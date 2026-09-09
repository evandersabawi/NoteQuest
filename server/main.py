"""NoteQuest account server (deploy on Railway).

Username + password accounts, security-question password reset, and sync of each user's profile and
study sets. Uses Postgres when DATABASE_URL is set (Railway), otherwise a local SQLite file for testing.

Environment:
  DATABASE_URL   postgres://... (Railway injects this when you add a Postgres service and reference it)
  JWT_SECRET     any long random string (required in production)
  ALLOWED_ORIGINS comma-separated origins allowed to call the API (default: the GitHub Pages site + localhost)
  PORT           set by Railway
"""
import datetime as dt
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Any, Optional

import bcrypt
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

DATABASE_URL = os.environ.get("DATABASE_URL", "")
JWT_SECRET = os.environ.get("JWT_SECRET") or ("dev-secret-" + secrets.token_hex(8))
ALLOWED = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "https://evandersabawi.github.io,http://localhost:8766,http://localhost:8765,http://127.0.0.1:8766").split(",") if o.strip()]
MAX_ATTEMPTS, LOCK_SECONDS = 5, 30
TOKEN_DAYS_STAY, TOKEN_HOURS_SESSION = 30, 12

app = FastAPI(title="NoteQuest API")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)


# ---------- database (Postgres or SQLite with the same SQL) ----------
class DB:
    def __init__(self):
        self.pg = DATABASE_URL.startswith("postgres")
        if self.pg:
            import psycopg
            self.psycopg = psycopg
            self.url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        else:
            self.path = os.environ.get("SQLITE_PATH", os.path.join(os.path.dirname(__file__), "notequest.sqlite3"))

    @contextmanager
    def conn(self):
        if self.pg:
            with self.psycopg.connect(self.url) as c:
                yield _PgConn(c)
        else:
            c = sqlite3.connect(self.path)
            c.row_factory = sqlite3.Row
            try:
                yield _SqliteConn(c)
                c.commit()
            finally:
                c.close()

    def init(self):
        with self.conn() as c:
            c.exec("""CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lc TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
                recovery_q TEXT, recovery_hash TEXT, profile TEXT NOT NULL, created_at BIGINT NOT NULL, last_login BIGINT,
                fail_count INTEGER NOT NULL DEFAULT 0, lock_until BIGINT NOT NULL DEFAULT 0)""")
            c.exec("""CREATE TABLE IF NOT EXISTS creations (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL)""")
            c.exec("CREATE INDEX IF NOT EXISTS creations_user ON creations(user_id)")


class _PgConn:
    def __init__(self, c): self.c = c
    def exec(self, sql, args=()):
        with self.c.cursor() as cur:
            cur.execute(sql.replace("?", "%s"), args)
    def one(self, sql, args=()):
        with self.c.cursor() as cur:
            cur.execute(sql.replace("?", "%s"), args)
            row = cur.fetchone()
            return dict(zip([d.name for d in cur.description], row)) if row else None
    def all(self, sql, args=()):
        with self.c.cursor() as cur:
            cur.execute(sql.replace("?", "%s"), args)
            names = [d.name for d in cur.description]
            return [dict(zip(names, r)) for r in cur.fetchall()]


class _SqliteConn:
    def __init__(self, c): self.c = c
    def exec(self, sql, args=()): self.c.execute(sql, args)
    def one(self, sql, args=()):
        r = self.c.execute(sql, args).fetchone()
        return dict(r) if r else None
    def all(self, sql, args=()): return [dict(r) for r in self.c.execute(sql, args).fetchall()]


db = DB()
db.init()
now_ms = lambda: int(time.time() * 1000)


# ---------- helpers ----------
def hash_pw(p: str) -> str: return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()
def check_pw(p: str, h: str) -> bool:
    try: return bcrypt.checkpw(p.encode(), h.encode())
    except Exception: return False
def norm_answer(a: str) -> str: return " ".join(a.strip().lower().split())

def make_token(uid: str, stay: bool) -> str:
    exp = dt.datetime.now(dt.timezone.utc) + (dt.timedelta(days=TOKEN_DAYS_STAY) if stay else dt.timedelta(hours=TOKEN_HOURS_SESSION))
    return jwt.encode({"sub": uid, "exp": exp}, JWT_SECRET, algorithm="HS256")

def user_out(u: dict) -> dict:
    prof = json.loads(u["profile"]) if isinstance(u["profile"], str) else u["profile"]
    prof.update({"id": u["id"], "name": u["username"], "cloud": True, "createdAt": u["created_at"], "lastLogin": u["last_login"], "recoveryQ": u["recovery_q"]})
    return prof

def current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not logged in")
    try:
        uid = jwt.decode(authorization[7:], JWT_SECRET, algorithms=["HS256"])["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired. Log in again.")
    except Exception:
        raise HTTPException(401, "Invalid session. Log in again.")
    with db.conn() as c:
        u = c.one("SELECT * FROM users WHERE id=?", (uid,))
    if not u: raise HTTPException(401, "Account no longer exists")
    return u

