import { ENGINE } from "./codex/engine";
import { cellIndex, Section } from "./section";
export type WorldMode = "meadows" | "flat";
export function hash(seed: number, x: number, y = 0, z = 0): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const smooth = (v: number) => v * v * (3 - 2 * v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function noise(seed: number, x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  return mix(mix(hash(seed, ix, 0, iz), hash(seed, ix + 1, 0, iz), fx), mix(hash(seed, ix, 0, iz + 1), hash(seed, ix + 1, 0, iz + 1), fx), fz) / 4294967295;
}
export function heightAt(seed: number, mode: WorldMode, x: number, z: number): number {
  if (mode === "flat") return ENGINE.flatHeight - 1;
  return Math.floor(43 + noise(seed, x / 110, z / 110) * 25 + noise(seed + 1, x / 28, z / 28) * 5 - Math.max(0, noise(seed + 2, x / 170, z / 170) - 0.64) * 90);
}
export function* generateColumnSteps(seed: number, mode: WorldMode, cx: number, cz: number): Generator<void, Map<number, Section>> {
  const cells = new Map<number, Uint16Array>();
  const put = (x: number, y: number, z: number, state: number, onlyAir = false) => {
    if (x < 0 || x > 31 || z < 0 || z > 31 || y < 0 || y >= 192) return;
    const sy = y >> 5;
    let data = cells.get(sy);
    if (!data) cells.set(sy, data = new Uint16Array(32768));
    const i = cellIndex(x, y & 31, z);
    if (!onlyAir || !data[i]) data[i] = state;
  };
  for (let z = 0; z < 32; z++) { for (let x = 0; x < 32; x++) {
    const wx = cx * 32 + x, wz = cz * 32 + z, top = heightAt(seed, mode, wx, wz);
    const caveFloor = 12 + Math.floor(noise(seed + 8, wx / 24, wz / 24) * 24);
    const cave = mode !== "flat" && noise(seed + 9, wx / 18, wz / 18) > 0.57;
    for (let y = 0; y <= top; y++) {
      if (cave && y > caveFloor && y < caveFloor + 5 && y < top - 4) continue;
      const state = y === top ? 1 : y > top - 4 ? 6 : mode !== "flat" && y > 1 && y < 35 && hash(seed, wx, y, wz) % 83 === 0 ? 9 : 2;
      put(x, y, z, state);
    }
    if (mode !== "flat") for (let y = top + 1; y <= ENGINE.seaLevel; y++) put(x, y, z, 8);
  } yield; }
  // Sample roots outside the column too: trees crossing borders are load-order independent.
  if (mode !== "flat") for (let z = -2; z < 34; z++) { for (let x = -2; x < 34; x++) {
    const wx = cx * 32 + x, wz = cz * 32 + z;
    if (hash(seed + 17, wx, 0, wz) % 211 !== 0 || Math.abs(wx) < 7 && Math.abs(wz) < 7) continue;
    const y = heightAt(seed, mode, wx, wz);
    if (y <= ENGINE.seaLevel) continue;
    const trunk = 4 + hash(seed + 18, wx, 0, wz) % 3;
    for (let dy = trunk - 2; dy <= trunk + 1; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
      if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy - trunk) < 5) put(x + dx, y + dy, z + dz, 7, true);
    for (let dy = 1; dy <= trunk; dy++) put(x, y + dy, z, 3);
  } yield; }
  const sections = new Map<number, Section>();
  for (const [y,data] of cells) { sections.set(y,Section.fromCells(data)); yield; }
  return sections;
}
export function generateColumn(seed: number, mode: WorldMode, cx: number, cz: number): Map<number, Section> {
  const steps=generateColumnSteps(seed,mode,cx,cz);
  let next=steps.next(); while(!next.done) next=steps.next(); return next.value;
}
