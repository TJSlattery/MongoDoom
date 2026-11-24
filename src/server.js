// HTTP static server + WebSocket relay + 30 Hz findOneAndUpdate loop.
// No game logic here: decode key bits into sanitized scalars, inject them into the pipeline, time the round-trip.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { connect, resetGame } from "./db.js";
import { buildTickPipeline, TICK_OPTIONS } from "./mql/pipeline.js";
import { seed } from "../scripts/seed.js";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TICK_MS = 33;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon" };

// key bitmask -> sanitized input scalars
export function decodeKeys(k) {
  const bits = Number.isInteger(k) ? k : 0;
  const has = (b) => (bits & b) !== 0;
  return {
    forward: (has(1) ? 1 : 0) - (has(2) ? 1 : 0),
    strafe: (has(8) ? 1 : 0) - (has(4) ? 1 : 0),
    turn: (has(32) ? 1 : 0) - (has(16) ? 1 : 0),
    shoot: has(64),
    use: has(128),
  };
}

export async function startServer({ port = Number(process.env.PORT ?? 3000), uri = process.env.MONGODB_URI } = {}) {
  const { client, db } = await connect(uri);
  if (!(await db.collection("templates").findOne({ _id: "doom_initial" }))) {
    console.log("database is empty, seeding...");
    await seed({ uri });
  }
  const games = db.collection("games");
  const assetsDoc = await db.collection("assets").findOne({ _id: "doom1_e1m1_pack" });
  const assetsJson = JSON.stringify(assetsDoc);

  let input = decodeKeys(0);
  let resetRequested = false;
  let running = true;
  const recent = []; // last 30 round-trips; the client shows the average so the number is readable

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/assets") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(assetsJson);
      }
      if (req.method === "POST" && url.pathname === "/api/reset") {
        resetRequested = true; // applied by the tick loop between ticks
        res.writeHead(204);
        return res.end();
      }
      if (req.method !== "GET") { res.writeHead(405); return res.end(); }
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(publicDir, rel);
      if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end(String(e.message));
    }
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      try { input = decodeKeys(JSON.parse(data.toString()).k); } catch { /* ignore malformed input */ }
    });
    ws.on("close", () => { if (wss.clients.size === 0) input = decodeKeys(0); });
  });

  async function loop() {
    const started = performance.now();
    try {
      if (resetRequested) { resetRequested = false; await resetGame(db); }
      if (wss.clients.size > 0) {
        const t0 = performance.now();
        const doc = await games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline(input), TICK_OPTIONS);
        const mongodMs = Math.round((performance.now() - t0) * 10) / 10;
        recent.push(mongodMs);
        if (recent.length > 30) recent.shift();
        const mongodAvgMs = Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10;
        const msg = JSON.stringify({ frame: doc.frame, mongodMs, mongodAvgMs });
        for (const ws of wss.clients) if (ws.readyState === 1) ws.send(msg);
      }
    } catch (e) {
      console.error("tick failed:", e.message);
    }
    if (running) setTimeout(loop, Math.max(0, TICK_MS - (performance.now() - started)));
  }

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  setTimeout(loop, TICK_MS);

  async function close() {
    running = false;
    for (const ws of wss.clients) ws.terminate();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => server.close(r));
    await client.close();
  }
  return { port: actualPort, close };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port, close } = await startServer();
  console.log(`MongoDoom listening on port ${port}  ->  http://localhost:${port}`);
  const shutdown = async () => { await close(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
