"""Step 1 proof: synthesize ONE word with Kokoro, encode it to Opus, print what came back.

Run:  tools/.venv/Scripts/python tools/proof.py [word] [voice]
"""
import subprocess, sys, time
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
from pathlib import Path

word = sys.argv[1] if len(sys.argv) > 1 else "photosynthesis"
voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
out = Path(__file__).parent / "_work"
out.mkdir(exist_ok=True)

t0 = time.time()
from kokoro import KPipeline  # noqa: E402
import soundfile as sf  # noqa: E402
import imageio_ffmpeg  # noqa: E402
import numpy as np  # noqa: E402

pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
print(f"pipeline ready in {time.time() - t0:.1f}s")

t1 = time.time()
chunks = []
for r in pipe(word, voice=voice):
    audio = r.audio.numpy() if hasattr(r.audio, "numpy") else np.asarray(r.audio)
    chunks.append(audio)
    toks = getattr(r, "tokens", None) or []
    print("graphemes:", r.graphemes)
    print("phonemes :", r.phonemes)
    for t in toks:
        print(f"  token {t.text!r:20} start={getattr(t, 'start_ts', None)} end={getattr(t, 'end_ts', None)} ws={t.whitespace!r}")
audio = np.concatenate(chunks)
print(f"synthesized {len(audio) / 24000:.2f}s of audio in {time.time() - t1:.1f}s")

wav = out / f"{word}.wav"
opus = out / f"{word}.opus"
sf.write(wav, audio, 24000)
ff = imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libopus", "-b:a", "32k", str(opus)], check=True)
print(f"wav  {wav.stat().st_size:,} bytes -> {wav}")
print(f"opus {opus.stat().st_size:,} bytes -> {opus}")
print("PROOF OK")
