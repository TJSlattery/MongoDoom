import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openTestDb, roomMap, wallRect, enemy, item, ITEMS, doorOf, switchOf, decorItem, barrel, proj, tablesWith, setState, step, stepFrame } from "./helpers.js";
import { buildTickPipeline, TICK_OPTIONS } from "../src/mql/pipeline.js";
import { asciiPipeline } from "../src/mql/asciiView.js";
import { Wad } from "../src/wad/wadReader.js";
import { fetchWad } from "../scripts/fetch-wad.js";
import { MONSTER_SETS } from "../src/wad/spriteBuilder.js";
import { rasterizeE1M1 } from "../src/wad/e1m1Rasterizer.js";
import { WALL_PX, EYE_FRAC, HORIZON, GRID_W, GRID_H } from "../src/mql/constants.js";

let client, db, games;
before(async () => ({ client, db, games } = await openTestDb()));
after(async () => { await client.close(); });

const isInt = (n) => Number.isInteger(n);
const cellOf = (doc, x, y) => doc.map[Math.floor(y) * GRID_W + Math.floor(x)] % 256;

// ---------------------------------------------------------------- Part 1: movement, doors, raycaster
test("cardinal and on-grid-line rays never divide by zero; all columns are valid integers", async () => {
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    for (const [x, y] of [[32.5, 32.5], [32, 32], [20.25, 40.75]]) {
      await setState(games, { player: { x, y, angle } });
      const doc = await step(games, {}, { stages: 2 });
      assert.equal(doc._columns.length, 160);
      for (const c of doc._columns) {
        assert.ok(isInt(c.dx) && c.dx >= 0 && c.dx <= 318, `dx ${c.dx}`);
        assert.ok(Number.isFinite(c.perpDist) && c.perpDist >= 0.08);
        assert.ok(c.w.length >= 1, "every ray in a closed room ends on a wall");
        for (const w of c.w) {
          assert.ok(isInt(w.sx) && w.sx >= 0 && w.sx <= 63, `sx ${w.sx}`);
          assert.ok(isInt(w.sy) && w.sy >= 0 && w.sy <= 127, `sy ${w.sy}`);
          assert.ok(isInt(w.sh) && w.sh >= 1 && w.sh <= 128, `sh ${w.sh}`);
          assert.ok(isInt(w.dy) && w.dy >= 0 && w.dy <= 168, `dy ${w.dy}`);
          assert.ok(isInt(w.dh) && w.dh > 0 && w.dy + w.dh <= 168, `dh ${w.dh}`);
        }
        for (const f of c.f) assert.ok(isInt(f.dy) && isInt(f.dh) && f.dh > 0 && f.dy + f.dh <= 168 && /^#[0-9a-f]{6}$/.test(f.c));
      }
    }
  }
});

test("center column distance is exact in an open room", async () => {
  await setState(games, { player: { x: 32.5, y: 32.5, angle: 0 } });
  const doc = await step(games, {}, { stages: 2 });
  assert.ok(Math.abs(doc._columns[80].perpDist - (GRID_W - 1 - 32.5)) < 1e-9);
});

test("worst-case diagonal ray still finds the border (MAX_STEPS covers ~190 steps)", async () => {
  await setState(games, { player: { x: 1.5, y: 1.5, angle: Math.PI / 4 } });
  const doc = await step(games, {}, { stages: 2 });
  const expected = (GRID_H - 1 - 1.5) * Math.SQRT2; // hits the bottom wall after ~GRID_H + GRID_H DDA steps
  assert.ok(Math.abs(doc._columns[80].perpDist - expected) < 0.01, `got ${doc._columns[80].perpDist}, expected ${expected}`);
});

test("independent-axis wall sliding: blocked on X, free on Y", async () => {
  await setState(games, { player: { x: GRID_W - 1.5, y: 30.5, angle: -Math.PI / 4 } });
  let prev = (await games.findOne({ _id: "doom" })).player;
  let blockedX = null;
  for (let i = 0; i < 6; i++) {
    const doc = await step(games, { forward: 1 }, { stages: 2 });
    assert.equal(cellOf(doc, doc.player.x, doc.player.y), 0, "player must stay in an open cell");
    assert.ok(doc.player.x + 0.25 < GRID_W - 1, "player must keep clear of the wall");
    assert.ok(doc.player.y < prev.y, "Y keeps advancing while sliding");
    if (blockedX !== null) assert.equal(doc.player.x, blockedX, "X stays pinned once blocked");
    if (doc.player.x === prev.x) blockedX = doc.player.x;
    prev = doc.player;
  }
  assert.notEqual(blockedX, null, "X must have become blocked");
});

