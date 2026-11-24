import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openTestDb, roomMap, wallRect, enemy, setState, step, stepFrame } from "./helpers.js";
import { buildTickPipeline, TICK_OPTIONS } from "../src/mql/pipeline.js";
import { asciiPipeline } from "../src/mql/asciiView.js";
import { Wad } from "../src/wad/wadReader.js";
import { rasterizeE1M1 } from "../src/wad/e1m1Rasterizer.js";
import { WALL_PX, EYE_FRAC, HORIZON } from "../src/mql/constants.js";

let client, db, games;
before(async () => ({ client, db, games } = await openTestDb()));
after(async () => { await client.close(); });

const isInt = (n) => Number.isInteger(n);
const cellOf = (doc, x, y) => doc.map[Math.floor(y) * 64 + Math.floor(x)];

// ---------------------------------------------------------------- Part 1: movement, doors, raycaster
test("cardinal and on-grid-line rays never divide by zero; all columns are valid integers", async () => {
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    for (const [x, y] of [[32.5, 32.5], [32, 32], [20.25, 40.75]]) {
      await setState(games, { player: { x, y, angle } });
      const doc = await step(games, {}, { stages: 2 });
      assert.equal(doc._columns.length, 160);
      for (const c of doc._columns) {
        assert.ok(isInt(c.dx) && c.dx >= 0 && c.dx <= 318, `dx ${c.dx}`);
        assert.ok(isInt(c.sx) && c.sx >= 0 && c.sx <= 63, `sx ${c.sx}`);
        assert.ok(isInt(c.sy) && c.sy >= 0 && c.sy <= 127, `sy ${c.sy}`);
        assert.ok(isInt(c.sh) && c.sh >= 1 && c.sh <= 128, `sh ${c.sh}`);
        assert.ok(isInt(c.dy) && c.dy >= 0 && c.dy <= 168, `dy ${c.dy}`);
        assert.ok(isInt(c.dh) && c.dh >= 0 && c.dh <= 168, `dh ${c.dh}`);
        assert.ok(Number.isFinite(c.perpDist) && c.perpDist >= 0.08);
      }
    }
  }
});

test("center column distance is exact in an open room", async () => {
  await setState(games, { player: { x: 32.5, y: 32.5, angle: 0 } });
  const doc = await step(games, {}, { stages: 2 });
  assert.ok(Math.abs(doc._columns[80].perpDist - 30.5) < 1e-9);
});

test("worst-case diagonal ray still finds the border (MAX_STEPS covers ~126 steps)", async () => {
  await setState(games, { player: { x: 1.5, y: 1.5, angle: Math.PI / 4 } });
  const doc = await step(games, {}, { stages: 2 });
  const expected = 61.5 * Math.SQRT2; // center ray to the far corner region
  assert.ok(Math.abs(doc._columns[80].perpDist - expected) < 0.01, `got ${doc._columns[80].perpDist}, expected ${expected}`);
});

test("independent-axis wall sliding: blocked on X, free on Y", async () => {
  await setState(games, { player: { x: 62.5, y: 30.5, angle: -Math.PI / 4 } });
  let prev = (await games.findOne({ _id: "doom" })).player;
  let blockedX = null;
  for (let i = 0; i < 6; i++) {
    const doc = await step(games, { forward: 1 }, { stages: 2 });
    assert.equal(cellOf(doc, doc.player.x, doc.player.y), 0, "player must stay in an open cell");
    assert.ok(doc.player.x + 0.25 < 63, "player must keep clear of the wall");
    assert.ok(doc.player.y < prev.y, "Y keeps advancing while sliding");
    if (blockedX !== null) assert.equal(doc.player.x, blockedX, "X stays pinned once blocked");
    if (doc.player.x === prev.x) blockedX = doc.player.x;
    prev = doc.player;
  }
  assert.notEqual(blockedX, null, "X must have become blocked");
});

