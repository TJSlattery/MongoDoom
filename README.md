# MongoDoom

Doom's E1M1, where **the game engine is a MongoDB aggregation pipeline**.

Every 33 ms the server sends one update to MongoDB. The database moves the player, runs the monsters, casts the rays,
works out which sprites are visible, and builds the status bar. The browser receives the finished frame and paints it.
It does no game math at all.

It uses the real `DOOM1.WAD` data: the whole level layout, wall and floor textures, sky, sprites and sector heights.

## Who does what

| MongoDB (the engine) | Node server (a relay) | Browser (a monitor) |
| --- | --- | --- |
| Player movement, collision, stairs and doors | Serves the page and the art | Draws wall strips, floors, sprites and HUD |
| Raycasting: which wall, floor or sky is in each of 160 screen columns | Turns key presses into a small input object | Sends key presses |
| Monsters: waking, chasing, attacking, fireballs, death | Calls the pipeline once per tick | Shows the latency and FPS counters |
| Shotgun hits, barrels, pickups, armor, nukage | Times the call and forwards the result | |
| Sprite projection and hiding sprites behind walls | | |
| Lighting, status bar layout, the face | | |

Three rules keep it honest, and the tests enforce them:

1. **The browser does no game math.** Files in `public/` may not use `Math`, trigonometry, `*` or `/`. Every screen
   position (`dx`, `dy`, `dh`, texture offsets) arrives precomputed from MongoDB. The FPS counter even avoids division.
2. **The server has no game logic.** It only decodes key bits, times the database call and relays the result.
3. **All game logic is plain MongoDB aggregation operators.** No `$function`, no server-side JavaScript.

## How a frame works

```
 keys ──websocket──▶ server.js ──one update──▶ MongoDB  games/{_id:"doom"}
                                                  │  the pipeline rewrites the game state
 canvas ◀──websocket── { frame, mongodMs } ◀──────┘  and stores the finished frame in it
```

The whole game lives in **one document**: the map, the player, the monsters, items and the latest rendered `frame`.
Each tick is a single `findOneAndUpdate` with an *aggregation pipeline* as the update. The stages run in order:

| # | Stage (`src/mql/`) | What it does |
| - | --- | --- |
| 1 | `stageInputMove` | Applies input: turning, walking with wall sliding and Doom's step-height rule, doors rising, eye height, sector light flicker |
| 2 | `stageRaycast` | Casts 160 rays through the grid. Each ray records floor, ceiling, sky and wall strips, including stair risers |
| 3 | `stagePickups` | Collects health, armor, ammo |
| 4 | `stageProjectiles` | Moves imp fireballs and explodes them |
| 5 | `stageCombatAI` | Shotgun hit detection, monster wake/chase/attack, nukage damage |
| 6 | `stageBarrels` | Barrel explosions and chain reactions |
| 7 | `stageSprites` | Projects every monster, item, decoration and fireball to the screen, picks the right sprite rotation, and hides parts behind walls |
| 8 | `stageHudFrame` | Weapon animation, status bar draw list, writes `frame`, cleans up temporary fields |

The browser gets back a `frame`: per screen column, a list of wall strips and floor/ceiling spans, then sprite strips,
then a list of `{ image, x, y }` status bar pieces. Painting that needs only loops and `drawImage`.

Because the game state is just a document, you can change it while the game runs. Try the snippets under
"Poke the live game" on the page, or `db.viewport_ascii.findOne()` in `mongosh`: a read-only **view** that renders the
current frame as 32 lines of text.

### Where to look in the code

**Where the pipeline is sent to MongoDB** (`src/server.js`, inside the tick loop):

```js
const doc = await games.findOneAndUpdate(
  { _id: "doom" },                      // the one game document
  buildTickPipeline(input.take()),      // the aggregation pipeline, used as the update
  TICK_OPTIONS                          // return only the new `frame`
);
```

This is the only database call per tick. `buildTickPipeline` (`src/mql/pipeline.js`) assembles the stages from
`src/mql/stage*.js` into a plain JSON array. The server never looks inside it.

**Where the browser paints** (`public/client.js`): the websocket handler `ws.onmessage` receives
`{ frame, mongodMs }` and calls `render(frame)`. That function, between the `// BEGIN RENDER` and `// END RENDER`
markers, is the only place that draws. It loops over `frame.columns`, `frame.sprites` and
`frame.hud.draw` and calls `drawImage` and `fillRect` with numbers it was given. The zero-math test checks that
region.

## Run it

