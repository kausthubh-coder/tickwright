/** Fixed ticks are shared by prediction and the authoritative server. */
export const TICKS_PER_SECOND = 20;
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;

/** Serializable generator state makes save/reload and input replay reproducible. */
export function nextRandom(state: { seed: number }): number {
  let value = state.seed | 0;
  if (value === 0) value = 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.seed = value >>> 0;
  return state.seed / 4294967296;
}
