// Rasterizes the whole real E1M1 into a GRID_W x GRID_H grid (32 Doom units per cell, flat heights).
//  - open/solid via even-odd point-in-level sampling on one-sided linedefs (keeps 64-unit corridors open)
//  - sectors via BSP descent; doors from zero-height sectors; reachability flood fill from the spawn
import { sectorAt } from "./wadReader.js";
import { readPalette } from "./pictureDecoder.js";

import { GRID_W, GRID_H, STEP_UP, HEADROOM, DOOR_SPEED } from "../mql/constants.js";

export { GRID_W, GRID_H };
export const CELL = 32;
const DOOR_SPECIALS = new Set([1, 26, 27, 28, 31, 32, 33, 34]);
// thing type -> stats and sprite set (sp = which frames to show; proj = throws fireballs; mel = has a melee attack)
import { MONSTER_SETS } from "./spriteBuilder.js";
export const ENEMY_DEFS = {
  3001: { hp: 60, mel: true, proj: true, sp: MONSTER_SETS.TROO }, // Imp
  3004: { hp: 20, mel: false, proj: false, sp: MONSTER_SETS.POSS }, // Zombieman
  9: { hp: 30, mel: false, proj: false, sp: MONSTER_SETS.SPOS }, // Shotgun guy
};
const ENEMY_TYPES = new Set(Object.keys(ENEMY_DEFS).map(Number));
// thing type -> pickup effect (hp/ar/am amounts and caps; arAbs = fraction of damage absorbed)
const ITEM_DEFS = {
  2014: { sprite: "BON1A0", hp: 1, hpCap: 200 },
  2015: { sprite: "BON2A0", ar: 1, arCap: 200, arAbs: 0.33 },
  2011: { sprite: "STIMA0", hp: 10, hpCap: 100 },
  2012: { sprite: "MEDIA0", hp: 25, hpCap: 100 },
  2018: { sprite: "ARM1A0", ar: 100, arCap: 100, arAbs: 0.33 },
  2019: { sprite: "ARM2A0", ar: 200, arCap: 200, arAbs: 0.5 },
  2001: { sprite: "SHOTA0", am: 8, amCap: 100 },
  2008: { sprite: "SHELA0", am: 4, amCap: 100 },
  2049: { sprite: "SBOXA0", am: 20, amCap: 100 },
  2007: { sprite: "CLIPA0", bu: 10, buCap: 200 },
  2048: { sprite: "AMMOA0", bu: 50, buCap: 200 },
};
// decorations: solid ones block movement (r = blocking half-width in cells); barrels can be shot and explode
const D = (sprite, extra = {}) => ({ sprite, anim: [sprite], animTicks: 1, solid: false, r: 0.5, hu: 64, barrel: false, hp: 0, ...extra });
export const DECOR_DEFS = {
  2028: D("COLUA0", { solid: true }),
  35: D("CBRAA0", { solid: true }),
  48: D("ELECA0", { solid: true, hu: 128 }),
  2035: D("BAR1A0", { solid: true, r: 0.4, anim: ["BAR1A0", "BAR1B0"], animTicks: 6, barrel: true, hp: 20 }),
  24: D("POL5A0"),
  10: D("PLAYW0"),
  12: D("PLAYW0"),
  15: D("PLAYN0"),
};
export const MAX_ENEMIES = 40;
export const ENEMY_HP = 60;

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx - px, cy = a.y + t * dy - py;
  return Math.hypot(cx, cy);
}

