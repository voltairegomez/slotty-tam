# Slotty Tam

The fun discovery platform — casinos, food, nightlife, speakeasies, shows, and hidden gems.
A real app: static front-end + a JSON API running as Vercel serverless functions, backed by a
**Turso (libSQL) database**. Search, newsletter signup, and giveaway entries all work and persist.

## Live deploy (Vercel + Turso)

This repo is wired for Vercel. It needs two environment variables pointing at your Turso database:

| Variable | Value |
|----------|-------|
| `TURSO_DATABASE_URL` | your `libsql://…turso.io` URL |
| `TURSO_AUTH_TOKEN`   | a Turso token with Read & Write |

Set them in **Vercel → your project → Settings → Environment Variables** (add to Production,
Preview, and Development), then deploy. On the first request the app **self-seeds** the database
from `data/seed.json`, so there's no manual seed step.

## Run locally

```bash
npm install
cp .env.example .env      # then paste your TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
npm start                 # http://localhost:3000
```

No Turso handy? Use a local file database instead — set `TURSO_DATABASE_URL=file:./dev.db` in
`.env` and everything runs offline with the same code.

### Commands

```bash
npm start     # run the site + API locally
npm run dev   # same, with auto-reload
npm run seed  # wipe & re-seed content tables from data/seed.json (keeps signups)
npm test      # API test suite (runs against a temp local DB)
```

## Editing content

All content lives in **`data/seed.json`** — venues, happy hours, road trips, merch, the giveaway,
and the ticker. The DB self-seeds from it once, when empty. To apply edits to an
already-seeded database, run `npm run seed` (destructive to content tables only; subscribers and
giveaway entries are preserved).

To add a venue, add an object to `listings`. Key fields: `category`
(`casino|restaurant|speakeasy|buffet|show|activity`), `featured` + `featured_slot`
(`main`/`small`), `tams_pick` + `tam_quote` + `tam_rating`, `jackpot` (an object → Jackpot of the
Week), `password_hint` (speakeasies), and `tags` (also searchable).

## API

Base `/api`: `listings` (search: `q`, `category`, `pill`, `featured`, `tams_pick`, `limit`,
`offset`), `listings/:id`, `categories`, `happy-hours`, `featured`, `picks`, `jackpot`,
`giveaway`, `road-trips`, `merch`, `ticker`, `stats`, `POST newsletter`, `POST giveaway/enter`.

## Structure

```
slotty-tam/
├── index.html          # front-end (served static by Vercel)
├── api/
│   └── [...path].js    # one serverless function → routes all /api/* through Express
├── lib/
│   ├── app.js          # Express routes
│   ├── db.js           # Turso/libSQL client
│   └── seed.js         # schema + seed (self-seed on first run)
├── scripts/
│   ├── seed.mjs        # `npm run seed`
│   └── test.mjs        # `npm test`
├── data/seed.json      # all editable content
├── server.js           # local dev server (static + API)
├── vercel.json         # bundles data/ with the function
└── package.json
```

## Notes

- Turso's free tier covers this comfortably; the whole stack (Vercel Hobby + Turso free) is ~$0.
- Venue data is a realistic starter set, not a live feed. To use real venues, point the data layer
  at a source like Google Places or Yelp.
- Favorites / accounts / cart currently show toasts — the natural next things to make real.

© 2025 Pure Design Werx.
