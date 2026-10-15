import { ENGINE, BLOCKS, solid } from "./codex/engine";
import { Section, SectionMap, gridIndex, sectionKey, columnKey, cellIndex, encodeSection, decodeSection } from "./section";
import { generateColumnSteps, heightAt, type WorldMode } from "./terrain";
import { Lighting } from "./light";
export { BLOCKS } from "./codex/engine";
export { lightAt } from "./light";
export const SIZE_X = 2048, SIZE_Y = 192, SIZE_Z = 2048, MIN_X = -1024, MIN_Z = -1024;
export interface SavedSection { key: string; revision: number; data: number[] }
export interface WorldMeta { version: 2; seed: number; mode: WorldMode; tick: number; revision: number; scheduled: ScheduledTick[]; nextOrder: number }
export interface ScheduledTick { due: number; order: number; x: number; y: number; z: number; kind: string }
export interface WorldSave { meta: WorldMeta; sections: SavedSection[] }
export interface Body { x: number; y: number; z: number; vy: number; grounded: boolean }
export interface Player extends Body {
  id: string; name: string; color: number; ack: number; facingX: number; facingZ: number;
  coyote: number; jumpBuffer: number; inventory: Record<string, number>; progress: { insight: number; arts: string[] };
}
export interface Input { x: number; z: number; jump: boolean; sprint: boolean; seq: number }
export const idleInput = (): Input => ({ x: 0, z: 0, jump: false, sprint: false, seq: 0 });
export const inBounds = (x: number, y: number, z: number) => x >= MIN_X && x < 1024 && z >= MIN_Z && z < 1024 && y >= 0 && y < SIZE_Y;

