// Stage 2: 160-column portal raycaster. A ray walks the grid; every time it enters a cell of a different sector
// it emits the floor/ceiling fills of the sector it just crossed, plus step (lower) and drop (upper) faces; a solid
// tile ends the ray with a tiled wall face. The running [top, bot] window clips everything that is hidden.
// Per column: w = wall strips {tex,sx,sy,sh,dy,dh,shade}, f = flat fills {dy,dh,c}, perpDist = where the ray ended.
import {
  add, sub, mul, div, mod, abs, floor, ceil, min, max, round, eq, ne, gt, gte, lt, and, or, not, cond, clamp,
  cellCode, cellIdx, safeInvAbs, atan2, lte, mapArr, filterArr, range, reduceArr, seqLet, arrAt, mergeObjects,
} from "./expr.js";
import { COLS, MAX_STEPS, HORIZON, VIEW_H, PX_PER_UNIT, EYE_UNITS, FLAT_RH, SKY_U } from "./constants.js";

const V = (n) => "$$" + n;
const concat = (...a) => ({ $concatArrays: a });

/** Screen y (unrounded) of world height h seen at perpendicular distance d. */
const yOf = (h, d) => sub(HORIZON, div(mul(sub(h, V("eye")), PX_PER_UNIT), d));

/** Packed flat texel (v*64+u) for every FLAT_RH-pixel row of a floor/ceiling span at height h, starting at screen row dyE.
 *  Row r samples the world point on this column's ray at the row centre; a 64x64 flat spans 64 world units. */
function flatRows(h, dyE, dhE) {
  // px32/py32 (player position in flat texels) and vx/vy (ray direction in flat texels) are column constants,
  // k is the fill constant, so each row costs one division and a handful of multiply-adds.
  return seqLet(
    [["k", mul(abs(sub(h, V("eye"))), PX_PER_UNIT)], ["y0", add(dyE, FLAT_RH / 2)]],
    mapArr(range(0, floor(div(dhE, FLAT_RH))), "r",
      seqLet(
        [["dd", div(V("k"), max(0.5, abs(sub(add(V("y0"), mul(V("r"), FLAT_RH)), HORIZON))))]],
        add(mul(mod(floor(add(V("py32"), mul(V("vy"), V("dd")))), 64), 64), mod(floor(add(V("px32"), mul(V("vx"), V("dd")))), 64))
      )));
}

/** Wall strips covering world heights [hb, ht] at distance d, tiled every 128 units from hb, clipped to [top, bot]. */
function wallPieces(hb, ht, tex, d, top, bot) {
  const strip = seqLet(
    [
      ["hb2", add(hb, mul(V("k"), 128))],
      ["ht2", min(ht, add(V("hb2"), 128))],
      ["len", sub(V("ht2"), V("hb2"))],
      ["yt", yOf(V("ht2"), d)],
      ["yb", yOf(V("hb2"), d)],
      ["a", max(V("yt"), top)],
      ["b", min(V("yb"), bot)],
      ["span", max(0.0001, sub(V("yb"), V("yt")))],
      ["sy", add(sub(128, V("len")), clamp(floor(mul(div(sub(V("a"), V("yt")), V("span")), V("len"))), 0, sub(V("len"), 1)))],
      ["sh", clamp(floor(mul(div(sub(V("b"), V("a")), V("span")), V("len"))), 1, sub(128, V("sy")))],
    ],
    { tex, sx: V("sx"), sy: V("sy"), sh: V("sh"), dy: floor(V("a")), dh: sub(floor(V("b")), floor(V("a"))), shade: V("shade") }
  );
  return filterArr(
    mapArr(range(0, min(3, ceil(div(sub(ht, hb), 128)))), "k", strip),
    "p", gt("$$p.dh", 0)
  );
}

