"""Steps 2 and 3: pre-generate lecture audio with Kokoro (local, free), one Opus file per sentence,
named by the sha256 of the exact sentence text. Re-running skips anything that already exists.

Usage:
  tools/.venv/Scripts/python tools/make_audio.py <export.json> [more.json ...]
      export.json comes from Settings -> Export all, or the Lecture page's "Download for audio".
  tools/.venv/Scripts/python tools/make_audio.py --text "Any sentence. Another one."
  tools/.venv/Scripts/python tools/make_audio.py --samples        # write voice samples to tools/_work for listening

Options:
  --voice af_heart     Kokoro voice (default: the manifest's voice, else af_heart)
  --bitrate 32k        Opus bitrate
  --force              regenerate even if audio already exists

Then commit the audio/ folder and push. The app plays these files and never synthesizes on tap.
"""
import argparse
import datetime as dt
import os
import subprocess
import sys
import time
from pathlib import Path

from audio_common import (AUDIO_DIR, DEFAULT_VOICE, MODEL, ROOT, SAMPLE_RATE, load_creations, load_manifest, save_manifest,
                          sentences_of, sha, split_sentences, split_words)

SAMPLE_VOICES = ["af_heart", "af_bella", "af_sky", "am_michael", "bm_george"]
SAMPLE_TEXT = "Photosynthesis takes place inside chloroplasts. Pause and think: which part do you expect handles light?"
WORK = ROOT / "tools" / "_work"


def log(*a):
    print(*a, flush=True)


def word_timings(tokens, words, duration):
    """Group misaki tokens (which split punctuation off) back into the whitespace-separated words the
    app shows, and give each word a [start, end] in seconds. Returns None if the groups don't line up."""
    groups, cur = [], []
    for t in tokens:
        cur.append(t)
        if t.whitespace:
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    if len(groups) != len(words):
        return None
    out = []
    for g in groups:
        starts = [t.start_ts for t in g if t.start_ts is not None]
        ends = [t.end_ts for t in g if t.end_ts is not None]
        out.append([min(starts) if starts else None, max(ends) if ends else None])
    # Fill gaps (punctuation-only groups, missing stamps) from neighbours.
    for i, (s, e) in enumerate(out):
        if s is None:
            s = out[i - 1][1] if i and out[i - 1][1] is not None else 0.0
        if e is None:
            nxt = next((out[j][0] for j in range(i + 1, len(out)) if out[j][0] is not None), None)
            e = nxt if nxt is not None else duration
        out[i] = [round(float(s), 3), round(float(max(e, s)), 3)]
    return out


def proportional_timings(words, duration):
    total = sum(len(w) for w in words) or 1
    t, out = 0.0, []
    for w in words:
        d = duration * len(w) / total
        out.append([round(t, 3), round(t + d, 3)])
        t += d
    return out


class Synth:
    def __init__(self, voice):
        import numpy as np  # noqa: F401
        from kokoro import KPipeline
        t0 = time.time()
        self.pipe = KPipeline(lang_code="a", repo_id=MODEL)
        self.voice = voice
        log(f"Kokoro ready ({time.time() - t0:.1f}s), voice {voice}")

    def synth(self, text):
        import numpy as np
        chunks, toks, offset = [], [], 0.0
        for r in self.pipe(text, voice=self.voice):
            a = r.audio.numpy() if hasattr(r.audio, "numpy") else np.asarray(r.audio)
            for t in (getattr(r, "tokens", None) or []):
                toks.append(_Tok(t.text, t.whitespace, None if t.start_ts is None else t.start_ts + offset,
                                 None if t.end_ts is None else t.end_ts + offset))
            chunks.append(a)
            offset += len(a) / SAMPLE_RATE
        audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype="float32")
        return audio, toks, len(audio) / SAMPLE_RATE


class _Tok:
    __slots__ = ("text", "whitespace", "start_ts", "end_ts")

    def __init__(self, text, ws, s, e):
        self.text, self.whitespace, self.start_ts, self.end_ts = text, ws, s, e


