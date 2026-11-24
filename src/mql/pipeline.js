// Assembles all stages into the single per-tick update pipeline.
import { stageInputMove } from "./stageInputMove.js";
import { stageRaycast } from "./stageRaycast.js";
import { stagePickups } from "./stagePickups.js";
import { stageProjectiles } from "./stageProjectiles.js";
import { stageBarrels } from "./stageBarrels.js";
import { stageCombatAI } from "./stageCombatAI.js";
import { stageSprites } from "./stageSprites.js";
import { stageHudFrame } from "./stageHudFrame.js";

const clamp1 = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Coerce arbitrary input into the exact scalar shape the pipeline accepts. */
export function sanitizeInput(raw = {}) {
  return {
    forward: clamp1(Number(raw.forward) || 0),
    strafe: clamp1(Number(raw.strafe) || 0),
    turn: clamp1(Number(raw.turn) || 0),
    shoot: !!raw.shoot,
    use: !!raw.use,
  };
}

export function buildTickPipeline(rawInput, { stages = Infinity } = {}) {
  const input = sanitizeInput(rawInput);
  const parts = [stageInputMove(input), stageRaycast(), stagePickups(), stageProjectiles(), stageCombatAI(input), stageBarrels(), stageSprites(), stageHudFrame()];
  return parts.slice(0, stages).flat();
}

export const TICK_OPTIONS = { returnDocument: "after", projection: { _id: 0, frame: 1 } };