def valid_username(n: str) -> bool:
    import re
    return bool(re.fullmatch(r"[\w.\-]{2,24}", n))


@app.exception_handler(HTTPException)
async def http_err(_: Request, e: HTTPException):
    return JSONResponse({"error": e.detail}, status_code=e.status_code)


# ---------- models ----------
class SignUp(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=200)
    avatar: dict = {}
    securityQ: str = Field(min_length=3, max_length=200)
    securityA: str = Field(min_length=2, max_length=200)
    stay: bool = True
    profile: dict = {}

class Login(BaseModel):
    username: str
    password: str
    stay: bool = True

class Reset(BaseModel):
    username: str
    answer: str
    newPassword: str = Field(min_length=8, max_length=200)

class ChangePw(BaseModel):
    current: str
    new: str = Field(min_length=8, max_length=200)

class Password(BaseModel):
    password: str

class Question(BaseModel):
    question: str = Field(min_length=3, max_length=200)
    answer: str = Field(min_length=2, max_length=200)
    password: str


# ---------- routes ----------
@app.get("/health")
def health():
    with db.conn() as c:
        n = c.one("SELECT COUNT(*) AS n FROM users")["n"]
    return {"ok": True, "users": n, "db": "postgres" if db.pg else "sqlite"}

@app.post("/auth/signup")
def signup(b: SignUp):
    name = b.username.strip()
    if not valid_username(name): raise HTTPException(400, "Username must be 2–24 characters: letters, numbers, dots, dashes or underscores.")
    uid = str(uuid.uuid4())
    prof = {k: v for k, v in b.profile.items() if k in ("stats", "activeDays")}
    prof.setdefault("stats", {"quizzes": 0, "quizPctTotal": 0, "quizBest": 0, "cardsStudied": 0, "flashRuns": 0, "monstersCaught": 0, "notemonWins": 0, "matchGames": 0, "matchBest": None, "blitzBest": 0, "blitzGames": 0, "xp": 0})
    prof.setdefault("activeDays", [])
    prof["avatar"] = b.avatar or {"kind": 0, "color": "#8b7cff"}
    with db.conn() as c:
        if c.one("SELECT 1 AS x FROM users WHERE username_lc=?", (name.lower(),)):
            raise HTTPException(409, "That username is taken.")
        c.exec("INSERT INTO users (id, username, username_lc, pass_hash, recovery_q, recovery_hash, profile, created_at, last_login) VALUES (?,?,?,?,?,?,?,?,?)",
               (uid, name, name.lower(), hash_pw(b.password), b.securityQ.strip(), hash_pw(norm_answer(b.securityA)), json.dumps(prof), now_ms(), now_ms()))
        u = c.one("SELECT * FROM users WHERE id=?", (uid,))
    return {"token": make_token(uid, b.stay), "user": user_out(u)}

@app.post("/auth/login")
def login(b: Login):
    with db.conn() as c:
        u = c.one("SELECT * FROM users WHERE username_lc=?", (b.username.strip().lower(),))
        if not u: raise HTTPException(401, "Wrong username or password.")
        if u["lock_until"] > now_ms():
            raise HTTPException(429, f"Too many attempts. Try again in {int((u['lock_until'] - now_ms()) / 1000) + 1}s.")
        if not check_pw(b.password, u["pass_hash"]):
            n = u["fail_count"] + 1
            if n >= MAX_ATTEMPTS:
                c.exec("UPDATE users SET fail_count=0, lock_until=? WHERE id=?", (now_ms() + LOCK_SECONDS * 1000, u["id"]))
                raise HTTPException(429, f"Too many wrong passwords. Locked for {LOCK_SECONDS} seconds.")
            c.exec("UPDATE users SET fail_count=? WHERE id=?", (n, u["id"]))
            left = MAX_ATTEMPTS - n
            raise HTTPException(401, f"Wrong username or password. {left} attempt{'' if left == 1 else 's'} left.")
        c.exec("UPDATE users SET fail_count=0, lock_until=0, last_login=? WHERE id=?", (now_ms(), u["id"]))
        u = c.one("SELECT * FROM users WHERE id=?", (u["id"],))
    return {"token": make_token(u["id"], b.stay), "user": user_out(u)}

@app.get("/auth/question")
def question(username: str):
    with db.conn() as c:
        u = c.one("SELECT recovery_q FROM users WHERE username_lc=?", (username.strip().lower(),))
    if not u: raise HTTPException(404, "No account with that username.")
    if not u["recovery_q"]: raise HTTPException(400, "This account has no security question, so the password cannot be reset.")
    return {"question": u["recovery_q"]}