test("doors: use starts the whole slab opening, it rises over several ticks, then becomes passable", async () => {
  const cells = wallRect(40, 41, 30, 33, 105);
  const door = doorOf(0, cells.map(([c, r]) => [c, r]), 72, { v: 24 });
  await setState(games, { map: roomMap(cells), doors: [door], player: { x: 38.9, y: 31.5, angle: 0 } });
  let doc = await step(games, {}, { stages: 2 });
  assert.ok(cells.every(([c, r]) => doc.map[r * GRID_W + c] === 105), "closed without use");
  assert.equal(doc._columns[80].w[0].tex, 5, "door column shows tex = tile - 100");
  assert.equal(doc.doors[0].dir, 0);
  doc = await step(games, { use: true }, { stages: 2 });
  assert.equal(doc.doors[0].dir, 1, "use starts it");
  assert.equal(doc.doors[0].open, 24, "and it has already moved this tick");
  assert.ok(cells.every(([c, r]) => doc.map[r * GRID_W + c] === 105), "still solid while rising");
  doc = await step(games, {}, { stages: 2 });
  assert.equal(doc.doors[0].open, 48);
  doc = await step(games, {}, { stages: 2 });
  assert.equal(doc.doors[0].open, 72);
  assert.equal(doc.doors[0].dir, 0, "stops at full height");
  assert.ok(cells.every(([c, r]) => doc.map[r * GRID_W + c] === 0), "all door cells open");
  assert.equal(doc.map.filter((v) => v > 0).length, roomMap().filter((v) => v > 0).length, "only the door changed");
  doc = await step(games, { use: true }, { stages: 2 });
  assert.equal(doc.doors[0].open, 72, "using an open door does nothing");
});

test("doors: the use key reaches a door from an off-centre angle and from further away, but not through walls", async () => {
  const cells = wallRect(40, 40, 30, 33, 105);
  const base = { map: roomMap(cells), doors: [doorOf(0, cells.map(([c, r]) => [c, r]))] };
  // 1.6 cells away and aimed 25 degrees off the door's centre line, at its top edge
  await setState(games, { ...base, player: { x: 38.5, y: 29.9, angle: 0.43 } });
  let doc = await step(games, { use: true }, { stages: 2 });
  assert.equal(doc.doors[0].dir, 1, "an old single-point probe missed this");
  // a wall in between: nothing happens
  await setState(games, { map: roomMap([...cells, ...wallRect(39, 39, 28, 36, 2)]), doors: base.doors, player: { x: 37.8, y: 31.5, angle: 0 } });
  doc = await step(games, { use: true }, { stages: 2 });
  assert.equal(doc.doors[0].dir, 0, "a wall in front of the door blocks the use key");
  // too far
  await setState(games, { ...base, player: { x: 30.5, y: 31.5, angle: 0 } });
  doc = await step(games, { use: true }, { stages: 2 });
  assert.equal(doc.doors[0].dir, 0);
});

test("doors: a half-open door shows its texture above a gap you can see under", async () => {
  const cells = wallRect(40, 41, 30, 33, 105);
  const place = async (open) => {
    await setState(games, { map: roomMap([...cells, ...wallRect(48, 48, 25, 38, 2)]), doors: [doorOf(0, cells.map(([c, r]) => [c, r]), 72, { open, dir: 0 })], player: { x: 36.5, y: 31.5, angle: 0 } });
    return (await step(games, {}, { stages: 2 }))._columns[80];
  };
  const closed = await place(0), half = await place(36);
  assert.equal(closed.w.length, 1, "closed: one wall face");
  assert.equal(closed.w[0].tex, 5);
  assert.ok(half.w.length >= 2, "half open: door face above, far wall seen beneath it");
  assert.equal(half.w[0].tex, 5, "door texture on top");
  assert.notEqual(half.w.at(-1).tex, 5, "and the room behind it under the door");
  assert.ok(half.perpDist > closed.perpDist, "ray now travels past the door");
  assert.ok(half.w[0].dy + half.w[0].dh < closed.w[0].dy + closed.w[0].dh, "door bottom edge is above the floor");
});

test("input latch: a key tap that starts and ends between ticks still counts once", async () => {
  const { InputState } = await import("../src/server.js");
  const st = new InputState();
  st.set(128); st.set(0); // press and release E before the next tick
  assert.equal(st.take().use, true);
  assert.equal(st.take().use, false, "consumed after one tick");
  st.set(128 | 1);
  assert.deepEqual([st.take().use, st.take().use, st.take().forward], [true, true, 1], "a held key keeps repeating");
  st.set(64); st.set(0);
  assert.equal(st.take().shoot, true, "fire taps latch too");
});