test("doors: use opens the whole slab; no use leaves it closed; door shows its texture", async () => {
  const door = wallRect(40, 41, 30, 33, 105);
  const map = roomMap(door);
  await setState(games, { map, player: { x: 38.9, y: 31.5, angle: 0 } });
  let doc = await step(games, {}, { stages: 2 });
  assert.ok(door.every(([c, r]) => doc.map[r * 64 + c] === 105), "closed without use");
  assert.equal(doc._columns[80].tex, 5, "door column shows tex = tile - 100");
  doc = await step(games, { use: true }, { stages: 2 });
  assert.ok(door.every(([c, r]) => doc.map[r * 64 + c] === 0), "all door cells open");
  assert.equal(doc.map.filter((v) => v > 0).length, roomMap().filter((v) => v > 0).length, "only the door changed");
});

test("raycast cost spike regression: stages 1-2 median < 10 ms", async () => {
  await setState(games, { player: { x: 32.5, y: 32.5, angle: 0.3 } });
  const t = [];
  for (let i = 0; i < 60; i++) {
    const s = performance.now();
    await games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline({ turn: 1 }, { stages: 2 }), { returnDocument: "after", projection: { tick: 1 } });
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  assert.ok(t[30] < 10, `median ${t[30].toFixed(1)} ms`);
});

// ---------------------------------------------------------------- Part 2: combat, AI, sprites, HUD
test("sprite wall occlusion: columns behind the half-wall are dropped, open side kept", async () => {
  await setState(games, {
    map: roomMap(wallRect(34, 34, 10, 31)), // wall at distance 2.0 covering the left half of the view
    player: { x: 32.0, y: 32.0, angle: 0 },
    enemies: [enemy(0, 36.0, 32.0)], // ty = 4.0, centered at column 80
  });
  const frame = await stepFrame(games, {});
  assert.equal(frame.sprites.length, 1);
  const dxs = frame.sprites[0].strips.map((s) => s.dx);
  assert.ok(dxs.length > 0);
  assert.ok(dxs.every((d) => d >= 160), `occluded strip leaked: min dx ${Math.min(...dxs)}`);
  assert.ok(dxs.includes(160) && dxs.includes(216), "open side retained");
});

test("sprite stands on the floor with the eye-height scale", async () => {
  // hurtTicks > 0 keeps the (otherwise chasing) enemy pinned so ty stays exactly 4.0
  await setState(games, { enemies: [enemy(0, 36.5, 32.5, { hurtTicks: 5 })] });
  const frame = await stepFrame(games, {});
  const st = frame.sprites[0].strips[0];
  const floorY = HORIZON + Math.floor(Math.floor(WALL_PX / 4) * EYE_FRAC);
  assert.equal(st.dy + st.dh, floorY);
  assert.equal(st.dh, Math.floor(403 / 4));
});

test("shotgun is occluded by walls, then hits and consumes ammo and cooldown", async () => {
  await setState(games, { map: roomMap(wallRect(34, 34, 30, 35)), enemies: [enemy(0, 37.0, 32.5)] });
  let doc = await step(games, { shoot: true });
  assert.equal(doc.enemies[0].hp, 60, "enemy behind wall is untouched");
  assert.equal(doc.player.ammo, 49, "shot was still fired");
  assert.equal(doc.player.weaponTicks, 32);

  await setState(games, { enemies: [enemy(0, 37.0, 32.5)] });
  doc = await step(games, { shoot: true });
  assert.ok(doc.enemies[0].hp < 60, "enemy in line of sight is hurt");
  assert.equal(doc.player.ammo, 49);
  const hp = doc.enemies[0].hp;
  doc = await step(games, { shoot: true });
  assert.equal(doc.player.ammo, 49, "cooldown prevents the next shot");
  assert.equal(doc.player.weaponTicks, 31);
  assert.ok(doc.enemies[0].hp >= Math.min(hp, 60) - 0, "no second hit during cooldown");
});

test("hitscan only damages the nearest enemy in line", async () => {
  await setState(games, { enemies: [enemy(0, 35.5, 32.5), enemy(1, 39.5, 32.5)] });
  const doc = await step(games, { shoot: true });
  assert.ok(doc.enemies[0].hp < 60);
  assert.equal(doc.enemies[1].hp, 60);
});

