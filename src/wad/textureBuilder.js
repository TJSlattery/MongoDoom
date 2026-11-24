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

export function buildWallTexture(wad, defs, name, palette) {
  const def = defs.get(name);
  if (!def) return null;
  return normalizeWall(compositeTexture(wad, def, palette));
}
