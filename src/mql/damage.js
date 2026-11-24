// Shared helpers: player damage with armor, and the shotgun aim cone.
import { add, sub, mul, abs, floor, min, max, gt, lt, and, cond, sqrt, seqLet, mergeObjects } from "./expr.js";

/** `$player` after taking `dealt` damage from the side given by `dir` (>0 right, <0 left): armor soaks armorAbs of it. */
export const damagePlayer = (dealt, dir) =>
  seqLet(
    [
      // nothing hurts the player once the level is finished
      ["dealt", cond({ $ifNull: ["$level.done", false] }, 0, dealt)], ["dir", dir],
      ["abs", { $ifNull: ["$player.armorAbs", 0] }], ["arm", { $ifNull: ["$player.armor", 0] }],
      ["saved", min("$$arm", floor(mul("$$dealt", "$$abs")))],
    ],
    mergeObjects("$player", {
      armor: sub("$$arm", "$$saved"),
      hp: max(0, sub("$player.hp", sub("$$dealt", "$$saved"))),
      hurtTicks: cond(gt("$$dealt", 0), 4, "$player.hurtTicks"),
      hurtDir: cond(gt("$$dealt", 0), "$$dir", { $ifNull: ["$player.hurtDir", 0] }),
    })
  );

/** Forward distance if the point (ex, ey) is inside the shotgun cone in front of a visible wall, else 1e9. */
export const aimTy = (ex, ey, centerDist) =>
  seqLet(
    [
      ["relX", sub(ex, "$player.x")], ["relY", sub(ey, "$player.y")],
      ["ty", add(mul("$_cam.dirX", "$$relX"), mul("$_cam.dirY", "$$relY"))],
      ["lat", sub(mul("$_cam.dirX", "$$relY"), mul("$_cam.dirY", "$$relX"))],
    ],
    cond(and(gt("$$ty", 0.2), lt("$$ty", centerDist), lt(abs("$$lat"), add(0.45, mul(0.06, "$$ty")))), "$$ty", 1e9)
  );

export const distTo = (ex, ey) => sqrt(add(mul(sub(ex, "$player.x"), sub(ex, "$player.x")), mul(sub(ey, "$player.y"), sub(ey, "$player.y"))));