test("raycast worst case (empty 148x96 room, every ray ~100+ steps): stages 1-2 median < 30 ms", async () => {
  await setState(games, { player: { x: 32.5, y: 32.5, angle: 0.3 } });
  const t = [];
  for (let i = 0; i < 60; i++) {
    const s = performance.now();
    await games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline({ turn: 1 }, { stages: 2 }), { returnDocument: "after", projection: { tick: 1 } });
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  assert.ok(t[30] < 30, `median ${t[30].toFixed(1)} ms`);
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
  const floorY = HORIZON + Math.floor((41 * (WALL_PX / 128)) / 4);
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
  assert.equal(doc.frame.sprites[0].frame, "TROOI0", "death animation starts");
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
  assert.match(doc.frame.sprites[0].frame, /^TROOE[1-8]$/, "attack pose is drawn while swinging");
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
  for (const k of ["_cam", "_columns", "_sprites", "_foes", "_pick", "_pj", "_lt"]) assert.equal(doc[k], undefined, `${k} must be unset`);
  assert.equal(doc.map.length, GRID_W * GRID_H);
  assert.equal(doc.frame.columns.length, 160);
  assert.deepEqual(Object.keys(doc.frame.columns[0]).sort(), ["dx", "f", "w"]); // wins/perpDist stay server-side
  assert.deepEqual(Object.keys(doc.frame.columns[0].w[0]).sort(), ["dh", "dy", "sh", "shade", "sx", "sy", "tex"]);
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

test("latency: 100 full-pipeline ticks on the full real E1M1 map have median < 30 ms", async () => {
  const wad = Wad.load(await fetchWad());
  const r = rasterizeE1M1(wad);
  await setState(games, { map: r.map, player: r.player, enemies: r.enemies, tables: r.tables });
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
  assert.ok(t[50] < 30, `median ${t[50].toFixed(1)} ms`);
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
  const wad = Wad.load(await fetchWad());
  const r = rasterizeE1M1(wad);
  // wake everything so the AI, LOS and combat paths all run
  await setState(games, { map: r.map, player: r.player, enemies: r.enemies.map((e) => ({ ...e, awake: true })), tables: r.tables });
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
    for (const c of doc.frame.columns) assert.ok(c.w.every((w) => Number.isInteger(w.dy) && w.dh > 0 && w.dy + w.dh <= 168));
    for (const s of doc.frame.sprites) for (const st of s.strips) assert.ok(st.dx >= 0 && st.dx <= 318 && st.sx >= 0 && st.sx <= 63 && st.sh >= 1);
  }
});

test("sprites are clipped by step risers: an enemy behind a raised ledge loses its feet", async () => {
  const tables = { secF: [0, 24], secC: [128, 128], secFC: ["#4c4c4c", "#606060"], secCC: ["#343434", "#343434"], secFT: [0, 0], secCT: [0, 0], secLow: [1, 1], secUp: [1, 1], secL: [255, 255], secS: [0, 0] };
  const ledge = wallRect(34, 34, 20, 44, 256); // sector 1 (floor +24), open tile
  const place = async (map) => {
    await setState(games, { map, tables, player: { x: 32.5, y: 32.5, angle: 0 }, enemies: [enemy(0, 38.5, 32.5, { hurtTicks: 5 })] });
    return stepFrame(games, {});
  };
  const open = (await place(roomMap())).sprites[0].strips[0];
  const hidden = (await place(roomMap(ledge))).sprites[0].strips[0];
  assert.ok(hidden.dy + hidden.dh < open.dy + open.dh, `feet must be hidden: ${hidden.dy + hidden.dh} vs ${open.dy + open.dh}`);
  assert.ok(hidden.dh < open.dh);
});

test("floor and ceiling spans carry flat texels when the sector has a flat", async () => {
  const tables = { secF: [0], secC: [128], secFC: ["#4c4c4c"], secCC: ["#343434"], secFT: [1], secCT: [0], secLow: [1], secUp: [1], secL: [255], secS: [0] };
  await setState(games, { tables });
  const frame = await stepFrame(games, {});
  const fills = frame.columns[80].f;
  const floorFill = fills.find((f) => f.fl === 1);
  assert.ok(floorFill && floorFill.t.length === floorFill.dh, "one texel per pixel row");
  assert.ok(floorFill.t.every((t) => Number.isInteger(t) && t >= 0 && t < 4096));
  assert.ok(fills.filter((f) => f.fl === 0).every((f) => f.t.length === 0), "sky/untextured spans have no texels");
});

test("pickups: armor, health and ammo apply once, respect caps, and vanish", async () => {
  await setState(games, {
    player: { hp: 60, ammo: 10 },
    items: [item(0, 32.5, 32.5, ITEMS.green), item(1, 32.6, 32.5, ITEMS.medikit), item(2, 32.5, 32.6, ITEMS.shells), item(3, 40.5, 32.5, ITEMS.helmet)],
  });
  let doc = await step(games, {});
  assert.equal(doc.player.armor, 100);
  assert.equal(doc.player.armorAbs, 0.33);
  assert.equal(doc.player.hp, 85);
  assert.equal(doc.player.ammo, 14);
  assert.deepEqual(doc.items.map((i) => i.taken), [true, true, true, false], "far item untouched");
  assert.equal(doc._pick, undefined);
  assert.equal(doc.frame.hud.armor, 100);
  assert.ok(doc.frame.hud.screenFlashRgba.startsWith("rgba(220"), "pickup flash");
  doc = await step(games, {});
  assert.equal(doc.player.armor, 100, "taken items are not re-applied");
});

test("pickups: not taken when it would do nothing (full health/armor/ammo)", async () => {
  await setState(games, {
    player: { hp: 100, ammo: 100 },
    items: [item(0, 32.5, 32.5, ITEMS.medikit), item(1, 32.5, 32.6, ITEMS.shells), item(2, 32.6, 32.5, { ...ITEMS.helmet, arCap: 0 })],
  });
  const doc = await step(games, {});
  assert.deepEqual(doc.items.map((i) => i.taken), [false, false, false]);
});

test("pickups: walking over an item collects it; dead players collect nothing", async () => {
  await setState(games, { player: { x: 30.5, y: 32.5, angle: 0 }, items: [item(0, 32.5, 32.5, ITEMS.blue)] });
  let doc;
  for (let i = 0; i < 12 && !(doc?.items[0].taken); i++) doc = await step(games, { forward: 1 });
  assert.equal(doc.items[0].taken, true);
  assert.equal(doc.player.armor, 200);
  assert.equal(doc.player.armorAbs, 0.5);

  await setState(games, { player: { hp: 0 }, items: [item(0, 32.5, 32.5, ITEMS.blue)] });
  doc = await step(games, {});
  assert.equal(doc.items[0].taken, false);
});

test("items render as sprites until taken", async () => {
  await setState(games, { items: [item(0, 36.5, 32.5, ITEMS.green)] });
  let frame = await stepFrame(games, {});
  assert.equal(frame.sprites.length, 1);
  assert.equal(frame.sprites[0].frame, "ARM1A0");
  await setState(games, { items: [{ ...item(0, 36.5, 32.5, ITEMS.green), taken: true }] });
  frame = await stepFrame(games, {});
  assert.equal(frame.sprites.length, 0);
});

test("armor absorbs a share of melee damage", async () => {
  const hits = [];
  for (const armor of [0, 100]) {
    await setState(games, { player: { armor, armorAbs: 0.5 }, tick: 7, enemies: [enemy(0, 33.5, 32.5, { awake: true })] });
    const doc = await step(games, {});
    hits.push({ hp: doc.player.hp, armor: doc.player.armor });
  }
  assert.ok(hits[0].hp < 100, "unarmored hit lands");
  const dealt = 100 - hits[0].hp;
  assert.equal(hits[1].armor, 100 - Math.floor(dealt * 0.5));
  assert.equal(hits[1].hp, 100 - (dealt - Math.floor(dealt * 0.5)));
});

const POSS = MONSTER_SETS.POSS;

test("humans use their own sprites for walk, attack, pain and death", async () => {
  const frameOf = async (extra) => {
    await setState(games, { enemies: [enemy(0, 36.5, 32.5, { sp: POSS, mel: false, hurtTicks: 0, ...extra })] });
    return (await stepFrame(games, {})).sprites[0].frame;
  };
  assert.match(await frameOf({ awake: false }), /^POSS[A-D][1-8]$/);
  assert.match(await frameOf({ swingTicks: 9, hurtTicks: 0 }), /^POSSE[1-8]$/, "aim frame first");
  assert.match(await frameOf({ swingTicks: 5, hurtTicks: 0 }), /^POSSF[1-8]$/, "then fire");
  assert.match(await frameOf({ hurtTicks: 5 }), /^POSSG[1-8]$/);
  assert.equal(await frameOf({ hp: 0, deadTicks: 0 }), "POSSH0", "death starts on the first frame");
  assert.equal(await frameOf({ hp: 0, deadTicks: 5 }), "POSSI0");
  assert.equal(await frameOf({ hp: 0, deadTicks: 12 }), "POSSJ0");
  assert.equal(await frameOf({ hp: 0, deadTicks: 500 }), "POSSL0", "ends on the corpse frame");
});

test("the visible rotation follows the enemy's facing relative to the viewer", async () => {
  // viewer at (32.5, 32.5) looking east at an enemy 26 cells east. Facing west (toward the viewer) is the front view.
  const rotOf = async (ang) => {
    await setState(games, { enemies: [enemy(0, 58.5, 32.5, { ang, hurtTicks: 0 })] }); // beyond sight range, so it keeps the facing we set
    return (await stepFrame(games, {})).sprites[0].frame.slice(-1);
  };
  const PI = Math.PI;
  assert.equal(await rotOf(PI), "1", "facing the viewer");
  assert.equal(await rotOf(0), "5", "facing away");
  const side = [await rotOf(PI / 2), await rotOf(-PI / 2)].sort();
  assert.deepEqual(side, ["3", "7"], "profile views are rotations 3 and 7 (mirrors of each other)");
  const seen = new Set();
  for (let k = 0; k < 8; k++) seen.add(await rotOf(PI + (k * PI) / 4));
  assert.equal(seen.size, 8, "eight distinct views");
});

test("humans never melee: adjacent, they only ever deal hitscan damage (<= 15)", async () => {
  await setState(games, { enemies: [enemy(0, 33.2, 32.5, { sp: POSS, mel: false, awake: true })], tick: 3 });
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    await games.updateOne({ _id: "doom" }, { $set: { "player.hp": 100 } });
    const d = await step(games, {});
    const dmg = 100 - d.player.hp;
    if (dmg > 0) hits++;
    assert.ok(dmg <= 15, `melee-sized hit ${dmg}`); // hitscan is 3-15, claws go to 24
    assert.ok(d.enemies[0].sp && d.enemies[0].mel === false, "type fields survive the tick");
  }
  assert.ok(hits > 0, "the human does attack");
});

