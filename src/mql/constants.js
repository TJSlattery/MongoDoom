// Shared numeric constants for the MQL stages, the seeder and the tests.
export const GRID = 64;
export const CELL_UNITS = 32;
export const COLS = 160;
export const VIEW_H = 168;
export const HORIZON = 84;
export const MAX_STEPS = 128; // true worst-case DDA length on a 64x64 grid is ~126
export const WALL_PX = 806; // 168 * 4.8: 128-unit wall = 4 cells, incl. Doom's 1.2 pixel aspect
export const EYE_FRAC = 0.32; // eye at 41/128 of wall height
export const SPR_PX = 403; // 64-unit sprite canvas height at 1 cell (half a wall)
export const SPR_COLS = 242; // 64-unit sprite canvas half-width in 2px columns at 1 cell
export const FOV_PLANE = 0.66;
export const TURN = 0.11;
export const MOVE = 0.3;
export const STRAFE = 0.25;
export const PLAYER_R = 0.25;
export const ENEMY_SPEED = 0.08;
export const ENEMY_R = 0.3;
export const SHOTGUN_TICKS = 32;
export const MUZZLE_TICKS = 3;
export const LOS_SAMPLES = 24;
export const LOS_RANGE = 24;
export const PLAYER_HP = 100;
export const PLAYER_AMMO = 50;
export const ENEMY_HP = 60;
