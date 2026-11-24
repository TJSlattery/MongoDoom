// PNAMES + TEXTURE1 compositor. Each texture is normalized to 64x128 RGBA covering 128x128 world units.
import { decodePicture, blank, blit } from "./pictureDecoder.js";

export function readTextureDefs(wad) {
  const pn = wad.lump("PNAMES");
  const count = pn.readUInt32LE(0);
  const patchNames = [];
  for (let i = 0; i < count; i++) patchNames.push(pn.toString("ascii", 4 + i * 8, 12 + i * 8).replace(/\0.*$/s, "").toUpperCase());

  const lists = ["TEXTURE1", "TEXTURE2"].filter((n) => wad.has(n));
  const defs = new Map();
  for (const lumpName of lists) {
    const t = wad.lump(lumpName);
    const num = t.readInt32LE(0);
    for (let i = 0; i < num; i++) {
      const o = t.readInt32LE(4 + i * 4);
      const name = t.toString("ascii", o, o + 8).replace(/\0.*$/s, "").toUpperCase();
      const width = t.readInt16LE(o + 12);
      const height = t.readInt16LE(o + 14);
      const pc = t.readInt16LE(o + 20);
      const patches = [];
      for (let p = 0; p < pc; p++) {
        const po = o + 22 + p * 10;
        patches.push({ originX: t.readInt16LE(po), originY: t.readInt16LE(po + 2), name: patchNames[t.readInt16LE(po + 4)] });
      }
      if (!defs.has(name)) defs.set(name, { name, width, height, patches });
    }
  }
  return defs;
}

/** Composite a texture definition at native size. */
export function compositeTexture(wad, def, palette) {
  const img = blank(def.width, def.height);
  for (const p of def.patches) {
    if (!wad.has(p.name)) continue;
    blit(img, decodePicture(wad.lump(p.name), palette), p.originX, p.originY);
  }
  return img;
}

/** Normalize to 64x128: tile/crop to 128x128 world units, then nearest-downsample x by 2. */
export function normalizeWall(img) {
  const out = blank(64, 128);
  for (let y = 0; y < 128; y++) {
    const sy = y % img.height;
    for (let x = 0; x < 64; x++) {
      const sx = (x * 2) % img.width;
      const so = (sy * img.width + sx) * 4;
      const o = (y * 64 + x) * 4;
      if (img.rgba[so + 3] === 0) { // transparent (e.g. middle textures with holes) -> opaque mid-gray
        out.rgba[o] = out.rgba[o + 1] = out.rgba[o + 2] = 96; out.rgba[o + 3] = 255;
      } else {
        out.rgba[o] = img.rgba[so]; out.rgba[o + 1] = img.rgba[so + 1];
        out.rgba[o + 2] = img.rgba[so + 2]; out.rgba[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Normalize a door or switch texture: drawn once (no tiling), left-aligned and bottom-aligned, 2 world units per column
 *  horizontally... i.e. the first `width/2` columns hold the picture, so a 64-unit door/switch face shows it at native size. */
export function normalizeSolo(img) {
  const out = blank(64, 128);
  for (let i = 0; i < out.rgba.length; i += 4) { out.rgba[i] = out.rgba[i + 1] = out.rgba[i + 2] = 96; out.rgba[i + 3] = 255; }
  const h = Math.min(128, img.height);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < 64 && x * 2 < img.width; x++) {
      const so = (y * img.width + x * 2) * 4;
      if (img.rgba[so + 3] === 0) continue;
      const o = ((128 - h + y) * 64 + x) * 4;
      out.rgba[o] = img.rgba[so]; out.rgba[o + 1] = img.rgba[so + 1]; out.rgba[o + 2] = img.rgba[so + 2];
    }
  return out;
}

export function buildWallTexture(wad, defs, name, palette) {
  const solo = name.endsWith("#solo");
  const def = defs.get(solo ? name.slice(0, -5) : name);
  if (!def) return null;
  const img = compositeTexture(wad, def, palette);
  return solo ? normalizeSolo(img) : normalizeWall(img);
}

/** The 256x128 sky as a seamless opaque image (rows below the patch repeat its last row). */
export function buildSky(wad, defs, palette) {
  const img = compositeTexture(wad, defs.get("SKY1"), palette);
  for (let y = 1; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      if (img.rgba[o + 3] === 0) img.rgba.copy(img.rgba, o, o - img.width * 4, o - img.width * 4 + 4);
    }
  return img;
}
