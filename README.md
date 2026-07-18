# Brew Log

A personal, offline-first PWA for logging coffee and matcha brews. Single user, no accounts, data stored on-device in IndexedDB with JSON export/import as backup.

## Files

Everything sits at the repo root — keep the names and layout as-is:

```
index.html                 the entire app (HTML + CSS + JS)
manifest.json              PWA manifest
service-worker.js          offline cache (bump CACHE version on every change!)
_headers                   Cloudflare Pages: never cache the service worker
icon-180.png               apple-touch-icon
icon-192.png / icon-512.png / icon-512-maskable.png
favicon.png
```

## Deploy (Cloudflare Pages + GitHub)

1. Push these files to the root of a GitHub repo.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build settings: **Framework preset: None · Build command: (empty) · Output directory: /**
4. Deploy. Your app is live at `https://<project>.pages.dev`.

Every push to the production branch auto-deploys.

## Install on iPhone

1. Open the `https://…pages.dev` URL in **Safari** (must be Safari).
2. Share button → **Add to Home Screen** → Add.
3. Launch from the icon: full-screen, offline-capable, data on-device.

## Updating the app — the one rule

**Every time you change any file, bump the cache version in `service-worker.js`** (currently `brewlog-v3`; next change → `brewlog-v4` → …) in the same commit. That's what makes installed copies fetch the new version. Skip it and phones keep serving the old cached app.

Update flow: edit → bump cache version → push → open the app (occasionally takes one extra open while the new worker activates).

## Data & backups

- Data lives in IndexedDB on the phone. iOS can clear it if you delete the home-screen app — so use **Settings → Save backup file** regularly (the app nudges you). Drop the file in iCloud Drive.
- **Restore from file** merges by record `id` and never wipes existing data. Re-importing the same backup is a no-op.
- The backup file includes packaging photos (base64). The clipboard copy skips photos to stay pasteable.
- Old data from the first (localStorage) build migrates automatically on first launch, non-destructively.

## Cloud backup (Phase 2)

The `worker/` folder contains a private Cloudflare Worker (D1 + R2) that backs up
all data automatically — see `worker/README.md` for the 10-minute setup, the
rate-limit rule recipe, and how to connect/restore in the app's Settings.

## Schema notes

- App data schema version: **2** (stored in the `meta` store; `1` was the legacy localStorage format).
- Stores: `coffee_library`, `matcha_library`, `coffee_logs`, `matcha_logs`, `grinders`, `meta`.
- Every record has stable `id`, `createdAt`, `updatedAt` — ready to map to D1 tables, photos to R2.
