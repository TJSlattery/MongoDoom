// Stage 3: hitscan shotgun (nearest target only), enemy wake/chase/attack AI, imp fireball spawning.
import {
  add, sub, mul, div, not, abs, floor, sqrt, atan2, max, min, gt, gte, lt, lte, eq, and, or, cond, clamp, sgn, cellAt, cellSec,
  passableFrom, arrAt, sizeArr, mapArr, filterArr, sumArr, minArr, seqLet, mergeObjects, mqlRand, lineOfSight, mod, lit,
} from "./expr.js";
import { damagePlayer, aimTy } from "./damage.js";
import { ENEMY_SPEED, ENEMY_R, SHOTGUN_TICKS, MUZZLE_TICKS, LOS_SAMPLES, LOS_RANGE, PROJ_SPEED, PROJ_Z } from "./constants.js";

const E = (k) => `$$e.${k}`;
const N = (k, d) => ({ $ifNull: [E(k), d] });

export function stageCombatAI(input) {
  const canFire = and(!!input.shoot, eq("$player.weaponTicks", 0), gt("$player.ammo", 0), gt("$player.hp", 0), not({ $ifNull: ["$level.done", false] }));

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
      // a barrel in front of the nearest enemy takes the shot instead
      ["barNear", minArr(mapArr({ $ifNull: ["$decor", []] }, "d",
        cond(and("$$d.barrel", eq("$$d.boom", 0), gt("$$d.hp", 0)), aimTy("$$d.x", "$$d.y", "$$centerDist"), 1e9)))],
    ],
    mapArr("$enemies", "e",
      seqLet(
        [
          ...projection,
          ["hit", and(isCandidate("$$centerDist"), eq("$$ty", "$$nearTy"), lt("$$ty", "$$barNear"))],
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
          ["esec", cellSec("$map", E("x"), E("y"))],
          ["efz", arrAt("$secF", "$$esec")],
          ["ecz", arrAt("$secC", "$$esec")],
          ["nx", cond(and("$$chase", passableFrom("$map", add("$$candX", mul(sgn(sub("$player.x", E("x"))), ENEMY_R)), E("y"), "$$efz", "$$ecz")), "$$candX", E("x"))],
          ["ny", cond(and("$$chase", passableFrom("$map", "$$nx", add("$$candY", mul(sgn(sub("$player.y", E("y"))), ENEMY_R)), "$$efz", "$$ecz")), "$$candY", E("y"))],
          // reaction delay: a monster that just noticed the player waits 15-44 ticks before its first attack
          ["woke", and("$$awake1", not(E("awake")))],
          ["atk0", cond("$$woke", add(15, floor(mul(mqlRand(mul("$$tick", 29), add(E("id"), 211)), 30))), max(0, sub(E("attackTicks"), 1)))],
          ["canAttack", and("$$alive1", "$$awake1", "$$los", eq("$$atk0", 0), eq("$$hurt1", 0), gt("$player.hp", 0))],
          ["mel", N("mel", true)],
          ["proj", N("proj", true)],
          ["melee", and("$$canAttack", lt("$$dist", 1.5), "$$mel")],
          ["ranged", and("$$canAttack", cond("$$mel", gte("$$dist", 1.5), true), lt("$$dist", 18), lt(mqlRand(mul("$$tick", 13), add(E("id"), 3)), 0.04))],
          // decorrelated from the attack trigger (different tick multiplier), otherwise damage is constant
          ["roll", mqlRand(mul("$$tick", 37), add(E("id"), 100))],
          // humans shoot hitscan bullets whose accuracy falls off with distance; imps throw a fireball instead
          ["rangedHit", lt(mqlRand(mul("$$tick", 53), add(E("id"), 7)), max(0.2, sub(0.7, mul(0.03, "$$dist"))))],
          ["fire", and("$$ranged", "$$proj")],
          ["dealt", cond("$$melee", mul(3, add(1, floor(mul("$$roll", 8)))),
            cond(and("$$ranged", not("$$proj"), "$$rangedHit"), mul(3, add(1, floor(mul("$$roll", 5)))), 0))],
        ],
        {
          id: E("id"), mel: "$$mel", proj: "$$proj", sp: E("sp"), x: "$$nx", y: "$$ny", hp: "$$hp1", hurtTicks: "$$hurt1",
          ang: cond(and("$$alive1", "$$awake1"), atan2(sub("$player.y", E("y")), sub("$player.x", E("x"))), N("ang", 0)),
          deadTicks: cond("$$alive1", 0, add(N("deadTicks", 0), 1)),
          attackTicks: cond(or("$$melee", "$$ranged"), 35, "$$atk0"),
          swingTicks: cond(or("$$melee", "$$ranged"), 10, max(0, sub(N("swingTicks", 0), 1))),
          awake: "$$awake1", dealt: "$$dealt", dirw: mul("$$dealt", sgn("$$lat")),
          shot: "$$fire",
          pvx: mul(div(sub("$player.x", E("x")), "$$dist"), PROJ_SPEED), pvy: mul(div(sub("$player.y", E("y")), "$$dist"), PROJ_SPEED),
          pz: add("$$efz", PROJ_Z),
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
        player: mergeObjects(
          damagePlayer(
            add(sumArr("$_foes.dealt"),
              // nukage: 5 damage every 32 ticks while standing in a damaging sector
              cond(and(eq(arrAt("$secS", "$_cam.sec"), 7), eq(mod("$tick", 32), 0), gt("$player.hp", 0)), 5, 0)),
            sumArr("$_foes.dirw")
          ),
          { kills: sizeArr(filterArr("$_foes", "e", lte(E("hp"), 0))) }
        ),
        enemies: mapArr("$_foes", "e", {
          id: E("id"), mel: E("mel"), proj: E("proj"), sp: E("sp"), x: E("x"), y: E("y"), hp: E("hp"), ang: E("ang"), deadTicks: E("deadTicks"),
          hurtTicks: E("hurtTicks"), attackTicks: E("attackTicks"), swingTicks: E("swingTicks"), awake: E("awake"),
        }),
        projectiles: { $concatArrays: [{ $ifNull: ["$projectiles", []] },
          mapArr(filterArr("$_foes", "e", E("shot")), "e",
            { id: add(mul("$tick", 64), E("id")), x: E("x"), y: E("y"), vx: E("pvx"), vy: E("pvy"), z: E("pz"), age: 0, hit: 0 })] },
      },
    },
    { $unset: "_foes" },
  ];
}
