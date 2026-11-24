// Stage 5: weapon animation, Doomguy face, status-bar draw list, screen flash, wire-format frame; strips transient fields.
import { FLAT_RH } from "./constants.js";
import {
  add, sub, mul, div, abs, cos, sin, max, min, round, gt, gte, lte, eq, and, or, cond, mapArr, filterArr, range, lit, seqLet, floor, mod,
  pow, mqlRand, lt,
} from "./expr.js";

const C = (k) => `$$c.${k}`;
const DIGITS = lit(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

function weaponSprite(w) {
  return cond(gte(w, 30), "SHTFA0",
    cond(gte(w, 24), "SHTGB0",
      cond(gte(w, 18), "SHTGC0",
        cond(gte(w, 12), "SHTGD0",
          cond(gte(w, 6), "SHTGC0",
            cond(gte(w, 2), "SHTGB0", "SHTGA0"))))));
}

/** Doom status-bar number: right-aligned at `rightX`, no leading zeros, drawn from `prefix`0..9 patches of width `w`. */
function numDraw(value, rightX, y, prefix, w, n) {
  return seqLet(
    [["v", max(0, min(sub(pow(10, n), 1), value))]],
    mapArr(
      filterArr(range(0, n), "i", or(eq("$$i", 0), gte("$$v", pow(10, "$$i")))),
      "i",
      { s: { $concat: [prefix, arrAt10(div("$$v", pow(10, "$$i")))] }, x: sub(rightX, mul(w, add("$$i", 1))), y }
    )
  );
}
const arrAt10 = (x) => ({ $arrayElemAt: [DIGITS, mod(floor(x), 10)] });

/** Intermission text (Doom's "level finished" screen), shown a moment after the exit switch is pressed. */
function endScreen() {
  const pad2 = (x) => cond(lt(x, 10), { $concat: ["0", { $toString: x }] }, { $toString: x });
  return seqLet(
    [
      ["done", { $ifNull: ["$level.done", false] }],
      ["since", sub("$tick", { $ifNull: ["$level.at", 0] })],
      ["secs", floor(div({ $ifNull: ["$level.at", 0] }, 30))],
      ["kills", { $size: { $filter: { input: "$enemies", as: "e", cond: lte("$$e.hp", 0) } } }],
      ["items", { $size: { $filter: { input: { $ifNull: ["$items", []] }, as: "i", cond: "$$i.taken" } } }],
    ],
    cond(and("$$done", gte("$$since", 20)),
      [
        { s: "E1M1 FINISHED", y: 52 },
        { s: { $concat: ["KILLS  ", { $toString: "$$kills" }, " / ", { $toString: { $size: "$enemies" } }] }, y: 84 },
        { s: { $concat: ["ITEMS  ", { $toString: "$$items" }, " / ", { $toString: { $size: { $ifNull: ["$items", []] } } }] }, y: 100 },
        { s: { $concat: ["TIME  ", { $toString: floor(div("$$secs", 60)) }, ":", pad2(mod("$$secs", 60))] }, y: 116 },
        { s: "PRESS R TO PLAY AGAIN", y: 148 },
      ],
      [])
  );
}

export function stageHudFrame() {
  const columns = mapArr("$_columns", "c", {
    dx: C("dx"),
    f: mapArr(C("f"), "q", { dy: "$$q.dy", dh: "$$q.dh", c: "$$q.c", fl: "$$q.fl", t: "$$q.t", ld: "$$q.ld" }),
    w: mapArr(C("w"), "p", {
      tex: "$$p.tex", sx: "$$p.sx", sy: "$$p.sy", sh: "$$p.sh", dy: "$$p.dy", dh: "$$p.dh",
      shade: cond(gt("$player.muzzleTicks", 0), max(0, round(sub("$$p.shade", 0.22), 2)), "$$p.shade"),
    }),
  });

  const ifn = (path, d = 0) => ({ $ifNull: [path, d] });
  const hp = "$player.hp";
  // pain tier 0 (healthy) .. 4 (nearly dead), as in Doom's status face
  const tier = min(4, floor(div(mul(sub(100, min(100, max(0, hp))), 5), 101)));
  const t = { $toString: "$$tier" };
  const face = seqLet(
    [["tier", tier], ["idle", floor(mul(mqlRand(floor(div("$tick", 15)), 5), 3))]],
    cond(lte(hp, 0), "STFDEAD0",
      cond(gt(hp, 200), "STFGOD0",
        cond(gt("$player.hurtTicks", 2), concat2("STFOUCH", t),
          cond(gt("$player.hurtTicks", 0), cond(gt(ifn("$player.hurtDir"), 0), concat2("STFTR", t, "0"), concat2("STFTL", t, "0")),
            cond(gt(ifn("$player.bonusTicks"), 0), concat2("STFEVL", t),
              cond(gte("$player.weaponTicks", 26), concat2("STFKILL", t),
                concat2("STFST", t, { $toString: "$$idle" })))))))
  );

  const armsSlots = [2, 3, 4, 5, 6, 7].map((n, i) => ({
    s: n === 3 ? "STYSNUM3" : "STGNUM" + n, x: 111 + (i % 3) * 12, y: 172 + (i >= 3 ? 10 : 0), // only the shotgun (slot 3) is owned
  }));
  const ammoRows = [[ifn("$player.bullets"), 200], ["$player.ammo", 100], [0, 50], [0, 300]];

  const hud = seqLet(
    [["phase", mul("$tick", 0.35)], ["bob", "$player.moving"], ["face", face]],
    {
      weaponSprite: weaponSprite("$player.weaponTicks"),
      weaponDx: cond("$$bob", round(mul(cos("$$phase"), 6)), 0),
      weaponDy: cond("$$bob", round(mul(abs(sin("$$phase")), 5)), 0),
      faceSprite: "$$face",
      end: endScreen(),
      hp: hp, armor: ifn("$player.armor"), ammo: "$player.ammo", kills: "$player.kills",
      draw: { $concatArrays: [
        lit([{ s: "STBAR", x: 0, y: 168 }, { s: "STARMS", x: 104, y: 168 }]),
        numDraw("$player.ammo", 44, 171, "STTNUM", 14, 3),
        numDraw(hp, 90, 171, "STTNUM", 14, 3),
        lit([{ s: "STTPRCNT", x: 90, y: 171 }]),
        numDraw(ifn("$player.armor"), 221, 171, "STTNUM", 14, 3),
        lit([{ s: "STTPRCNT", x: 221, y: 171 }]),
        lit(armsSlots),
        ...ammoRows.flatMap(([cur, max_], r) => [numDraw(cur, 288, 173 + r * 6, "STYSNUM", 4, 3), numDraw(max_, 314, 173 + r * 6, "STYSNUM", 4, 3)]),
        [{ s: "$$face", x: 143, y: 168 }],
      ] },
      screenFlashRgba: cond(gt("$player.hurtTicks", 0), lit("rgba(180,0,0,0.32)"),
        cond(gt("$player.muzzleTicks", 0), lit("rgba(255,220,140,0.16)"),
          cond(gt(ifn("$player.bonusTicks"), 0), lit("rgba(220,200,80,0.14)"), lit("rgba(0,0,0,0)")))),
    }
  );

  return [
    { $set: { frame: { tick: "$tick", rh: FLAT_RH, columns, sprites: "$_sprites", hud } } },
    { $unset: ["_cam", "_columns", "_sprites", "_lt"] },
  ];
}

function concat2(...parts) { return { $concat: parts }; }
function arrAt(a, i) { return { $arrayElemAt: [a, i] }; }
