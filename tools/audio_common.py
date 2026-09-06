"""Shared helpers for the audio tools. The sentence and word splitting here MUST match js/lecture.js,
because audio files are named by the sha256 of the exact sentence text the app displays."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio"
MANIFEST = AUDIO_DIR / "manifest.json"
MODEL = "hexgrad/Kokoro-82M"
DEFAULT_VOICE = "af_heart"
SAMPLE_RATE = 24000

# Same regex as splitSentences() in js/lecture.js
SENT_RE = re.compile(r"[^.!?]+(?:[.!?]+[\"'”’)\]]*|$)")
WORD_RE = re.compile(r"\S+")


def split_sentences(text: str):
    parts = SENT_RE.findall(text) or [text]
    return [p.strip() for p in parts if p.strip()]


def split_words(sentence: str):
    return WORD_RE.findall(sentence)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sentences_of(lecture: dict):
    out = []
    for sec in lecture.get("sections", []):
        for p in sec.get("paragraphs", []):
            out.extend(split_sentences(str(p).strip()))
    return out


def load_creations(path: Path):
    """Accepts a Settings -> Export file, a Lecture page 'Download for audio' file, or a bare creation."""
    data = json.loads(Path(path).read_text("utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "creations" in data:
        return data["creations"]
    if isinstance(data, dict) and ("lecture" in data or "cards" in data):
        return [data]
    if isinstance(data, dict) and "sections" in data:  # a bare lecture, e.g. audio/sample_lecture.json
        return [{"name": data.get("title", Path(path).stem), "lecture": data}]
    return []


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text("utf-8"))
    return {"version": 1, "model": MODEL, "voice": None, "bitrate": "32k", "generated": None, "sentences": {}}


def save_manifest(m: dict):
    AUDIO_DIR.mkdir(exist_ok=True)
    tmp = MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(m, ensure_ascii=False, separators=(",", ":")), "utf-8")
    tmp.replace(MANIFEST)