export function rasterizeE1M1(wad) {
  const m = wad.loadMap("E1M1");
  const { vertexes, linedefs, sidedefs, sectors, things } = m;
  const V = (i) => vertexes[i];

  const oneSided = linedefs.filter((l) => l.left === -1);
  const oneSegs = oneSided.map((l) => ({ a: V(l.v1), b: V(l.v2), l }));
  const inside = (x, y) => {
    let c = 0;
    for (const { a, b } of oneSegs) {
      if (a.y > y !== b.y > y) {
        const xi = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (xi > x) c++;
      }
    }
    return (c & 1) === 1;
  };

  // ---- global 32-unit grid over the whole map -------------------------------------------------
  const xs = vertexes.map((v) => v.x), ys = vertexes.map((v) => v.y);
  const gx0 = Math.floor(Math.min(...xs) / CELL) * CELL;
  const gyTop = Math.ceil(Math.max(...ys) / CELL) * CELL;
  const GW = Math.ceil((Math.max(...xs) - gx0) / CELL) + 1;
  const GH = Math.ceil((gyTop - Math.min(...ys)) / CELL) + 1;
  const gi = (c, r) => r * GW + c;
  const cx = (c) => gx0 + (c + 0.5) * CELL;
  const cy = (r) => gyTop - (r + 0.5) * CELL;

  const open = new Uint8Array(GW * GH);
  const sec = new Int16Array(GW * GH).fill(-1);
  for (let r = 0; r < GH; r++)
    for (let c = 0; c < GW; c++) {
      if (inside(cx(c), cy(r))) {
        open[gi(c, r)] = 1;
        sec[gi(c, r)] = sectorAt(m, cx(c), cy(r));
      }
    }

  // ---- door sectors ---------------------------------------------------------------------------
  const sectorLines = new Map(); // sector -> linedefs touching it
  linedefs.forEach((l) => {
    for (const sd of [l.right, l.left]) {
      if (sd < 0) continue;
      const s = sidedefs[sd].sector;
      if (!sectorLines.has(s)) sectorLines.set(s, []);
      sectorLines.get(s).push(l);
    }
  });
  const doorSectors = [];
  sectorLines.forEach((lines, s) => {
    if (sectors[s].ceilH > sectors[s].floorH) return;
    const twoSided = lines.filter((l) => l.left >= 0);
    const neighbors = new Set();
    twoSided.forEach((l) => {
      const a = sidedefs[l.right].sector, b = sidedefs[l.left].sector;
      neighbors.add(a === s ? b : a);
    });
    const hasDoorSpecial = twoSided.some((l) => DOOR_SPECIALS.has(l.special));
    if (neighbors.size >= 1 && hasDoorSpecial) {
      const pts = lines.flatMap((l) => [V(l.v1), V(l.v2)]);
      // face texture: upper texture of a sidedef belonging to a *different* sector, facing the door
      let tex = null;
      for (const l of twoSided) {
        for (const sd of [l.right, l.left]) {
          const d = sidedefs[sd];
          if (d.sector === s) continue;
          for (const t of [d.upper, d.lower, d.middle]) if (!tex && t !== "-") tex = t;
        }
      }
      doorSectors.push({
        s, tex: tex || "BIGDOOR2",
        minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
      });
    }
  });
  const doorAt = new Map(); // global cell index -> door sector entry
  for (const d of doorSectors) {
    const c0 = Math.floor((d.minX - gx0) / CELL), c1 = Math.floor((d.maxX - 1 - gx0) / CELL);
    const r0 = Math.floor((gyTop - d.maxY) / CELL), r1 = Math.floor((gyTop - d.minY - 1) / CELL);
    let any = false;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (c >= 0 && r >= 0 && c < GW && r < GH && open[gi(c, r)]) { doorAt.set(gi(c, r), d); any = true; }
    if (!any) {
      const c = Math.floor(((d.minX + d.maxX) / 2 - gx0) / CELL), r = Math.floor((gyTop - (d.minY + d.maxY) / 2) / CELL);
      if (c >= 0 && r >= 0 && c < GW && r < GH) { open[gi(c, r)] = 1; doorAt.set(gi(c, r), d); }
    }
  }

  // door cells borrow the sector of an adjacent non-door open cell, so they have real heights once opened
  {
    const headroom = (x) => sectors[x].ceilH - sectors[x].floorH;
    const resolved = new Set();
    for (let pass = 0; pass < 4; pass++)
      for (const g of doorAt.keys()) {
        if (resolved.has(g)) continue;
        const c = g % GW, r = Math.floor(g / GW);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= GW || nr >= GH) continue;
          const j = gi(nc, nr);
          if (!open[j] || sec[j] < 0 || (doorAt.has(j) && !resolved.has(j)) || headroom(sec[j]) < 56) continue;
          sec[g] = sec[j]; resolved.add(g); break;
        }
      }
    for (const g of doorAt.keys()) if (!resolved.has(g)) sec[g] = 0;
  }

  // ---- spawn & enemy things -------------------------------------------------------------------
  const start = things.find((t) => t.type === 1);
  const enemyThings = things.filter((t) => ENEMY_TYPES.has(t.type) && (t.flags & 2) !== 0 && (t.flags & 0x10) === 0);
  const toG = (x, y) => ({ c: Math.floor((x - gx0) / CELL), r: Math.floor((gyTop - y) / CELL) });

  const floorOf = (idx) => (sec[idx] >= 0 ? sectors[sec[idx]].floorH : 0);
  const ceilOf = (idx) => (sec[idx] >= 0 ? sectors[sec[idx]].ceilH : 0);
  // Doom movement rule: step UP at most 24 units (drops are free) and keep 56 units of headroom
  const canStep = (a, b) => floorOf(b) - floorOf(a) <= STEP_UP && Math.min(ceilOf(a), ceilOf(b)) - Math.max(floorOf(a), floorOf(b)) >= HEADROOM;
  const passable = (idx) => open[idx] === 1 || doorAt.has(idx);

  // The grid is the whole map plus a margin; wc/wr place the global grid inside it. The outer ring is forced solid.
  const wc = -Math.floor((GRID_W - GW) / 2), wr = -Math.floor((GRID_H - GH) / 2);
  if (GRID_W < GW + 2 || GRID_H < GH + 2) throw new Error(`grid ${GRID_W}x${GRID_H} too small for map ${GW}x${GH}`);
  const sp = toG(start.x, start.y);
  const inGrid = (c, r) => c > wc && r > wr && c < wc + GRID_W - 1 && r < wr + GRID_H - 1;
  const reach = new Set();
  {
    const stack = [[sp.c, sp.r]];
    reach.add(gi(sp.c, sp.r));
    while (stack.length) {
      const [c, r] = stack.pop();
      const a = gi(c, r);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= GW || nr >= GH || !inGrid(nc, nr)) continue;
        const b = gi(nc, nr);
        if (reach.has(b) || !passable(b)) continue;
        if (!doorAt.has(a) && !doorAt.has(b) && !canStep(a, b)) continue;
        reach.add(b);
        stack.push([nc, nr]);
      }
    }
  }

  // ---- compact texture ids --------------------------------------------------------------------
  const nearestOneSidedTex = (x, y) => {
    let bd = Infinity, name = "STARTAN3", special = 0;
    for (const { a, b, l } of oneSegs) {
      const d = distToSegment(x, y, a, b);
      if (d < bd) {
        bd = d;
        const t = sidedefs[l.right].middle;
        name = t === "-" ? "STARTAN3" : t;
        special = l.special;
      }
    }
    return { name, special, dist: bd };
  };

  const cellNames = new Array(GRID_W * GRID_H).fill(null); // texture name per solid / door cell
  const kind = new Uint8Array(GRID_W * GRID_H); // 0 open, 1 solid, 2 door
  const secLocal = new Int16Array(GRID_W * GRID_H);
  for (let r = 0; r < GRID_H; r++)
    for (let c = 0; c < GRID_W; c++) {
      const g = gi(wc + c, wr + r);
      const i = r * GRID_W + c;
      if (wc + c < 0 || wr + r < 0 || wc + c >= GW || wr + r >= GH) { kind[i] = 1; cellNames[i] = "STARTAN3"; continue; }
      if (reach.has(g)) {
        secLocal[i] = sec[g];
        if (doorAt.has(g)) { kind[i] = 2; cellNames[i] = doorAt.get(g).tex + "#solo"; }
        else kind[i] = 0;
      } else {
        kind[i] = 1;
        const near = nearestOneSidedTex(cx(wc + c), cy(wr + r));
        cellNames[i] = near.name;
        if (near.special === 11 && near.dist <= CELL) { kind[i] = 3; cellNames[i] = "SW1STRTN#solo"; } // exit switch face
      }
    }

  const freq = new Map();
  cellNames.forEach((n) => n && freq.set(n, (freq.get(n) || 0) + 1));
  // step faces / ceiling drops use the sector's most common lower / upper sidedef texture
  const mostCommon = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  const lowNames = [], upNames = [];
  for (let si = 0; si < sectors.length; si++) {
    const lo = new Map(), up = new Map();
    for (const sd of sidedefs) {
      if (sd.sector !== si) continue;
      if (sd.lower !== "-") lo.set(sd.lower, (lo.get(sd.lower) || 0) + 1);
      if (sd.upper !== "-") up.set(sd.upper, (up.get(sd.upper) || 0) + 1);
    }
    lowNames.push(mostCommon(lo) || "STARTAN3");
    upNames.push(mostCommon(up) || mostCommon(lo) || "STARTAN3");
  }
  for (const n of [...lowNames, ...upNames]) if (!freq.has(n)) freq.set(n, 0);
  freq.set("SW2STRTN#solo", 0); // the switch's "pressed" face
  const ordered = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
  const textureNames = ordered.slice(0, 99);
  const idOf = new Map(textureNames.map((n, i) => [n, i + 1]));
  const map = new Array(GRID_W * GRID_H);
  for (let i = 0; i < map.length; i++) {
    if (kind[i] === 0) map[i] = secLocal[i] * 256;
    else {
      const id = idOf.get(cellNames[i]) || 1;
      map[i] = kind[i] === 2 ? secLocal[i] * 256 + 100 + id : kind[i] === 3 ? 200 + id : id;
    }
  }

  // ---- entities -------------------------------------------------------------------------------
  const lx = (x) => (x - (gx0 + wc * CELL)) / CELL;
  const ly = (y) => (gyTop - wr * CELL - y) / CELL;
  const isOpenLocal = (c, r) => c >= 0 && r >= 0 && c < GRID_W && r < GRID_H && map[r * GRID_W + c] % 256 === 0;
  const nearestOpen = (x, y, maxR = 6) => {
    const c0 = Math.floor(x), r0 = Math.floor(y);
    for (let rad = 0; rad <= maxR; rad++)
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++)
          if (Math.max(Math.abs(dr), Math.abs(dc)) === rad && isOpenLocal(c0 + dc, r0 + dr)) return { x: c0 + dc + 0.5, y: r0 + dr + 0.5 };
    return null;
  };

  const p0 = { x: lx(start.x), y: ly(start.y) };
  const spawnPos = isOpenLocal(Math.floor(p0.x), Math.floor(p0.y)) ? { x: Math.floor(p0.x) + 0.5, y: Math.floor(p0.y) + 0.5 } : nearestOpen(p0.x, p0.y);
  const player = {
    x: spawnPos.x, y: spawnPos.y, angle: (-start.angle * Math.PI) / 180,
    hp: 100, armor: 0, armorAbs: 0, ammo: 50, bullets: 50, bob: 0, hurtDir: 0, kills: 0, bonusTicks: 0, muzzleTicks: 0, weaponTicks: 0, hurtTicks: 0, moving: false,
  };

  const candidates = [];
  for (const t of enemyThings) {
    const x = lx(t.x), y = ly(t.y);
    if (x < 1 || y < 1 || x > GRID_W - 1 || y > GRID_H - 1) continue;
    // keep the exact WAD position when its cell is open; otherwise nudge to the nearest open cell centre
    const pos = isOpenLocal(Math.floor(x), Math.floor(y)) ? { x, y } : nearestOpen(x, y, 2);
    if (!pos) continue;
    if (Math.hypot(pos.x - player.x, pos.y - player.y) < 5) continue; // not on top of the player
    candidates.push({ ...pos, type: t.type, ang: (-t.angle * Math.PI) / 180 });
  }
  candidates.sort((a, b) => a.y - b.y || a.x - b.x);
  const chosen = [];
  if (candidates.length <= MAX_ENEMIES) chosen.push(...candidates);
  else for (let i = 0; i < MAX_ENEMIES; i++) chosen.push(candidates[Math.floor((i * candidates.length) / MAX_ENEMIES)]);
  const enemies = chosen.map((p, id) => ({ id, x: p.x, y: p.y, hp: ENEMY_DEFS[p.type].hp, mel: ENEMY_DEFS[p.type].mel, proj: ENEMY_DEFS[p.type].proj, sp: ENEMY_DEFS[p.type].sp, ang: p.ang, deadTicks: 0, hurtTicks: 0, attackTicks: 0, swingTicks: 0, awake: false }));

  // ---- pickups: exact WAD positions, every effect field present so the pipeline needs no per-type logic ----
  const items = [];
  for (const t of things) {
    const def = ITEM_DEFS[t.type];
    if (!def || !(t.flags & 2) || (t.flags & 0x10)) continue;
    const x = lx(t.x), y = ly(t.y);
    const pos = isOpenLocal(Math.floor(x), Math.floor(y)) ? { x, y } : nearestOpen(x, y, 2);
    if (!pos) continue;
    items.push({ id: items.length, x: pos.x, y: pos.y, taken: false, hp: 0, hpCap: 0, ar: 0, arCap: 0, arAbs: 0, am: 0, amCap: 0, bu: 0, buCap: 0, ...def });
  }

  // ---- decorations at exact WAD positions (skipped when not on an open cell) ----
  const decor = [];
  for (const t of things) {
    const def = DECOR_DEFS[t.type];
    if (!def || !(t.flags & 2) || (t.flags & 0x10)) continue;
    const x = lx(t.x), y = ly(t.y);
    if (!isOpenLocal(Math.floor(x), Math.floor(y))) continue;
    decor.push({ id: decor.length, x, y, boom: 0, ...def });
  }

  // ---- sector tables (indexed by the sector id stored in map cell bits >= 8: code = sector * 256 + tile) ----
  const palette = readPalette(wad);
  const flatColor = (name) => {
    if (name.startsWith("F_SKY")) return "#26346e";
    if (!wad.has(name)) return "#505050";
    const b = wad.lump(name);
    let r = 0, g = 0, bl = 0;
    for (let i = 0; i < b.length; i++) { const c = palette[b[i]]; r += c[0]; g += c[1]; bl += c[2]; }
    const h = (v) => Math.round(v / b.length).toString(16).padStart(2, "0");
    return "#" + h(r) + h(g) + h(bl);
  };
  const sb = wad.mapLump("E1M1", "SECTORS");
  const flatName = (i, off) => sb.toString("ascii", i * 26 + off, i * 26 + off + 8).replace(/\0.*$/s, "").toUpperCase();
  const texId = (n) => idOf.get(n) || 1;
  const skyName = (n) => n.startsWith("F_SKY");
  const flatNames = [...new Set(sectors.flatMap((_, i) => [flatName(i, 4), flatName(i, 12)]).filter((n) => !skyName(n) && wad.has(n)))].sort();
  const flatId = (n, ceiling = false) => (skyName(n) ? (ceiling ? -1 : 0) : !wad.has(n) ? 0 : flatNames.indexOf(n) + 1);
  const tables = {
    secFT: sectors.map((_, i) => flatId(flatName(i, 4))),
    secCT: sectors.map((_, i) => flatId(flatName(i, 12), true)),
    secL: sectors.map((x) => x.light),
    secS: sectors.map((x) => x.special),
    secF: sectors.map((x) => x.floorH),
    secC: sectors.map((x) => x.ceilH),
    secFC: sectors.map((_, i) => flatColor(flatName(i, 4))),
    secCC: sectors.map((_, i) => flatColor(flatName(i, 12))),
    secLow: lowNames.map(texId),
    secUp: upNames.map(texId),
  };
  player.z = tables.secF[Math.floor(map[Math.floor(player.y) * GRID_W + Math.floor(player.x)] / 256)];

  // bounding box of a group of cells: x0/y0 = first column/row, nx/ny = size in cells (textures are laid out from x0/y0)
  const span = (cells) => {
    const cs = cells.map((k) => k % GRID_W), rs = cells.map((k) => Math.floor(k / GRID_W));
    return { x0: Math.min(...cs), y0: Math.min(...rs), nx: Math.max(...cs) - Math.min(...cs) + 1, ny: Math.max(...rs) - Math.min(...rs) + 1 };
  };

  // ---- doors: each connected slab of door cells is one door that rises as a unit ----
  const doors = [];
  const doorSeen = new Set();
  for (let i = 0; i < map.length; i++) {
    if (map[i] % 256 < 100 || map[i] % 256 >= 200 || doorSeen.has(i)) continue;
    const cells = [], stack = [i];
    doorSeen.add(i);
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      const kc = k % GRID_W, kr = Math.floor(k / GRID_W);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const c = kc + dc, r = kr + dr, j = r * GRID_W + c;
          if (c < 0 || r < 0 || c >= GRID_W || r >= GRID_H || doorSeen.has(j) || map[j] % 256 !== map[i] % 256) continue;
          doorSeen.add(j);
          stack.push(j);
        }
    }
    const sector = Math.floor(map[i] / 256);
    doors.push({ id: doors.length, cells: cells.sort((a, b) => a - b), ...span(cells), open: 0, dir: 0, h: Math.max(24, tables.secC[sector] - tables.secF[sector]), v: 0 });
    doors[doors.length - 1].v = Math.max(DOOR_SPEED, Math.ceil(doors[doors.length - 1].h / 30)); // every door takes about a second
  }

  // ---- switches: the exit switch face (tile 200+id) is one group; pressing it ends the level ----
  const switches = [];
  const swSeen = new Set();
  for (let i = 0; i < map.length; i++) {
    if (map[i] % 256 <= 200 || swSeen.has(i)) continue;
    const cells = [], stack = [i];
    swSeen.add(i);
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const c = (k % GRID_W) + dc, r = Math.floor(k / GRID_W) + dr, j = r * GRID_W + c;
          if (c < 0 || r < 0 || c >= GRID_W || r >= GRID_H || swSeen.has(j) || map[j] % 256 <= 200) continue;
          swSeen.add(j);
          stack.push(j);
        }
    }
    switches.push({ id: switches.length, cells: cells.sort((a, b) => a - b), ...span(cells), on: false, tex: idOf.get("SW1STRTN#solo"), texOn: idOf.get("SW2STRTN#solo"), exit: true });
  }

  const openCount = map.reduce((n, v) => n + (v % 256 === 0 ? 1 : 0), 0);
  return {
    map, player, enemies, items, decor, doors, switches, textureNames, tables, flatNames,
    window: { col: wc, row: wr, originX: gx0 + wc * CELL, originY: gyTop - wr * CELL },
    stats: { openCount, doors: map.filter((v) => v % 256 >= 100 && v % 256 < 200).length, switches: switches.length },
  };
}
