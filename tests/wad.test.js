import test from "node:test";
import assert from "node:assert/strict";
import { Wad } from "../src/wad/wadReader.js";
import { fetchWad } from "../scripts/fetch-wad.js";
import { readPalette, fromDataUrl, toDataUrl } from "../src/wad/pictureDecoder.js";
import { readTextureDefs, buildWallTexture, buildSky } from "../src/wad/textureBuilder.js";
import { ITEM_FRAMES, DECOR_FRAMES, PROJ_FRAMES, MONSTER_SETS, buildImp, buildCentered, buildMonsterFrames, buildWeapon, buildHud, WEAPON_FRAMES, HUD_IMAGES } from "../src/wad/spriteBuilder.js";
import { rasterizeE1M1, GRID_W, GRID_H } from "../src/wad/e1m1Rasterizer.js";

const wadPath = await fetchWad(); // downloads the shareware WAD on a fresh clone
const wad = Wad.load(wadPath);
const palette = readPalette(wad);
const defs = readTextureDefs(wad);
const raster = rasterizeE1M1(wad);

test("IWAD header and lump directory", () => {
  assert.equal(wad.buf.toString("ascii", 0, 4), "IWAD");
  assert.ok(wad.lumps.length > 1000);
  for (const l of ["PLAYPAL", "PNAMES", "TEXTURE1", "E1M1", ...ITEM_FRAMES, ...DECOR_FRAMES, ...PROJ_FRAMES, ...WEAPON_FRAMES, ...HUD_IMAGES, "SKY1"]) assert.ok(wad.has(l), `missing lump ${l}`);
  for (const l of ["THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SEGS", "SSECTORS", "NODES", "SECTORS"]) assert.ok(wad.mapLump("E1M1", l).length > 0);
});

test("PLAYPAL yields 256 RGB triplets", () => {
  assert.equal(palette.length, 256);
  for (const c of palette) assert.ok(c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
});

test("wall textures normalize to 64x128 PNG data URLs", () => {
  for (const name of ["STARTAN3", "BIGDOOR2", "DOORBLU", "BROWN1", "COMPUTE2"]) {
    if (!defs.has(name)) continue;
    const img = buildWallTexture(wad, defs, name, palette);
    assert.equal(img.width, 64); assert.equal(img.height, 128);
    assert.equal(img.rgba.length, 64 * 128 * 4);
    for (let i = 3; i < img.rgba.length; i += 4) assert.equal(img.rgba[i], 255, `${name} has non-opaque pixel`);
    const back = fromDataUrl(toDataUrl(img));
    assert.equal(back.width, 64); assert.equal(back.height, 128);
  }
  assert.ok(defs.has("STARTAN3"));
});

test("sprite, weapon and HUD canvases have the specified sizes", () => {
  for (const [n, c] of Object.entries(buildMonsterFrames(wad, palette))) {
    assert.deepEqual([c.width, c.height], [64, 64], n);
    assert.ok(c.rgba.some((v, i) => i % 4 === 3 && v === 255), `${n} is empty`);
  }
  for (const n of WEAPON_FRAMES) {
    const c = buildWeapon(wad, n, palette);
    assert.deepEqual([c.width, c.height], [320, 168]);
    assert.ok(c.rgba.some((v, i) => i % 4 === 3 && v === 255), `${n} is empty`);
  }
  for (const n of HUD_IMAGES) {
    const c = buildHud(wad, n, palette);
    if (n.startsWith("STF")) assert.deepEqual([c.width, c.height], [32, 32], n); // face box
    assert.ok(c.rgba.some((v, i) => i % 4 === 3 && v === 255), `${n} is empty`);
  }
  const bar = buildHud(wad, "STBAR", palette);
  assert.deepEqual([bar.width, bar.height], [320, 32]);
});

test("E1M1 full map: closed, connected, with doors and enemies", () => {
  const { map, player, enemies, textureNames } = raster;
  assert.equal(map.length, GRID_W * GRID_H);
  assert.ok(map.every(Number.isInteger));
  for (let c = 0; c < GRID_W; c++) assert.ok(map[c] % 256 > 0 && map[(GRID_H - 1) * GRID_W + c] % 256 > 0, "top/bottom border must be solid");
  for (let r = 0; r < GRID_H; r++) assert.ok(map[r * GRID_W] % 256 > 0 && map[r * GRID_W + GRID_W - 1] % 256 > 0, "left/right border must be solid");
  const at = (x, y) => map[Math.floor(y) * GRID_W + Math.floor(x)] % 256;
  assert.equal(at(player.x, player.y), 0, "spawn cell must be open");
  const tile = (v) => v % 256;
  assert.ok(map.every((v) => tile(v) === 0 || (tile(v) >= 1 && tile(v) <= 99) || (tile(v) >= 101 && tile(v) <= 199) || (tile(v) >= 201 && tile(v) <= 255)), "tile id range (walls, doors, switches)");
  assert.ok(map.every((v) => Math.floor(v / 256) < raster.tables.secF.length), "sector ids in range");
  assert.ok(map.every((v) => tile(v) === 0 || (tile(v) % 100) <= textureNames.length), "tile ids must reference real textures");

  // every open cell is reachable from the spawn (4-connected, doors crossable)
  const seen = new Set([Math.floor(player.y) * GRID_W + Math.floor(player.x)]);
  const stack = [...seen];
  while (stack.length) {
    const i = stack.pop(), r = Math.floor(i / GRID_W), c = i % GRID_W;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const R = r + dr, C = c + dc, j = R * GRID_W + C;
      if (R < 0 || C < 0 || R >= GRID_H || C >= GRID_W || seen.has(j) || (tile(map[j]) >= 1 && tile(map[j]) < 100)) continue;
      seen.add(j); stack.push(j);
    }
  }
  const open = map.filter((v) => tile(v) === 0).length;
  const reachedOpen = [...seen].filter((i) => tile(map[i]) === 0).length;
  assert.equal(reachedOpen, open, "no sealed open pockets");
  assert.ok(open >= 3000, `only ${open} open cells`);
  assert.ok(map.some((v) => tile(v) >= 100 && tile(v) < 200), "needs at least one door");
  assert.ok(enemies.length >= 5, `only ${enemies.length} enemies`);
  assert.ok(enemies.length <= 40);
  for (const e of enemies) assert.ok(seen.has(Math.floor(e.y) * GRID_W + Math.floor(e.x)) && at(e.x, e.y) === 0, `enemy ${e.id} not on open reachable cell`);
});

