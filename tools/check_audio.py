"""Step 4: fail loudly if any lecture sentence has no audio.

Usage:  tools/.venv/Scripts/python tools/check_audio.py <export.json> [more.json ...]
        (an export comes from Settings -> Export all, or the Lecture page's "Download for audio")

Exit code 0 only when every sentence of every lecture has a manifest entry, an existing
non-empty .opus file, and word timings that line up with the words on screen.
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")  # Kokoro prints IPA symbols the Windows console cannot show otherwise
except Exception:
    pass
from pathlib import Path

from audio_common import ROOT, load_creations, load_manifest, sentences_of, sha, split_words

files = [Path(a) for a in sys.argv[1:]]
if not files:
    print(__doc__)
    sys.exit(2)

manifest = load_manifest()
entries = manifest.get("sentences", {})
total = missing = 0
problems = []
for f in files:
    for c in load_creations(f):
        lec = c.get("lecture")
        if not lec:
            print(f"- {c.get('name')}: no lecture written yet (open Lecture in the app first)")
            continue
        sents = sentences_of(lec)
        ok = 0
        for s in sents:
            total += 1
            h = sha(s)
            e = entries.get(h)
            path = ROOT / e["file"] if e else None
            if not e:
                problems.append((c["name"], s, "not in manifest"))
            elif not path.exists() or path.stat().st_size == 0:
                problems.append((c["name"], s, f"file missing or empty: {e['file']}"))
            elif len(e.get("words", [])) != len(split_words(s)):
                problems.append((c["name"], s, f"word timings ({len(e.get('words', []))}) do not match words on screen ({len(split_words(s))})"))
            else:
                ok += 1
        missing += len(sents) - ok
        print(f"- {c['name']}: {ok}/{len(sents)} sentences have audio")

print()
if problems:
    for name, s, why in problems:
        print(f"MISSING [{name}] {why}\n    \"{s[:90]}{'…' if len(s) > 90 else ''}\"")
    print(f"\nFAIL: {len(problems)} of {total} sentences are not playable. Run tools/make_audio.py on the same export.")
    sys.exit(1)
print(f"OK: all {total} sentences have audio (voice {manifest.get('voice', '?')}).")
