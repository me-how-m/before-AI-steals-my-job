# Before AI steals my job…

An anonymous wall of things people want to do before AI steals their job. Handwritten notes drift across an animated gradient — raises never asked for, inboxes never cleared, resignation letters never sent. You can open any of them, add a "+ me too", copy them — or leave your own.

Built as a static site: no build step, no framework, no dependencies (only Google Fonts at runtime). And yes, it was built by AI.

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## Features

- **Floating notes** — 10 rows of notes drift left/right at different speeds, spaced so they never overlap, fading in toward the center of the screen and out toward the edges.
- **Composer** — a collapsible card with the prompt *"Before AI steals my job…"* where you write your own note (240 chars max).
- **Two-step posting flow** — sign it (name, initial, pseudonym) or stay anonymous, then optionally leave an email for a removal link.
- **Note detail** — click any floating note to read it in full, with author, time, a "+ me too" counter, and copy-to-clipboard. (Reply is coming soon.)
- **Live counter** — the badge in the corner counts every note on the wall, including yours.

## Files

- `index.html` — page structure and static markup
- `styles.css` — all styling and animations
- `data.js` — sample notes and row layout
- `app.js` — floaters, composer, modals, interactions

A themed variant of [before-I-die](https://github.com/me-how-m/before-I-die), originally mocked up with Claude Design (claude.ai/design) and implemented as a production static site by Claude Code.
