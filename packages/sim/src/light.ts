import { emission, opaque, skyScale } from "./codex/engine";
import { columnKey, sectionKey } from "./section";
import type { World } from "./world";

export const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
export interface LightColumn { values: Uint8Array; top: Int16Array }
class LightColumns extends Map<string, LightColumn> {
  grid: (LightColumn | undefined)[] = new Array(4096);
  override set(key: string, value: LightColumn): this {
    const [x,z] = key.split(",").map(Number); this.grid[(z+32)*64+x+32]=value; return super.set(key,value);
  }
  override delete(key: string): boolean {
    const [x,z] = key.split(",").map(Number); this.grid[(z+32)*64+x+32]=undefined; return super.delete(key);
  }
}
const address = (x: number, y: number, z: number) => (y * 2048 + z + 1024) * 2048 + x + 1024;
const inside = (x: number, y: number, z: number) => x >= -1024 && x < 1024 && z >= -1024 && z < 1024 && y >= 0 && y < 192;
const index = (x: number, y: number, z: number) => (y * 32 + (z & 31)) * 32 + (x & 31);

/** Two nibbles per cell. Direct sky is a source; every other edge attenuates by one. */
export class Lighting {
  columns = new LightColumns();
  private queue: number[] = [];
  private queued = new Set<number>();
  constructor(private world: World) {}
  get(x: number, y: number, z: number): number {
    if (y >= 192) return 15;
    if (!inside(x, y, z)) return 0;
    return this.columns.grid[((z>>5)+32)*64+(x>>5)+32]?.values[index(x, y, z)] ?? 0;
  }
  private enqueue(x: number, y: number, z: number) {
    if (!inside(x, y, z) || !this.columns.grid[((z>>5)+32)*64+(x>>5)+32]) return;
    const key = address(x, y, z);
    if (!this.queued.has(key)) { this.queued.add(key); this.queue.push(key); }
  }
  initialize(cx: number, cz: number) { for (const _ of this.initializeSteps(cx,cz)) { /* synchronous test/world path */ } }
  *initializeSteps(cx: number, cz: number): Generator<void> {
    const column: LightColumn = { values: new Uint8Array(192 * 1024), top: new Int16Array(1024).fill(-1) };
    this.columns.set(columnKey(cx, cz), column);
    for (let z = 0; z < 32; z++) { for (let x = 0; x < 32; x++) {
      const wx = cx * 32 + x, wz = cz * 32 + z;
      let open = true;
      for (let y = 191; y >= 0; y--) {
        const state = this.world.peek(wx, y, wz), i = index(wx, y, wz);
        if (opaque(state) && open) { column.top[z * 32 + x] = y; open = false; }
        column.values[i] = (open ? 15 : 0) | (emission(state) << 4);
        if (emission(state)) for (const [dx, dy, dz] of NEIGHBORS) this.enqueue(wx + dx, y + dy, wz + dz);
      }
    } yield; }
    // Seed shade and both sides of a newly loaded boundary. Repeating this converges
    // to the same light field regardless of which adjacent column loaded first.
    for (let z = 0; z < 32; z++) { for (let x = 0; x < 32; x++) {
      const wx = cx * 32 + x, wz = cz * 32 + z, top = column.top[z * 32 + x];
      for (let y = 0; y <= top; y++) if (!opaque(this.world.peek(wx, y, wz))) {
        if (NEIGHBORS.some(([dx, dy, dz]) => this.get(wx + dx, y + dy, wz + dz) !== 0)) this.enqueue(wx, y, wz);
      }
      if (x === 0 || x === 31 || z === 0 || z === 31) for (let y = 0; y < 192; y++) {
        for (const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          if (!(x===0&&dx===-1||x===31&&dx===1||z===0&&dz===-1||z===31&&dz===1)) continue;
          const a=this.get(wx,y,wz), b=this.get(wx+dx,y,wz+dz);
          if (((a&15)>(b&15)+1||(a>>4)>(b>>4)+1)&&!opaque(this.world.peek(wx+dx,y,wz+dz))) this.enqueue(wx+dx,y,wz+dz);
          if (((b&15)>(a&15)+1||(b>>4)>(a>>4)+1)&&!opaque(this.world.peek(wx,y,wz))) this.enqueue(wx,y,wz);
        }
      }
    } yield; }
    yield* this.flushSteps();
  }
  edited(x: number, y: number, z: number) {
    const column = this.columns.get(columnKey(x >> 5, z >> 5));
    if (!column) return;
    const i = (z & 31) * 32 + (x & 31), previous = column.top[i];
    let top = 191;
    while (top >= 0 && !opaque(this.world.peek(x, top, z))) top--;
    column.top[i] = top;
    // Only the edited shaft changes direct-sky sources. The queue handles additions
    // and removals, including competing emitters, without relighting the world.
    for (let sy = Math.min(previous, top) + 1; sy <= Math.max(previous, top); sy++) this.enqueue(x, sy, z);
    this.enqueue(x, y, z);
    for (const [dx, dy, dz] of NEIGHBORS) this.enqueue(x + dx, y + dy, z + dz);
    this.flush();
  }
  flush() { for (const _ of this.flushSteps()) { /* edits finish before the next phase */ } }
  *flushSteps(): Generator<void> {
    for (let cursor = 0; cursor < this.queue.length; cursor++) {
      const key = this.queue[cursor]; this.queued.delete(key);
      const x = key % 2048 - 1024, z = Math.floor(key / 2048) % 2048 - 1024, y = Math.floor(key / 4194304);
      const column = this.columns.grid[((z>>5)+32)*64+(x>>5)+32]!;
      const state = this.world.peek(x, y, z), i = index(x, y, z);
      let sky = 0, block = emission(state);
      if (!opaque(state)) {
        sky = y > column.top[(z & 31) * 32 + (x & 31)] ? 15 : 0;
        for (const [dx, dy, dz] of NEIGHBORS) {
          const neighbor = this.get(x + dx, y + dy, z + dz);
          sky = Math.max(sky, (neighbor & 15) - 1);
          block = Math.max(block, (neighbor >> 4) - 1);
        }
      }
      const value = sky | (block << 4);
      if (column.values[i] === value) continue;
      column.values[i] = value;
      this.world.meshDirty.add(sectionKey(x >> 5, y >> 5, z >> 5));
      this.world.lightChanged.add(columnKey(x >> 5, z >> 5));
      for (const [dx, dy, dz] of NEIGHBORS) this.enqueue(x + dx, y + dy, z + dz);
      if (cursor % 512 === 511) yield;
    }
    this.queue.length = 0;
  }
}
export function lightAt(w: World, x: number, y: number, z: number) {
  w.ensureColumn(x >> 5, z >> 5);
  const packed = w.light.get(Math.floor(x), Math.floor(y), Math.floor(z));
  return { sky: packed & 15, block: packed >> 4, effective: Math.max(packed >> 4, (packed & 15) * skyScale(w.tick)) };
}