test("a shotgun blast kills a zombieman outright", async () => {
  await setState(games, { enemies: [enemy(0, 35.5, 32.5, { hp: 20, sp: POSS, mel: false })] });
  const d = await step(games, { shoot: true });
  assert.equal(d.enemies[0].hp, 0);
});

// ---------------------------------------------------------------- sky, light, view bob, nukage
test("sky: sky ceilings are drawn from the 256-wide sky by ray angle, and turn with the player", async () => {
  const tables = tablesWith({ secCT: [-1] });
  const skyCols = async (angle) => {
    await setState(games, { tables, player: { angle } });
    const frame = await stepFrame(games, {});
    return frame.columns.map((c) => c.f.find((f) => f.fl === -1)).filter(Boolean);
  };
  const a = await skyCols(0);
  assert.equal(a.length, 160, "every column has a sky span");
  for (const f of a) {
    assert.equal(f.t.length, 3);
    const [u, sy, sh] = f.t;
    assert.ok(Number.isInteger(u) && u >= 0 && u < 256 && sy >= 0 && sy <= 127 && sh >= 1 && sy + sh <= 128);
    assert.equal(f.ld, 0, "sky is not darkened by sector light");
  }
  const us = a.map((f) => f.t[0]);
  assert.ok(us.every((u, i) => i === 0 || u >= us[i - 1] || us[i - 1] > 240), "sky columns advance left to right");
  const b = await skyCols(Math.PI / 4);
  assert.notDeepEqual(b.map((f) => f.t[0]), us, "turning scrolls the sky");
  assert.ok(Math.abs(((b[80].t[0] - a[80].t[0] + 256) % 256) - 128) <= 2, "an eighth of a turn is 128 of the 256 sky columns (the sky repeats every 90 degrees, as in Doom)");
});

