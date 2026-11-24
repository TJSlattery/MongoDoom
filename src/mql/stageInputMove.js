// Stage 1: tick/timers, turning, independent-axis wall sliding, interactive doors.
import {
  add, sub, mul, div, abs, floor, cos, sin, max, min, gt, gte, lte, eq, and, or, cond, sgn, cellAt,
  arrAt, mapArr, range, seqLet, mergeObjects, mod,
} from "./expr.js";
import { TURN, MOVE, STRAFE, PLAYER_R, FOV_PLANE, GRID } from "./constants.js";

export function stageInputMove(input) {
  const alive = gt("$player.hp", 0);
  const dec = (path) => max(0, sub(path, 1));

  const stages = [
    // 1a: bump tick, decay timers, compute the camera basis for the new heading
    {
      $set: {
        tick: add("$tick", 1),
        player: mergeObjects("$player", {
          muzzleTicks: dec("$player.muzzleTicks"),
          weaponTicks: dec("$player.weaponTicks"),
          hurtTicks: dec("$player.hurtTicks"),
        }),
        _cam: seqLet(
          [["ang", add("$player.angle", cond(alive, input.turn * TURN, 0))],
           ["dirX", cos("$$ang")], ["dirY", sin("$$ang")]],
          { ang: "$$ang", dirX: "$$dirX", dirY: "$$dirY", planeX: mul(-FOV_PLANE, "$$dirY"), planeY: mul(FOV_PLANE, "$$dirX") }
        ),
      },
    },
    // 1b: movement with independent-axis wall sliding
    {
      $set: {
        player: mergeObjects(
          "$player",
          seqLet(
            [
              ["dirX", "$_cam.dirX"], ["dirY", "$_cam.dirY"],
              ["fwd", cond(alive, input.forward * MOVE, 0)],
              ["str", cond(alive, input.strafe * STRAFE, 0)],
              ["dxMove", sub(mul("$$dirX", "$$fwd"), mul("$$dirY", "$$str"))],
              ["dyMove", add(mul("$$dirY", "$$fwd"), mul("$$dirX", "$$str"))],
              ["nextX", cond(eq(cellAt("$map", add("$player.x", "$$dxMove", mul(sgn("$$dxMove"), PLAYER_R)), "$player.y"), 0),
                add("$player.x", "$$dxMove"), "$player.x")],
              ["nextY", cond(eq(cellAt("$map", "$$nextX", add("$player.y", "$$dyMove", mul(sgn("$$dyMove"), PLAYER_R))), 0),
                add("$player.y", "$$dyMove"), "$player.y")],
            ],
            { x: "$$nextX", y: "$$nextY", angle: "$_cam.ang", moving: or(gt(abs("$$fwd"), 0), gt(abs("$$str"), 0)) }
          )
        ),
      },
    },
  ];

  if (input.use) {
    // 1c: open every door cell within Chebyshev distance 2 of the probe cell
    const probeX = floor(add("$player.x", mul("$_cam.dirX", 1.4)));
    const probeY = floor(add("$player.y", mul("$_cam.dirY", 1.4)));
    stages.push({
      $set: {
        map: seqLet(
          [["px", probeX], ["py", probeY]],
          cond(
            and(alive, gte(cellAt("$map", "$$px", "$$py"), 100)),
            mapArr(range(0, GRID * GRID), "i",
              seqLet(
                [["cell", arrAt("$map", "$$i")],
                 ["cx", mod("$$i", GRID)], ["cy", floor(div("$$i", GRID))]],
                cond(and(gte("$$cell", 100), lte(max(abs(sub("$$cx", "$$px")), abs(sub("$$cy", "$$py"))), 2)), 0, "$$cell")
              )),
            "$map"
          )
        ),
      },
    });
  }
  return stages;
}
