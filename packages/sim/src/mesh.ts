import { BLOCK_COLORS, blockId, opaque } from "./codex/engine";
import type { World } from "./world";

export interface MeshData { positions: Float32Array; normals: Float32Array; colors: Float32Array; lights: Float32Array; indices: Uint32Array }
/** Greedy faces merge only when state, face direction and simulation light agree. */
export function meshSection(w: World, cx: number, sy: number, cz: number): MeshData {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], lights: number[] = [], indices: number[] = [];
  const origin = [cx * 32, sy * 32, cz * 32], mask = new Int32Array(1024);
  const get = (p: number[]) => w.peek(origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]);
  const light = (p: number[]) => w.light.get(origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]);
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    for (const sign of [-1, 1]) for (let plane = 0; plane < 32; plane++) {
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
        const p = [0, 0, 0]; p[axis] = plane; p[u] = i; p[v] = j;
        const state = get(p); p[axis] += sign;
        const neighbor = get(p);
        const visible = state !== 0 && !opaque(neighbor) && blockId(neighbor) !== blockId(state);
        const packed = light(p);
        // Preserve the emitter's light on its own surface.
        p[axis] -= sign;
        const own = light(p), combined = Math.max(packed & 15, own & 15) | (Math.max(packed >> 4, own >> 4) << 4);
        mask[j * 32 + i] = visible ? state | (combined << 16) : 0;
      }
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32;) {
        const value = mask[j * 32 + i]; if (!value) { i++; continue; }
        let width = 1, height = 1;
        while (i + width < 32 && mask[j * 32 + i + width] === value) width++;
        outer: while (j + height < 32) {
          for (let k = 0; k < width; k++) if (mask[(j + height) * 32 + i + k] !== value) break outer;
          height++;
        }
        const base = positions.length / 3, hex = BLOCK_COLORS[blockId(value)] ?? 0xff00ff;
        const tint = blockId(value) === 1 && (axis !== 1 || sign < 0) ? [0.57, 0.43, 0.3] : [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
        const packed = value >>> 16;
        for (const [du, dv] of [[0, 0], [width, 0], [width, height], [0, height]]) {
          const p = [...origin]; p[axis] += plane + (sign > 0 ? 1 : 0); p[u] += i + du; p[v] += j + dv;
          positions.push(...p);
          const normal = [0, 0, 0]; normal[axis] = sign; normals.push(...normal);
          colors.push(...tint); lights.push((packed & 15) / 15, (packed >> 4) / 15);
        }
        if (sign > 0) indices.push(base, base+1, base+2, base, base+2, base+3);
        else indices.push(base, base+2, base+1, base, base+3, base+2);
        for (let y = 0; y < height; y++) mask.fill(0, (j+y)*32+i, (j+y)*32+i+width);
        i += width;
      }
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), colors: Float32Array.from(colors), lights: Float32Array.from(lights), indices: Uint32Array.from(indices) };
}