test("sector light: dark sectors darken walls and floors; flicker and blink change light over time", async () => {
  const shadeAt = async (light, special = 0, tick = 0) => {
    await setState(games, { tables: tablesWith({ secL: [light], secS: [special] }), tick, player: { x: GRID_W - 4.5 } }); // wall 3 cells ahead, so distance does not saturate the shade
    const f = await stepFrame(games, {});
    return { wall: f.columns[80].w[0].shade, floor: f.columns[80].f.find((x) => x.dh > 0 && x.dy > 84).ld };
  };
  const bright = await shadeAt(255), dim = await shadeAt(96);
  assert.ok(dim.wall > bright.wall + 0.15, `walls ${dim.wall} vs ${bright.wall}`);
  assert.ok(dim.floor > bright.floor + 0.15 && bright.floor === 0, "floors get sector darkness too");
  const blink = new Set();
  for (const t of [0, 10, 20, 30]) blink.add((await shadeAt(200, 12, t)).wall);
  assert.ok(blink.size >= 2, "blinking sector alternates");
  const flick = new Set();
  for (let t = 0; t < 40; t += 3) flick.add((await shadeAt(200, 1, t)).wall);
  assert.ok(flick.size >= 2, "flickering sector varies");
});

test("view bob: eye height oscillates while moving and settles when still", async () => {
  await setState(games, {});
  const bobs = [];
  for (let i = 0; i < 8; i++) bobs.push((await step(games, { forward: 1 })).player.bob);
  assert.ok(bobs.some((b) => Math.abs(b) > 1) && bobs.every((b) => Math.abs(b) <= 3.0001));
  assert.ok(new Set(bobs.map((b) => b.toFixed(2))).size > 3, "it actually oscillates");
  let doc;
  for (let i = 0; i < 20; i++) doc = await step(games, {});
  assert.ok(Math.abs(doc.player.bob) < 0.1, "settles back when standing still");
});

test("nukage: standing in a damaging sector costs 5 hp every 32 ticks", async () => {
  await setState(games, { tables: tablesWith({ secS: [7] }), tick: 0 });
  const hp = [];
  for (let i = 0; i < 70; i++) hp.push((await step(games, {})).player.hp);
  assert.equal(hp[0], 100);
  assert.equal(hp[31], 95, "first tick divisible by 32");
  assert.equal(hp[63], 90);
  assert.equal(hp[69], 90);
});

// ---------------------------------------------------------------- status bar
const drawOf = (frame) => frame.hud.draw;
const digitsAt = (draw, prefix, rightX, y, span = 60) =>
  draw.filter((d) => d.s.startsWith(prefix) && d.y === y && d.x <= rightX && d.x > rightX - span).sort((a, b) => a.x - b.x).map((d) => d.s.slice(prefix.length)).join("");

test("status bar: Doom numerals, percent signs, ARMS panel and ammo table are laid out by MQL", async () => {
  await setState(games, { player: { hp: 100, armor: 57, ammo: 8, bullets: 50 } });
  const f = await stepFrame(games, {});
  const draw = drawOf(f);
  assert.deepEqual(draw.slice(0, 2), [{ s: "STBAR", x: 0, y: 168 }, { s: "STARMS", x: 104, y: 168 }]);
  assert.equal(digitsAt(draw, "STTNUM", 44, 171), "8", "ammo");
  assert.equal(digitsAt(draw, "STTNUM", 90, 171), "100", "health (right edge x=90)");
  assert.equal(digitsAt(draw, "STTNUM", 221, 171), "57", "armor");
  assert.deepEqual(draw.filter((d) => d.s === "STTPRCNT").map((d) => d.x), [90, 221]);
  assert.deepEqual(draw.filter((d) => /^(STYSNUM3|STGNUM[2-7])$/.test(d.s) && d.y >= 172 && d.x < 150).map((d) => d.s).sort(), ["STGNUM2", "STGNUM4", "STGNUM5", "STGNUM6", "STGNUM7", "STYSNUM3"], "only the shotgun slot is lit");
  assert.equal(digitsAt(draw, "STYSNUM", 288, 173, 14), "50", "bullets current");
  assert.equal(digitsAt(draw, "STYSNUM", 314, 173, 14), "200", "bullets max");
  assert.equal(digitsAt(draw, "STYSNUM", 288, 179, 14), "8", "shells current");
  assert.equal(draw.at(-1).s, f.hud.faceSprite);
  assert.deepEqual([draw.at(-1).x, draw.at(-1).y], [143, 168]);
  assert.ok(draw.every((d) => Number.isInteger(d.x) && Number.isInteger(d.y)));
});

