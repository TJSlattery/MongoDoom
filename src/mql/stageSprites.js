// Stage 4: inverse-camera projection of every world sprite (enemies, items, decorations, fireballs),
// back-to-front depth sort, per-column Z-buffer / portal-window occlusion.
import {
  add, sub, mul, div, mod, floor, max, min, gt, lte, lt, and, or, not, cond, clamp, arrAt, sizeArr, mapArr, filterArr,
  sortArr, range, seqLet, lit, cellSec, atan2, eq, gte, concat,
} from "./expr.js";
import { HORIZON, VIEW_H, SPR_COLS, FOV_PLANE, PX_PER_UNIT, EYE_UNITS } from "./constants.js";
import { MONSTER_SETS } from "../wad/spriteBuilder.js";
import { BARREL_BOOM_TICKS } from "./stageBarrels.js";

const P = (k) => `$$p.${k}`;
const ROTS = lit(["1", "2", "3", "4", "5", "6", "7", "8"]);
const DEG = 57.29578;

export function stageSprites() {
  const rel = [["relX", sub("$$e.x", "$player.x")], ["relY", sub("$$e.y", "$player.y")]];
  const cam = {
    ty: add(mul("$_cam.dirX", "$$relX"), mul("$_cam.dirY", "$$relY")),
    tx: div(sub(mul("$_cam.dirX", "$$relY"), mul("$_cam.dirY", "$$relX")), FOV_PLANE),
  };
  const floorOf = arrAt("$secF", cellSec("$map", "$$e.x", "$$e.y"));
  const N = (k, d) => ({ $ifNull: [`$$e.${k}`, d] });

  // ---- enemies: 8 rotations relative to the viewer, plus attack / pain / death animation frames
  const enemies = mapArr("$enemies", "e",
    seqLet(
      [
        ...rel,
        ["sp", N("sp", lit(MONSTER_SETS.TROO))],
        ["a", atan2("$$relY", "$$relX")], // viewer -> monster direction; Doom picks the rotation from (that - facing)
        ["rot", arrAt(ROTS, mod(add(mod(floor(div(add(mul(sub(N("ang", 0), "$$a"), DEG), 202.5), 45)), 8), 8), 8))],
        ["sw", N("swingTicks", 0)],
        ["step", mod(floor(div(add("$tick", mul(N("id", 0), 3)), 6)), 4)],
      ],
      {
        baseZ: floorOf, hu: 64, ...cam,
        frame: { $concat: [
          "$$sp.k",
          cond(lte("$$e.hp", 0),
            { $concat: [arrAt("$$sp.die", min(4, floor(div(N("deadTicks", 0), 5)))), "0"] },
            cond(gt("$$e.hurtTicks", 0), { $concat: ["$$sp.pain", "$$rot"] },
              cond(gt("$$sw", 0),
                { $concat: [arrAt("$$sp.atk", cond(gt("$$sw", 6), 0, cond(gt("$$sw", 3), 1, 2))), "$$rot"] },
                { $concat: [arrAt("$$sp.walk", "$$step"), "$$rot"] }))),
        ] },
      }
    ));

  // ---- pickups
  const items = mapArr(filterArr({ $ifNull: ["$items", []] }, "i", not("$$i.taken")), "e",
    seqLet(rel, { baseZ: floorOf, hu: 64, ...cam, frame: "$$e.sprite" }));

  // ---- decorations; exploding barrels switch to the BEXP sequence and vanish when it ends
  const decor = mapArr(
    filterArr({ $ifNull: ["$decor", []] }, "d", or(not("$$d.barrel"), lt("$$d.boom", BARREL_BOOM_TICKS))),
    "e",
    seqLet(rel, {
      baseZ: floorOf, hu: N("hu", 64), ...cam,
      frame: cond(gt(N("boom", 0), 0),
        arrAt(lit(["BEXPA0", "BEXPB0", "BEXPC0", "BEXPD0", "BEXPE0"]), min(4, floor(div(sub("$$e.boom", 1), 8)))),
        arrAt("$$e.anim", mod(floor(div("$tick", "$$e.animTicks")), sizeArr("$$e.anim")))),
    }));

  // ---- fireballs: centred sprites, so the 64-unit canvas bottom sits 32 units under the ball
  const projectiles = mapArr({ $ifNull: ["$projectiles", []] }, "e",
    seqLet(rel, {
      baseZ: sub("$$e.z", 32), hu: 64, ...cam,
      frame: cond(gt("$$e.hit", 0),
        arrAt(lit(["BAL1C0", "BAL1D0", "BAL1E0"]), min(2, floor(div(sub("$$e.hit", 1), 4)))),
        arrAt(lit(["BAL1A0", "BAL1B0"]), mod(floor(div("$$e.age", 3)), 2))),
    }));

  const visible = filterArr({ $concatArrays: [enemies, items, decor, projectiles] }, "p", gt(P("ty"), 0.25));
  const sprite = seqLet(
    [
      ["ty", P("ty")], ["tx", P("tx")], ["hu", P("hu")],
      ["eye", add("$player.z", EYE_UNITS, { $ifNull: ["$player.bob", 0] })],
      ["floorY", add(HORIZON, floor(div(mul(sub("$$eye", P("baseZ")), PX_PER_UNIT), "$$ty")))],
      ["sprH", max(2, floor(div(mul("$$hu", PX_PER_UNIT), "$$ty")))],
      ["rawTop", sub("$$floorY", "$$sprH")],
      ["colSpan", max(2, floor(div(SPR_COLS, "$$ty")))],
      ["centerCol", floor(mul(80, add(1, div("$$tx", "$$ty"))))],
      ["leftCol", sub("$$centerCol", floor(div("$$colSpan", 2)))],
      ["cStart", clamp("$$leftCol", 0, 159)],
      ["cEnd", clamp(add("$$leftCol", "$$colSpan"), 0, 160)],
      ["y0", clamp("$$rawTop", 0, VIEW_H)],
      ["y1", clamp("$$floorY", 0, VIEW_H)],
    ],
    {
      frame: P("frame"),
      strips: filterArr(
        mapArr(range("$$cStart", "$$cEnd"), "c",
          seqLet(
            [
              ["col", arrAt("$_columns", "$$c")],
              // visible window at the sprite's depth = the last portal window the ray passed before reaching it
              ["before", filterArr("$$col.wins", "wn", lt("$$wn.d", "$$ty"))],
              ["win", cond(gt(sizeArr("$$before"), 0), arrAt("$$before", -1), { top: 0, bot: VIEW_H })],
              ["dy", max("$$y0", "$$win.top")],
              ["dh", cond(lt("$$ty", "$$col.perpDist"), max(0, sub(min("$$y1", "$$win.bot"), "$$dy")), 0)],
              ["sy", clamp(floor(mul(div(sub("$$dy", "$$rawTop"), "$$sprH"), "$$hu")), 0, sub("$$hu", 1))],
              ["sh", clamp(floor(mul(div("$$dh", "$$sprH"), "$$hu")), 1, sub("$$hu", "$$sy"))],
            ],
            {
              dx: mul("$$c", 2),
              sx: clamp(floor(mul(div(sub("$$c", "$$leftCol"), "$$colSpan"), 64)), 0, 63),
              sy: "$$sy", sh: "$$sh", dy: "$$dy", dh: "$$dh",
            }
          )),
        "st", gt("$$st.dh", 0)
      ),
    }
  );

  return [
    {
      $set: {
        _sprites: filterArr(
          mapArr(sortArr(visible, { ty: -1 }), "p", sprite),
          "s", gt(sizeArr("$$s.strips"), 0)
        ),
      },
    },
  ];
}
