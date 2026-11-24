// Parses the WAD, rasterizes the E1M1 window, seeds assets/games/templates and creates db.viewport_ascii.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateObjectSize } from "bson";
import { Wad } from "../src/wad/wadReader.js";
import { readPalette, toDataUrl } from "../src/wad/pictureDecoder.js";
import { readTextureDefs, buildWallTexture, buildSky } from "../src/wad/textureBuilder.js";
import { buildSpritePack, buildFlat } from "../src/wad/spriteBuilder.js";
import { rasterizeE1M1 } from "../src/wad/e1m1Rasterizer.js";
import { buildTickPipeline, TICK_OPTIONS } from "../src/mql/pipeline.js";
import { asciiPipeline } from "../src/mql/asciiView.js";
import { connect, resetGame } from "../src/db.js";
import { fetchWad } from "./fetch-wad.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function seed({ uri, log = console.log } = {}) {
  const wadPath = await fetchWad();
  const wad = Wad.load(wadPath);
  const palette = readPalette(wad);
  const defs = readTextureDefs(wad);
  const raster = rasterizeE1M1(wad);

  const wallTextures = {};
  raster.textureNames.forEach((name, i) => {
    const img = buildWallTexture(wad, defs, name, palette);
    if (!img) throw new Error(`Missing texture ${name}`);
    wallTextures[String(i + 1)] = toDataUrl(img);
  });
  const { sprites, hud } = buildSpritePack(wad, palette, [...new Set(raster.enemies.map((e) => e.sp.k))]);
  const flats = {};
  raster.flatNames.forEach((name, i) => { flats[String(i + 1)] = toDataUrl(buildFlat(wad, name, palette)); });
  const assets = { _id: "doom1_e1m1_pack", wallTextures, flats, sky: toDataUrl(buildSky(wad, defs, palette)), sprites, hud };

  const state = { tick: 0, map: raster.map, player: raster.player, enemies: raster.enemies, items: raster.items, decor: raster.decor, doors: raster.doors, switches: raster.switches, level: { done: false, at: 0 }, projectiles: [], ...raster.tables };
  const { client, db } = await connect(uri);
  try {
    await db.collection("assets").replaceOne({ _id: assets._id }, assets, { upsert: true });
    await db.collection("templates").replaceOne({ _id: "doom_initial" }, { _id: "doom_initial", state }, { upsert: true });
    await resetGame(db);
    // one tick so games.frame exists before the view is created
    await db.collection("games").findOneAndUpdate({ _id: "doom" }, buildTickPipeline({}), TICK_OPTIONS);
    await db.dropCollection("viewport_ascii").catch(() => {});
    await db.createCollection("viewport_ascii", { viewOn: "games", pipeline: asciiPipeline });

    const sizes = {
      assets: calculateObjectSize(assets),
      games: calculateObjectSize(await db.collection("games").findOne({ _id: "doom" })),
    };
    log(`seeded ${db.databaseName}: assets ${(sizes.assets / 1024).toFixed(0)} KB, games ${(sizes.games / 1024).toFixed(0)} KB, ` +
      `${raster.stats.openCount} open cells, ${raster.enemies.length} enemies, ${raster.items.length} items, ${raster.textureNames.length} textures`);
    return { sizes, raster };
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().catch((e) => { console.error(e); process.exit(1); });
}
