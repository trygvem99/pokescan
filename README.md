# PokéScan

Scan a Pokémon card with your phone, identify it, and see its **real Cardmarket value (EUR)**.

A zero-build mobile web app (PWA). No accounts, no API keys, no backend.

## How it works

1. **Scan** — capture the card with your phone camera (or upload a photo).
2. **Read** — on-device OCR (Tesseract.js) reads the card name + collector number. The image never leaves your phone.
3. **Identify** — looks the card up in the [pokemontcg.io](https://pokemontcg.io) database and shows matching cards *with images* so you confirm the exact variant/set.
4. **Value** — shows the card's real **Cardmarket** prices and lets you pick the condition that matches yours.

### Honest limits
- Cardmarket's gated API isn't used; prices come through pokemontcg.io, which exposes Cardmarket's *aggregate* figures (trend / low / EX+ low / average / 7- & 30-day avg) — not a full per-grade table.
- The app does **not** professionally grade your card. Condition is the tier *you* select; the value is the real Cardmarket anchor for that tier. No invented multipliers.

## Run locally

```bash
node server.js          # → http://localhost:5173
# or: python -m http.server 5173
```

Open `http://localhost:5173` on your computer. The live camera works on `localhost`.

## Use it on your phone (live camera needs HTTPS)

Phone browsers only allow the live camera over **HTTPS**. Two easy paths:

- **Deploy** the folder to any static host (GitHub Pages, Netlify, Vercel) and open the HTTPS URL on your phone.
- Or just use the **“Upload / take photo”** button, which works over plain HTTP on the local network too.

## Files
- `index.html` / `styles.css` / `app.js` — the app
- `manifest.webmanifest` / `sw.js` / `icon.svg` — PWA shell (installable, offline)
- `server.js` — tiny static dev server
