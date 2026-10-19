# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Suivi lait" is a French-language PWA for logging a baby's bottle feeds. It is a static site with no build step, no package.json, no tests, and no dependencies beyond Google Fonts. The entire app lives in `index.html` (inline CSS + inline JS in a single IIFE).

## Commands

There is nothing to build, lint, or test. To run locally, serve the folder over HTTP (the service worker requires it, `file://` will not work):

```
python3 -m http.server 8000
```

Deploy to production (project is already linked via `.vercel/project.json`):

```
npx vercel deploy --prod --yes
```

Production URL: https://suivi-lait.vercel.app. Deployment Protection (Vercel Authentication) is deliberately disabled on the project so the link is public; do not re-enable it.

## Architecture

**Data model.** IndexedDB database `suivi-lait-db` (version 2) with two object stores:
- `feeds` (keyPath `id`, index `by_date` on `date`): one record per bottle, `{ id, date: "YYYY-MM-DD", ml: number, time: ISO string }`. Millilitres are the canonical unit; ounces are a display-only conversion (`ML_PER_OZ = 29.5735`).
- `daily` (keyPath `date`): one record per day for per-day flags, currently `{ date, vitaminD: boolean, vitaminDTime: ISO string | null }`. Add new per-day facts here rather than creating more stores.

The chosen unit is persisted in `localStorage` under `suivi-lait-unit-v1`.

**Daily minimum.** `DAILY_MIN_ML = 600` drives the progress bar and status line in the total card (peach while under, sage once reached) and the vertical marker in the 7-day history. The history bars are scaled to `max(totals, DAILY_MIN_ML) * 1.1` so the marker never sits on the edge. Change the constant, not the strings, to adjust the target.

**Migration.** On boot, `migrateFromLocalStorage()` imports any data from the pre-IndexedDB key `suivi-lait-data-v1` and then deletes that key. Keep this path working if the schema changes. If you change the IndexedDB schema, bump `DB_VERSION` and handle it in `onupgradeneeded`.

**Rendering.** `render()` is the single entry point that redraws everything for `state.viewDate` (day navigation, quick-add grid, vitamin D card, feed list, stats tiles, and the history bars with their vitamin D dot). Always change the viewed day through `goToDate()`, which clamps to today, clears edit mode, and pre-fills the past-day time input.

**Past days and editing.** Feeds added while viewing a past day take their time from the `#custom-time` input (shown only when `.custom-row` has the `past` class); today uses the current time (`entryTimeFor`). `state.editingId` puts one feed item into inline edit mode (amount in the current unit + HH:MM), saved through `updateEntry()` which rewrites the record via `dbPut`. The day label opens a hidden `<input type="date">` and history rows call `goToDate()`.

**Statistics.** `renderHistory()` loads all feeds and daily records once (`dbGetAll` + `dbGetAllDaily`), groups them by date for `state.period` (7 or 30 days), then calls `renderStats()`. Averages are computed over days that have at least one feed ("jours renseignés"), not over the whole period; vitamin D is counted over the whole period. All mutations (`addEntry`, `removeEntry`, `setUnit`) end by calling `render()`. The day-navigation keeps `viewDate` as a mutable `Date`; the "next day" button is hidden when viewing today.

**Vitamin D reminder.** Settings live in `localStorage` under `suivi-lait-reminder-v1` (`{ enabled, time: "HH:MM", lastNotified: "YYYY-MM-DD" }`), so they are per device. `checkReminder()` runs on load, every minute, on visibility change, and after each `renderVitaminD()`; it adds the `due` class to the card once the time has passed and today's vitamin D is not given, and fires at most one browser notification per day (via the service worker's `showNotification` when available). There is no push backend: notifications only fire while the app is open. The "Calendrier" link builds a `data:` `.ics` with `RRULE:FREQ=DAILY` and a `VALARM` as the app-closed fallback. `sw.js` handles `notificationclick` by focusing or opening the app.

**Offline / PWA.** `sw.js` precaches the shell under cache name `suivi-lait-v1`, uses network-first for navigations (falls back to cached `/index.html`) and cache-first for everything else. `vercel.json` sets `Cache-Control: no-cache` on `sw.js` so updates are picked up, and sets the manifest content type. When changing cached assets, bump the `CACHE` name in `sw.js` so old caches are purged on activate.

**Theming.** Colors are CSS custom properties on `:root`, with a dark variant applied both via `prefers-color-scheme` and via `[data-theme="dark"]`. All UI strings are French.
