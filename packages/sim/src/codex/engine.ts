/** M1 choices live here so future Codex/Sight use the simulation's values. */
export const ENGINE = Object.freeze({
  sectionSize: 32, sectionsHigh: 6, worldSize: 2048, worldHeight: 192,
  simulationRadius: 4, viewRadius: 12, detailRadius: 6, interestRadius: 96,
  interpolationMs: 100, sectionSaveTicks: 600, playerSaveTicks: 1200,
  randomTicks: 3, maxPlayers: 8, dayTicks: 24000,
  dayEnd: 16800, duskEnd: 18000, nightEnd: 22800,
  runSpeed: 6.5, sprintSpeed: 9, gravity: 22, jumpHeight: 1.25,
  coyoteTicks: 2, jumpBufferTicks: 3, bodyHeight: 1.75, bodyRadius: 0.3,
  stepHeight: 0.6, reach: 7, seaLevel: 45, flatHeight: 8,
  lodStride: 4, columnsPerStreamTick: 2, inputQueueLimit: 40,
});
export const TICK_PHASES = [
  "Player inputs", "Scheduled block ticks", "Ley settle", "Random ticks",
  "Entities move and think", "Spawning", "Items", "Folk and Guardians",
] as const;
export const BLOCKS = ["Air", "Meadow", "Stone", "Timber", "Lantern", "Glass", "Dirt", "Leaves", "Water", "Ore", "Glowshroom"] as const;
export const BLOCK_COLORS = [0, 0x79a954, 0x889095, 0x976d48, 0xffd477, 0xa3ddd2, 0x917052, 0x508b4b, 0x528ead, 0xba9872, 0x94e2b1];
export const blockId = (state: number) => state & 255;
export const opaque = (state: number) => ![0, 4, 5, 8, 10].includes(blockId(state));
export const solid = (state: number) => ![0, 8, 10].includes(blockId(state));
export const emission = (state: number) => blockId(state) === 4 ? 15 : blockId(state) === 10 ? 7 : 0;
export function skyScale(tick: number): number {
  const t = tick % ENGINE.dayTicks;
  if (t < ENGINE.dayEnd) return 1;
  if (t < ENGINE.duskEnd) return 1 - (t - ENGINE.dayEnd) / 1200 * (11 / 15);
  if (t < ENGINE.nightEnd) return 4 / 15;
  return 4 / 15 + (t - ENGINE.nightEnd) / 1200 * (11 / 15);
}