You need **Node 20.19+** and a **running MongoDB 6.0+** on `127.0.0.1:27017` (developed and tested on 9.0.8).
If you don't have MongoDB, `mongod --dbpath ./data` or `docker run -p 27017:27017 mongo` both work.

```sh
git clone <this repo> && cd MongoDoom
npm install
npm start        # then open http://localhost:3000
```

The first `npm start` downloads the shareware `DOOM1.WAD` (about 4 MB), converts the level and writes it to MongoDB.
This takes a few seconds and only happens once. Other commands:

```sh
npm run seed     # rebuild the database from the WAD (do this after changing the level data)
npm test         # all test suites
node --test tests/pipeline.test.js   # one suite
```

Defaults: database `mongodb://127.0.0.1:27017/mongodoom` (override with `MONGODB_URI`), port 3000 (`PORT=0` picks a
free one). `assets/DOOM1.WAD` (the shareware WAD) is downloaded automatically if missing (or run `npm run fetch-wad`); if you are
offline, place the file there yourself. The pipeline and end-to-end tests need `mongod`, use their own databases
(`mongodoom_test`, `mongodoom_e2e`) and never touch the game data. The full suite takes about a minute.

If you see `Could not connect to MongoDB`, `mongod` is not running or `MONGODB_URI` is wrong.

Controls: `W`/`S` move, `A`/`D` strafe, `←`/`→` turn, `Space` or click to shoot, `E` open doors and press the exit switch, `R` reset.

## Code map

```
scripts/seed.js        reads the WAD, builds the level, writes everything to MongoDB
src/wad/               WAD parsing: lumps, textures, sprites, and the E1M1 level rasterizer
src/mql/               the game: one file per pipeline stage, expr.js (JS helpers that build the
                       pipeline JSON), constants.js (grid size, speeds, screen geometry)
src/server.js          HTTP + websocket + the 30 Hz tick loop
src/db.js              connection and reset helpers
public/                the browser client (index.html, client.js)
tests/                 wad, pipeline, zero-math lint, and end-to-end tests
assets/                DOOM1.WAD and the original design plan
```

**How the level is built.** `e1m1Rasterizer.js` turns the WAD's level into a 148×96 grid, 32 Doom units per cell. A
cell is open or solid depending on whether its centre is inside the level. Each cell also stores its sector, so floor
and ceiling heights, flats and light come from small per-sector tables in the game document. A flood fill from the
player start removes unreachable cells.

**How the pipeline is written.** The stages are built in JavaScript with small helpers (`add`, `cond`, `mapArr`, ...)
that emit plain aggregation JSON, so the pipeline you see in MongoDB is ordinary `$set` stages.

## Output resolution

The game draws to a **320 x 200** canvas, the same resolution as the original Doom. The top **320 x 168** is the 3D
view and the bottom 32 rows are the status bar. The browser stretches the canvas to 640 x 480 with
`image-rendering: pixelated`, so pixels stay sharp and chunky.

Why these numbers:

- **It matches vanilla Doom.** Doom's art was made for 320 x 200 (the status bar is exactly 32 rows, sprites and
  weapons have fixed pixel offsets). Using the same size means the WAD's images can be drawn without resampling.
- **It is shown at 4:3.** Doom's 320 x 200 pixels were meant to be displayed slightly tall, so the screen came out
  4:3. Stretching to 640 x 480 reproduces that, and `WALL_PX` in `src/mql/constants.js` includes the 1.2 pixel aspect
  so walls and sprites are not squashed.
- **160 rays, not 320.** The raycast is the most expensive part of the tick, and its cost grows with the number of
  columns. Each ray covers a 2-pixel-wide column, which halves that cost. The tick is about 20 ms against a 33 ms
  budget, so doubling the columns would not fit. The width of each column is why walls look slightly blocky
  horizontally.
- **Floors and ceilings are full vertical resolution.** Each pixel row gets its own texel (`FLAT_RH = 1`). Setting it
  to 2 saves about 2 ms per tick at the cost of chunkier floors.
- **Frame size matters too.** Every frame travels from MongoDB through the server to the browser as JSON, typically
  15-110 KB. Higher resolution means more strips and more data per frame.

To change it you would edit `COLS`, `VIEW_H` and the canvas size together, and re-check tick latency.

## Current limits

- Only the shotgun works. Bullets, clips and the other weapons are not implemented.
- The exit switch works and shows a level-finished screen, but there is no next level. There are no keys. Doors rise
  over about a second and stay open.
- Medium-skill monsters only: Imps and Zombiemen. Shotgun Guys have sprites but are not placed.
- Monsters walk straight at you with no pathfinding. There is no sound.
- Floors and ceilings are textured per pixel row but use per-sector lighting rather than Doom's per-pixel distance
  shading. Stairs are sampled at cell resolution.