@app.post("/auth/reset")
def reset(b: Reset):
    with db.conn() as c:
        u = c.one("SELECT * FROM users WHERE username_lc=?", (b.username.strip().lower(),))
        if not u: raise HTTPException(404, "No account with that username.")
        if u["lock_until"] > now_ms(): raise HTTPException(429, "Too many attempts. Try again in a moment.")
        if not u["recovery_hash"] or not check_pw(norm_answer(b.answer), u["recovery_hash"]):
            n = u["fail_count"] + 1
            lock = now_ms() + LOCK_SECONDS * 1000 if n >= MAX_ATTEMPTS else 0
            c.exec("UPDATE users SET fail_count=?, lock_until=? WHERE id=?", (0 if lock else n, lock, u["id"]))
            raise HTTPException(401, "Wrong answer.")
        c.exec("UPDATE users SET pass_hash=?, fail_count=0, lock_until=0 WHERE id=?", (hash_pw(b.newPassword), u["id"]))
    return {"ok": True}

@app.post("/auth/password")
def change_password(b: ChangePw, u: dict = Depends(current_user)):
    if not check_pw(b.current, u["pass_hash"]): raise HTTPException(401, "Current password is wrong.")
    with db.conn() as c:
        c.exec("UPDATE users SET pass_hash=? WHERE id=?", (hash_pw(b.new), u["id"]))
    return {"ok": True}

@app.post("/auth/question")
def set_question(b: Question, u: dict = Depends(current_user)):
    if not check_pw(b.password, u["pass_hash"]): raise HTTPException(401, "Password is wrong.")
    with db.conn() as c:
        c.exec("UPDATE users SET recovery_q=?, recovery_hash=? WHERE id=?", (b.question.strip(), hash_pw(norm_answer(b.answer)), u["id"]))
    return {"ok": True}

@app.post("/auth/delete")
def delete_account(b: Password, u: dict = Depends(current_user)):
    if not check_pw(b.password, u["pass_hash"]): raise HTTPException(401, "Password is wrong.")
    with db.conn() as c:
        c.exec("DELETE FROM creations WHERE user_id=?", (u["id"],))
        c.exec("DELETE FROM users WHERE id=?", (u["id"],))
    return {"ok": True}

@app.get("/me")
def me(u: dict = Depends(current_user)):
    return user_out(u)

@app.put("/me")
def update_me(body: dict, u: dict = Depends(current_user)):
    prof = json.loads(u["profile"]) if isinstance(u["profile"], str) else dict(u["profile"])
    for k in ("stats", "activeDays", "avatar"):
        if k in body: prof[k] = body[k]
    name = u["username"]
    if isinstance(body.get("name"), str) and body["name"].strip() != u["username"]:
        name = body["name"].strip()
        if not valid_username(name): raise HTTPException(400, "Username must be 2–24 characters: letters, numbers, dots, dashes or underscores.")
    with db.conn() as c:
        if name.lower() != u["username_lc"] and c.one("SELECT 1 AS x FROM users WHERE username_lc=?", (name.lower(),)):
            raise HTTPException(409, "That username is taken.")
        c.exec("UPDATE users SET profile=?, username=?, username_lc=? WHERE id=?", (json.dumps(prof), name, name.lower(), u["id"]))
        u2 = c.one("SELECT * FROM users WHERE id=?", (u["id"],))
    return user_out(u2)

@app.get("/creations")
def list_creations(u: dict = Depends(current_user)):
    with db.conn() as c:
        rows = c.all("SELECT data FROM creations WHERE user_id=? ORDER BY updated_at DESC", (u["id"],))
    return {"creations": [json.loads(r["data"]) if isinstance(r["data"], str) else r["data"] for r in rows]}

@app.put("/creations/{cid}")
async def put_creation(cid: str, request: Request, u: dict = Depends(current_user)):
    raw = await request.body()
    if len(raw) > 4_000_000: raise HTTPException(413, "That set is too large to sync (over 4 MB).")
    data = json.loads(raw)
    if not isinstance(data, dict) or data.get("id") != cid: raise HTTPException(400, "Bad set")
    data.pop("audioClips", None)
    data["owner"] = u["id"]
    upd = int(data.get("updatedAt") or now_ms())
    with db.conn() as c:
        if c.one("SELECT 1 AS x FROM creations WHERE id=? AND user_id=?", (cid, u["id"])):
            c.exec("UPDATE creations SET data=?, updated_at=? WHERE id=? AND user_id=?", (json.dumps(data), upd, cid, u["id"]))
        elif c.one("SELECT 1 AS x FROM creations WHERE id=?", (cid,)):
            raise HTTPException(403, "That set belongs to another account")
        else:
            c.exec("INSERT INTO creations (id, user_id, data, updated_at) VALUES (?,?,?,?)", (cid, u["id"], json.dumps(data), upd))
    return {"ok": True, "updatedAt": upd}

@app.delete("/creations/{cid}")
def delete_creation(cid: str, u: dict = Depends(current_user)):
    with db.conn() as c:
        c.exec("DELETE FROM creations WHERE id=? AND user_id=?", (cid, u["id"]))
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8787")))
