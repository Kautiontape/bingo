# bingo

People-watching bingo at https://bingo.kautiontape.com. Private boards live in the browser;
shared boards live in SQLite on ktn and update live over Server-Sent Events.
Design and the reasons behind it: `docs/design/2026-10-16-bingo.md`.

## Commands

```bash
npm run dev     # server + static files on :3000 (PORT, DATABASE_URL override), restarts on change
npm test        # unit tests: card logic, game rules, HTTP layer (node --test)
npm run e2e     # two-browser run of the shared flow; needs Chromium (CHROMIUM=/path, default /usr/bin/chromium)
node scripts/make-images.js   # re-render public/og.png and public/apple-touch-icon.png
```

`npm ci` warns about better-sqlite3's install script; it's denied on purpose (`allowScripts`),
because the package ships prebuilt binaries for glibc and musl.

## Layout

- `public/` is served as-is, no build step. Vanilla ES modules.
  - `js/card.js` is pure card logic (deal, lines, score). **The server imports it too**; keep it
    free of DOM and Node APIs.
  - `js/phrases.js` holds the starter list and the fun-name word lists.
  - `js/app.js` is the page controller; `js/ui/*` are the menu, dialogs, players strip, confetti, toasts.
- `server/`: `boards.js` (game rules over SQLite, no HTTP), `routes.js` (Hono: validation,
  auth headers, rate limits, SSE, static files, page templating), `events.js` (per-board fan-out), `db.js`.
- Auth is two random secrets kept in the browser, stored hashed: `x-player-token` per player and
  `x-creator-key` for the creator's controls.
- The page loads its code from `/v/<content hash>/…` (immutable cache) because Cloudflare forces a
  4-hour browser cache on `.js`/`.css`. Keep module imports relative so they inherit the prefix.
- Cards change text on new rounds, edits and item renames; each bumps `boards.rev`, and clients
  refetch their own card when the `rev` in a state event differs.

## Deploy

Push to `main`: CI tests, builds `ghcr.io/kautiontape/bingo`, and the ktn runner pulls it in
`/opt/services/bingo` (`127.0.0.1:8116`). nginx config lives in `deploy/`; copy it to ktn by hand
when it changes. Commit style: `topic: message`.
