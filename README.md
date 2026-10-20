# Milk Tracker

[![Tests](https://github.com/ebdkhdev/milk-tracker/actions/workflows/test.yml/badge.svg)](https://github.com/ebdkhdev/milk-tracker/actions/workflows/test.yml)

A small offline-first PWA to log a baby's bottle feeds: daily totals against a minimum that depends on the baby's age, time since the last bottle and feeding rhythm, editable quick-add amounts, optional milk type and notes, 7/30-day history and stats, a printable summary for the paediatrician, and a daily vitamin D check with reminder. French, English and Arabic. All data stays on the device (IndexedDB), with export/import to a file for backups. An optional account (email and password, or Google; Neon Auth) saves everything to a Neon Postgres database in Europe, brings it to every device and shares it with the other parent by email invitation, through small Vercel Functions. Optional push notifications (vitamin D reminder, next expected bottle, the other parent's bottles) work with the app closed; they send the reminder time, time zone and last bottle time to the same server and are scheduled with Upstash QStash.

Built with React, TypeScript and TanStack Start (SPA mode, static output).

## Run locally

    npm install
    npm run dev

Production build (static site in `dist/client`, including the service worker):

    npm run build
    python3 -m http.server 8000 -d dist/client

Tests (builds, then runs the end-to-end suite in a local headless Chrome; set `CHROME_PATH` if needed):

    npm test

## Deploy (Vercel)

    npx vercel deploy --prod

`vercel.json` tells Vercel to run `npm run build` and serve `dist/client`.
