# NoteQuest

A personal study app: photograph your notes, pick a game mode and a theme, and Claude turns them into flash cards, a monster-battle game, a matching game, a speed round, and a quiz. Everything runs in the browser; there is no server.

## Files

- `index.html`, `styles.css` – the page and all themes
- `js/store.js` – IndexedDB storage (creations) + localStorage (settings)
- `js/api.js` – the Claude API call and image compression
- `js/games.js` – Flash Cards, Notemon, Match, Blitz, and Quiz
- `js/app.js` – routing, Your Creations, Create, Settings, sample set

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

1. Open Settings and paste a Claude API key from https://console.anthropic.com. The key is stored only in your browser's localStorage and is sent only to `api.anthropic.com`. It is never in the repo.
2. Go to Create, add photos of your notes, choose a game mode and theme, and press Generate.
3. Your new set appears on the Creations page with Study and Quiz buttons.

Use "Load sample set" in Settings to try the games without an API key.

## Notes

- Photos are downscaled in the browser (longest side 1568px, JPEG) before being sent, so a page of notes costs roughly 1,500 input tokens.
- Export/Import in Settings moves your sets between devices as a JSON file.
- The default model is Claude Opus 5; Sonnet 5 is available in Settings for cheaper generation.
