"""Local audio helper. Runs on your PC and lets the NoteQuest web app generate Kokoro audio automatically.

Start it with tools/start_audio_helper.bat (or: tools/.venv/Scripts/python tools/audio_server.py).
Leave the window open. The app finds it at http://localhost:8788.

Endpoints:
  GET  /health                      -> {"ok": true, "voice": ..., "model": ...}
  POST /synthesize {"sentences": [..], "voice": "af_heart"}
       -> {"sentences": {"<sha256>": {"dur", "words", "voice", "data": <base64 opus>}}}
       Clips are also written to audio/<sha256>.opus and audio/manifest.json, so a plain
       `git add audio && git commit && git push` publishes them for other devices.
"""
import base64
import datetime as dt
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from audio_common import AUDIO_DIR, DEFAULT_VOICE, MODEL, ROOT, load_manifest, save_manifest, sha, split_words
from make_audio import Synth, WORK, encode_opus, proportional_timings, word_timings

PORT = 8788
lock = threading.Lock()
synths = {}
manifest = load_manifest()


def get_synth(voice):
    if voice not in synths:
        synths[voice] = Synth(voice)
    return synths[voice]


def make_clip(text, voice):
    h = sha(text)
    path = AUDIO_DIR / f"{h}.opus"
    e = manifest["sentences"].get(h)
    if not (e and path.exists() and path.stat().st_size > 0 and e.get("voice") == voice):
        audio, toks, dur = get_synth(voice).synth(text)
        if dur <= 0:
            raise RuntimeError("empty audio")
        words = split_words(text)
        timings = word_timings(toks, words, dur) or proportional_timings(words, dur)
        AUDIO_DIR.mkdir(exist_ok=True)
        WORK.mkdir(exist_ok=True)
        encode_opus(audio, WORK / f"{h}.wav", path, manifest.get("bitrate") or "32k")
        e = {"file": f"audio/{h}.opus", "dur": round(dur, 3), "voice": voice, "words": timings, "approx": False, "text": text}
        manifest["sentences"][h] = e
        manifest.update({"voice": manifest.get("voice") or voice, "model": MODEL, "bitrate": manifest.get("bitrate") or "32k",
                         "generated": dt.datetime.now().isoformat(timespec="seconds")})
        save_manifest(manifest)
        print(f"  made {dur:4.1f}s  {text[:70]}{'…' if len(text) > 70 else ''}", flush=True)
    return h, {"dur": e["dur"], "words": e["words"], "voice": e["voice"], "data": base64.b64encode(path.read_bytes()).decode("ascii")}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json(200, {"ok": True, "voice": manifest.get("voice") or DEFAULT_VOICE, "model": MODEL, "clips": len(manifest["sentences"])})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/synthesize"):
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
            sentences = [str(s).strip() for s in req.get("sentences", []) if str(s).strip()]
            voice = req.get("voice") or manifest.get("voice") or DEFAULT_VOICE
            if not sentences:
                return self._json(400, {"error": "no sentences"})
            out = {}
            with lock:
                for s in sentences[:50]:
                    h, clip = make_clip(s, voice)
                    out[h] = clip
            self._json(200, {"sentences": out, "voice": voice})
        except Exception as ex:
            print("ERROR", ex, flush=True)
            self._json(500, {"error": str(ex)})

    def log_message(self, fmt, *args):  # quieter console
        if "/synthesize" in fmt % args or "error" in (fmt % args).lower():
            print(fmt % args, flush=True)


if __name__ == "__main__":
    voice = manifest.get("voice") or DEFAULT_VOICE
    print(f"NoteQuest audio helper starting on http://localhost:{PORT}  (project: {ROOT})", flush=True)
    print("Loading Kokoro…", flush=True)
    get_synth(voice)
    print(f"Ready. Voice {voice}. Leave this window open; the app will generate lecture audio through it.", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
