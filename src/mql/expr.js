// Composable JS-to-MQL expression macros. Every helper returns a plain MQL expression object.
// Strings starting with "$" are field paths / variables; use lit() for string literals.
import { GRID } from "./constants.js";

export const lit = (v) => ({ $literal: v });
export const v = (name) => "$$" + name;
export const f = (path) => "$" + path;

// arithmetic
export const add = (...a) => ({ $add: a });
export const sub = (a, b) => ({ $subtract: [a, b] });
export const mul = (...a) => ({ $multiply: a });
export const div = (a, b) => ({ $divide: [a, b] });
export const mod = (a, b) => ({ $mod: [a, b] });
export const abs = (a) => ({ $abs: a });
export const floor = (a) => ({ $floor: a });
export const sin = (a) => ({ $sin: a });
export const cos = (a) => ({ $cos: a });
export const sqrt = (a) => ({ $sqrt: a });
export const min = (...a) => ({ $min: a });
export const max = (...a) => ({ $max: a });
export const round = (a, place = 0) => ({ $round: [a, place] });

// logic
export const eq = (a, b) => ({ $eq: [a, b] });
export const ne = (a, b) => ({ $ne: [a, b] });
export const gt = (a, b) => ({ $gt: [a, b] });
export const gte = (a, b) => ({ $gte: [a, b] });
export const lt = (a, b) => ({ $lt: [a, b] });
export const lte = (a, b) => ({ $lte: [a, b] });
export const and = (...a) => ({ $and: a });
export const or = (...a) => ({ $or: a });
export const not = (a) => ({ $not: [a] });
export const cond = (i, t, e) => ({ $cond: [i, t, e] });

// variables & arrays
export const letVars = (vars, inExpr) => ({ $let: { vars, in: inExpr } });
export const arrAt = (arr, idx) => ({ $arrayElemAt: [arr, idx] });
export const sizeArr = (arr) => ({ $size: arr });
export const range = (start, end) => ({ $range: [start, end] });
export const mapArr = (input, as, inExpr) => ({ $map: { input, as, in: inExpr } });
export const filterArr = (input, as, condExpr) => ({ $filter: { input, as, cond: condExpr } });
export const reduceArr = (input, initialValue, inExpr) => ({ $reduce: { input, initialValue, in: inExpr } });
export const sortArr = (input, sortBy) => ({ $sortArray: { input, sortBy } });
export const sumArr = (arr) => ({ $sum: arr });
export const minArr = (arr) => ({ $min: arr });
export const allTrue = (arr) => ({ $allElementsTrue: [arr] });

// domain macros
export const clamp = (val, lo, hi) => max(lo, min(hi, val));
export const sgn = (d) => cond(gte(d, 0), 1, -1);

/** Grid lookup with clamped indices (the outer ring is always solid, so clamping is safe). */
export const cellAt = (mapExpr, xExpr, yExpr) =>
  arrAt(mapExpr, add(mul(clamp(floor(yExpr), 0, GRID - 1), GRID), clamp(floor(xExpr), 0, GRID - 1)));

/** |1/d| that never divides by zero (axis-aligned rays). */
export const safeInvAbs = (d) => cond(lt(abs(d), 0.000001), 1000000, abs(div(1, d)));

/** Deterministic pseudo-random in [0,1); intermediates stay < 4.6e12 (exact in doubles). */
export const mqlRand = (tickExpr, saltExpr) =>
  div(mod(add(mul(mod(tickExpr, 4096), 1103515245), add(12345, mul(saltExpr, 7919))), 65536), 65536);

/** True when every sampled interior point of the segment (x0,y0)->(x1,y1) lies in an open (0) cell. */
export const lineOfSight = (mapExpr, x0, y0, x1, y1, samples, varName = "s") =>
  allTrue(
    mapArr(range(1, samples), varName,
      eq(cellAt(mapExpr,
        add(x0, mul(sub(x1, x0), div(v(varName), samples))),
        add(y0, mul(sub(y1, y0), div(v(varName), samples)))), 0))
  );

/** Sequential let: pairs are [name, expr] and later expressions may use earlier names via v(name). */
export const seqLet = (pairs, body) =>
  pairs.reduceRight((acc, [name, expr]) => letVars({ [name]: expr }, acc), body);

export const mergeObjects = (...a) => ({ $mergeObjects: a });