export class World {
  readonly version = 2;
  autoGenerate = true;
  tick = 0;
  revision = 0;
  nextOrder = 0;
  scheduled: ScheduledTick[] = [];
  sections = new SectionMap();
  columns = new Set<string>();
  dirty = new Map<string, number>();
  modified = new Set<string>();
  meshDirty = new Set<string>();
  lightChanged = new Set<string>();
  activeColumns = new Set<string>();
  anchors = new Set<string>();
  overlays = new Map<string, SavedSection>();
  readonly light = new Lighting(this);
  constructor(readonly seed = 19283, readonly mode: WorldMode = "meadows", readonly generate = true) {}
  ensureColumn(cx: number, cz: number) {
    for (const _ of this.columnSteps(cx,cz)) { /* synchronous simulation/test caller */ }
  }
  async ensureColumnAsync(cx: number, cz: number) {
    // Worker CPU clocks can be frozen between I/O operations. Yield by work units.
    let stage=0;
    for (const _ of this.columnSteps(cx,cz)) if (++stage%4===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  private *columnSteps(cx: number, cz: number): Generator<void> {
    const key = columnKey(cx, cz);
    if (!this.generate || this.columns.has(key) || cx < -32 || cx >= 32 || cz < -32 || cz >= 32) return;
    const generated = yield* generateColumnSteps(this.seed, this.mode, cx, cz);
    for (let sy = 0; sy < 6; sy++) {
      const sk = sectionKey(cx, sy, cz), saved = this.overlays.get(sk);
      const section = saved ? decodeSection(Uint8Array.from(saved.data)) : generated.get(sy);
      if (section) {
        section.revision = saved?.revision ?? 0;
        if (section.nonAir) this.sections.set(sk, section);
      }
      this.meshDirty.add(sk);
    }
    this.columns.add(key);
    yield* this.light.initializeSteps(cx, cz);
  }
  /** No generation side effects: lighting and meshing use this accessor. */
  peek(x: number, y: number, z: number): number {
    if (y >= SIZE_Y) return 0;
    if (!inBounds(x, y, z)) return 2; // The Null and bedrock are solid boundaries.
    return this.sections.grid[gridIndex(x >> 5, y >> 5, z >> 5)]?.get(cellIndex(x & 31, y & 31, z & 31)) ?? 0;
  }
}
export function createWorld(seed = 19283, mode: WorldMode = "meadows", generate = true) { return new World(seed, mode, generate); }
export function blockAt(w: World, x: number, y: number, z: number) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  if (inBounds(x, y, z)) {
    if (w.autoGenerate) w.ensureColumn(x >> 5, z >> 5);
    else if (!w.columns.has(columnKey(x >> 5,z >> 5))) return 2;
  }
  return w.peek(x, y, z);
}
export function setBlock(w: World, x: number, y: number, z: number, state: number): boolean {
  if (![x, y, z].every(Number.isInteger) || !inBounds(x, y, z)) return false;
  w.ensureColumn(x >> 5, z >> 5);
  const key = sectionKey(x >> 5, y >> 5, z >> 5);
  let section = w.sections.get(key);
  if (!section) { if (!state) return false; section = new Section(); w.sections.set(key, section); }
  if (!section.set(cellIndex(x & 31, y & 31, z & 31), state)) return false;
  w.revision++;
  section.revision = w.revision;
  w.dirty.set(key, w.revision); w.modified.add(key); w.meshDirty.add(key);
  // Empty edited sections remain tombstones in the save, but allocate no blocks.
  if (!section.nonAir) w.sections.delete(key);
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
    w.meshDirty.add(sectionKey((x + dx) >> 5, (y + dy) >> 5, (z + dz) >> 5));
  w.light.edited(x, y, z);
  return true;
}
export function worldMeta(w: World): WorldMeta {
  return { version: 2, seed: w.seed, mode: w.mode, tick: w.tick, revision: w.revision, scheduled: w.scheduled.map(v => ({ ...v })), nextOrder: w.nextOrder };
}
export function savedSection(w: World, key: string): SavedSection {
  if (!w.columns.has(key.split(",").filter((_, i) => i !== 1).join(",")) && w.overlays.has(key)) return w.overlays.get(key)!;
  return { key, revision: w.dirty.get(key) ?? w.sections.get(key)?.revision ?? w.overlays.get(key)?.revision ?? w.revision, data: Array.from(encodeSection(w.sections.get(key) ?? new Section())) };
}
export function saveWorld(w: World): WorldSave {
  return { meta: worldMeta(w), sections: [...w.modified].sort().map(key => savedSection(w, key)) };
}
export function restoreWorld(save: WorldSave): World {
  const w = createWorld(save.meta.seed, save.meta.mode);
  Object.assign(w, { tick: save.meta.tick, revision: save.meta.revision, scheduled: save.meta.scheduled.map(v => ({ ...v })), nextOrder: save.meta.nextOrder });
  for (const entry of save.sections) { w.overlays.set(entry.key, entry); w.modified.add(entry.key); }
  return w;
}
export function worldHash(w: World, players: Player[] = []): string {
  const text = JSON.stringify({ ...saveWorld(w), players: [...players].sort((a, b) => a.id.localeCompare(b.id)) });
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function createPlayer(id: string, name: string, color: number, w: World): Player {
  let x = 0.5, z = 0.5;
  // Start on dry terrain, with a fixed search order for every seed.
  for (let r = 0; r < 128 && heightAt(w.seed, w.mode, Math.floor(x), Math.floor(z)) < ENGINE.seaLevel && w.mode !== "flat"; r++) x = r + 0.5;
  w.ensureColumn(Math.floor(x / 32), Math.floor(z / 32));
  let y = 191;
  while (y > 0 && !solid(blockAt(w, x, y, z))) y--;
  return { id, name, color, x, y: y + 1, z, vy: 0, grounded: true, ack: 0, facingX: 0, facingZ: -1, coyote: 0, jumpBuffer: 0, inventory: {}, progress: { insight: 0, arts: [] } };
}
export { movePlayer, moveBody, collides, editBlock } from "./movement";
export { stepWorld, spawnReason, simulationColumns } from "./tick";
