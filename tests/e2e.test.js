import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { MongoClient } from "mongodb";
import { seed } from "../scripts/seed.js";
import { decodeKeys } from "../src/server.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const URI = process.env.MONGODB_URI_E2E || "mongodb://127.0.0.1:27017/mongodoom_e2e";

let child, base, stderr = "", exitInfo;

before(async () => {
  await seed({ uri: URI, log: () => {} });
  child = spawn(process.execPath, ["src/server.js"], { cwd: root, env: { ...process.env, PORT: "0", MONGODB_URI: URI } });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("exit", (code, signal) => { exitInfo = { code, signal }; });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("server did not start: " + buf + stderr)), 15000);
    child.stdout.on("data", (d) => {
      buf += d;
      const m = buf.match(/listening on port (\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });
  base = `127.0.0.1:${port}`;
});

after(async () => {
  if (child && exitInfo === undefined) child.kill("SIGKILL");
  const c = await MongoClient.connect(URI);
  await c.db().dropDatabase();
  await c.close();
});

test("decodeKeys sanitizes bitmasks into scalar inputs", () => {
  assert.deepEqual(decodeKeys(1 | 8 | 32 | 64), { forward: 1, strafe: 1, turn: 1, shoot: true, use: false });
  assert.deepEqual(decodeKeys(1 | 2), { forward: 0, strafe: 0, turn: 0, shoot: false, use: false });
  assert.deepEqual(decodeKeys("evil"), { forward: 0, strafe: 0, turn: 0, shoot: false, use: false });
  assert.deepEqual(decodeKeys(128), { forward: 0, strafe: 0, turn: 0, shoot: false, use: true });
});

test("static files, assets API, and path traversal protection", async () => {
  const html = await fetch(`http://${base}/`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /<canvas id="screen"/);
  assert.equal((await fetch(`http://${base}/client.js`)).status, 200);
  assert.equal((await fetch(`http://${base}/..%2f..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`http://${base}/nope.js`)).status, 404);

  const assets = await (await fetch(`http://${base}/api/assets`)).json();
  assert.ok(Object.keys(assets.wallTextures).length >= 1);
  assert.ok(assets.sprites.TROOA1.startsWith("data:image/png;base64,"));
  assert.ok(assets.sprites.SHTFA0 && assets.hud.STBAR);
  assert.ok(assets.sky.startsWith("data:image/png") && assets.hud.STTNUM0 && assets.hud.STARMS && assets.hud.STFST00, "sky and Doom status-bar art");
  assert.ok(assets.sprites.TROOA5 && assets.sprites.POSSA3 && assets.sprites.BAL1A0 && assets.sprites.BEXPA0, "rotations, fireballs, barrels");
  assert.ok(Object.keys(assets.flats).length >= 3 && assets.flats["1"].startsWith("data:image/png"));
});

test("websocket streams valid frames under input; reset restores the template; clean shutdown", async () => {
  const ws = new WebSocket(`ws://${base}`);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

  const msgs = [];
  ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
  const script = [1, 1 | 32, 1 | 16, 64, 1 | 64, 128, 8, 4, 0];
  for (let i = 0; i < 30; i++) {
    ws.send(JSON.stringify({ k: script[i % script.length] }));
    await new Promise((r) => setTimeout(r, 35));
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(msgs.length >= 20, `received only ${msgs.length} frames`);
  for (const m of msgs) {
    assert.equal(typeof m.mongodMs, "number");
    assert.ok(m.mongodMs >= 0 && m.mongodMs < 1000);
    assert.equal(typeof m.mongodAvgMs, "number");
    assert.equal(m.frame.columns.length, 160);
    assert.ok(m.frame.columns.every((c) => Number.isInteger(c.dx) && c.perpDist === undefined && c.w.every((w) => Number.isInteger(w.dh) && w.dh > 0) && c.f.every((f) => typeof f.c === "string")));
    assert.ok(Array.isArray(m.frame.sprites));
    assert.ok(typeof m.frame.hud.weaponSprite === "string");
    assert.ok(Array.isArray(m.frame.hud.draw) && m.frame.hud.draw[0].s === "STBAR" && m.frame.rh >= 1);
  }
  const ticks = msgs.map((m) => m.frame.tick);
  assert.ok(ticks.every((t, i) => i === 0 || t > ticks[i - 1]), "ticks strictly increase");
  assert.ok(msgs.some((m) => m.frame.hud.ammo < 50), "the shoot inputs reached the pipeline");

  // reset: applied between ticks, tick counter returns to the template's
  const before = msgs.at(-1).frame.tick;
  assert.equal((await fetch(`http://${base}/api/reset`, { method: "POST" })).status, 204);
  msgs.length = 0;
  await new Promise((r) => setTimeout(r, 400));
  // frames already in flight when the reset was requested may still arrive first; find the first post-reset one
  const restored = msgs.find((m) => m.frame.tick < before);
  assert.ok(restored, `no frame below tick ${before} after reset; saw ${msgs.map((m) => m.frame.tick).join(",")}`);
  assert.ok(restored.frame.tick <= 3, `reset frame should be near the template tick, got ${restored.frame.tick}`);
  assert.equal(restored.frame.hud.ammo, 50);
  assert.equal(restored.frame.hud.hp, 100);

  ws.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => { const t = setInterval(() => { if (exitInfo) { clearInterval(t); resolve(); } }, 50); });
  assert.equal(exitInfo.code, 0, `server exit ${JSON.stringify(exitInfo)}`);
  assert.equal(stderr.trim(), "", `server wrote to stderr: ${stderr}`);
});
