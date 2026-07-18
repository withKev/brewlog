# Brew Log sync Worker — setup

Private single-user backup API for the Brew Log PWA. One bearer key, no accounts.
Data → D1. Photos → R2. Deploys separately from the Pages site.

## One-time setup (about 10 minutes)

Prereqs: Node installed, and `npx wrangler login` done once (opens a browser to authorize your Cloudflare account).

Run everything from this `worker/` folder.

```bash
# 1. Create the D1 database, then copy its database_id into wrangler.toml
npx wrangler d1 create brewlog

# 2. Apply the schema
npx wrangler d1 execute brewlog --remote --file=schema.sql

# 3. Create the private R2 bucket (never enable public access on it)
npx wrangler r2 bucket create brewlog-photos

# 4. Generate your secret key — SAVE THIS somewhere safe (password manager).
#    You'll paste it into the app once. It is never committed to the repo.
openssl rand -hex 32

# 5. Store it as the Worker secret (paste the key when prompted)
npx wrangler secret put SYNC_KEY

# 6. Edit wrangler.toml first:
#    - database_id from step 1
#    - ALLOWED_ORIGIN = your Pages URL (e.g. https://yourproject.pages.dev)
#    Then deploy:
npx wrangler deploy
```

Note the deployed URL, e.g. `https://brewlog-sync.<your-subdomain>.workers.dev`.

## Dashboard hardening (5 minutes — do both)

**Rate-limiting rule** (the free plan includes exactly one — spend it on failed auth):
1. Cloudflare dashboard → your zone → **Security → WAF → Rate limiting rules → Create rule**.
2. Name: `brewlog failed auth`.
3. If incoming requests match (Edit expression):
   `(http.host eq "brewlog-sync.<your-subdomain>.workers.dev")`
4. With the same characteristics: **IP**.
5. Enable **custom counting expression**:
   `(http.host eq "brewlog-sync.<your-subdomain>.workers.dev" and http.response.code in {401 403})`
6. When rate exceeds: **20 requests per 1 hour** → Action: **Block** for **1 day** → Deploy.

Counting only 401/403 responses means your own successful syncs never trip it, while
key-guessing gets an IP blocked after 20 misses. Check **Security → Events** after a
few days to confirm it's not catching anything legitimate.

> Rate-limit rules attach to a zone. If your Worker runs on `workers.dev` and the rule
> won't match it in your dashboard, attach a route on your own domain
> (e.g. `sync.yourdomain.com/*`) to the Worker and target that host instead.

**Bot Fight Mode:** dashboard → **Security → Bots → enable Bot Fight Mode**.
DDoS protection is already always-on for free.

## Connect the app

1. Open Brew Log → Settings → **Cloud backup**.
2. Paste the Worker URL and your key → **Connect cloud backup**.
3. It verifies the key, then seeds the cloud with everything already on the phone.
   After that every save/edit/delete backs up automatically in the background;
   offline changes queue and flush when you're back online.

**New phone / reinstall:** deploy nothing — just open the app, connect with the same
URL + key, then tap **Restore from cloud**.

## Behavior notes

- Local-first: saving a brew never waits on the network.
- "Delete all data" in the app wipes the **phone only** — the cloud copy survives,
  by design. To truly erase the cloud: `npx wrangler d1 execute brewlog --remote
  --command "DELETE FROM coffee_logs; DELETE FROM matcha_logs; DELETE FROM
  coffee_library; DELETE FROM matcha_library; DELETE FROM grinders;"` and empty the
  R2 bucket from the dashboard.
- Replaced photos leave an orphaned old object in R2 (overwritten under the same key
  on next upload; removed photos' objects linger). Harmless at personal scale.
- If the key ever leaks, rotate it: `openssl rand -hex 32`, `npx wrangler secret put
  SYNC_KEY`, reconnect in the app with the new key.

## Updating the app

Any change to `index.html` still requires bumping the cache version in
`service-worker.js` (now `brewlog-v3`) in the same commit.
