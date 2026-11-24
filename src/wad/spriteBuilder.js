// Sprites (64-wide floor-anchored canvases with 8 rotations), weapon frames, projectiles, decorations, HUD images.
import { decodePicture, blank, blit, toDataUrl, mirror } from "./pictureDecoder.js";

// Monster sprite sets: k = lump prefix; walk/atk/pain have 8 rotations, die frames are single (rotation 0).
export const MONSTER_SETS = {
  TROO: { k: "TROO", walk: ["A", "B", "C", "D"], atk: ["E", "F", "G"], pain: "H", die: ["I", "J", "K", "L", "M"] },
  POSS: { k: "POSS", walk: ["A", "B", "C", "D"], atk: ["E", "F", "E"], pain: "G", die: ["H", "I", "J", "K", "L"] },
  SPOS: { k: "SPOS", walk: ["A", "B", "C", "D"], atk: ["E", "F", "E"], pain: "G", die: ["H", "I", "J", "K", "L"] },
};
export const ITEM_FRAMES = ["BON1A0", "BON2A0", "STIMA0", "MEDIA0", "ARM1A0", "ARM2A0", "SHOTA0", "SHELA0", "SBOXA0", "CLIPA0", "AMMOA0"];
export const DECOR_FRAMES = ["COLUA0", "CBRAA0", "ELECA0", "BAR1A0", "BAR1B0", "BEXPA0", "BEXPB0", "BEXPC0", "BEXPD0", "BEXPE0", "POL5A0", "PLAYW0", "PLAYN0"];
export const TALL_FRAMES = new Set(["ELECA0"]); // 128 units tall instead of 64
export const PROJ_FRAMES = ["BAL1A0", "BAL1B0", "BAL1C0", "BAL1D0", "BAL1E0"];
export const WEAPON_FRAMES = ["SHTGA0", "SHTGB0", "SHTGC0", "SHTGD0", "SHTFA0"];

/** Find the picture for sprite `prefix+frame` at rotation `rot` (0..8). Returns a decoded (possibly mirrored) picture. */
export function findSprite(wad, base, rot, palette) {
  // lump name = 4-char prefix + frame letter + rotation digit [+ frame letter + rotation digit, the mirrored one]
  for (const l of wad.lumps) {
    const n = l.name;
    if (n.length !== 6 && n.length !== 8) continue;
    const pairs = [n.slice(0, 6)];
    if (n.length === 8) pairs.push(n.slice(0, 4) + n.slice(6, 8));
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].slice(0, 5) === base && Number(pairs[i].slice(5)) === rot) {
        const pic = decodePicture(wad.lump(n), palette);
        return i === 1 ? mirror(pic) : pic;
      }
    }
  }
  return null;
}

/** 64-wide canvas (64 units) of height `h` units; Doom's sprite origin lands at (32, h) = floor line. */
export function canvasFor(pic, h = 64) {
  const canvas = blank(64, h);
  blit(canvas, pic, 32 - pic.leftOfs, h - pic.topOfs);
  return canvas;
}
export function buildImp(wad, name, palette) {
  return canvasFor(decodePicture(wad.lump(name), palette), TALL_FRAMES.has(name) ? 128 : 64);
}
/** Canvas centred on Doom's sprite origin (projectiles are anchored at their middle). */
export function buildCentered(wad, name, palette) {
  const pic = decodePicture(wad.lump(name), palette);
  const canvas = blank(64, 64);
  blit(canvas, pic, 32 - pic.leftOfs, 32 - pic.topOfs);
  return canvas;
}

/** Weapon sprite at Doom's native screen position, clipped to the 320x168 3D view. */
function weaponLayer(wad, name, palette) {
  const pic = decodePicture(wad.lump(name), palette);
  const canvas = blank(320, 168);
  // Doom (R_DrawPSprite): x = 160 + (1 - 160 - leftOfs) = 1 - leftOfs. Vertically the weapon is centered on
  // BASEYCENTER (100) but the view is centered at viewheight/2 = 84 with a status bar, so y = 16 - topOfs.
  blit(canvas, pic, 1 - pic.leftOfs, 16 - pic.topOfs);
  return canvas;
}

