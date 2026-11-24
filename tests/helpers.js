import { connect } from "../src/db.js";
import { GRID_W, GRID_H } from "../src/mql/constants.js";
import { buildTickPipeline, TICK_OPTIONS } from "../src/mql/pipeline.js";

export const TEST_URI = process.env.MONGODB_URI_TEST || "mongodb://127.0.0.1:27017/mongodoom_test";

export async function openTestDb() {
  const { client, db } = await connect(TEST_URI);
  return { client, db, games: db.collection("games") };
}

/** GRID_W x GRID_H map: solid border, empty interior; `cells` = [[col,row,tile], ...] overrides. */
export function roomMap(cells = []) {
  const map = new Array(GRID_W * GRID_H).fill(0);
  for (let c = 0; c < GRID_W; c++) { map[c] = 1; map[(GRID_H - 1) * GRID_W + c] = 1; }
  for (let r = 0; r < GRID_H; r++) { map[r * GRID_W] = 1; map[r * GRID_W + GRID_W - 1] = 1; }
  for (const [c, r, t] of cells) map[r * GRID_W + c] = t;
  return map;
}
export const wallRect = (c0, c1, r0, r1, tile = 2) => {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c, r, tile]);
  return out;
};

export const enemy = (id, x, y, extra = {}) => ({ id, x, y, hp: 60, hurtTicks: 0, attackTicks: 0, awake: false, ...extra });

export const FLAT_TABLES = { secF: [0], secC: [128], secFC: ["#4c4c4c"], secFT: [0], secCT: [0], secCC: ["#343434"], secLow: [1], secUp: [1], secL: [255], secS: [0] };

export async function setState(games, { map = roomMap(), player = {}, enemies = [], tick = 0, tables = FLAT_TABLES, items = [], decor = [], projectiles = [], doors = [], switches = [], level = { done: false, at: 0 } } = {}) {
  const p = { x: 32.5, y: 32.5, angle: 0, hp: 100, ammo: 50, kills: 0, muzzleTicks: 0, weaponTicks: 0, hurtTicks: 0, moving: false, ...player };
  await games.replaceOne({ _id: "doom" }, { _id: "doom", tick, map, player: p, enemies, items, decor, projectiles, doors, switches, level, ...tables }, { upsert: true });
}

/** Run one tick and return the FULL document (partial pipelines leave transient fields in place). */
export async function step(games, input = {}, opts = {}) {
  return games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline(input, opts), { returnDocument: "after" });
}

export async function stepFrame(games, input = {}) {
  return (await games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline(input), TICK_OPTIONS)).frame;
}

export const item = (id, x, y, fx = {}) => ({ id, x, y, taken: false, sprite: "BON2A0", hp: 0, hpCap: 0, ar: 0, arCap: 0, arAbs: 0, am: 0, amCap: 0, ...fx });
export const ITEMS = {
  helmet: { sprite: "BON2A0", ar: 1, arCap: 200, arAbs: 0.33 },
  green: { sprite: "ARM1A0", ar: 100, arCap: 100, arAbs: 0.33 },
  blue: { sprite: "ARM2A0", ar: 200, arCap: 200, arAbs: 0.5 },
  medikit: { sprite: "MEDIA0", hp: 25, hpCap: 100 },
  shells: { sprite: "SHELA0", am: 4, amCap: 100 },
};

export const decorItem = (id, x, y, fx = {}) => ({
  id, x, y, sprite: "COLUA0", anim: ["COLUA0"], animTicks: 1, solid: true, r: 0.5, hu: 64, barrel: false, hp: 0, boom: 0, ...fx,
});
export const barrel = (id, x, y, fx = {}) => decorItem(id, x, y, { sprite: "BAR1A0", anim: ["BAR1A0", "BAR1B0"], animTicks: 6, r: 0.4, barrel: true, hp: 20, ...fx });
export const proj = (id, x, y, vx, vy, fx = {}) => ({ id, x, y, vx, vy, z: 32, age: 0, hit: 0, ...fx });
export const tablesWith = (extra = {}) => ({ ...FLAT_TABLES, ...extra });

/** A door made of the given [col,row] cells (their map tiles must be 100+id). */
export const doorOf = (id, cells, h = 72, fx = {}) => ({ id, cells: cells.map(([c, r]) => r * GRID_W + c).sort((a, b) => a - b), open: 0, dir: 0, h, v: 6, ...fx });

/** A switch made of the given [col,row] cells (their map tiles must be 200+id). */
export const switchOf = (id, cells, fx = {}) => {
  const cs = cells.map(([c]) => c), rs = cells.map(([, r]) => r);
  return { id, cells: cells.map(([c, r]) => r * GRID_W + c).sort((a, b) => a - b), x0: Math.min(...cs), y0: Math.min(...rs),
    nx: Math.max(...cs) - Math.min(...cs) + 1, ny: Math.max(...rs) - Math.min(...rs) + 1, on: false, tex: 3, texOn: 4, exit: true, ...fx };
};