test("a killed enemy counts as a kill and is drawn as a corpse", async () => {
  await setState(games, { enemies: [enemy(0, 33.5, 32.5, { hp: 1 })] });
  const doc = await step(games, { shoot: true });
  assert.equal(doc.enemies[0].hp, 0);
  assert.equal(doc.player.kills, 1);
  assert.ok(["TROOK0", "TROOM0"].includes(doc.frame.sprites[0].frame));
});

test("AI: sleeping enemy behind a wall never wakes; with line of sight it wakes, chases, and bites", async () => {
  await setState(games, { map: roomMap(wallRect(36, 36, 20, 45)), enemies: [enemy(0, 41.5, 32.5)] });
  let doc;
  for (let i = 0; i < 6; i++) doc = await step(games, {});
  assert.equal(doc.enemies[0].awake, false);
  assert.equal(doc.enemies[0].x, 41.5);

  await setState(games, { enemies: [enemy(0, 41.5, 32.5)] });
  doc = await step(games, {});
  assert.equal(doc.enemies[0].awake, true);
  assert.ok(doc.enemies[0].x < 41.5, "approaches the player");

  // a monster that has only just noticed the player waits out a reaction delay before attacking
  await setState(games, { enemies: [enemy(0, 33.5, 32.5)] });
  doc = await step(games, {});
  assert.equal(doc.enemies[0].awake, true);
  assert.equal(doc.player.hp, 100, "no instant attack on waking");
  assert.ok(doc.enemies[0].attackTicks >= 15 && doc.enemies[0].attackTicks <= 44, `reaction ${doc.enemies[0].attackTicks}`);

  await setState(games, { enemies: [enemy(0, 33.5, 32.5, { awake: true })] }); // alert, within melee range
  doc = await step(games, {});
  assert.ok(doc.player.hp < 100, "melee hit lands");
  assert.equal(doc.player.hurtTicks, 4);
  assert.equal(doc.enemies[0].attackTicks, 35);
  assert.equal(doc.enemies[0].swingTicks, 10);
  assert.equal(doc.frame.sprites[0].frame, "TROOF1", "attack pose is drawn while swinging");
  assert.equal(doc.frame.hud.faceSprite, "STFOUCH0");
});

test("dead player cannot move or fire, enemies stop damaging", async () => {
  await setState(games, { player: { hp: 0 }, enemies: [enemy(0, 33.5, 32.5, { awake: true })] });
  const doc = await step(games, { forward: 1, turn: 1, shoot: true });
  assert.equal(doc.player.x, 32.5);
  assert.equal(doc.player.angle, 0);
  assert.equal(doc.player.ammo, 50);
  assert.equal(doc.player.hp, 0);
  assert.equal(doc.frame.hud.faceSprite, "STFDEAD0");
});

test("frame envelope: wire shape, no transient fields leaked into the document", async () => {
  await setState(games, { enemies: [enemy(0, 36.5, 32.5)] });
  const doc = await step(games, { forward: 1 });
  for (const k of ["_cam", "_columns", "_sprites", "_foes"]) assert.equal(doc[k], undefined, `${k} must be unset`);
  assert.equal(doc.map.length, 4096);
  assert.equal(doc.frame.columns.length, 160);
  assert.deepEqual(Object.keys(doc.frame.columns[0]).sort(), ["dh", "dx", "dy", "sh", "shade", "sx", "sy", "tex"]);
  assert.equal(doc.frame.tick, doc.tick);
  assert.equal(doc.frame.hud.weaponSprite, "SHTGA0");
});