test("all textures referenced by the map exist in TEXTURE1", () => {
  for (const n of raster.textureNames) assert.ok(defs.has(n.replace(/#solo$/, "")), `texture ${n} not found`);
});

test("pickups: real E1M1 items are placed on open cells with the sprites they need", () => {
  const { items, textureNames } = raster;
  assert.ok(items.length >= 30, `only ${items.length} items`);
  assert.ok(items.some((i) => i.sprite === "ARM1A0") && items.some((i) => i.sprite === "ARM2A0"), "green and blue armor present");
  assert.ok(items.filter((i) => i.sprite === "BON2A0").length >= 10, "armor helmets present");
  for (const i of items) {
    assert.ok(ITEM_FRAMES.includes(i.sprite));
    assert.equal(raster.map[Math.floor(i.y) * GRID_W + Math.floor(i.x)] % 256, 0, `item ${i.id} not on an open cell`);
    assert.ok(i.hp + i.ar + i.am + i.bu > 0 && i.taken === false);
  }
  for (const n of ITEM_FRAMES) assert.deepEqual([buildImp(wad, n, palette).width, buildImp(wad, n, palette).height], [64, 64]);
});

test("enemies carry the right sprite set, facing and stats for their type", () => {
  const kinds = {};
  for (const e of raster.enemies) {
    kinds[e.sp.k] = (kinds[e.sp.k] || 0) + 1;
    assert.equal(e.hp, { TROO: 60, POSS: 20, SPOS: 30 }[e.sp.k]);
    assert.equal(e.mel, e.sp.k === "TROO");
    assert.equal(e.proj, e.sp.k === "TROO", "only imps throw fireballs");
    assert.ok(Number.isFinite(e.ang), "enemies start with a facing angle");
    assert.deepEqual(e.sp, MONSTER_SETS[e.sp.k]);
  }
  assert.ok(kinds.TROO >= 1 && kinds.POSS >= 1, JSON.stringify(kinds));
});

test("monster rotations: all 8 views exist and mirrored views differ from their partners", () => {
  const frames = buildMonsterFrames(wad, palette, ["TROO", "POSS"]);
  for (const sn of ["TROO", "POSS"]) {
    const set = MONSTER_SETS[sn];
    for (const L of [...set.walk, ...set.atk, set.pain]) for (let r = 1; r <= 8; r++) assert.ok(frames[`${sn}${L}${r}`], `${sn}${L}${r}`);
    for (const L of set.die) assert.ok(frames[`${sn}${L}0`], `${sn}${L}0`);
    assert.ok(!frames[`${sn}A2`].rgba.equals(frames[`${sn}A8`].rgba), "rotation 8 is the mirror of 2, not a copy");
    assert.ok(!frames[`${sn}A1`].rgba.equals(frames[`${sn}A5`].rgba), "front and back differ");
  }
});

test("sky, sector light, decorations and fireball art", () => {
  const sky = buildSky(wad, readTextureDefs(wad), palette);
  assert.deepEqual([sky.width, sky.height], [256, 128]);
  for (let i = 3; i < sky.rgba.length; i += 4) assert.equal(sky.rgba[i], 255, "sky must be fully opaque");
  const { tables, decor } = raster;
  assert.ok(tables.secCT.some((v) => v < 0), "E1M1 has sky ceilings (flat id -1)");
  assert.ok(tables.secCT.every((v) => v <= tables.secCT.length + 40));
  assert.ok(tables.secL.every((l) => l >= 0 && l <= 255) && new Set(tables.secL).size > 3, "varied sector light levels");
  assert.equal(tables.secL.length, tables.secF.length);
  assert.ok(tables.secS.includes(7), "nukage sectors are marked");
  assert.ok(decor.length >= 15 && decor.some((d) => d.barrel) && decor.some((d) => d.solid && !d.barrel));
  for (const d of decor) {
    assert.equal(raster.map[Math.floor(d.y) * GRID_W + Math.floor(d.x)] % 256, 0, `decor ${d.id} not on an open cell`);
    assert.ok(DECOR_FRAMES.includes(d.sprite) && d.anim.every((n) => DECOR_FRAMES.includes(n)));
  }
  assert.deepEqual([buildImp(wad, "ELECA0", palette).width, buildImp(wad, "ELECA0", palette).height], [64, 128], "tall column canvas");
  for (const n of PROJ_FRAMES) assert.deepEqual([buildCentered(wad, n, palette).width, buildCentered(wad, n, palette).height], [64, 64]);
});

test("exit switch and door textures: one switch, drawn once, with its pressed face", () => {
  const { switches, doors, textureNames, map } = raster;
  assert.equal(switches.length, 1, "E1M1 has one exit switch");
  const sw = switches[0];
  assert.ok(sw.exit && !sw.on && sw.cells.length >= 2);
  assert.equal(textureNames[sw.tex - 1], "SW1STRTN#solo");
  assert.equal(textureNames[sw.texOn - 1], "SW2STRTN#solo");
  for (const c of sw.cells) assert.equal(map[c] % 256, 200 + sw.tex);
  assert.ok(doors.every((d) => Number.isInteger(d.x0) && d.nx >= 1 && d.ny >= 1 && d.cells.length === d.nx * d.ny));
  const exit = doors.find((d) => textureNames.includes("EXITDOOR#solo") && textureNames[(map[d.cells[0]] % 256) - 101] === "EXITDOOR#solo");
  assert.ok(exit, "the exit door uses its own non-tiled texture");
  // solo textures: picture drawn once, bottom-aligned (EXITDOOR is only 72 rows tall)
  const img = buildWallTexture(wad, defs, "EXITDOOR#solo", palette);
  assert.deepEqual([img.width, img.height], [64, 128]);
  const px = (x, y) => img.rgba.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3).join(",");
  assert.equal(px(2, 5), "96,96,96", "rows above the 72-row picture are plain filler, not a repeat");
  assert.notEqual(px(10, 100), "96,96,96");
});
