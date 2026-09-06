# NoteQuest

A personal study app: photograph your notes, pick a game mode and a theme, and Claude turns them into flash cards, a monster-battle game, a matching game, a speed round, and a quiz. Everything runs in the browser; there is no server.

Layout: a top bar with log in / sign up / log out, a sidebar with Home, Your creations, Create and a settings gear, and a Home screen showing your avatar, username, level/XP, stats and recent notes. Accounts are local profiles stored in the browser: username, a drawn creature avatar, a password (stored only as a salted PBKDF2 hash) and a security question for password resets. Five wrong passwords lock the account for 30 seconds. No email, no server.

## Files

- `index.html`, `styles.css` – the page and all themes
- `js/icons.js` – inline SVG line icons, generated creature avatars and Notemon monsters (no emoji anywhere)
- `js/store.js` – IndexedDB storage (creations) + localStorage (settings, accounts)
- `js/api.js` – the Claude API call and image compression
- `js/games.js` – Flash Cards, Notemon, Match, Blitz, and Quiz
- `js/lecture.js` – Lecture mode: Claude writes a spoken lecture; pre-generated Kokoro audio plays while the transcript highlights each word
- `audio/` – pre-generated lecture clips (`<sha256 of sentence>.opus`, 32 kbps) plus `manifest.json` and the sample lecture text
- `tools/` – the local audio pipeline (see below)
- `js/app.js` – accounts, routing, Home, Your Creations, Create, Settings, sample set

## Run locally

Any static file server works. For example:

```bash
python -m http.server 8765 --directory notequest
```

Then open http://localhost:8765. Opening `index.html` directly from disk also works in most browsers.

## Deploy to GitHub Pages

1. Create a new GitHub repository (public or private both work for Pages on a personal account with a Pro plan; public is simplest).
2. Copy the contents of the `notequest` folder into the repo root and push.
3. In the repo: Settings → Pages → Source: "Deploy from a branch" → branch `main`, folder `/ (root)` → Save.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

## First use

1. Sign up with a username, password, security question and an avatar (all stored on this device only). Untick "Stay signed in" to be logged out when the tab closes.
2. Open Settings (gear icon at the bottom of the sidebar) and paste a Claude API key from https://console.anthropic.com. The key is stored only in your browser's localStorage and is sent only to `api.anthropic.com`. It is never in the repo.
3. Go to Create, add photos of your notes, choose a game mode and theme, and press Generate.
4. Your new set appears on the Creations page with Study, Quiz and Lecture buttons. Lecture writes a spoken lecture the first time you open it (text only, a few cents) and then reads it aloud with word-by-word highlighting; you can change speed and voice, click any sentence to jump, or have Claude rewrite it.

Use "Load a sample" on the Home screen (or in Settings) to try the games without an API key.

If you unzip the download and see only the header bar, check that a `js` folder with four files sits next to `index.html`.

## Notes

- Photos are downscaled in the browser (longest side 1568px, JPEG) before being sent, so a page of notes costs roughly 1,500 input tokens.
- Export/Import in Settings moves your sets between devices as a JSON file.
- The default model is Claude Opus 5; Sonnet 5 is available in Settings for cheaper generation.
- If your Anthropic account runs out of credits, the Create page shows an "out of credits" banner with a link to the billing page. Rate limits, overload and bad keys get plain-language messages too.

## Lecture audio (Kokoro, local and free)

Lecture audio is never synthesized when you press Play. It is pre-generated on your PC with the
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) model, stored as one Opus file per sentence, and
committed with the site. Files are named by the sha256 of the exact sentence text, so re-running skips
everything that already exists and any edited sentence gets fresh audio automatically.

One-time setup (Python 3.12 environment inside `tools/.venv`, ignored by git):

```bash
python -m pip install --user uv
uv venv --python 3.12 tools/.venv
uv pip install --python tools/.venv/Scripts/python.exe kokoro soundfile imageio-ffmpeg pip
```

Prove it works on one word, then listen to the voices and pick one:

```bash
tools/.venv/Scripts/python tools/proof.py photosynthesis
tools/.venv/Scripts/python tools/make_audio.py --samples
```

Generate audio for a lecture:

1. Open the lecture in the app and press **For audio** (or Settings → Export all). This downloads a JSON file with the lecture text.
2. `tools/.venv/Scripts/python tools/make_audio.py path/to/lecture-xxx.json --voice af_heart`
3. `tools/.venv/Scripts/python tools/check_audio.py path/to/lecture-xxx.json` must print `OK` (it exits non-zero and lists every sentence that has no playable audio).
4. Listen to a couple of the new clips in `audio/`, then `git add audio && git commit && git push`.

The manifest (`audio/manifest.json`) records every sentence, its file, duration, voice and per-word timings; the app
uses those timings to highlight words. Sentences without audio fall back to the browser's built-in voice or a silent
timed scroll, and the Lecture page says so plainly.
