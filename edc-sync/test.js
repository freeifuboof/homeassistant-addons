"use strict";
// Starts the server on a spare port with a temp data dir and exercises the API.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edc-sync-"));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;

function start() {
  const p = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dir, CREATE_PER_HOUR: "3" }),
    stdio: ["ignore", "pipe", "inherit"]
  });
  return new Promise((resolve) => p.stdout.on("data", (d) => { if (String(d).includes("listening")) resolve(p); }));
}
async function req(method, url, body, headers) {
  const r = await fetch(base + url, {
    method, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, json, text, headers: r.headers };
}

(async () => {
  let srv = await start();
  try {
    assert.equal((await req("GET", "/api/health")).status, 200);
    const join = await req("GET", "/join");
    assert.ok(join.text.includes("edcplanner://join"), "join page");
    assert.equal((await req("OPTIONS", "/api/crews")).headers.get("access-control-allow-origin"), "*");

    const c = await req("POST", "/api/crews", { name: "Test crew" });
    assert.equal(c.status, 201);
    const t = c.json.token;
    assert.ok(/^[A-Za-z0-9_-]{24}$/.test(t));

    const keyA = "a".repeat(22), keyB = "b".repeat(22);
    let r = await req("PUT", `/api/crews/${t}/members/memberAAA`, { name: "Wade", bits: "AAAC" }, { "X-Member-Key": keyA });
    assert.equal(r.status, 200);
    assert.equal(r.json.members.length, 1);
    r = await req("PUT", `/api/crews/${t}/members/memberBBB`, { name: "<b>Alex</b>", bits: "AAEA" }, { "X-Member-Key": keyB });
    assert.equal(r.json.members.length, 2);
    assert.equal(r.json.members.find((m) => m.id === "memberBBB").name, "bAlex/b", "name is sanitised");

    // B can't overwrite A
    r = await req("PUT", `/api/crews/${t}/members/memberAAA`, { name: "Evil", bits: "AAAA" }, { "X-Member-Key": keyB });
    assert.equal(r.status, 403);
    r = await req("PUT", `/api/crews/${t}/members/memberAAA`, { name: "Wade", bits: "AAAC" });
    assert.equal(r.status, 401);

    // validation
    assert.equal((await req("PUT", `/api/crews/${t}/members/memberAAA`, { name: "", bits: "AAAC" }, { "X-Member-Key": keyA })).status, 400);
    assert.equal((await req("PUT", `/api/crews/${t}/members/memberAAA`, { name: "W", bits: "no spaces!" }, { "X-Member-Key": keyA })).status, 400);
    assert.equal((await req("PUT", `/api/crews/${t}/members/memberAAA`, "x".repeat(5000), { "X-Member-Key": keyA })).status, 413);
    assert.equal((await req("GET", `/api/crews/short`)).status, 400);
    assert.equal((await req("GET", `/api/crews/${"z".repeat(24)}`)).status, 404);

    // get + seen
    r = await req("GET", `/api/crews/${t}?me=memberBBB`);
    assert.equal(r.status, 200);
    assert.equal(r.json.name, "Test crew");
    assert.ok(!JSON.stringify(r.json).includes("keyHash"), "key hashes are never returned");

    // locations: only members, kept in memory, visible to the crew
    assert.equal((await req("PUT", `/api/crews/${t}/members/strangerX1/location`, { lat: 28.5, lon: -81.4 }, { "X-Member-Key": "c".repeat(22) })).status, 404);
    assert.equal((await req("PUT", `/api/crews/${t}/members/memberAAA/location`, { lat: 28.5, lon: -81.4 }, { "X-Member-Key": keyB })).status, 403);
    assert.equal((await req("PUT", `/api/crews/${t}/members/memberAAA/location`, { lat: 200, lon: 0 }, { "X-Member-Key": keyA })).status, 400);
    assert.equal((await req("PUT", `/api/crews/${t}/members/memberAAA/location`, { lat: 28.5376123, lon: -81.4031456, acc: 8.4 }, { "X-Member-Key": keyA })).status, 200);
    r = await req("GET", `/api/crews/${t}`);
    const locA = r.json.members.find((m) => m.id === "memberAAA").loc;
    assert.deepEqual([locA.lat, locA.lon, locA.acc], [28.53761, -81.40315, 8]);
    assert.equal(r.json.members.find((m) => m.id === "memberBBB").loc, null);

    // meet-up spot
    r = await req("PUT", `/api/crews/${t}/members/memberBBB/meet`, { x: 0.52, y: 0.47, label: "Ferris wheel <3" }, { "X-Member-Key": keyB });
    assert.equal(r.status, 200);
    assert.equal(r.json.meet.label, "Ferris wheel 3");
    assert.equal(r.json.meet.by, "bAlex/b");
    assert.equal((await req("PUT", `/api/crews/${t}/members/memberBBB/meet`, { x: 2, y: 0.5 }, { "X-Member-Key": keyB })).status, 400);

    // leave
    assert.equal((await req("DELETE", `/api/crews/${t}/members/memberBBB`, undefined, { "X-Member-Key": keyB })).status, 200);
    r = await req("GET", `/api/crews/${t}`);
    assert.equal(r.json.members.length, 1);

    // creation rate limit (3/hour in this test, 1 used)
    await req("POST", "/api/crews", {});
    await req("POST", "/api/crews", {});
    assert.equal((await req("POST", "/api/crews", {})).status, 429);

    // persistence across restart; token itself is not stored
    srv.kill("SIGTERM");
    await new Promise((res) => srv.on("exit", res));
    const raw = fs.readFileSync(path.join(dir, "edc-sync.json"), "utf8");
    assert.ok(!raw.includes(t), "raw token not stored");
    srv = await start();
    r = await req("GET", `/api/crews/${t}`);
    assert.equal(r.json.members[0].name, "Wade");
    assert.equal(r.json.members[0].loc, null, "locations are not persisted");
    assert.equal(r.json.meet.label, "Ferris wheel 3", "meet-up spot is persisted");
    assert.ok(!raw.includes("28.53761"), "location never written to disk");
    console.log("edc-sync: all tests passed");
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
