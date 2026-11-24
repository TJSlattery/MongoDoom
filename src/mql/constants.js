// Shared numeric constants for the MQL stages, the seeder and the tests.
// Whole E1M1 at 32 units/cell (143x88 cells) plus a solid margin. index = row * GRID_W + col
export const GRID_W = 148;
export const GRID_H = 96;
export const CELL_UNITS = 32;
export const COLS = 160;
export const VIEW_H = 168;
export const HORIZON = 84;
export const MAX_STEPS = 256; // worst-case DDA length is about GRID_W + GRID_H = 244
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
export const EYE_UNITS = 41; // eye height above the floor, in Doom units
export const PX_PER_UNIT = WALL_PX / 128; // screen pixels per world unit at distance 1 cell
export const STEP_UP = 32; // Doom allows 24 per step, but a 32-unit cell can hold a 4-step flight (8 each), so the cell-resolution limit is 32
export const HEADROOM = 56; // min ceiling clearance
export const Z_SPEED = 6; // eye-height smoothing, units per tick
export const FLAT_RH = 1; // floor/ceiling texel rows are this many pixels tall (1 = full resolution)
export const PROJ_SPEED = 0.365; // imp fireball, cells/tick (Doom: 10 units/tic at 35 Hz)
export const PROJ_Z = 32; // fireball height above the shooter's floor, units
export const PROJ_R = 0.55; // fireball hit radius against the player, cells
export const BLAST_UNITS = 128; // barrel explosion radius and peak damage
export const SKY_U = 162.97466; // sky columns per radian (1024 columns per turn, 256 wide texture)
export const DOOR_SPEED = 3; // door opening speed, world units per tick (Doom: ~2.3 at 30 Hz; slightly brisker feels better)
export const DOOR_REACH = [0.7, 1.2, 1.7, 2.05]; // cells ahead of the player that the use key checks, nearest first (Doom: 64 units = 2 cells)
