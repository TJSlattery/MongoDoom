import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Wad } from "../src/wad/wadReader.js";
import { readPalette, fromDataUrl, toDataUrl } from "../src/wad/pictureDecoder.js";
import { readTextureDefs, buildWallTexture } from "../src/wad/textureBuilder.js";
import { buildImp, buildWeapon, buildHud, IMP_FRAMES, WEAPON_FRAMES, HUD_IMAGES } from "../src/wad/spriteBuilder.js";
import { rasterizeE1M1, GRID } from "../src/wad/e1m1Rasterizer.js";

const wadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "DOOM1.WAD");
const wad = Wad.load(wadPath);
const palette = readPalette(wad);
const defs = readTextureDefs(wad);
const raster = rasterizeE1M1(wad);

test("IWAD header and lump directory", () => {
  assert.equal(wad.buf.toString("ascii", 0, 4), "IWAD");
  assert.ok(wad.lumps.length > 1000);
  for (const l of ["PLAYPAL", "PNAMES", "TEXTURE1", "E1M1", ...IMP_FRAMES, ...WEAPON_FRAMES, ...HUD_IMAGES]) assert.ok(wad.has(l), `missing lump ${l}`);
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
  for (const n of IMP_FRAMES) {
    const c = buildImp(wad, n, palette);
    assert.deepEqual([c.width, c.height], [64, 64]);
    assert.ok(c.rgba.some((v, i) => i % 4 === 3 && v === 255), `${n} is empty`);
  }
  for (const n of WEAPON_FRAMES) {
    const c = buildWeapon(wad, n, palette);
    assert.deepEqual([c.width, c.height], [320, 168]);
    assert.ok(c.rgba.some((v, i) => i % 4 === 3 && v === 255), `${n} is empty`);
  }
  const bar = buildHud(wad, "STBAR", palette);
  assert.deepEqual([bar.width, bar.height], [320, 32]);
});

test("E1M1 window: closed, connected, with doors and enemies", () => {
  const { map, player, enemies, textureNames } = raster;
  assert.equal(map.length, GRID * GRID);
  assert.ok(map.every(Number.isInteger));
  for (let i = 0; i < GRID; i++) {
    assert.ok(map[i] > 0 && map[(GRID - 1) * GRID + i] > 0 && map[i * GRID] > 0 && map[i * GRID + GRID - 1] > 0, "border must be solid");
  }
  const at = (x, y) => map[Math.floor(y) * GRID + Math.floor(x)];
  assert.equal(at(player.x, player.y), 0, "spawn cell must be open");
  assert.ok(map.every((v) => v === 0 || (v >= 1 && v <= 63) || (v >= 101 && v <= 163)), "tile id range");
  assert.ok(map.every((v) => v === 0 || (v % 100) <= textureNames.length), "tile ids must reference real textures");

  // every open cell is reachable from the spawn (4-connected, doors crossable)
  const seen = new Set([Math.floor(player.y) * GRID + Math.floor(player.x)]);
  const stack = [...seen];
  while (stack.length) {
    const i = stack.pop(), r = Math.floor(i / GRID), c = i % GRID;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const R = r + dr, C = c + dc, j = R * GRID + C;
      if (R < 0 || C < 0 || R >= GRID || C >= GRID || seen.has(j) || map[j] >= 1 && map[j] < 100) continue;
      seen.add(j); stack.push(j);
    }
  }
  const open = map.filter((v) => v === 0).length;
  const reachedOpen = [...seen].filter((i) => map[i] === 0).length;
  assert.equal(reachedOpen, open, "no sealed open pockets");
  assert.ok(open >= 800, `only ${open} open cells`);
  assert.ok(map.some((v) => v >= 100), "needs at least one door");
  assert.ok(enemies.length >= 5, `only ${enemies.length} enemies`);
  assert.ok(enemies.length <= 12);
  for (const e of enemies) assert.ok(seen.has(Math.floor(e.y) * GRID + Math.floor(e.x)) && at(e.x, e.y) === 0, `enemy ${e.id} not on open reachable cell`);
});

test("all textures referenced by the map exist in TEXTURE1", () => {
  for (const n of raster.textureNames) assert.ok(defs.has(n), `texture ${n} not found`);
});
