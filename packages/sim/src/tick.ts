import { ENGINE, TICK_PHASES } from "./codex/engine";
import { nextRandom } from "./clock";
import { hash, heightAt } from "./terrain";
import { lightAt } from "./light";
import { columnKey } from "./section";
import { movePlayer } from "./movement";
import { idleInput, type World, type Input, type Player, type ScheduledTick } from "./world";

export function simulationColumns(players: Player[], anchors: Set<string> = new Set()): Set<string> {
  const columns = new Set<string>(anchors);
  for (const p of players) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const x = Math.floor(p.x / 32) + dx, z = Math.floor(p.z / 32) + dz;
    if (x >= -32 && x < 32 && z >= -32 && z < 32) columns.add(columnKey(x, z));
  }
  return new Set([...columns].sort());
}
export interface TickHooks {
  phase?: (phase: typeof TICK_PHASES[number]) => void;
  scheduled?: (tick: ScheduledTick) => void;
  random?: (x: number, y: number, z: number) => void;
  spawn?: (x: number, y: number, z: number, reason: string) => void;
}
export function spawnReason(w: World, x: number, y: number, z: number): string {
  const light = lightAt(w, x, y, z);
  if (light.sky > 0 || light.block > 0) return "Too bright: M1 stub requires light 0";
  return "M1: mob spawning is not enabled";
}
export function scheduleBlock(w: World, tick: Omit<ScheduledTick, "order">) {
  w.scheduled.push({ ...tick, order: w.nextOrder++ });
}
export function stepWorld(w: World, players: Player[], inputs: Map<string, Input>, hooks: TickHooks = {}, edits?: () => void) {
  if (!players.length) return;
  w.tick++;
  w.activeColumns = simulationColumns(players, w.anchors);
  // Terrain is populated by streaming before it is ticked. Tests may eagerly load
  // their fixture columns; unloaded sections never acquire content ticks.
  hooks.phase?.(TICK_PHASES[0]);
  for (const p of players) movePlayer(w, p, inputs.get(p.id) ?? { ...idleInput(), seq: p.ack });
  edits?.();
  hooks.phase?.(TICK_PHASES[1]);
  const due = w.scheduled.filter(t => t.due <= w.tick && w.activeColumns.has(columnKey(t.x >> 5, t.z >> 5))).sort((a, b) => a.order - b.order);
  const orders = new Set(due.map(t => t.order));
  w.scheduled = w.scheduled.filter(t => !orders.has(t.order));
  for (const t of due) hooks.scheduled?.(t);
  hooks.phase?.(TICK_PHASES[2]); // Ley components arrive in M4.
  hooks.phase?.(TICK_PHASES[3]);
  for (const key of w.activeColumns) {
    if (!w.columns.has(key)) continue;
    const [cx, cz] = key.split(",").map(Number), rng = { seed: hash(w.seed, w.tick, cx, cz) };
    for (let sy = 0; sy < 6; sy++) for (let n = 0; n < ENGINE.randomTicks; n++) {
      const x = cx * 32 + Math.floor(nextRandom(rng) * 32), y = sy * 32 + Math.floor(nextRandom(rng) * 32), z = cz * 32 + Math.floor(nextRandom(rng) * 32);
      hooks.random?.(x, y, z);
    }
  }
  hooks.phase?.(TICK_PHASES[4]); // Non-player entities will iterate by creation order.
  hooks.phase?.(TICK_PHASES[5]);
  if (hooks.spawn) for (const key of w.activeColumns) {
    if (!w.columns.has(key)) continue;
    const [cx, cz] = key.split(",").map(Number), rng = { seed: hash(w.seed ^ 0x5a5a, w.tick, cx, cz) };
    const x = cx * 32 + Math.floor(nextRandom(rng) * 32), z = cz * 32 + Math.floor(nextRandom(rng) * 32);
    const y = Math.floor(nextRandom(rng) * (heightAt(w.seed, w.mode, x, z) + 2));
    hooks.spawn(x, y, z, spawnReason(w, x, y, z));
  }
  hooks.phase?.(TICK_PHASES[6]); // Item merge and pickup arrive in M4.
  hooks.phase?.(TICK_PHASES[7]);
  if (w.tick % 20 === 0) { /* Folk schedules and Guardian checks arrive in M5. */ }
}
