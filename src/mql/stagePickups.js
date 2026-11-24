// Stage 3b: item pickups. Each item carries its own effect data, so the pipeline has no per-type logic:
//   hp/hpCap, ar/arCap/arAbs (armor points, cap, fraction of damage absorbed), am/amCap (shells).
// An item is taken only if it would change something (Doom: no medikit at full health, no armor if already >= cap).
import {
  add, sub, mul, lt, gt, and, or, not, cond, max, min, mapArr, filterArr, reduceArr, sqrt, seqLet, mergeObjects, sizeArr,
} from "./expr.js";

const IT = (k) => `$$p.it.${k}`;
const items = { $ifNull: ["$items", []] };

export function stagePickups() {
  const near = seqLet(
    [["dx", sub(IT("x"), "$player.x")], ["dy", sub(IT("y"), "$player.y")]],
    lt(add(mul("$$dx", "$$dx"), mul("$$dy", "$$dy")), 0.64)
  );
  const useful = or(
    and(gt(IT("hp"), 0), lt("$player.hp", IT("hpCap"))),
    and(gt(IT("ar"), 0), lt({ $ifNull: ["$player.armor", 0] }, IT("arCap"))),
    and(gt(IT("am"), 0), lt("$player.ammo", IT("amCap"))),
    and(gt(IT("bu"), 0), lt({ $ifNull: ["$player.bullets", 0] }, IT("buCap")))
  );
  return [
    {
      $set: {
        _pick: mapArr(items, "it", {
          it: "$$it",
        }),
      },
    },
    {
      $set: {
        _pick: mapArr("$_pick", "p", {
          it: "$$p.it",
          ok: and(not("$$p.it.taken"), gt("$player.hp", 0), near, useful),
        }),
      },
    },
    {
      $set: {
        player: seqLet(
          [[
            "res",
            reduceArr(
              filterArr("$_pick", "p", "$$p.ok"),
              { hp: "$player.hp", armor: { $ifNull: ["$player.armor", 0] }, abs: { $ifNull: ["$player.armorAbs", 0] }, ammo: "$player.ammo", bullets: { $ifNull: ["$player.bullets", 0] }, n: 0 },
              seqLet(
                [["p", "$$this"], ["v", "$$value"]],
                {
                  hp: cond(gt(IT("hp"), 0), min(IT("hpCap"), add("$$v.hp", IT("hp"))), "$$v.hp"),
                  armor: cond(gt(IT("ar"), 0), min(IT("arCap"), add("$$v.armor", IT("ar"))), "$$v.armor"),
                  abs: cond(gt(IT("ar"), 0), max("$$v.abs", IT("arAbs")), "$$v.abs"),
                  ammo: cond(gt(IT("am"), 0), min(IT("amCap"), add("$$v.ammo", IT("am"))), "$$v.ammo"),
                  bullets: cond(gt(IT("bu"), 0), min(IT("buCap"), add("$$v.bullets", IT("bu"))), "$$v.bullets"),
                  n: add("$$v.n", 1),
                }
              )
            ),
          ]],
          mergeObjects("$player", {
            hp: "$$res.hp", armor: "$$res.armor", armorAbs: "$$res.abs", ammo: "$$res.ammo", bullets: "$$res.bullets",
            bonusTicks: cond(gt("$$res.n", 0), 4, max(0, sub({ $ifNull: ["$player.bonusTicks", 0] }, 1))),
          })
        ),
        items: mapArr("$_pick", "p", mergeObjects("$$p.it", { taken: or("$$p.it.taken", "$$p.ok") })),
      },
    },
    { $unset: "_pick" },
  ];
}