test("status bar: no leading zeros, zero is shown, big numbers are capped", async () => {
  await setState(games, { player: { hp: 5, armor: 0, ammo: 0 } });
  let draw = drawOf(await stepFrame(games, {}));
  assert.equal(digitsAt(draw, "STTNUM", 90, 171), "5");
  assert.equal(digitsAt(draw, "STTNUM", 221, 171), "0");
  await setState(games, { player: { hp: 9999 } });
  draw = drawOf(await stepFrame(games, {}));
  assert.equal(digitsAt(draw, "STTNUM", 90, 171), "999");
});

test("status face: pain tier follows health; hits turn it toward the attacker; death and god mode", async () => {
  const faceFor = async (player) => { await setState(games, { player }); return (await stepFrame(games, {})).hud.faceSprite; };
  assert.match(await faceFor({ hp: 100 }), /^STFST0[0-2]$/);
  assert.match(await faceFor({ hp: 70 }), /^STFST1[0-2]$/);
  assert.match(await faceFor({ hp: 45 }), /^STFST2[0-2]$/);
  assert.match(await faceFor({ hp: 25 }), /^STFST3[0-2]$/);
  assert.match(await faceFor({ hp: 5 }), /^STFST4[0-2]$/);
  assert.equal(await faceFor({ hp: 0 }), "STFDEAD0");
  assert.equal(await faceFor({ hp: 9999 }), "STFGOD0");
  assert.equal(await faceFor({ hp: 45, hurtTicks: 4 }), "STFOUCH2", "fresh hit: ouch face at the right tier");
  assert.equal(await faceFor({ hp: 45, hurtTicks: 2, hurtDir: 1 }), "STFTR20", "attacker on the right");
  assert.equal(await faceFor({ hp: 45, hurtTicks: 2, hurtDir: -1 }), "STFTL20", "attacker on the left");
  assert.equal(await faceFor({ hp: 45, bonusTicks: 3 }), "STFEVL2");
});

test("a hit records which side it came from", async () => {
  // enemy to the player's right (player faces east, +y is south = right)
  await setState(games, { enemies: [enemy(0, 32.5, 33.6, { awake: true })], tick: 7 });
  let doc;
  for (let i = 0; i < 80 && !(doc?.player.hp < 100); i++) doc = await step(games, {});
  assert.ok(doc.player.hp < 100, "got bitten");
  assert.ok(doc.player.hurtDir > 0, `hurtDir ${doc.player.hurtDir}`);
});

// ---------------------------------------------------------------- fireballs
test("fireballs fly, hit the player for 3-24 (armor applies), then explode and disappear", async () => {
  await setState(games, { player: { armor: 100, armorAbs: 0.5 }, projectiles: [proj(1, 37.5, 32.5, -0.365, 0)] });
  let doc, dmgTick = null;
  for (let i = 0; i < 30; i++) {
    doc = await step(games, {});
    if (dmgTick === null && (doc.player.armor < 100 || doc.player.hp < 100)) dmgTick = i;
    if (!doc.projectiles.length) break;
  }
  assert.ok(dmgTick !== null && dmgTick >= 8 && dmgTick <= 14, `hit on tick ${dmgTick}`);
  const lost = (100 - doc.player.armor) + (100 - doc.player.hp);
  assert.ok(lost >= 3 && lost <= 24, `damage ${lost}`);
  assert.equal(100 - doc.player.armor, Math.floor(lost * 0.5) + (lost % 2 ? 0 : 0) || 100 - doc.player.armor);
  assert.ok(doc.player.armor < 100, "armor soaked a share");
  assert.equal(doc.projectiles.length, 0, "explosion finishes and the projectile is removed");
});

test("fireballs explode on walls without hurting anyone, and show the explosion sprites", async () => {
  await setState(games, { map: roomMap(wallRect(36, 36, 25, 40)), projectiles: [proj(1, 34.0, 32.5, 0.365, 0)] });
  const seen = [];
  let doc;
  for (let i = 0; i < 20 && (!doc || doc.projectiles.length); i++) {
    doc = await step(games, {});
    if (doc.frame.sprites[0]) seen.push(doc.frame.sprites[0].frame);
    if (doc.projectiles[0]) assert.ok(doc.projectiles[0].x <= 36.0, "never passes through the wall");
  }
  assert.equal(doc.player.hp, 100);
  assert.ok(seen.some((n) => /^BAL1[AB]0$/.test(n)), "flying frames");
  assert.ok(seen.includes("BAL1C0") || seen.includes("BAL1D0") || seen.includes("BAL1E0"), `explosion frames ${seen}`);
});

test("imps throw fireballs instead of instant hits; humans never spawn them", async () => {
  await setState(games, { enemies: [enemy(0, 38.5, 32.5, { awake: true, proj: true })], tick: 5 });
  let spawned = false, doc;
  for (let i = 0; i < 400 && !spawned; i++) {
    await games.updateOne({ _id: "doom" }, { $set: { "player.hp": 100 } });
    doc = await step(games, {});
    if (doc.projectiles.length) {
      spawned = true;
      const p = doc.projectiles[0];
      assert.ok(p.vx < 0 && Math.abs(Math.hypot(p.vx, p.vy) - 0.365) < 1e-6, "aimed at the player at fireball speed");
      assert.equal(doc.player.hp, 100, "no instant damage from the throw itself");
    }
  }
  assert.ok(spawned, "an awake imp in sight eventually throws");
  await setState(games, { enemies: [enemy(0, 38.5, 32.5, { awake: true, proj: false, mel: false, sp: POSS })], tick: 5 });
  for (let i = 0; i < 200; i++) assert.equal((await step(games, {})).projectiles.length, 0);
});

