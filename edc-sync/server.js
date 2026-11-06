"use strict";
// edc-sync: live crew sync for the EDC Planner app.
// No dependencies. Data is one small JSON file in DATA_DIR.
//
// A crew is identified by a random secret token (shared in the invite link). The server only
// stores sha256(token), so the database alone can't be used to join crews.
// Each phone is a member with its own random key, so crew members can't overwrite each other.

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_FILE = path.join(DATA_DIR, "edc-sync.json");
const MAX_CREWS = Number(process.env.MAX_CREWS || 500);
const MAX_MEMBERS = Number(process.env.MAX_MEMBERS || 40);
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN || 120);
const CREATE_PER_HOUR = Number(process.env.CREATE_PER_HOUR || 10);
const CREW_TTL_DAYS = Number(process.env.CREW_TTL_DAYS || 60);
const TRUST_PROXY = process.env.TRUST_PROXY !== "false"; // use CF-Connecting-IP from Cloudflare Tunnel

const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const BITS_RE = /^[A-Za-z0-9_-]{4,96}$/;

// ---------- storage ----------
let db = { crews: {} };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (!db.crews) db.crews = {};
} catch (e) {
  if (e.code !== "ENOENT") console.error("Could not read database, starting empty:", e.message);
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + ".tmp";
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error("Save failed:", e.message);
    }
  }, 500);
}
function prune() {
  const cutoff = Date.now() - CREW_TTL_DAYS * 86400000;
  let n = 0;
  for (const [id, c] of Object.entries(db.crews)) {
    if ((c.touched || 0) < cutoff) { delete db.crews[id]; n++; }
  }
  if (n) { console.log(`Pruned ${n} idle crew(s)`); save(); }
}
setInterval(prune, 3600000).unref();
prune();

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = (bytes) => crypto.randomBytes(bytes).toString("base64url");
function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- rate limiting ----------
const hits = new Map();
function limited(ip, bucket, max, windowMs) {
  const key = bucket + "|" + ip;
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now - h.start > windowMs) { h = { start: now, n: 0 }; hits.set(key, h); }
  h.n++;
  return h.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (now - h.start > 3600000) hits.delete(k);
}, 600000).unref();

// ---------- http helpers ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Member-Key",
  "Access-Control-Max-Age": "86400"
};
function send(res, status, body, headers) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  }, CORS, headers || {}));
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 4096) { tooBig = true; chunks.length = 0; return; } // keep draining, answer 413 at the end
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return reject(Object.assign(new Error("Body too large"), { status: 413 }));
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}
function clientIp(req) {
  if (TRUST_PROXY && req.headers["cf-connecting-ip"]) return String(req.headers["cf-connecting-ip"]);
  return req.socket.remoteAddress || "?";
}
function cleanName(n) {
  return String(n || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 24);
}