export function stageRaycast() {
  const step = (rdx, rdy, ddx, ddy, stx, sty) =>
    cond(V("value.done"), V("value"),
      seqLet(
        [
          ["v", V("value")],
          ["xa", lt("$$v.sdx", "$$v.sdy")],
          ["nmx", cond(V("xa"), add("$$v.mx", stx), "$$v.mx")],
          ["nmy", cond(V("xa"), "$$v.my", add("$$v.my", sty))],
          ["d", max(0.08, cond(V("xa"), "$$v.sdx", "$$v.sdy"))],
          ["code", cellCode("$map", V("nmx"), V("nmy"))],
          ["tile", mod(V("code"), 256)],
          ["nsec", floor(div(V("code"), 256))],
          ["cur", "$$v.sec"],
          // doors and switches: look up the owning object (open height / pressed state, and its span for texture layout)
          ["isDoor", and(gt(V("tile"), 100), lt(V("tile"), 200))],
          ["isSwitch", gt(V("tile"), 200)],
          ["cidx", cellIdx(V("nmx"), V("nmy"))],
          ["obj", cond(V("isDoor"), { $arrayElemAt: [{ $filter: { input: { $ifNull: ["$doors", []] }, as: "dd", cond: { $in: [V("cidx"), "$$dd.cells"] } } }, 0] },
            cond(V("isSwitch"), { $arrayElemAt: [{ $filter: { input: { $ifNull: ["$switches", []] }, as: "dd", cond: { $in: [V("cidx"), "$$dd.cells"] } } }, 0] }, null))],
          ["dOpen", { $ifNull: ["$$obj.open", 0] }],
          ["solid", and(gt(V("tile"), 0), or(not(V("isDoor")), lte(V("dOpen"), 0)))],
          // face texture: doors / switches are drawn once across their own span (16 texels per cell from the span start)
          ["solo", or(V("isDoor"), V("isSwitch"))],
          ["texId", cond(V("isSwitch"), cond({ $ifNull: ["$$obj.on", false] }, "$$obj.texOn", sub(V("tile"), 200)), cond(V("isDoor"), sub(V("tile"), 100), V("tile")))],
          ["nsdx", cond(V("xa"), add("$$v.sdx", ddx), "$$v.sdx")],
          ["nsdy", cond(V("xa"), "$$v.sdy", add("$$v.sdy", ddy))],
        ],
        cond(
          and(eq(V("tile"), 0), eq(V("nsec"), V("cur"))),
          // same sector, open cell: just advance
          mergeObjects(V("v"), { mx: V("nmx"), my: V("nmy"), sdx: V("nsdx"), sdy: V("nsdy") }),
          seqLet(
            [
              ["top", "$$v.top"], ["bot", "$$v.bot"],
              ["fA", arrAt("$secF", V("cur"))], ["cA", arrAt("$secC", V("cur"))],
              // texture column and shading at this crossing
              ["wallHit", cond(V("xa"), add("$player.y", mul(V("d"), rdy)), add("$player.x", mul(V("d"), rdx)))],
              ["spanStart", cond(V("xa"), { $ifNull: ["$$obj.y0", 0] }, { $ifNull: ["$$obj.x0", 0] })],
              ["spanTexels", min(64, mul(16, cond(V("xa"), { $ifNull: ["$$obj.ny", 4] }, { $ifNull: ["$$obj.nx", 4] })))],
              ["rawSx", cond(V("solo"),
                clamp(floor(mul(sub(V("wallHit"), V("spanStart")), 16)), 0, sub(V("spanTexels"), 1)),
                clamp(floor(mul(mod(V("wallHit"), 4), 16)), 0, 63))],
              ["flip", or(and(V("xa"), gt(rdx, 0)), and(not(V("xa")), lt(rdy, 0)))],
              ["sx", cond(V("flip"), sub(cond(V("solo"), sub(V("spanTexels"), 1), 63), V("rawSx")), V("rawSx"))],
              ["amb", round(mul(sub(255, arrAt("$_lt", V("cur"))), 0.55 / 255), 2)],
              ["shade", clamp(round(add(V("amb"), div(V("d"), 22), cond(V("xa"), 0, 0.12)), 2), 0, 0.88)],
              // floor of A from its far edge down to the current bottom clip
              ["fdy", max(V("top"), floor(yOf(V("fA"), V("d"))))],
              ["fflat", arrAt("$secFT", V("cur"))],
              ["fillF", cond(lt(V("fdy"), V("bot")), [{
                dy: V("fdy"), dh: sub(V("bot"), V("fdy")), c: arrAt("$secFC", V("cur")), fl: V("fflat"), ld: V("amb"),
                t: cond(gt(V("fflat"), 0), flatRows(V("fA"), V("fdy"), sub(V("bot"), V("fdy"))), []),
              }], [])],
              ["bot1", cond(lt(V("fdy"), V("bot")), V("fdy"), V("bot"))],
              // ceiling of A from the top clip down to its far edge
              ["cdy", min(V("bot1"), floor(yOf(V("cA"), V("d"))))],
              ["cflat", arrAt("$secCT", V("cur"))],
              ["fillC", cond(gt(V("cdy"), V("top")), [{
                dy: V("top"), dh: sub(V("cdy"), V("top")), c: arrAt("$secCC", V("cur")), fl: V("cflat"), ld: cond(lt(V("cflat"), 0), 0, V("amb")),
                // sky: [source column, source row, source height] of the 256x128 sky, drawn by the client; flat: packed texels
                t: cond(gt(V("cflat"), 0), flatRows(V("cA"), V("top"), sub(V("cdy"), V("top"))),
                  cond(lt(V("cflat"), 0), [V("skyU"), clamp(add(V("top"), 16), 0, 127), clamp(sub(V("cdy"), V("top")), 1, sub(128, clamp(add(V("top"), 16), 0, 127)))], [])),
              }], [])],
              ["top1", cond(gt(V("cdy"), V("top")), V("cdy"), V("top"))],
              ["fills", concat("$$v.f", V("fillF"), V("fillC"))],
            ],
            cond(
              V("solid"),
              // solid wall / closed door: tiled face from floor to ceiling, ray ends
              mergeObjects(V("v"), {
                done: true, perp: V("d"), f: V("fills"),
                w: concat("$$v.w", wallPieces(V("fA"), V("cA"), V("texId"), V("d"), V("top1"), V("bot1"))),
              }),
              // portal into a neighbouring sector: step-up face and ceiling-drop face, then keep walking
              seqLet(
                [
                  ["fB", arrAt("$secF", V("nsec"))], ["cB", cond(V("isDoor"), add(arrAt("$secF", V("nsec")), V("dOpen")), arrAt("$secC", V("nsec")))],
                  ["lowFace", gt(V("fB"), V("fA"))],
                  ["lowW", cond(V("lowFace"), wallPieces(V("fA"), V("fB"), arrAt("$secLow", V("nsec")), V("d"), V("top1"), V("bot1")), [])],
                  ["bot2", cond(V("lowFace"), min(V("bot1"), max(V("top1"), floor(yOf(V("fB"), V("d"))))), V("bot1"))],
                  ["upFace", and(lt(V("cB"), V("cA")), or(V("isDoor"), not(and(lt(arrAt("$secCT", V("cur")), 0), lt(arrAt("$secCT", V("nsec")), 0)))))],
                  ["upW", cond(V("upFace"), wallPieces(V("cB"), V("cA"), cond(V("isDoor"), V("texId"), arrAt("$secUp", V("nsec"))), V("d"), V("top1"), V("bot2")), [])],
                  ["top2", cond(V("upFace"), min(V("bot2"), max(V("top1"), floor(yOf(V("cB"), V("d"))))), V("top1"))],
                ],
                {
                  mx: V("nmx"), my: V("nmy"), sdx: V("nsdx"), sdy: V("nsdy"), sec: V("nsec"),
                  top: V("top2"), bot: V("bot2"), f: V("fills"), wins: concat("$$v.wins", [{ d: V("d"), top: V("top2"), bot: V("bot2") }]), w: concat("$$v.w", V("lowW"), V("upW")),
                  done: gte(V("top2"), V("bot2")), perp: cond(gte(V("top2"), V("bot2")), V("d"), "$$v.perp"),
                }
              )
            )
          )
        )
      ));

  const col = "$$col";
  const column = seqLet(
    [
      ["eye", add("$player.z", EYE_UNITS, { $ifNull: ["$player.bob", 0] })],
      ["cameraX", sub(div(mul(col, 2), COLS), 1)],
      ["rdx", add("$_cam.dirX", mul("$_cam.planeX", "$$cameraX"))],
      ["rdy", add("$_cam.dirY", mul("$_cam.planeY", "$$cameraX"))],
      ["skyU", mod(add(mod(floor(mul(atan2("$$rdy", "$$rdx"), SKY_U)), 256), 256), 256)],
      ["px32", mul("$player.x", 32)], ["py32", mul("$player.y", 32)], ["vx", mul("$$rdx", 32)], ["vy", mul("$$rdy", 32)],
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
          { mx: "$$mx0", my: "$$my0", sdx: "$$sdx0", sdy: "$$sdy0", sec: "$_cam.sec", top: 0, bot: VIEW_H, w: [], f: [], wins: [], done: false, perp: 1000 },
          step("$$rdx", "$$rdy", "$$ddx", "$$ddy", "$$stx", "$$sty")
        ),
      ],
    ],
    { dx: mul(col, 2), w: "$$dda.w", f: "$$dda.f", wins: "$$dda.wins", perpDist: "$$dda.perp" }
  );
  return [{ $set: { _columns: mapArr(range(0, COLS), "col", column) } }];
}
