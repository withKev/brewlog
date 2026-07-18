// Brew Log sync Worker — private single-user backup API.
// Auth: one bearer key (SYNC_KEY secret). Data: D1. Photos: R2.
// Every response is JSON except photo streaming.

const TABLES = {
  coffee_library: ["id","createdAt","updatedAt","deleted","name","origin","roastNotes","price","size","notes","photoKey"],
  matcha_library: ["id","createdAt","updatedAt","deleted","brand","grade","origin","price","size","notes","photoKey"],
  coffee_logs:    ["id","createdAt","updatedAt","deleted","date","beanId","beanName","beanNotes","method","grinderId","grinderName","grindSetting","dose","water","temp","tempUnit","timeSec","rating","notes"],
  matcha_logs:    ["id","createdAt","updatedAt","deleted","date","matchaId","matchaName","beanNotes","prepStyle","amount","water","temp","tempUnit","milkType","milkAmount","sweetener","whiskType","sifted","rating","notes"],
  grinders:       ["id","createdAt","updatedAt","deleted","name"]
};
const MAX_BODY = 8 * 1024 * 1024;        // 8 MB JSON push cap
const MAX_PHOTO = 4 * 1024 * 1024;       // 4 MB per photo (app downscales well below this)

/* ---------- auth: compare SHA-256 digests so timing reveals nothing ---------- */
async function keyOK(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const given = auth.slice(7).trim();
  const secret = (env.SYNC_KEY || "").trim();
  if (!given || !secret) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(secret))
  ]);
  const va = new Uint8Array(a), vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/* ---------- CORS ---------- */
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(env) }
  });
}

/* ---------- value hygiene: only plain scalars reach SQL ---------- */
function cleanVal(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.length > 20000 ? v.slice(0, 20000) : v;
  return null; // objects/blobs never land in D1
}

/* ---------- handlers ---------- */
async function handlePull(env, url) {
  const since = url.searchParams.get("since");
  const out = { tables: {}, serverTime: new Date().toISOString() };
  for (const [table, cols] of Object.entries(TABLES)) {
    const sql = since
      ? `SELECT ${cols.join(",")} FROM ${table} WHERE updatedAt > ?`
      : `SELECT ${cols.join(",")} FROM ${table}`;
    const stmt = since ? env.DB.prepare(sql).bind(since) : env.DB.prepare(sql);
    const { results } = await stmt.all();
    out.tables[table] = results || [];
  }
  return out;
}

async function handlePush(env, body) {
  const stmts = [];
  let count = 0;

  const upserts = body && body.upserts ? body.upserts : {};
  for (const [table, rows] of Object.entries(upserts)) {
    const cols = TABLES[table];
    if (!cols || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !row.id) continue;
      const vals = cols.map(c => cleanVal(row[c]));
      const updates = cols.filter(c => c !== "id")
        .map(c => `${c}=excluded.${c}`).join(",");
      // Last-write-wins: only apply if incoming updatedAt is newer.
      const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
        ON CONFLICT(id) DO UPDATE SET ${updates}
        WHERE excluded.updatedAt > ${table}.updatedAt`;
      stmts.push(env.DB.prepare(sql).bind(...vals));
      count++;
    }
  }

  const deletes = body && body.deletes ? body.deletes : {};
  const nowIso = new Date().toISOString();
  for (const [table, ids] of Object.entries(deletes)) {
    if (!TABLES[table] || !Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== "string" || !id) continue;
      // Tombstone: mark deleted (or create a tombstone row if it never synced).
      const sql = `INSERT INTO ${table} (id, updatedAt, deleted) VALUES (?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET deleted=1, updatedAt=excluded.updatedAt`;
      stmts.push(env.DB.prepare(sql).bind(id, nowIso));
      count++;
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
  return { ok: true, applied: count, serverTime: nowIso };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // GET /health — unauthenticated diagnostic. Reveals only whether config
    // EXISTS (never the secret's value), so it is safe to leave in.
    if (request.method === "GET" && url.pathname === "/health") {
      return json(env, 200, {
        ok: true,
        keyConfigured: !!(env.SYNC_KEY && env.SYNC_KEY.trim()),
        keyLength: env.SYNC_KEY ? env.SYNC_KEY.trim().length : 0,
        allowedOrigin: env.ALLOWED_ORIGIN || null,
        hasDB: !!env.DB,
        hasR2: !!env.PHOTOS
      });
    }

    if (!(await keyOK(request, env))) {
      return json(env, 401, { error: "unauthorized" });
    }

    try {
      // GET /pull[?since=ISO]
      if (request.method === "GET" && url.pathname === "/pull") {
        return json(env, 200, await handlePull(env, url));
      }

      // POST /push  { upserts:{table:[rows]}, deletes:{table:[ids]} }
      if (request.method === "POST" && url.pathname === "/push") {
        const len = parseInt(request.headers.get("Content-Length") || "0", 10);
        if (len > MAX_BODY) return json(env, 413, { error: "body too large" });
        let body;
        try { body = await request.json(); }
        catch (e) { return json(env, 400, { error: "invalid JSON" }); }
        return json(env, 200, await handlePush(env, body));
      }

      // POST /photo?id=<recordId>  (body = image bytes)
      if (request.method === "POST" && url.pathname === "/photo") {
        const id = (url.searchParams.get("id") || "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (!id) return json(env, 400, { error: "missing id" });
        const len = parseInt(request.headers.get("Content-Length") || "0", 10);
        if (len > MAX_PHOTO) return json(env, 413, { error: "photo too large" });
        const key = `photos/${id}.jpg`;
        await env.PHOTOS.put(key, request.body, {
          httpMetadata: { contentType: request.headers.get("Content-Type") || "image/jpeg" }
        });
        return json(env, 200, { ok: true, key });
      }

      // GET /photo/<recordId>
      if (request.method === "GET" && url.pathname.startsWith("/photo/")) {
        const id = url.pathname.slice("/photo/".length).replace(/[^a-zA-Z0-9_-]/g, "");
        if (!id) return json(env, 400, { error: "missing id" });
        const obj = await env.PHOTOS.get(`photos/${id}.jpg`);
        if (!obj) return json(env, 404, { error: "not found" });
        return new Response(obj.body, {
          status: 200,
          headers: {
            "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
            "Cache-Control": "no-store",
            ...corsHeaders(env)
          }
        });
      }

      return json(env, 404, { error: "not found" });
    } catch (e) {
      return json(env, 500, { error: "server error" });
    }
  }
};
