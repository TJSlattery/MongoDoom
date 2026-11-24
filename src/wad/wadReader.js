// Binary IWAD reader: header, lump directory, and E1M1 map lump parsers.
import fs from "node:fs";

const name8 = (buf, off) => buf.toString("ascii", off, off + 8).replace(/\0.*$/s, "").toUpperCase();

export class Wad {
  constructor(buf) {
    this.buf = buf;
    const magic = buf.toString("ascii", 0, 4);
    if (magic !== "IWAD" && magic !== "PWAD") throw new Error(`Not a WAD: ${magic}`);
    const numLumps = buf.readInt32LE(4);
    const dirOffset = buf.readInt32LE(8);
    this.lumps = [];
    for (let i = 0; i < numLumps; i++) {
      const o = dirOffset + i * 16;
      this.lumps.push({ offset: buf.readInt32LE(o), size: buf.readInt32LE(o + 4), name: name8(buf, o + 8) });
    }
    this.byName = new Map();
    this.lumps.forEach((l, i) => {
      if (!this.byName.has(l.name)) this.byName.set(l.name, i);
    });
  }

  static load(path) {
    return new Wad(fs.readFileSync(path));
  }

  has(name) {
    return this.byName.has(name);
  }

  lump(name) {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`Missing lump ${name}`);
    const l = this.lumps[i];
    return this.buf.subarray(l.offset, l.offset + l.size);
  }

  /** Map lumps are looked up by name inside the 10 lumps after the marker. */
  mapLump(marker, name) {
    const mi = this.byName.get(marker);
    if (mi === undefined) throw new Error(`Missing map ${marker}`);
    for (let i = mi + 1; i <= mi + 10 && i < this.lumps.length; i++) {
      if (this.lumps[i].name === name) {
        const l = this.lumps[i];
        return this.buf.subarray(l.offset, l.offset + l.size);
      }
    }
    throw new Error(`Missing ${name} in ${marker}`);
  }

  loadMap(marker = "E1M1") {
    const m = (n) => this.mapLump(marker, n);
    const vb = m("VERTEXES");
    const vertexes = [];
    for (let i = 0; i < vb.length / 4; i++) vertexes.push({ x: vb.readInt16LE(i * 4), y: vb.readInt16LE(i * 4 + 2) });

    const lb = m("LINEDEFS");
    const linedefs = [];
    for (let i = 0; i < lb.length / 14; i++) {
      const o = i * 14;
      linedefs.push({
        v1: lb.readUInt16LE(o), v2: lb.readUInt16LE(o + 2), flags: lb.readInt16LE(o + 4),
        special: lb.readInt16LE(o + 6), tag: lb.readInt16LE(o + 8),
        right: lb.readInt16LE(o + 10), left: lb.readInt16LE(o + 12),
      });
    }

    const sb = m("SIDEDEFS");
    const sidedefs = [];
    for (let i = 0; i < sb.length / 30; i++) {
      const o = i * 30;
      sidedefs.push({
        upper: name8(sb, o + 4), lower: name8(sb, o + 12), middle: name8(sb, o + 20), sector: sb.readInt16LE(o + 28),
      });
    }

    const cb = m("SECTORS");
    const sectors = [];
    for (let i = 0; i < cb.length / 26; i++) {
      const o = i * 26;
      sectors.push({ floorH: cb.readInt16LE(o), ceilH: cb.readInt16LE(o + 2), special: cb.readInt16LE(o + 22), tag: cb.readInt16LE(o + 24) });
    }

    const tb = m("THINGS");
    const things = [];
    for (let i = 0; i < tb.length / 10; i++) {
      const o = i * 10;
      things.push({ x: tb.readInt16LE(o), y: tb.readInt16LE(o + 2), angle: tb.readInt16LE(o + 4), type: tb.readInt16LE(o + 6), flags: tb.readInt16LE(o + 8) });
    }

    const gb = m("SEGS");
    const segs = [];
    for (let i = 0; i < gb.length / 12; i++) {
      const o = i * 12;
      segs.push({ linedef: gb.readInt16LE(o + 6), side: gb.readInt16LE(o + 8) });
    }

    const ssb = m("SSECTORS");
    const ssectors = [];
    for (let i = 0; i < ssb.length / 4; i++) ssectors.push({ count: ssb.readUInt16LE(i * 4), first: ssb.readUInt16LE(i * 4 + 2) });

    const nb = m("NODES");
    const nodes = [];
    for (let i = 0; i < nb.length / 28; i++) {
      const o = i * 28;
      nodes.push({ x: nb.readInt16LE(o), y: nb.readInt16LE(o + 2), dx: nb.readInt16LE(o + 4), dy: nb.readInt16LE(o + 6), right: nb.readUInt16LE(o + 24), left: nb.readUInt16LE(o + 26) });
    }

    return { vertexes, linedefs, sidedefs, sectors, things, segs, ssectors, nodes };
  }
}

/** Sector index containing world point (x, y), via BSP descent. */
export function sectorAt(map, x, y) {
  let child = map.nodes.length - 1;
  while (!(child & 0x8000)) {
    const n = map.nodes[child];
    // Doom R_PointOnSide: front (right child) iff (y-ny)*dx < dy*(x-nx)
    child = (y - n.y) * n.dx < n.dy * (x - n.x) ? n.right : n.left;
  }
  const ss = map.ssectors[child & 0x7fff];
  const seg = map.segs[ss.first];
  const ld = map.linedefs[seg.linedef];
  const sd = seg.side === 0 ? ld.right : ld.left;
  return map.sidedefs[sd].sector;
}
