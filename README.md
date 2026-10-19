# Milk Tracker

A small offline-first PWA to log a baby's bottle feeds: daily totals against a minimum target, 7/30-day history and stats, and a daily vitamin D check with reminder. All data stays on the device (IndexedDB). No account, no backend.

Built with React, TypeScript and TanStack Start (SPA mode, static output).

## Run locally

    npm install
    npm run dev

Production build (static site in `dist/client`, including the service worker):

    npm run build
    python3 -m http.server 8000 -d dist/client

## Deploy (Vercel)

    npx vercel deploy --prod

`vercel.json` tells Vercel to run `npm run build` and serve `dist/client`.