## Credits and legal

This is an unofficial fan project. It is not affiliated with or endorsed by id Software or Bethesda. DOOM is a
trademark of its owners. The game data comes from id Software's freely distributable **shareware** `DOOM1.WAD`, which
is downloaded on demand and is not included in this repository. The code here reads the WAD but does not modify it.

---

# Technical details

## What comes out of the WAD

A WAD file is a directory of named binary blobs called *lumps*. `npm run seed` reads `assets/DOOM1.WAD` with
`src/wad/` and turns the lumps it needs into MongoDB documents. Nothing is read from the WAD at play time.

| WAD lump | What it holds | What we do with it | Code |
| --- | --- | --- | --- |
| `PLAYPAL` | The 256-colour palette | Every image in the WAD stores palette indices, so this converts them to RGB | `pictureDecoder.js` |
| Sprites, HUD patches (`TROO*`, `STBAR`...) | Pictures in Doom's "column post" format: vertical runs of pixels with gaps | Decoded to RGBA and saved as PNG data URLs. Monsters get all 8 rotations (Doom stores 5 and mirrors the rest, so we bake the mirrors). Each sprite is placed on a fixed canvas with its feet on the bottom edge | `pictureDecoder.js`, `spriteBuilder.js` |
| `PNAMES`, `TEXTURE1` | Wall textures, assembled from overlapping patches | Patches are composited, then resized to 64x128 (covering 128 world units) | `textureBuilder.js` |
| Flats (`FLOOR4_8`...) | Raw 64x64 floor and ceiling tiles | Saved as images; sector tables store which flat each sector uses. The sky is `SKY1` | `spriteBuilder.js`, `textureBuilder.js` |
| `VERTEXES`, `LINEDEFS`, `SIDEDEFS` | The level's wall segments and the textures on each side | Decide which grid cells are solid, which wall texture a face uses, and where doors are | `e1m1Rasterizer.js` |
| `SECTORS` | Rooms: floor height, ceiling height, flats, light level, special type | Become the `secF`, `secC`, `secFT`, `secL`, `secS`... tables in the game document (stairs, sky, flicker, nukage) | `e1m1Rasterizer.js` |
| `NODES`, `SEGS`, `SSECTORS` | Doom's BSP tree | Walked to find which sector a point is in | `wadReader.js` |
| `THINGS` | Placed objects: player start, monsters, items, decorations | Become the `player`, `enemies`, `items` and `decor` arrays. Only things flagged for Medium skill are kept | `e1m1Rasterizer.js` |

**Turning a level into a grid.** Doom levels are arbitrary polygons, but the raycaster walks a regular grid, so
`e1m1Rasterizer.js` converts one into the other (148 x 96 cells, 32 Doom units each):

1. A cell is *open* if its centre is inside the level. This is an even-odd test: shoot a line out to the right and count
   how many one-sided wall segments it crosses. We do this rather than drawing the walls onto the grid, because walls
   on both sides of a narrow corridor would fill every cell and close it.
2. Each open cell asks the BSP tree which sector it is in. Its map value is `sector * 256 + tile`, so one number holds
   both the room (for heights and flats) and what is in the cell (open, wall texture id, or door).
3. Zero-height sectors with a door special become door cells.
4. A flood fill from the player start, using Doom's movement rule (steps up to 32 units, 56 units of headroom), turns
   everything unreachable into solid, so there are no sealed pockets.
5. Texture names are renumbered to small compact ids so a cell fits in one number and only the textures that are used
   get stored.

## How the raycast works, and why it is needed

**Why.** The browser may not do any game math, so it cannot work out what is in front of the player. MongoDB has to
produce, for every screen column, exactly which strips of which images to draw and where. The raycaster is how it
finds that out. It is also the most expensive stage (most of the ~20 ms tick), so it shapes much of the design.

**The idea.** The screen is 160 columns, each 2 pixels wide. For each column the pipeline fires a ray from the player
into the map. The rays are spread across a "camera plane" in front of the player: ray direction =
`facing + plane * (column offset from the centre)`. Sine and cosine are computed once per tick, not per column.

**Walking the grid (DDA).** A ray moves from one grid cell border to the next, always crossing whichever border (vertical
or horizontal) is nearer. At each new cell it looks at the map value. Doing this in a `$reduce` over a fixed
`range(0, MAX_STEPS)` is how a loop is written in an aggregation pipeline. It cannot stop early, so once a column is
`done` the remaining iterations just return the value unchanged. `MAX_STEPS` is 256 because a ray crossing the whole
148 x 96 grid can take about 244 steps.

