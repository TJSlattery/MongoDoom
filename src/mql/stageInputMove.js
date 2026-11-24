// Stage 1: tick/timers, turning, independent-axis wall sliding with Doom step/headroom rules, eye height, doors.
import {
  add, sub, mul, div, abs, floor, cos, sin, max, min, gt, gte, lte, eq, and, or, cond, sgn, cellAt, cellSec, cellCode,
  passableFrom, not, arrAt, mapArr, filterArr, reduceArr, concat, range, seqLet, mergeObjects, mod, clamp, sizeArr, mqlRand, lt, cellIdx,
} from "./expr.js";
import { TURN, MOVE, STRAFE, PLAYER_R, FOV_PLANE, GRID_W, GRID_H, Z_SPEED, DOOR_REACH } from "./constants.js";

export function stageInputMove(input) {
  // once the exit switch is pressed the level is over: the player can no longer move, fire or use things
  const levelDone = { $ifNull: ["$level.done", false] };
  const alive = and(gt("$player.hp", 0), not(levelDone));
  const dec = (path) => max(0, sub(path, 1));

  const stages = [
    // 1a: bump tick, decay timers, camera basis, and the sector the player is standing in
    {
      $set: {
        tick: add("$tick", 1),
        player: mergeObjects("$player", {
          muzzleTicks: dec("$player.muzzleTicks"),
          weaponTicks: dec("$player.weaponTicks"),
          hurtTicks: dec("$player.hurtTicks"),
        }),
        // light level per sector this tick, with Doom's flicker (special 1), glow (8) and blink (12) effects
        _lt: mapArr(range(0, sizeArr("$secL")), "s",
          seqLet(
            [["l", arrAt("$secL", "$$s")], ["sp", arrAt("$secS", "$$s")], ["r", mqlRand(floor(div("$tick", 3)), "$$s")]],
            cond(eq("$$sp", 1), cond(lt("$$r", 0.4), mul("$$l", 0.5), "$$l"),
              cond(eq("$$sp", 8), mul("$$l", add(0.7, mul(0.3, abs(sin(mul("$tick", 0.09)))))),
                cond(eq("$$sp", 12), cond(lt(mod("$tick", 36), 18), "$$l", mul("$$l", 0.5)), "$$l")))
          )),
        _cam: seqLet(
          [["ang", add("$player.angle", cond(alive, input.turn * TURN, 0))],
           ["dirX", cos("$$ang")], ["dirY", sin("$$ang")],
           ["sec", cellSec("$map", "$player.x", "$player.y")]],
          {
            ang: "$$ang", dirX: "$$dirX", dirY: "$$dirY", planeX: mul(-FOV_PLANE, "$$dirY"), planeY: mul(FOV_PLANE, "$$dirX"),
            sec: "$$sec", fz: arrAt("$secF", "$$sec"), cz: arrAt("$secC", "$$sec"),
          }
        ),
      },
    },
    // 1b: movement (independent-axis sliding; Doom step-up / headroom rule) and eye-height smoothing
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
              ["nextX", cond(passableFrom("$map", add("$player.x", "$$dxMove", mul(sgn("$$dxMove"), PLAYER_R)), "$player.y", "$_cam.fz", "$_cam.cz"),
                add("$player.x", "$$dxMove"), "$player.x")],
              ["nextY", cond(passableFrom("$map", "$$nextX", add("$player.y", "$$dyMove", mul(sgn("$$dyMove"), PLAYER_R)), "$_cam.fz", "$_cam.cz"),
                add("$player.y", "$$dyMove"), "$player.y")],
              ["targetZ", arrAt("$secF", cellSec("$map", "$$nextX", "$$nextY"))],
              ["z0", { $ifNull: ["$player.z", "$$targetZ"] }],
              ["z", add("$$z0", clamp(sub("$$targetZ", "$$z0"), -Z_SPEED, Z_SPEED))],
            ],
            {
              x: "$$nextX", y: "$$nextY", z: "$$z", angle: "$_cam.ang", moving: or(gt(abs("$$fwd"), 0), gt(abs("$$str"), 0)),
              // view bob: a 3-unit sine while moving, settling back when still
              bob: cond(or(gt(abs("$$fwd"), 0), gt(abs("$$str"), 0)), mul(sin(mul("$tick", 0.5)), 3), mul({ $ifNull: ["$player.bob", 0] }, 0.6)),
            }
          )
        ),
      },
    },
  ];

  const doors = { $ifNull: ["$doors", []] };
  if (input.use) {
    // 1c: the use key looks at a few points ahead (nearest first); the first solid thing found must be a closed door,
    // and that door starts opening. A single probe point was easy to miss on a 1-cell-wide door.
    const probe = (dist) => cellIdx(add("$player.x", mul("$_cam.dirX", dist)), add("$player.y", mul("$_cam.dirY", dist)));
    const tileAt = (idx) => mod(arrAt("$map", idx), 256);
    const pick = seqLet(
      DOOR_REACH.flatMap((d, i) => [[`i${i}`, probe(d)], [`t${i}`, tileAt(`$$i${i}`)]]),
      DOOR_REACH.reduceRight((acc, _, i) =>
        cond(gt(`$$t${i}`, 0), cond(gte(`$$t${i}`, 100), `$$i${i}`, -1), acc), -1)
    );
    stages.push({
      $set: {
        doors: seqLet(
          [["pick", pick]],
          mapArr(doors, "d",
            cond(and(alive, gte("$$pick", 0), { $in: ["$$pick", "$$d.cells"] }, eq("$$d.dir", 0), eq("$$d.open", 0)),
              mergeObjects("$$d", { dir: 1 }), "$$d"))
        ),
        // pressing a switch flips its texture; the exit switch also ends the level
        switches: seqLet(
          [["pick", pick]],
          mapArr({ $ifNull: ["$switches", []] }, "w",
            cond(and(alive, gte("$$pick", 0), { $in: ["$$pick", "$$w.cells"] }, not("$$w.on")), mergeObjects("$$w", { on: true }), "$$w"))
        ),
        level: seqLet(
          [["pick", pick]],
          cond(and(alive, gte("$$pick", 0),
            { $anyElementTrue: [mapArr({ $ifNull: ["$switches", []] }, "w", and("$$w.exit", { $in: ["$$pick", "$$w.cells"] }))] }),
          { done: true, at: "$tick" }, { $ifNull: ["$level", { done: false, at: 0 }] })
        ),
      },
    });
  }
  // 1d: doors rise; once fully open the door cells become ordinary open cells (their sector bits are kept)
  stages.push({
    $set: {
      map: seqLet(
        [["fin", reduceArr(filterArr(doors, "d", and(eq("$$d.dir", 1), gte(add("$$d.open", "$$d.v"), "$$d.h"))),
          [], concat("$$value", "$$this.cells"))]],
        cond(gt(sizeArr("$$fin"), 0),
          mapArr(range(0, GRID_W * GRID_H), "i",
            cond({ $in: ["$$i", "$$fin"] }, sub(arrAt("$map", "$$i"), mod(arrAt("$map", "$$i"), 256)), arrAt("$map", "$$i"))),
          "$map")
      ),
      doors: mapArr(doors, "d",
        cond(eq("$$d.dir", 1),
          mergeObjects("$$d", {
            open: min("$$d.h", add("$$d.open", "$$d.v")),
            dir: cond(gte(add("$$d.open", "$$d.v"), "$$d.h"), 0, 1),
          }), "$$d")),
    },
  });
  return stages;
}