export function buildWeapon(wad, name, palette) {
  const base = weaponLayer(wad, "SHTGA0", palette);
  if (name === "SHTGA0") return base;
  if (name === "SHTFA0") { // muzzle flash composited over the idle gun
    blit(base, weaponLayer(wad, "SHTFA0", palette), 0, 0);
    return base;
  }
  return weaponLayer(wad, name, palette);
}

// ---- status bar -------------------------------------------------------------------------------
const digits = (p) => Array.from({ length: 10 }, (_, i) => p + i);
export const FACE_TIERS = 5;
export const FACE_NAMES = [
  ...Array.from({ length: FACE_TIERS }, (_, t) => [`STFST${t}0`, `STFST${t}1`, `STFST${t}2`, `STFTR${t}0`, `STFTL${t}0`, `STFOUCH${t}`, `STFEVL${t}`, `STFKILL${t}`]).flat(),
  "STFDEAD0", "STFGOD0",
];
export const HUD_IMAGES = ["STBAR", "STARMS", ...digits("STTNUM"), "STTPRCNT", ...digits("STYSNUM"), ...[2, 3, 4, 5, 6, 7].map((n) => "STGNUM" + n), ...FACE_NAMES];

/** HUD patches are drawn at their own position by MQL; faces get Doom's patch offset baked into a 32x32 face-box canvas. */
export function buildHud(wad, name, palette) {
  const pic = decodePicture(wad.lump(name), palette);
  if (!name.startsWith("STF")) return pic;
  const canvas = blank(32, 32);
  blit(canvas, pic, -pic.leftOfs, -pic.topOfs); // V_DrawPatch(143, 168): x - leftOfs, y - topOfs
  return canvas;
}

/** Every rotation of every monster frame the game can show, keyed e.g. "POSSA3" (rotation digit last), deaths "POSSH0". */
export function buildMonsterFrames(wad, palette, setNames = Object.keys(MONSTER_SETS)) {
  const out = {};
  for (const sn of setNames) {
    const set = MONSTER_SETS[sn];
    const rotLetters = [...new Set([...set.walk, ...set.atk, set.pain])];
    for (const L of rotLetters)
      for (let rot = 1; rot <= 8; rot++) {
        const pic = findSprite(wad, set.k + L, rot, palette);
        if (!pic) throw new Error(`missing sprite ${set.k}${L}${rot}`);
        out[`${set.k}${L}${rot}`] = canvasFor(pic);
      }
    for (const L of set.die) out[`${set.k}${L}0`] = buildImp(wad, `${set.k}${L}0`, palette);
  }
  return out;
}

/** 64x64 floor/ceiling flat (raw palette indices, no header). */
export function buildFlat(wad, name, palette) {
  const b = wad.lump(name);
  const img = blank(64, 64);
  for (let i = 0; i < 4096; i++) {
    const c = palette[b[i]];
    img.rgba[i * 4] = c[0]; img.rgba[i * 4 + 1] = c[1]; img.rgba[i * 4 + 2] = c[2]; img.rgba[i * 4 + 3] = 255;
  }
  return img;
}

export function buildSpritePack(wad, palette, setNames) {
  const sprites = {};
  for (const [n, img] of Object.entries(buildMonsterFrames(wad, palette, setNames))) sprites[n] = toDataUrl(img);
  for (const n of [...ITEM_FRAMES, ...DECOR_FRAMES]) sprites[n] = toDataUrl(buildImp(wad, n, palette));
  for (const n of PROJ_FRAMES) sprites[n] = toDataUrl(buildCentered(wad, n, palette));
  for (const n of WEAPON_FRAMES) sprites[n] = toDataUrl(buildWeapon(wad, n, palette));
  const hud = {};
  for (const n of HUD_IMAGES) hud[n] = toDataUrl(buildHud(wad, n, palette));
  return { sprites, hud };
}
