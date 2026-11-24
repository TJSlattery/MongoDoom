// Read-only db.viewport_ascii pipeline: renders games.frame as 32 strings x 80 chars of shaded glyphs.
import {
  add, sub, mul, div, floor, min, gte, lt, and, cond, arrAt, mapArr, range, reduceArr, seqLet, lit, eq, sizeArr,
} from "./expr.js";
import { VIEW_H } from "./constants.js";

const ROWS = 32;
const WIDTH = 80;
const GLYPHS = ["█", "▓", "▒", "░"];

export const asciiPipeline = (() => {
  const inRect = (y, dy, dh) => and(gte(y, dy), lt(y, add(dy, dh)));

  const glyph = seqLet(
    [
      ["i", "$$this"],
      ["col", arrAt("$frame.columns", mul("$$i", 2))],
      ["spriteHit", { $anyElementTrue: [mapArr("$frame.sprites", "sp",
        { $anyElementTrue: [mapArr("$$sp.strips", "st",
          and(eq("$$st.dx", mul("$$i", 4)), inRect("$$y", "$$st.dy", "$$st.dh")))] })] }],
    ],
    cond("$$spriteHit", "M",
      cond(inRect("$$y", "$$col.dy", "$$col.dh"),
        arrAt(lit(GLYPHS), min(3, floor(div("$$col.shade", 0.22)))),
        cond(lt("$$y", VIEW_H / 2), " ", "·")))
  );

  const row = seqLet(
    [["y", floor(div(mul("$$r", VIEW_H), ROWS))]],
    reduceArr(range(0, WIDTH), "", { $concat: ["$$value", glyph] })
  );

  return [
    { $match: { _id: "doom" } },
    { $project: { _id: 0, rows: mapArr(range(0, ROWS), "r", row) } },
  ];
})();