**Distance without fisheye.** The distance used for scaling is the *perpendicular* distance to the wall, not the straight
line, so straight walls look straight. A wall `d` cells away is drawn `WALL_PX / d` pixels tall, so near walls fill the
screen and far ones shrink. Heights work the same way: any height `h` appears at screen row
`84 - (h - eyeHeight) * scale / d`.

**1. Walking one ray across the grid** (top-down; each `.` is an open cell, the ray always steps to the nearest border):

```
        col 0   col 1   col 2   col 3   col 4   col 5
       ┌───────┬───────┬───────┬───────┬───────┬───────┐
 row 0 │       │       │       │   #   │   #   │   #   │   ●  player
       ├───────┼───────┼───────┼───────┼───────┼───────┤   ·  the ray's path
 row 1 │   ●   │   ·   │   ·   ║   ·   │   #   │   #   │   #  solid cell: the ray ends here
       │       ╲       ╲       ║       ╲       │       │   ║  sector boundary (floor or
       ├───────┼───────┼───────╫───────┼───────┼───────┤      ceiling height changes)
 row 2 │       │   ·   │   ·   ║   ·   │   ·   │   #   │
       └───────┴───────┴───────╨───────┴───────┴───────┘
          sector A (floor 0)     sector B (floor +24)

 The ray moves to whichever cell border is nearer. Crossing ║ adds a riser; hitting # ends the ray.
 Each move is one iteration of the $reduce (at most MAX_STEPS = 256).
```

**2. What that ray records for its screen column** (top of the screen is row 0, the viewport is 168 rows tall):

```
   row 0   ┌──────────────┐
           │ ceiling      │  ceiling span of the sector the ray started in
           ├──────────────┤
           │ ceiling drop │  upper texture, if the next sector's ceiling is lower
           ├──────────────┤
           │              │
           │ wall         │  the solid cell the ray finally hit, cut into 128-unit
           │              │  pieces so the texture tiles
           ├──────────────┤
           │ step riser   │  lower texture, if the next sector's floor is higher
           ├──────────────┤
           │ floor        │  floor span: one flat texel per pixel row
  row 168  └──────────────┘
```

Each strip becomes an entry in the column: `w` holds the wall, riser and drop strips (`tex`, `sx`, `sy`, `sh`, `dy`,
`dh`, `shade`), and `f` holds the floor, ceiling and sky spans (`dy`, `dh`, `c`, `fl`, `t`, `ld`).

**Why it is more than a wall finder.** Original Doom handled stairs and ceilings with a different system. Here one
ray does everything, as a "portal walker":

- Each time the ray enters a cell in a **different sector**, it has crossed a boundary. It records the floor and ceiling
  spans of the sector it just left, then checks the next sector's heights. If the floor is higher it adds a **step
  riser** (using that sector's lower texture). If the ceiling is lower it adds a **ceiling drop** (upper texture).
- A running window `[top, bot]` tracks which rows of the column are still visible. Each riser or drop shrinks it,
  so nothing behind a closer ledge is drawn. The ray ends when it hits a solid cell or the window closes.
- Every wall face is cut into 128-unit pieces so tall walls tile the texture, and each piece records which texture
  column (`sx`) and which slice of the texture (`sy`, `sh`) to use.
- **Floors and ceilings** are textured by working backwards: for each pixel row of a span, the pipeline computes the
  distance to the point of floor seen on that row, finds its world position along the ray, and stores which flat texel
  it lands on (`v*64 + u`). The client looks that up. Sky spans store a sky column from the ray's angle instead.
- **Light** from the sector's light level, plus distance, becomes a `shade` value per wall piece and `ld` per span.

**What the sprites need from it.** Each column also keeps its wall distance (`perpDist`) and the window at every portal
crossing (`wins`). `stageSprites` projects a monster to the screen and, per column, keeps its strip only if it is
nearer than the wall and sits inside the window at its depth. That is how a monster is hidden by a pillar, or loses
its feet behind a stair. The shotgun uses the centre column's distance to check the wall is not in the way.

**Output.** After the sprite and HUD stages, each column is `{ dx, w: [...wall strips], f: [...floor/ceiling spans] }`.
The client loops over them and calls `drawImage`; it never decides anything.

**Cost.** Floor and ceiling texel rows are the biggest part. `FLAT_RH` in `src/mql/constants.js` sets how many pixels
tall each texel row is. At 1 the median tick is ~21 ms and open halls ~27 ms, against a 33 ms budget. At 2 it saves
about 2 ms.

