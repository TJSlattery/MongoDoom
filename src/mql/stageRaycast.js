// Stage 2: 160-column camera-plane DDA with world-aligned texture coordinates and viewport source-rect clipping.
import {
  add, sub, mul, div, mod, abs, floor, min, max, round, eq, gt, lt, and, or, cond, clamp, cellAt,
  safeInvAbs, mapArr, range, reduceArr, seqLet,
} from "./expr.js";
import { COLS, MAX_STEPS, WALL_PX, EYE_FRAC, HORIZON, VIEW_H } from "./constants.js";

export function stageRaycast() {
  const col = "$$col";
  const column = seqLet(
    [
      ["cameraX", sub(div(mul(col, 2), COLS), 1)],
      ["rdx", add("$_cam.dirX", mul("$_cam.planeX", "$$cameraX"))],
      ["rdy", add("$_cam.dirY", mul("$_cam.planeY", "$$cameraX"))],
      ["ddx", safeInvAbs("$$rdx")],
      ["ddy", safeInvAbs("$$rdy")],
      ["mx0", floor("$player.x")],
      ["my0", floor("$player.y")],
      ["stx", cond(lt("$$rdx", 0), -1, 1)],
      ["sty", cond(lt("$$rdy", 0), -1, 1)],
      ["sdx0", mul(cond(lt("$$rdx", 0), sub("$player.x", "$$mx0"), sub(add("$$mx0", 1), "$player.x")), "$$ddx")],
      ["sdy0", mul(cond(lt("$$rdy", 0), sub("$player.y", "$$my0"), sub(add("$$my0", 1), "$player.y")), "$$ddy")],
      [
        "dda",
        reduceArr(
          range(0, MAX_STEPS),
          { hit: false, mx: "$$mx0", my: "$$my0", sdx: "$$sdx0", sdy: "$$sdy0", side: 0, tile: 1 },
          cond("$$value.hit", "$$value",
            seqLet(
              [
                ["xa", lt("$$value.sdx", "$$value.sdy")],
                ["nmx", cond("$$xa", add("$$value.mx", "$$stx"), "$$value.mx")],
                ["nmy", cond("$$xa", "$$value.my", add("$$value.my", "$$sty"))],
                ["cell", cellAt("$map", "$$nmx", "$$nmy")],
              ],
              {
                hit: gt("$$cell", 0), mx: "$$nmx", my: "$$nmy",
                sdx: cond("$$xa", add("$$value.sdx", "$$ddx"), "$$value.sdx"),
                sdy: cond("$$xa", "$$value.sdy", add("$$value.sdy", "$$ddy")),
                side: cond("$$xa", 0, 1),
                tile: cond(gt("$$cell", 0), "$$cell", 1),
              }
            ))
        ),
      ],
      ["side", "$$dda.side"],
      ["perp", max(0.08, cond(eq("$$side", 0), sub("$$dda.sdx", "$$ddx"), sub("$$dda.sdy", "$$ddy")))],
      ["tex", cond(gt("$$dda.tile", 100), sub("$$dda.tile", 100), "$$dda.tile")],
      ["wallHit", cond(eq("$$side", 0), add("$player.y", mul("$$perp", "$$rdy")), add("$player.x", mul("$$perp", "$$rdx")))],
      // a 128-unit texture spans 4 cells = 64 texels, so 16 texels per cell, world-aligned
      ["rawSx", clamp(floor(mul(mod("$$wallHit", 4), 16)), 0, 63)],
      ["flip", or(and(eq("$$side", 0), gt("$$rdx", 0)), and(eq("$$side", 1), lt("$$rdy", 0)))],
      ["sx", cond("$$flip", sub(63, "$$rawSx"), "$$rawSx")],
      ["fullH", max(1, floor(div(WALL_PX, "$$perp")))],
      ["floorOff", floor(mul("$$fullH", EYE_FRAC))],
      ["rawTop", add(sub(HORIZON, "$$fullH"), "$$floorOff")],
      ["rawEnd", add(HORIZON, "$$floorOff")],
      ["dy", clamp("$$rawTop", 0, VIEW_H)],
      ["dh", max(0, sub(clamp("$$rawEnd", 0, VIEW_H), "$$dy"))],
      ["sy", clamp(floor(mul(div(sub("$$dy", "$$rawTop"), "$$fullH"), 128)), 0, 127)],
      ["sh", clamp(floor(mul(div("$$dh", "$$fullH"), 128)), 1, sub(128, "$$sy"))],
      ["shade", clamp(round(add(div("$$perp", 18), cond(eq("$$side", 1), 0.18, 0)), 2), 0, 0.85)],
    ],
    { dx: mul(col, 2), tex: "$$tex", sx: "$$sx", sy: "$$sy", sh: "$$sh", dy: "$$dy", dh: "$$dh", shade: "$$shade", perpDist: "$$perp" }
  );
  return [{ $set: { _columns: mapArr(range(0, COLS), "col", column) } }];
}