// ---------------------------------------------------------------- decorations and barrels
test("solid decorations block the player; non-solid ones do not; both are drawn", async () => {
  await setState(games, { player: { x: 30.5, y: 32.5, angle: 0 }, decor: [decorItem(0, 33.0, 32.5)] });
  let doc;
  for (let i = 0; i < 20; i++) doc = await step(games, { forward: 1 });
  assert.ok(doc.player.x < 33.0 - 0.5, `stopped before the column (x=${doc.player.x})`);
  assert.equal(doc.frame.sprites[0].frame, "COLUA0");
  await setState(games, { player: { x: 30.5, y: 32.5, angle: 0 }, decor: [decorItem(0, 33.0, 32.5, { solid: false, sprite: "POL5A0", anim: ["POL5A0"] })] });
  for (let i = 0; i < 20; i++) doc = await step(games, { forward: 1 });
  assert.ok(doc.player.x > 34, "walks straight through a pool of blood");
});

test("tall decorations use a 128-unit sprite height", async () => {
  const strip = async (hu) => {
    await setState(games, { decor: [decorItem(0, 36.5, 32.5, { hu, sprite: "ELECA0", anim: ["ELECA0"] })] });
    const st = (await stepFrame(games, {})).sprites[0].strips[0];
    return st;
  };
  const a = await strip(64), b = await strip(128);
  assert.ok(Math.abs(b.dh - 2 * a.dh) <= 2 || b.dh > a.dh, `${a.dh} vs ${b.dh}`);
  assert.equal(b.sy + b.sh <= 128, true);
});

test("barrels animate, take the shot, explode, hurt things nearby, and chain", async () => {
  // shooting a barrel: it is nearer than the imp behind it, so the barrel takes the shot
  await setState(games, {
    decor: [barrel(0, 34.5, 32.5), barrel(1, 34.5, 34.0)],
    enemies: [enemy(0, 39.0, 32.5), enemy(1, 34.5, 35.0)], // #0 is behind the barrel and outside the blast radius
    tick: 0,
  });
  let doc = await step(games, {});
  assert.equal(doc.decor[0].boom, 0);
  assert.match(doc.frame.sprites.find((s) => s.frame.startsWith("BAR1")).frame, /^BAR1[AB]0$/);
  doc = await step(games, { shoot: true });
  assert.equal(doc.enemies[0].hp, 60, "the imp behind the barrel was not shot directly");
  assert.ok(doc.decor[0].boom >= 1, "barrel exploded");
  assert.equal(doc.decor[0].solid, false, "an exploding barrel stops blocking");
  assert.ok(doc.enemies[1].hp < 60 && doc.enemies[1].hurtTicks === 4, "the blast hurt the imp 2.5 cells from the barrel");
  assert.ok(doc.player.hp < 100, "and the player 2 cells away");
  const second = (await step(games, {})).decor[1];
  assert.ok(second.hp <= 0 || second.boom >= 1, "neighbouring barrel caught the blast");
  let last;
  for (let i = 0; i < 60; i++) last = await step(games, {});
  assert.ok(last.decor.every((d) => d.boom >= 1), "chain reaction finished");
  assert.ok(!last.frame.sprites.some((s) => s.frame.startsWith("BEXP") || s.frame.startsWith("BAR1")), "explosion sprites are gone");
});

test("barrel blasts need line of sight and kill nearby enemies", async () => {
  await setState(games, {
    map: roomMap(wallRect(33, 33, 28, 38)),
    decor: [barrel(0, 34.5, 32.5, { hp: 0 })], // already dead: explodes this tick
    enemies: [enemy(0, 35.5, 32.5, { hp: 30 }), enemy(1, 31.5, 32.5, { hp: 30 })],
  });
  await games.updateOne({ _id: "doom" }, { $set: { "player.x": 20.5, "player.y": 32.5 } });
  const doc = await step(games, {});
  assert.equal(doc.decor[0].boom, 1);
  assert.equal(doc.enemies[0].hp, 0, "enemy beside it dies");
  assert.equal(doc.enemies[1].hp, 30, "enemy behind the wall is shielded");
  assert.equal(doc.player.kills, 1);
});

test("bullet clips and ammo boxes add bullets up to the cap", async () => {
  await setState(games, { player: { bullets: 195 }, items: [item(0, 32.5, 32.5, { sprite: "CLIPA0", bu: 10, buCap: 200 })] });
  let doc = await step(games, {});
  assert.equal(doc.player.bullets, 200, "capped at 200");
  await setState(games, { player: { bullets: 200 }, items: [item(0, 32.5, 32.5, { sprite: "AMMOA0", bu: 50, buCap: 200 })] });
  doc = await step(games, {});
  assert.equal(doc.items[0].taken, false, "refused when already full");
});

