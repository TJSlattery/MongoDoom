# MongoDoom

A playable 30 Hz 2.5D Doom engine where **the game engine is a MongoDB aggregation pipeline**. Physics, collision,
doors, hitscan, enemy AI, raycasting and sprite occlusion all run inside one `findOneAndUpdate` per tick; the browser
only paints precomputed texture strips from real `DOOM1.WAD` data (a cropped window of E1M1).

```
 keyboard ──ws──▶ server.js ──[5-stage update pipeline]──▶ mongod  (games/_id:"doom")
                     ▲                                        │
 canvas strips ◀─ws──┴──── { frame, mongodMs } ◀──────────────┘
```

Architecture laws (enforced by `tests/`): `public/` has no `Math`/trig/world state/`*`/`/`; `src/server.js` has no game
logic; all game logic is plain MQL (no `$function`). See `assets/mongodoom_tier_1_implementation_plan.md` for the spec.

## Run it

Requires Node 20+ and a local MongoDB 6.0+ (`mongod` on `127.0.0.1:27017`; override with `MONGODB_URI`).

```sh
npm install
npm run seed      # parse the WAD, rasterize E1M1, seed MongoDB, create db.viewport_ascii
npm start         # http://localhost:3000   (PORT=0 for an ephemeral port)
npm test          # wad, pipeline (needs mongod), zero-math lint, end-to-end
```

`assets/DOOM1.WAD` (shareware) is used if present; `npm run fetch-wad` downloads it otherwise. `npm start` seeds an
empty database automatically.

## Controls

`W`/`S` move, `A`/`D` strafe, `←`/`→` (or `Q`/`.`) turn, `Space` or click shoot, `E` open doors, `R` reset.

## Live demo from mongosh (the game keeps running while you do this)

```js
// the 3D view, rendered by MongoDB as 32 strings of 80 characters
db.viewport_ascii.findOne({}, { _id: 0 })

// god mode
db.games.updateOne({ _id: "doom" }, { $set: { "player.hp": 9999, "player.ammo": 999 } })

// teleport ambush: spawn an awake Imp
db.games.updateOne({ _id: "doom" }, { $push: { enemies: { id: 99, x: 18.5, y: 50.0, hp: 60, hurtTicks: 0, attackTicks: 0, awake: true } } })
```

## Scope

Tier 1: one cropped window of E1M1 at 32 Doom units per cell, no pickups/keys/exit, instant doors, every enemy uses Imp
sprites and stats (their "fireball" is an instant hit), straight-line chase AI. See §7 of the plan.
