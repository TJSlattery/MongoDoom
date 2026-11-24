// Rasterizes a window of the real E1M1 geometry into a 64x64 grid (32 Doom units per cell).
//  - open/solid via even-odd point-in-level sampling on one-sided linedefs (keeps 64-unit corridors open)
//  - sectors via BSP descent; doors from zero-height sectors; reachability flood fill from the spawn
import { sectorAt } from "./wadReader.js";

export const GRID = 64;
export const CELL = 32;
const WIN = GRID * CELL;
const DOOR_SPECIALS = new Set([1, 26, 27, 28, 31, 32, 33, 34]);
const ENEMY_TYPES = new Set([3001, 3004, 9]);
export const MAX_ENEMIES = 12;
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

  // ---- spawn & enemy things -------------------------------------------------------------------
  const start = things.find((t) => t.type === 1);
  const enemyThings = things.filter((t) => ENEMY_TYPES.has(t.type) && (t.flags & 4) !== 0 && (t.flags & 0x10) === 0);
  const toG = (x, y) => ({ c: Math.floor((x - gx0) / CELL), r: Math.floor((gyTop - y) / CELL) });

  const floorOf = (idx) => (sec[idx] >= 0 ? sectors[sec[idx]].floorH : 0);
  const passable = (idx) => open[idx] === 1 || doorAt.has(idx);

  /** Flood fill inside window (wc, wr = top-left global cell). Returns Set of global indices. */
  function flood(wc, wr, sc, sr) {
    const inWin = (c, r) => c > wc && r > wr && c < wc + GRID - 1 && r < wr + GRID - 1; // ring forced solid
    const seen = new Set();
    if (!inWin(sc, sr) || !passable(gi(sc, sr))) return seen;
    const stack = [[sc, sr]];
    seen.add(gi(sc, sr));
    while (stack.length) {
      const [c, r] = stack.pop();
      const a = gi(c, r);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (!inWin(nc, nr)) continue;
        const b = gi(nc, nr);
        if (seen.has(b) || !passable(b)) continue;
        if (!doorAt.has(a) && !doorAt.has(b) && Math.abs(floorOf(a) - floorOf(b)) > 24) continue;
        seen.add(b);
        stack.push([nc, nr]);
      }
    }
    return seen;
  }

  // ---- window search --------------------------------------------------------------------------
  const sp = toG(start.x, start.y);
  const enemyCells = enemyThings.map((t) => toG(t.x, t.y));
  let best = null;
  // The spawn must sit at least 12 cells from every window edge so the player starts with room on every side.
  const MARGIN = 12;
  for (let wr = sp.r - (GRID - MARGIN); wr <= sp.r - MARGIN; wr += 2)
    for (let wc = sp.c - (GRID - MARGIN); wc <= sp.c - MARGIN; wc += 2) {
      if (wc < -8 || wr < -8 || wc + GRID > GW + 8 || wr + GRID > GH + 8) continue;
      const reach = flood(wc, wr, sp.c, sp.r);
      if (!reach.size) continue;
      let eCount = 0;
      for (const e of enemyCells) if (reach.has(gi(e.c, e.r))) eCount++;
      const score = reach.size + 80 * Math.min(eCount, MAX_ENEMIES);
      if (!best || score > best.score) best = { score, wc, wr, reach };
    }
  if (!best) throw new Error("No viable E1M1 window found");
  const { wc, wr, reach } = best;

  // ---- compact texture ids --------------------------------------------------------------------
  const nearestOneSidedTex = (x, y) => {
    let bd = Infinity, name = "STARTAN3";
    for (const { a, b, l } of oneSegs) {
      const d = distToSegment(x, y, a, b);
      if (d < bd) {
        bd = d;
        const t = sidedefs[l.right].middle;
        name = t === "-" ? "STARTAN3" : t;
      }
    }
    return name;
  };

  const cellNames = new Array(GRID * GRID).fill(null); // texture name per solid / door cell
  const kind = new Uint8Array(GRID * GRID); // 0 open, 1 solid, 2 door
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      const g = gi(wc + c, wr + r);
      const i = r * GRID + c;
      if (wc + c < 0 || wr + r < 0 || wc + c >= GW || wr + r >= GH) { kind[i] = 1; cellNames[i] = "STARTAN3"; continue; }
      if (reach.has(g)) {
        if (doorAt.has(g)) { kind[i] = 2; cellNames[i] = doorAt.get(g).tex; }
        else kind[i] = 0;
      } else {
        kind[i] = 1;
        cellNames[i] = nearestOneSidedTex(cx(wc + c), cy(wr + r));
      }
    }

  const freq = new Map();
  cellNames.forEach((n) => n && freq.set(n, (freq.get(n) || 0) + 1));
  const ordered = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
  const textureNames = ordered.slice(0, 63);
  const idOf = new Map(textureNames.map((n, i) => [n, i + 1]));
  const map = new Array(GRID * GRID);
  for (let i = 0; i < map.length; i++) {
    if (kind[i] === 0) map[i] = 0;
    else {
      const id = idOf.get(cellNames[i]) || 1;
      map[i] = kind[i] === 2 ? 100 + id : id;
    }
  }

  // ---- entities -------------------------------------------------------------------------------
  const lx = (x) => (x - (gx0 + wc * CELL)) / CELL;
  const ly = (y) => (gyTop - wr * CELL - y) / CELL;
  const isOpenLocal = (c, r) => c >= 0 && r >= 0 && c < GRID && r < GRID && map[r * GRID + c] === 0;
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
    hp: 100, ammo: 50, kills: 0, muzzleTicks: 0, weaponTicks: 0, hurtTicks: 0, moving: false,
  };

  const candidates = [];
  for (const t of enemyThings) {
    const x = lx(t.x), y = ly(t.y);
    const pos = isOpenLocal(Math.floor(x), Math.floor(y)) ? { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 } : nearestOpen(x, y, 2);
    if (!pos) continue;
    if (x < 1 || y < 1 || x > GRID - 1 || y > GRID - 1) continue;
    if (Math.hypot(pos.x - player.x, pos.y - player.y) < 5) continue; // not on top of the player
    if (candidates.some((c) => c.x === pos.x && c.y === pos.y)) continue;
    candidates.push(pos);
  }
  candidates.sort((a, b) => a.y - b.y || a.x - b.x);
  const chosen = [];
  if (candidates.length <= MAX_ENEMIES) chosen.push(...candidates);
  else for (let i = 0; i < MAX_ENEMIES; i++) chosen.push(candidates[Math.floor((i * candidates.length) / MAX_ENEMIES)]);
  const enemies = chosen.map((p, id) => ({ id, x: p.x, y: p.y, hp: ENEMY_HP, hurtTicks: 0, attackTicks: 0, swingTicks: 0, awake: false }));

  const openCount = map.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
  return {
    map, player, enemies, textureNames,
    window: { col: wc, row: wr, originX: gx0 + wc * CELL, originY: gyTop - wr * CELL },
    stats: { openCount, doors: map.filter((v) => v >= 100).length },
  };
}
