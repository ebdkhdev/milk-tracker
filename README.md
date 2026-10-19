# Milk Tracker

A small offline-first PWA to log a baby's bottle feeds: daily totals against a minimum target, 7/30-day history and stats, and a daily vitamin D check with reminder. All data stays on the device (IndexedDB). No account, no backend.

## Run locally

    python3 -m http.server 8000

## Deploy (Vercel)

Option A: https://vercel.com/new, "Deploy" without Git, drag this folder.

Option B (CLI):

    npm i -g vercel
    cd milk-tracker
    vercel --prod

No build step: it is a static site.
