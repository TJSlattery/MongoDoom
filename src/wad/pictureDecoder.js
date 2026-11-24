// PLAYPAL + Doom column-post picture decoder -> RGBA buffers / PNG data URLs.
import { PNG } from "pngjs";

export function readPalette(wad) {
  const b = wad.lump("PLAYPAL");
  const pal = [];
  for (let i = 0; i < 256; i++) pal.push([b[i * 3], b[i * 3 + 1], b[i * 3 + 2]]);
  return pal;
}

/** Decode a column-post lump into { width, height, leftOfs, topOfs, rgba } (transparent where unwritten). */
export function decodePicture(buf, palette) {
  const width = buf.readUInt16LE(0);
  const height = buf.readUInt16LE(2);
  const leftOfs = buf.readInt16LE(4);
  const topOfs = buf.readInt16LE(6);
  const rgba = Buffer.alloc(width * height * 4);
  for (let x = 0; x < width; x++) {
    let p = buf.readUInt32LE(8 + x * 4);
    for (;;) {
      if (p >= buf.length) break;
      const topDelta = buf[p++];
      if (topDelta === 0xff) break;
      const len = buf[p++];
      p++; // pad
      for (let i = 0; i < len; i++) {
        const y = topDelta + i;
        const idx = buf[p++];
        if (y < height && p <= buf.length) {
          const o = (y * width + x) * 4;
          const c = palette[idx];
          rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
        }
      }
      p++; // trailing pad
    }
  }
  return { width, height, leftOfs, topOfs, rgba };
}

export function blank(width, height) {
  return { width, height, rgba: Buffer.alloc(width * height * 4) };
}

/** Alpha-composite `src` onto `dst` with its top-left at (x0, y0); out-of-range pixels are clipped. */
export function blit(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) {
    const dy = y + y0;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + x0;
      if (dx < 0 || dx >= dst.width) continue;
      const so = (y * src.width + x) * 4;
      if (src.rgba[so + 3] === 0) continue;
      const d = (dy * dst.width + dx) * 4;
      dst.rgba[d] = src.rgba[so]; dst.rgba[d + 1] = src.rgba[so + 1];
      dst.rgba[d + 2] = src.rgba[so + 2]; dst.rgba[d + 3] = 255;
    }
  }
}

export function toDataUrl({ width, height, rgba }) {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  return "data:image/png;base64," + PNG.sync.write(png).toString("base64");
}

export function fromDataUrl(url) {
  const png = PNG.sync.read(Buffer.from(url.split(",")[1], "base64"));
  return { width: png.width, height: png.height, rgba: png.data };
}
