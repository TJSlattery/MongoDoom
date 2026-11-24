// Stage 3c: explosive barrels. A shotgun blast that reaches a barrel first damages it; at 0 hp it explodes
// (boom = 1 on that tick), damaging everything in 128 units that it can see, which can chain into other barrels.
import {
  add, sub, mul, div, abs, floor, min, max, gt, lt, lte, eq, and, or, cond, clamp, arrAt, mapArr, filterArr, sumArr, minArr, sizeArr,
  seqLet, mergeObjects, mqlRand, lineOfSight, range,
} from "./expr.js";
import { damagePlayer, aimTy, distTo } from "./damage.js";
import { MUZZLE_TICKS, BLAST_UNITS } from "./constants.js";

export const BARREL_BOOM_TICKS = 40; // the explosion sprite plays for this long, then the barrel is gone
const decor = { $ifNull: ["$decor", []] };

export function stageBarrels() {
  const centerDist = arrAt("$_columns.perpDist", 80);
  const firedNow = eq("$player.muzzleTicks", MUZZLE_TICKS); // combat sets this only on the tick the gun fires
  // forward distance of the nearest enemy that was hit this tick
  const enemyHit = minArr(mapArr("$enemies", "e",
    cond(eq("$$e.hurtTicks", 4),
      add(mul("$_cam.dirX", sub("$$e.x", "$player.x")), mul("$_cam.dirY", sub("$$e.y", "$player.y"))), 1e9)));

  const shot = seqLet(
    [
      ["cd", centerDist], ["ehit", enemyHit],
      ["bn", minArr(mapArr(decor, "x", cond(and("$$x.barrel", eq("$$x.boom", 0), gt("$$x.hp", 0)), aimTy("$$x.x", "$$x.y", "$$cd"), 1e9)))],
    ],
    mapArr(decor, "d",
      seqLet(
        [
          ["ty", aimTy("$$d.x", "$$d.y", "$$cd")],
          ["hit", and(firedNow, "$$d.barrel", eq("$$d.boom", 0), gt("$$d.hp", 0), eq("$$ty", "$$bn"), lt("$$ty", "$$ehit"))],
          ["pellets", clamp(floor(sub(9, mul(0.35, distTo("$$d.x", "$$d.y")))), 2, 7)],
          ["dmg", cond("$$hit", mul("$$pellets", mul(5, add(1, floor(mul(mqlRand(mul("$tick", 17), "$$d.id"), 3))))), 0)],
          ["hp1", sub("$$d.hp", "$$dmg")],
          ["boom1", cond(gt("$$d.boom", 0), min(BARREL_BOOM_TICKS, add("$$d.boom", 1)),
            cond(and("$$d.barrel", lte("$$hp1", 0)), 1, 0))],
        ],
        mergeObjects("$$d", { hp: "$$hp1", boom: "$$boom1", solid: cond(gt("$$boom1", 0), false, "$$d.solid") })
      ))
  );

  // damage a target at (x, y) takes from every barrel that exploded this tick and has line of sight to it
  const blastAt = (x, y) =>
    sumArr(mapArr("$$blasts", "b",
      seqLet(
        [["du", mul(max(abs(sub("$$b.x", x)), abs(sub("$$b.y", y))), 32)]],
        cond(and(lt("$$du", BLAST_UNITS), lineOfSight("$map", "$$b.x", "$$b.y", x, y, 10, "ls")), sub(BLAST_UNITS, "$$du"), 0)
      )));
  const withBlasts = (body) => seqLet([["blasts", filterArr(decor, "b", eq("$$b.boom", 1))]], body);

  return [
    { $set: { decor: shot } },
    {
      $set: {
        enemies: withBlasts(mapArr("$enemies", "e",
          seqLet([["dm", blastAt("$$e.x", "$$e.y")]],
            mergeObjects("$$e", {
              hp: max(0, sub("$$e.hp", "$$dm")),
              hurtTicks: cond(gt("$$dm", 0), 4, "$$e.hurtTicks"),
              awake: or("$$e.awake", gt("$$dm", 0)),
            })))),
        decor: withBlasts(mapArr(decor, "d",
          cond(and("$$d.barrel", eq("$$d.boom", 0)),
            mergeObjects("$$d", { hp: sub("$$d.hp", blastAt("$$d.x", "$$d.y")) }), "$$d"))),
        player: withBlasts(damagePlayer(blastAt("$player.x", "$player.y"), 1)),
      },
    },
    { $set: { "player.kills": sizeArr(filterArr("$enemies", "e", lte("$$e.hp", 0))) } },
  ];
}
