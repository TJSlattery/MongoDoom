// Stage 3a: imp fireballs. They fly in a straight line, explode on walls, steps/ceilings that block them, or the player.
import { add, sub, mul, div, floor, mod, gt, gte, lt, and, or, not, cond, sgn, cellCode, arrAt, mapArr, filterArr, sumArr, seqLet, mqlRand, eq } from "./expr.js";
import { damagePlayer } from "./damage.js";
import { PROJ_R } from "./constants.js";

const P = (k) => `$$p.${k}`;
export const PROJ_BOOM_TICKS = 12; // explosion frames: 3 x 4 ticks, then the projectile is removed
export const PROJ_MAX_AGE = 120;

export function stageProjectiles() {
  const moved = mapArr({ $ifNull: ["$projectiles", []] }, "p",
    seqLet(
      [
        ["fly", eq(P("hit"), 0)],
        ["nx", add(P("x"), P("vx"))], ["ny", add(P("y"), P("vy"))],
        ["code", cellCode("$map", "$$nx", "$$ny")],
        ["tile", mod("$$code", 256)],
        ["nsec", floor(div("$$code", 256))],
        ["wall", or(gt("$$tile", 0), gt(arrAt("$secF", "$$nsec"), P("z")), lt(arrAt("$secC", "$$nsec"), P("z")))],
        ["pdx", sub("$$nx", "$player.x")], ["pdy", sub("$$ny", "$player.y")],
        ["near", and(gt("$player.hp", 0), lt(add(mul("$$pdx", "$$pdx"), mul("$$pdy", "$$pdy")), PROJ_R * PROJ_R))],
        ["boom", and("$$fly", or("$$wall", "$$near", gte(P("age"), PROJ_MAX_AGE)))],
        ["dmg", cond(and("$$fly", "$$near"), mul(3, add(1, floor(mul(mqlRand(mul("$tick", 41), P("id")), 8)))), 0)],
        ["lat", sub(mul("$_cam.dirX", sub("$$ny", "$player.y")), mul("$_cam.dirY", sub("$$nx", "$player.x")))],
      ],
      {
        id: P("id"), vx: P("vx"), vy: P("vy"), z: P("z"),
        x: cond(and("$$fly", not("$$wall")), "$$nx", P("x")), y: cond(and("$$fly", not("$$wall")), "$$ny", P("y")),
        age: add(P("age"), 1),
        hit: cond("$$fly", cond("$$boom", 1, 0), add(P("hit"), 1)),
        dmg: "$$dmg", dirw: mul("$$dmg", sgn("$$lat")),
      }
    ));
  return [
    { $set: { _pj: moved } },
    {
      $set: {
        player: damagePlayer(sumArr("$_pj.dmg"), sumArr("$_pj.dirw")),
        projectiles: mapArr(filterArr("$_pj", "p", lt(P("hit"), PROJ_BOOM_TICKS + 1)), "p",
          { id: P("id"), x: P("x"), y: P("y"), vx: P("vx"), vy: P("vy"), z: P("z"), age: P("age"), hit: P("hit") }),
      },
    },
    { $unset: "_pj" },
  ];
}
