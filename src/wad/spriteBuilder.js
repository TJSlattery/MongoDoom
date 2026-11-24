// Imp sprites (64x64 floor-anchored), weapon frames (320x168 canvases), HUD images.
import { decodePicture, blank, blit, toDataUrl } from "./pictureDecoder.js";

export const IMP_FRAMES = ["TROOA1", "TROOB1", "TROOC1", "TROOD1", "TROOF1", "TROOH1", "TROOK0", "TROOM0"];
export const WEAPON_FRAMES = ["SHTGA0", "SHTGB0", "SHTGC0", "SHTGD0", "SHTFA0"];
export const HUD_IMAGES = ["STBAR", "STFST00", "STFOUCH0", "STFKILL0", "STFDEAD0"];

/** 64x64 canvas = 64x64 world units; Doom's sprite origin lands at canvas (32, 64) = floor line. */
export function buildImp(wad, name, palette) {
  const pic = decodePicture(wad.lump(name), palette);
  const canvas = blank(64, 64);
  blit(canvas, pic, 32 - pic.leftOfs, 64 - pic.topOfs);
  return canvas;
}

/** Weapon sprite at Doom's native screen position, clipped to the 320x168 3D view. */
function weaponLayer(wad, name, palette) {
  const pic = decodePicture(wad.lump(name), palette);
  const canvas = blank(320, 168);
  // Doom (R_DrawPSprite): x = 160 + (1 - 160 - leftOfs) = 1 - leftOfs. Vertically the weapon is centered on
  // BASEYCENTER (100) but the view is centered at viewheight/2 = 84 with a status bar, so y = 16 - topOfs.
  blit(canvas, pic, 1 - pic.leftOfs, 16 - pic.topOfs);
  return canvas;
}

export function buildWeapon(wad, name, palette) {
  const base = weaponLayer(wad, "SHTGA0", palette);
  if (name === "SHTGA0") return base;
  if (name === "SHTFA0") { // muzzle flash composited over the idle gun
    blit(base, weaponLayer(wad, "SHTFA0", palette), 0, 0);
    return base;
  }
  return weaponLayer(wad, name, palette);
}

export function buildHud(wad, name, palette) {
  const pic = decodePicture(wad.lump(name), palette);
  return pic;
}

export function buildSpritePack(wad, palette) {
  const sprites = {};
  for (const n of IMP_FRAMES) sprites[n] = toDataUrl(buildImp(wad, n, palette));
  for (const n of WEAPON_FRAMES) sprites[n] = toDataUrl(buildWeapon(wad, n, palette));
  const hud = {};
  for (const n of HUD_IMAGES) hud[n] = toDataUrl(buildHud(wad, n, palette));
  return { sprites, hud };
}