def encode_opus(audio, wav_path: Path, opus_path: Path, bitrate: str):
    import soundfile as sf
    import imageio_ffmpeg
    sf.write(wav_path, audio, SAMPLE_RATE)
    tmp = opus_path.with_suffix(".opus.part")
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(wav_path),
                    "-c:a", "libopus", "-b:a", bitrate, "-application", "voip", "-f", "opus", str(tmp)], check=True)
    os.replace(tmp, opus_path)  # only ever swap in a fully written file
    wav_path.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("exports", nargs="*", help="export JSON files from the app")
    ap.add_argument("--text", help="generate audio for this text instead of an export")
    ap.add_argument("--voice")
    ap.add_argument("--bitrate", default="32k")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--samples", action="store_true", help="write voice samples as WAV to tools/_work")
    args = ap.parse_args()

    WORK.mkdir(exist_ok=True)
    if args.samples:
        import soundfile as sf
        for v in SAMPLE_VOICES:
            audio, _, dur = Synth(v).synth(SAMPLE_TEXT)
            p = WORK / f"sample_{v}.wav"
            sf.write(p, audio, SAMPLE_RATE)
            log(f"  {p.name}  {dur:.1f}s")
        log("Listen to the samples in tools/_work and pass your favourite as --voice.")
        return 0

    manifest = load_manifest()
    voice = args.voice or manifest.get("voice") or DEFAULT_VOICE
    if manifest.get("voice") and manifest["voice"] != voice:
        log(f"NOTE: manifest voice is {manifest['voice']}, generating new clips with {voice}. Use --force to redo old clips in the new voice.")

    # Collect every sentence we need, keyed by hash so duplicates are done once.
    wanted = {}
    for f in args.exports:
        for c in load_creations(Path(f)):
            lec = c.get("lecture")
            if not lec:
                log(f"- {c.get('name')}: no lecture written yet, skipping (open Lecture in the app first)")
                continue
            for s in sentences_of(lec):
                wanted.setdefault(sha(s), s)
    if args.text:
        for s in split_sentences(args.text):
            wanted.setdefault(sha(s), s)
    if not wanted:
        log("Nothing to do: give me an export JSON or --text.")
        return 2

    entries = manifest.setdefault("sentences", {})
    todo = []
    for h, s in wanted.items():
        e = entries.get(h)
        path = AUDIO_DIR / f"{h}.opus"
        if not args.force and e and path.exists() and path.stat().st_size > 0 and e.get("voice") == voice:
            continue
        todo.append((h, s, path))
    log(f"{len(wanted)} sentences wanted, {len(wanted) - len(todo)} already done, {len(todo)} to generate")
    if not todo:
        return 0

    synth = Synth(voice)
    AUDIO_DIR.mkdir(exist_ok=True)
    done = failed = approx = 0
    t0 = time.time()
    for i, (h, s, path) in enumerate(todo, 1):
        try:
            audio, toks, dur = synth.synth(s)
            if dur <= 0:
                raise RuntimeError("empty audio")
            words = split_words(s)
            timings = word_timings(toks, words, dur)
            if timings is None:
                timings = proportional_timings(words, dur)
                approx += 1
            encode_opus(audio, WORK / f"{h}.wav", path, args.bitrate)
            entries[h] = {"file": f"audio/{h}.opus", "dur": round(dur, 3), "voice": voice, "words": timings,
                          "approx": timings is None or len(timings) != len(words), "text": s}
            done += 1
            if i % 5 == 0 or i == len(todo):
                manifest.update({"voice": manifest.get("voice") or voice, "model": MODEL, "bitrate": args.bitrate,
                                 "generated": dt.datetime.now().isoformat(timespec="seconds")})
                save_manifest(manifest)
            log(f"  [{i}/{len(todo)}] {dur:5.1f}s  {path.stat().st_size:6,} B  {s[:70]}{'…' if len(s) > 70 else ''}")
        except Exception as ex:  # keep going; report at the end
            failed += 1
            log(f"  [{i}/{len(todo)}] FAILED: {ex}  \"{s[:70]}\"")
    manifest.update({"voice": manifest.get("voice") or voice, "model": MODEL, "bitrate": args.bitrate,
                     "generated": dt.datetime.now().isoformat(timespec="seconds")})
    save_manifest(manifest)
    log(f"\nGenerated {done}, failed {failed}, approximate word timing on {approx}, in {time.time() - t0:.0f}s.")
    log(f"Manifest: {len(entries)} sentences total. Now run tools/check_audio.py on the same export, then commit audio/.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