test("fuzz: rotations, projectiles, barrels and the HUD survive 300 random ticks on the real map", async () => {
  const wad = Wad.load(await fetchWad());
  const r = rasterizeE1M1(wad);
  await setState(games, { map: r.map, player: r.player, enemies: r.enemies.map((e) => ({ ...e, awake: true })), items: r.items, decor: r.decor, tables: r.tables });
  let sd = 987;
  const rnd = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 300; i++) {
    const doc = await step(games, { forward: Math.floor(rnd() * 3) - 1, strafe: Math.floor(rnd() * 3) - 1, turn: Math.floor(rnd() * 3) - 1, shoot: rnd() < 0.4, use: rnd() < 0.05 });
    assert.ok(Number.isFinite(doc.player.bob) && Number.isFinite(doc.player.hp));
    for (const p of doc.projectiles) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    for (const d of doc.decor) assert.ok(Number.isFinite(d.hp) && d.boom >= 0 && d.boom <= 40);
    for (const e of doc.enemies) assert.ok(Number.isFinite(e.ang) && e.deadTicks >= 0);
    for (const s of doc.frame.sprites) assert.match(s.frame, /^[A-Z0-9]{4,8}$/, `bad frame ${s.frame}`);
    assert.ok(doc.frame.hud.draw.every((d) => typeof d.s === "string" && d.s.length >= 5 && !d.s.includes("$")));
    for (const k of ["_cam", "_columns", "_sprites", "_foes", "_pick", "_pj", "_lt"]) assert.equal(doc[k], undefined, `${k} leaked`);
  }
});

// ---------------------------------------------------------------- exit switch, door/switch texture layout
test("exit switch: pressing it flips its texture, ends the level and freezes the player", async () => {
  const cells = [[40, 31, 203], [40, 32, 203]];
  const sw = switchOf(0, cells.map(([c, r]) => [c, r]));
  const map = roomMap(cells);
  await setState(games, { map, switches: [sw], player: { x: 38.5, y: 31.8, angle: 0 }, enemies: [enemy(0, 33.0, 31.8, { awake: true })] });
  let doc = await step(games, {}, { stages: 2 });
  assert.equal(doc._columns[80].w[0].tex, 3, "unpressed face (tile 203 -> texture 3)");
  assert.equal(doc.level.done, false);
  doc = await step(games, { use: true });
  assert.equal(doc.switches[0].on, true);
  assert.equal(doc.level.done, true);
  assert.equal(doc.level.at, doc.tick);
  assert.equal(doc.frame.columns[80].w[0].tex, 4, "pressed face");
  assert.equal(doc.frame.hud.end.length, 0, "the end screen waits a moment");
  const x = doc.player.x;
  for (let i = 0; i < 25; i++) doc = await step(games, { forward: -1, turn: 1, shoot: true });
  assert.equal(doc.player.x, x, "cannot move after finishing");
  assert.equal(doc.player.ammo, 50, "cannot fire");
  assert.equal(doc.player.hp, 100, "enemies cannot hurt a player who has finished");
  const lines = doc.frame.hud.end.map((l) => l.s);
  assert.equal(lines[0], "E1M1 FINISHED");
  assert.ok(lines.includes("KILLS  0 / 1") && lines.some((l) => l.startsWith("ITEMS  0 / 0")) && lines.some((l) => /^TIME  \d+:\d\d$/.test(l)), lines.join(" | "));
  assert.ok(doc.frame.hud.end.every((l) => Number.isInteger(l.y)));
});

test("switch use: a wall in between or an ordinary wall does nothing", async () => {
  await setState(games, { map: roomMap([[40, 31, 203], [40, 32, 203], ...wallRect(39, 39, 28, 36, 2)]), switches: [switchOf(0, [[40, 31], [40, 32]])], player: { x: 37.8, y: 31.8, angle: 0 } });
  let doc = await step(games, { use: true });
  assert.equal(doc.level.done, false);
  await setState(games, { map: roomMap(wallRect(40, 40, 28, 36, 2)), switches: [], player: { x: 38.5, y: 31.8, angle: 0 } });
  doc = await step(games, { use: true });
  assert.equal(doc.level.done, false);
});

test("door and switch faces are laid out across their own span, not by world position", async () => {
  // a 2-cell-wide door placed so that world-aligned texturing would wrap it (cells 39 and 40; 39 mod 4 = 3)
  const cells = [[39, 30, 105], [40, 30, 105]];
  const texelsAt = async (ang, x) => {
    await setState(games, { map: roomMap(cells), doors: [doorOf(0, cells.map(([c, r]) => [c, r]), 72, { x0: 39, y0: 30, nx: 2, ny: 1 })], player: { x, y: 33.5, angle: ang } });
    const doc = await step(games, {}, { stages: 2 });
    return doc._columns.filter((c) => c.w[0] && c.w[0].tex === 5).map((c) => c.w[0].sx);
  };
  // looking north (-y) at the door's south face
  const sx = await texelsAt(-Math.PI / 2, 40.0);
  assert.ok(sx.length > 10);
  const lo = Math.min(...sx), hi = Math.max(...sx);
  assert.ok(lo >= 0 && hi <= 31, `a 2-cell door uses the 32 left-hand texels once (got ${lo}..${hi})`);
  const increasing = sx.filter((v, i) => i === 0 || v !== sx[i - 1]);
  assert.ok(increasing.every((v, i) => i === 0 || Math.abs(v - increasing[i - 1]) <= 4), "no wrap-around seam");
});
