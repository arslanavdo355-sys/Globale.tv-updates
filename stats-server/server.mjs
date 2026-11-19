import http from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";

const PORT = process.env.PORT || 10000;
const KEY = process.env.STATS_KEY || "";
const FILE = process.env.DATA_FILE || "data.json";
const ALLOW = "https://arslanavdo355-sys.github.io";
const DAY = 864e5;
const ID = /^[A-Za-z0-9-]{8,64}$/;

let data = { devices: {}, events: [] };
let loaded = false;
let chain = Promise.resolve();

async function load() {
  if (loaded) return;
  loaded = true;
  try { data = JSON.parse(await readFile(FILE, "utf8")); } catch {}
}
async function save() {
  const tmp = FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, FILE);
}
// Writes run one after another, so two pings never overwrite each other.
function mutate(fn) {
  chain = chain.then(async () => { await load(); fn(); await save(); }).catch(() => {});
  return chain;
}
function same(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 4096) { reject(new Error("big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, "ok", { "content-type": "text/plain" });

  if (req.method === "POST" && url.pathname === "/api/ping") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, "Bad Request"); }
    const id = clean(body.id, 64), ev = clean(body.ev, 10), v = clean(body.v, 20);
    if (!ID.test(id) || (ev !== "open" && ev !== "close")) return send(res, 400, "Bad Request");
    const now = new Date().toISOString();
    mutate(() => {
      const dev = data.devices[id] ?? { first: now, last: now, opens: 0, version: v };
      dev.last = now;
      if (v) dev.version = v;
      if (ev === "open") dev.opens += 1;
      data.devices[id] = dev;
      data.events.push({ t: now, id, ev, v });
      if (data.events.length > 500) data.events = data.events.slice(-500);
    });
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    const headers = { "access-control-allow-origin": ALLOW };
    const given = url.searchParams.get("key") ?? "";
    if (!KEY || !same(given, KEY)) return send(res, 401, "Unauthorized", headers);
    await load();
    const now = Date.now();
    const devices = Object.entries(data.devices).map(([id, d]) => ({ id, ...d })).sort((a, b) => (a.last < b.last ? 1 : -1));
    const versions = {};
    for (const d of devices) versions[d.version || "?"] = (versions[d.version || "?"] ?? 0) + 1;
    const totals = {
      devices: devices.length,
      opens: devices.reduce((s, d) => s + d.opens, 0),
      active24: devices.filter((d) => now - Date.parse(d.last) < DAY).length,
      active7: devices.filter((d) => now - Date.parse(d.last) < 7 * DAY).length,
    };
    return send(res, 200, { totals, versions, devices, events: data.events.slice(-200).reverse() }, headers);
  }

  send(res, 404, "Not Found");
});
server.listen(PORT, () => console.log("listening on " + PORT));