function crewView(crew) {
  const now = Date.now();
  return {
    now,
    name: crew.name,
    members: Object.entries(crew.members).map(([id, m]) => ({
      id, name: m.name, bits: m.bits, updated: m.updated, seen: m.seen
    }))
  };
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  const ip = clientIp(req);

  if (req.method === "OPTIONS") return send(res, 204, "");
  if (url.pathname === "/" || url.pathname === "/join") return send(res, 200, JOIN_PAGE);
  if (url.pathname === "/api/health") return send(res, 200, { ok: true, crews: Object.keys(db.crews).length });
  if (parts[0] !== "api") return send(res, 404, { error: "Not found" });

  if (limited(ip, "all", RATE_PER_MIN, 60000)) return send(res, 429, { error: "Too many requests, slow down" });

  // POST /api/crews  -> create a crew
  if (req.method === "POST" && parts.length === 2 && parts[1] === "crews") {
    if (limited(ip, "create", CREATE_PER_HOUR, 3600000)) return send(res, 429, { error: "Too many crews created, try later" });
    if (Object.keys(db.crews).length >= MAX_CREWS) return send(res, 507, { error: "Server is full" });
    const body = await readJson(req);
    const token = randomToken(18);
    db.crews[sha(token)] = { name: cleanName(body.name) || "EDC crew", created: Date.now(), touched: Date.now(), members: {} };
    save();
    return send(res, 201, { token });
  }

  // /api/crews/:token[/members/:id]
  if (parts[1] === "crews" && parts[2]) {
    const token = parts[2];
    if (!TOKEN_RE.test(token)) return send(res, 400, { error: "Bad crew token" });
    const crew = db.crews[sha(token)];
    if (!crew) return send(res, 404, { error: "Crew not found. It may have expired." });

    if (req.method === "GET" && parts.length === 3) {
      const me = url.searchParams.get("me");
      if (me && crew.members[me]) { crew.members[me].seen = Date.now(); }
      crew.touched = Date.now();
      save();
      return send(res, 200, crewView(crew));
    }

    if (parts[3] === "members" && parts[4] && parts.length === 5) {
      const id = parts[4];
      if (!ID_RE.test(id)) return send(res, 400, { error: "Bad member id" });
      const key = String(req.headers["x-member-key"] || "");
      if (!TOKEN_RE.test(key)) return send(res, 401, { error: "Missing member key" });
      const existing = crew.members[id];
      if (existing && !safeEqual(existing.keyHash, sha(key))) return send(res, 403, { error: "Not your member slot" });

      if (req.method === "PUT") {
        const body = await readJson(req);
        const name = cleanName(body.name);
        const bits = String(body.bits || "");
        if (!name) return send(res, 400, { error: "Name required" });
        if (!BITS_RE.test(bits)) return send(res, 400, { error: "Bad picks" });
        if (!existing && Object.keys(crew.members).length >= MAX_MEMBERS) return send(res, 507, { error: "Crew is full" });
        const now = Date.now();
        crew.members[id] = { keyHash: sha(key), name, bits, updated: now, seen: now };
        crew.touched = now;
        save();
        return send(res, 200, crewView(crew));
      }
      if (req.method === "DELETE") {
        delete crew.members[id];
        crew.touched = Date.now();
        save();
        return send(res, 200, { ok: true });
      }
    }
  }
  return send(res, 404, { error: "Not found" });
}

const JOIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Join EDC crew</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0614;color:#f3eefe;
font:16px/1.4 system-ui,sans-serif;padding:24px;box-sizing:border-box;text-align:center}
.box{max-width:360px}
h1{font-size:40px;margin:0;background:linear-gradient(90deg,#39ff6a,#29c6ff,#b44dff,#ff3fa4);-webkit-background-clip:text;background-clip:text;color:transparent}
a.btn{display:block;margin:22px 0 12px;padding:15px;border-radius:14px;background:linear-gradient(90deg,#b44dff,#ff3fa4);color:#fff;font-weight:800;text-decoration:none}
p{color:#a99cc4;font-size:14px}code{word-break:break-all;color:#c6ff3d}
</style></head><body><div class="box">
<h1>edc</h1><p>You're invited to a live crew in <b style="color:#fff">EDC Planner</b>.</p>
<a class="btn" id="open" href="#">Open in EDC Planner</a>
<p id="hint">Nothing happened? Install the EDC Planner app first, then tap the button again.
Or copy this whole link and tap <b>Paste</b> in the app's Crew tab.</p>
</div><script>
var t = location.hash.slice(1);
var a = document.getElementById("open");
if (!/^[A-Za-z0-9_-]{22,64}$/.test(t)) { a.style.display = "none"; document.getElementById("hint").textContent = "This invite link is incomplete. Ask for it again."; }
else a.href = "edcplanner://join?s=" + encodeURIComponent(location.origin) + "&t=" + t;
</script></body></html>`;

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "Server error" });
    if (!e.status) console.error(e);
  });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(PORT, () => console.log(`edc-sync listening on :${PORT}, data in ${DB_FILE}`));

function shutdown() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { /* ignore */ }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
