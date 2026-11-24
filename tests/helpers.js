import { connect } from "../src/db.js";
import { buildTickPipeline, TICK_OPTIONS } from "../src/mql/pipeline.js";

export const TEST_URI = process.env.MONGODB_URI_TEST || "mongodb://127.0.0.1:27017/mongodoom_test";

export async function openTestDb() {
  const { client, db } = await connect(TEST_URI);
  return { client, db, games: db.collection("games") };
}

/** 64x64 map: solid border, empty interior; `cells` = [[col,row,tile], ...] overrides. */
export function roomMap(cells = []) {
  const map = new Array(4096).fill(0);
  for (let i = 0; i < 64; i++) { map[i] = 1; map[63 * 64 + i] = 1; map[i * 64] = 1; map[i * 64 + 63] = 1; }
  for (const [c, r, t] of cells) map[r * 64 + c] = t;
  return map;
}
export const wallRect = (c0, c1, r0, r1, tile = 2) => {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c, r, tile]);
  return out;
};

export const enemy = (id, x, y, extra = {}) => ({ id, x, y, hp: 60, hurtTicks: 0, attackTicks: 0, awake: false, ...extra });

export async function setState(games, { map = roomMap(), player = {}, enemies = [], tick = 0 } = {}) {
  const p = { x: 32.5, y: 32.5, angle: 0, hp: 100, ammo: 50, kills: 0, muzzleTicks: 0, weaponTicks: 0, hurtTicks: 0, moving: false, ...player };
  await games.replaceOne({ _id: "doom" }, { _id: "doom", tick, map, player: p, enemies }, { upsert: true });
}

/** Run one tick and return the FULL document (partial pipelines leave transient fields in place). */
export async function step(games, input = {}, opts = {}) {
  return games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline(input, opts), { returnDocument: "after" });
}

export async function stepFrame(games, input = {}) {
  return (await games.findOneAndUpdate({ _id: "doom" }, buildTickPipeline(input), TICK_OPTIONS)).frame;
}
