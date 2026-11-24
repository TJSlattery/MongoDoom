// Stage 4: inverse-camera projection, back-to-front depth sort, per-column Z-buffer occlusion.
import {
  add, sub, mul, div, mod, floor, sqrt, max, gt, lte, lt, and, cond, clamp, arrAt, sizeArr, mapArr, filterArr,
  sortArr, range, seqLet, lit,
} from "./expr.js";
import { WALL_PX, EYE_FRAC, HORIZON, VIEW_H, SPR_PX, SPR_COLS, FOV_PLANE } from "./constants.js";

const P = (k) => `$$p.${k}`;
const WALK = ["TROOA1", "TROOB1", "TROOC1", "TROOD1"];

export function stageSprites() {
  const projected = mapArr("$enemies", "e",
    seqLet(
      [
        ["relX", sub("$$e.x", "$player.x")],
        ["relY", sub("$$e.y", "$player.y")],
      ],
      {
        ty: add(mul("$_cam.dirX", "$$relX"), mul("$_cam.dirY", "$$relY")),
        tx: div(sub(mul("$_cam.dirX", "$$relY"), mul("$_cam.dirY", "$$relX")), FOV_PLANE),
        frame: cond(lte("$$e.hp", 0),
          cond(gt("$$e.hurtTicks", 0), "TROOK0", "TROOM0"),
          cond(gt("$$e.hurtTicks", 0), "TROOH1",
            cond(gt("$$e.swingTicks", 0), "TROOF1",
              arrAt(lit(WALK), mod(floor(div("$tick", 4)), 4))))),
      }
    ));

  const visible = filterArr(projected, "p", gt(P("ty"), 0.25));
  const sprite = seqLet(
    [
      ["ty", P("ty")],
      ["tx", P("tx")],
      ["floorY", add(HORIZON, floor(mul(floor(div(WALL_PX, "$$ty")), EYE_FRAC)))],
      ["sprH", max(2, floor(div(SPR_PX, "$$ty")))],
      ["rawTop", sub("$$floorY", "$$sprH")],
      ["colSpan", max(2, floor(div(SPR_COLS, "$$ty")))],
      ["centerCol", floor(mul(80, add(1, div("$$tx", "$$ty"))))],
      ["leftCol", sub("$$centerCol", floor(div("$$colSpan", 2)))],
      ["cStart", clamp("$$leftCol", 0, 159)],
      ["cEnd", clamp(add("$$leftCol", "$$colSpan"), 0, 160)],
      ["dy", clamp("$$rawTop", 0, VIEW_H)],
      ["dh", max(0, sub(clamp("$$floorY", 0, VIEW_H), "$$dy"))],
      ["sy", clamp(floor(mul(div(sub("$$dy", "$$rawTop"), "$$sprH"), 64)), 0, 63)],
      ["sh", clamp(floor(mul(div("$$dh", "$$sprH"), 64)), 1, sub(64, "$$sy"))],
    ],
    {
      frame: P("frame"),
      strips: mapArr(
        filterArr(range("$$cStart", "$$cEnd"), "c", and(gt("$$dh", 0), lt("$$ty", arrAt("$_columns.perpDist", "$$c")))),
        "c",
        {
          dx: mul("$$c", 2),
          sx: clamp(floor(mul(div(sub("$$c", "$$leftCol"), "$$colSpan"), 64)), 0, 63),
          sy: "$$sy", sh: "$$sh", dy: "$$dy", dh: "$$dh",
        }
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
