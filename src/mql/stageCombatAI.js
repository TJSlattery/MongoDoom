// Stage 3: hitscan shotgun (nearest target only, range-scaled pellets), enemy wake/chase/attack AI.
import {
  add, sub, mul, div, not, abs, floor, sqrt, max, min, gt, gte, lt, lte, eq, and, or, cond, clamp, sgn, cellAt,
  arrAt, sizeArr, mapArr, filterArr, sumArr, minArr, seqLet, mergeObjects, mqlRand, lineOfSight,
} from "./expr.js";
import {
  ENEMY_SPEED, ENEMY_R, SHOTGUN_TICKS, MUZZLE_TICKS, LOS_SAMPLES, LOS_RANGE, FOV_PLANE,
} from "./constants.js";

const E = (k) => `$$e.${k}`;

export function stageCombatAI(input) {
  const canFire = and(!!input.shoot, eq("$player.weaponTicks", 0), gt("$player.ammo", 0), gt("$player.hp", 0));

  // camera-space projection of an enemy relative to the player: forward distance `ty`, lateral offset `lat` (cells)
  const projection = [
    ["relX", sub(E("x"), "$player.x")],
    ["relY", sub(E("y"), "$player.y")],
    ["dist", max(0.1, sqrt(add(mul("$$relX", "$$relX"), mul("$$relY", "$$relY"))))],
    ["ty", add(mul("$_cam.dirX", "$$relX"), mul("$_cam.dirY", "$$relY"))],
    ["lat", sub(mul("$_cam.dirX", "$$relY"), mul("$_cam.dirY", "$$relX"))],
  ];
  const isCandidate = (centerDist) =>
    and("$$canFire", gt(E("hp"), 0), gt("$$ty", 0.2), lt("$$ty", centerDist), lt(abs("$$lat"), add(0.45, mul(0.06, "$$ty"))));

  const foes = seqLet(
    [
      ["canFire", canFire],
      ["centerDist", arrAt("$_columns.perpDist", 80)],
      ["tick", "$tick"],
      ["cands", mapArr("$enemies", "e", seqLet(projection, cond(isCandidate("$$centerDist"), "$$ty", 1e9)))],
      ["nearTy", minArr("$$cands")],
    ],
    mapArr("$enemies", "e",
      seqLet(
        [
          ...projection,
          ["hit", and(isCandidate("$$centerDist"), eq("$$ty", "$$nearTy"))],
          ["pellets", clamp(floor(sub(9, mul(0.35, "$$dist"))), 2, 7)],
          ["perPellet", mul(5, add(1, floor(mul(mqlRand("$$tick", E("id")), 3))))],
          ["hp1", cond("$$hit", max(0, sub(E("hp"), mul("$$pellets", "$$perPellet"))), E("hp"))],
          ["hurt1", cond("$$hit", 4, max(0, sub(E("hurtTicks"), 1)))],
          ["alive1", gt("$$hp1", 0)],
          ["los", and(lt("$$dist", LOS_RANGE), lineOfSight("$map", E("x"), E("y"), "$player.x", "$player.y", LOS_SAMPLES))],
          ["awake1", or(E("awake"), "$$hit", "$$los", and("$$canFire", lt("$$dist", 12)))],
          ["chase", and("$$alive1", "$$awake1", eq("$$hurt1", 0), gt("$$dist", 1.2))],
          ["candX", add(E("x"), mul(div(sub("$player.x", E("x")), "$$dist"), ENEMY_SPEED))],
          ["candY", add(E("y"), mul(div(sub("$player.y", E("y")), "$$dist"), ENEMY_SPEED))],
          ["nx", cond(and("$$chase", eq(cellAt("$map", add("$$candX", mul(sgn(sub("$player.x", E("x"))), ENEMY_R)), E("y")), 0)), "$$candX", E("x"))],
          ["ny", cond(and("$$chase", eq(cellAt("$map", "$$nx", add("$$candY", mul(sgn(sub("$player.y", E("y"))), ENEMY_R))), 0)), "$$candY", E("y"))],
          // reaction delay: a monster that just noticed the player waits 15-44 ticks before its first attack
          ["woke", and("$$awake1", not(E("awake")))],
          ["atk0", cond("$$woke", add(15, floor(mul(mqlRand(mul("$$tick", 29), add(E("id"), 211)), 30))), max(0, sub(E("attackTicks"), 1)))],
          ["canAttack", and("$$alive1", "$$awake1", "$$los", eq("$$atk0", 0), eq("$$hurt1", 0), gt("$player.hp", 0))],
          ["melee", and("$$canAttack", lt("$$dist", 1.5))],
          ["ranged", and("$$canAttack", gte("$$dist", 1.5), lt("$$dist", 18), lt(mqlRand(mul("$$tick", 13), add(E("id"), 3)), 0.04))],
          // decorrelated from the attack trigger (different tick multiplier), otherwise damage is constant
          ["roll", mqlRand(mul("$$tick", 37), add(E("id"), 100))],
          // instant-hit "fireball" stands in for a dodgeable projectile: accuracy falls off with distance
          ["rangedHit", lt(mqlRand(mul("$$tick", 53), add(E("id"), 7)), max(0.2, sub(0.7, mul(0.03, "$$dist"))))],
          ["dealt", cond("$$melee", mul(3, add(1, floor(mul("$$roll", 8)))),
            cond(and("$$ranged", "$$rangedHit"), mul(3, add(1, floor(mul("$$roll", 3)))), 0))],
        ],
        {
          id: E("id"), x: "$$nx", y: "$$ny", hp: "$$hp1", hurtTicks: "$$hurt1",
          attackTicks: cond(or("$$melee", "$$ranged"), 35, "$$atk0"),
          swingTicks: cond(or("$$melee", "$$ranged"), 10, max(0, sub({ $ifNull: [E("swingTicks"), 0] }, 1))), awake: "$$awake1", dealt: "$$dealt",
        }
      ))
  );

  return [
    {
      $set: {
        player: mergeObjects("$player", {
          weaponTicks: cond(canFire, SHOTGUN_TICKS, "$player.weaponTicks"),
          muzzleTicks: cond(canFire, MUZZLE_TICKS, "$player.muzzleTicks"),
          ammo: cond(canFire, sub("$player.ammo", 1), "$player.ammo"),
        }),
        _foes: foes,
      },
    },
    {
      $set: {
        player: seqLet(
          [["dealt", sumArr("$_foes.dealt")]],
          mergeObjects("$player", {
            hp: max(0, sub("$player.hp", "$$dealt")),
            hurtTicks: cond(gt("$$dealt", 0), 4, "$player.hurtTicks"),
            kills: sizeArr(filterArr("$_foes", "e", lte(E("hp"), 0))),
          })
        ),
        enemies: mapArr("$_foes", "e", {
          id: E("id"), x: E("x"), y: E("y"), hp: E("hp"), hurtTicks: E("hurtTicks"), attackTicks: E("attackTicks"), swingTicks: E("swingTicks"), awake: E("awake"),
        }),
      },
    },
    { $unset: "_foes" },
  ];
}