test("HUD: weapon animation, muzzle flash and bob", async () => {
  await setState(games, { enemies: [] });
  let doc = await step(games, { shoot: true });
  assert.equal(doc.frame.hud.weaponSprite, "SHTFA0", "the firing tick shows the muzzle flash frame");
  assert.ok(doc.frame.hud.screenFlashRgba.startsWith("rgba(255"));
  for (let i = 0; i < 3; i++) doc = await step(games, {});
  assert.equal(doc.player.weaponTicks, 29);
  assert.equal(doc.frame.hud.weaponSprite, "SHTGB0", "flash ends, pump animation begins");
  assert.equal(doc.frame.hud.screenFlashRgba, "rgba(0,0,0,0)");
  doc = await step(games, { forward: 1 });
  assert.equal(doc.player.moving, true);
});

test("latency: 100 full-pipeline ticks on the real E1M1 window have median < 15 ms", async () => {
  const wad = Wad.load(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "DOOM1.WAD"));
  const r = rasterizeE1M1(wad);
  await setState(games, { map: r.map, player: r.player, enemies: r.enemies });
  for (let i = 0; i < 10; i++) await games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline({ turn: 1 }), TICK_OPTIONS);
  const t = [];
  for (let i = 0; i < 100; i++) {
    const input = { forward: i % 3 === 0 ? 1 : 0, turn: i % 2 ? 1 : -1, shoot: i % 40 === 0 };
    const s = performance.now();
    await games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline(input), TICK_OPTIONS);
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  console.log(`      tick latency: median ${t[50].toFixed(1)} ms, p95 ${t[95].toFixed(1)} ms, max ${t[99].toFixed(1)} ms`);
  assert.ok(t[50] < 15, `median ${t[50].toFixed(1)} ms`);
});

test("viewport_ascii view returns 32 strings of length 80", async () => {
  await db.dropCollection("viewport_ascii").catch(() => {});
  await db.createCollection("viewport_ascii", { viewOn: "games", pipeline: asciiPipeline });
  const v = await db.collection("viewport_ascii").findOne();
  assert.equal(v.rows.length, 32);
  assert.ok(v.rows.every((s) => typeof s === "string" && s.length === 80));
  assert.ok(v.rows.some((s) => /[█▓▒░]/.test(s)), "walls are drawn");
});

test("fuzz: 400 random-input ticks on the real map keep every invariant", async () => {
  const wad = Wad.load(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "DOOM1.WAD"));
  const r = rasterizeE1M1(wad);
  // wake everything so the AI, LOS and combat paths all run
  await setState(games, { map: r.map, player: r.player, enemies: r.enemies.map((e) => ({ ...e, awake: true })) });
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = () => Math.floor(rnd() * 3) - 1;
  let tickNo = 0;
  for (let i = 0; i < 400; i++) {
    const input = { forward: pick(), strafe: pick(), turn: pick(), shoot: rnd() < 0.3, use: rnd() < 0.1 };
    const doc = await step(games, input);
    tickNo++;
    assert.equal(doc.tick, tickNo);
    const p = doc.player;
    for (const k of ["x", "y", "angle", "hp", "ammo", "kills", "muzzleTicks", "weaponTicks", "hurtTicks"]) assert.ok(Number.isFinite(p[k]), `player.${k}=${p[k]} at tick ${i}`);
    assert.equal(cellOf(doc, p.x, p.y), 0, `player inside tile ${cellOf(doc, p.x, p.y)} at tick ${i}`);
    assert.ok(p.hp >= 0 && p.hp <= 100 && p.ammo >= 0 && p.ammo <= 50);
    for (const e of doc.enemies) {
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && e.hp >= 0 && e.hp <= 60, `enemy ${e.id} bad state at tick ${i}`);
      assert.equal(cellOf(doc, e.x, e.y), 0, `enemy ${e.id} inside a wall at tick ${i}`);
    }
    assert.equal(doc.player.kills, doc.enemies.filter((e) => e.hp === 0).length);
    for (const c of doc.frame.columns) assert.ok(Number.isInteger(c.dy) && Number.isInteger(c.dh) && c.dh >= 0 && c.dy + c.dh <= 168);
    for (const s of doc.frame.sprites) for (const st of s.strips) assert.ok(st.dx >= 0 && st.dx <= 318 && st.sx >= 0 && st.sx <= 63 && st.sh >= 1);
  }
});
