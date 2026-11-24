// Stage 5: weapon animation, Doomguy face, screen flash, wire-format frame; strips transient fields.
import { add, sub, mul, abs, cos, sin, max, round, gt, gte, lte, and, or, cond, mapArr, lit, seqLet } from "./expr.js";

const C = (k) => `$$c.${k}`;

function weaponSprite(w) {
  return cond(gte(w, 30), "SHTFA0",
    cond(gte(w, 24), "SHTGB0",
      cond(gte(w, 18), "SHTGC0",
        cond(gte(w, 12), "SHTGD0",
          cond(gte(w, 6), "SHTGC0",
            cond(gte(w, 2), "SHTGB0", "SHTGA0"))))));
}

export function stageHudFrame() {
  const columns = mapArr("$_columns", "c", {
    dx: C("dx"), tex: C("tex"), sx: C("sx"), sy: C("sy"), sh: C("sh"), dy: C("dy"), dh: C("dh"),
    shade: cond(gt("$player.muzzleTicks", 0), max(0, round(sub(C("shade"), 0.22), 2)), C("shade")),
  });

  const hud = seqLet(
    [
      ["phase", mul("$tick", 0.35)],
      ["bob", "$player.moving"],
    ],
    {
      weaponSprite: weaponSprite("$player.weaponTicks"),
      weaponDx: cond("$$bob", round(mul(cos("$$phase"), 6)), 0),
      weaponDy: cond("$$bob", round(mul(abs(sin("$$phase")), 5)), 0),
      faceSprite: cond(lte("$player.hp", 0), "STFDEAD0",
        cond(gt("$player.hurtTicks", 0), "STFOUCH0",
          cond(gte("$player.weaponTicks", 26), "STFKILL0", "STFST00"))),
      hp: "$player.hp", ammo: "$player.ammo", kills: "$player.kills",
      screenFlashRgba: cond(gt("$player.hurtTicks", 0), lit("rgba(180,0,0,0.32)"),
        cond(gt("$player.muzzleTicks", 0), lit("rgba(255,220,140,0.16)"), lit("rgba(0,0,0,0)"))),
    }
  );

  return [
    { $set: { frame: { tick: "$tick", columns, sprites: "$_sprites", hud } } },
    { $unset: ["_cam", "_columns", "_sprites"] },
  ];
}
