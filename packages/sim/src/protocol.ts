import { Section, encodeSection, decodeSection, sectionKey } from "./section";
import { ENGINE } from "./codex/engine";
import type { World, Player } from "./world";
import { heightAt } from "./terrain";

const MAGIC = 0x325754;
const emptySection = new Section();
function encodeLight(values: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < values.length;) {
    let end = i + 1;
    while (end < values.length && values[end] === values[i] && end - i < 65535) end++;
    out.push((end - i) & 255, (end - i) >> 8, values[i]); i = end;
  }
  return Uint8Array.from(out);
}
function decodeLight(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(32768); let cursor = 0;
  if (bytes.length % 3) throw new Error("Truncated light run");
  for (let i = 0; i < bytes.length; i += 3) {
    const length = bytes[i] | (bytes[i + 1] << 8);
    if (!length || cursor + length > result.length) throw new Error("Invalid light run");
    result.fill(bytes[i + 2], cursor, cursor + length); cursor += length;
  }
  if (cursor !== result.length) throw new Error("Incomplete light field");
  return result;
}
export interface SectionPacket { type: "section"; cx: number; sy: number; cz: number; revision: number; section: Section; light: Uint8Array }
export interface LodPacket { type: "lod"; cx: number; cz: number; heights: Uint16Array }
export function encodeSectionPacket(w: World, cx: number, sy: number, cz: number): ArrayBuffer {
  const section = encodeSection(w.sections.get(sectionKey(cx, sy, cz)) ?? emptySection);
  const values = w.light.columns.get(`${cx},${cz}`)?.values.subarray(sy * 32768, (sy + 1) * 32768) ?? new Uint8Array(32768);
  const light = encodeLight(values), bytes = new Uint8Array(24 + section.length + light.length), view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true); view.setUint8(4, 1); view.setInt16(6, cx, true); view.setInt16(8, cz, true); view.setUint8(10, sy);
  view.setUint32(12, w.revision, true); view.setUint32(16, section.length, true); view.setUint32(20, light.length, true);
  bytes.set(section, 24); bytes.set(light, 24 + section.length);
  return bytes.buffer;
}
export function encodeLodPacket(w: World, cx: number, cz: number): ArrayBuffer {
  const bytes = new Uint8Array(174), view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true); view.setUint8(4, 2); view.setInt16(6, cx, true); view.setInt16(8, cz, true);
  for (let z = 0; z <= 8; z++) for (let x = 0; x <= 8; x++) {
    const wx = cx * 32 + x * ENGINE.lodStride, wz = cz * 32 + z * ENGINE.lodStride;
    let top = Math.max(w.mode === "flat" ? 0 : ENGINE.seaLevel, heightAt(w.seed, w.mode, wx, wz)) + 1;
    if (w.columns.has(`${wx >> 5},${wz >> 5}`)) { top = 192; while (top > 0 && !w.peek(wx, top - 1, wz)) top--; }
    view.setUint16(12 + (z * 9 + x) * 2, top, true);
  }
  return bytes.buffer;
}
export function decodePacket(buffer: ArrayBuffer): SectionPacket | LodPacket {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error("Invalid chunk packet");
  const cx = view.getInt16(6, true), cz = view.getInt16(8, true);
  if (cx < -32 || cx >= 32 || cz < -32 || cz >= 32) throw new Error("Invalid column");
  if (view.getUint8(4) === 2) {
    if (buffer.byteLength !== 174) throw new Error("Invalid LOD packet");
    return { type: "lod", cx, cz, heights: Uint16Array.from({ length: 81 }, (_, i) => view.getUint16(12 + i * 2, true)) };
  }
  if (view.getUint8(4) !== 1 || buffer.byteLength < 24) throw new Error("Unknown chunk packet");
  const sy = view.getUint8(10), size = view.getUint32(16, true), lightSize = view.getUint32(20, true);
  if (sy >= 6 || 24 + size + lightSize !== buffer.byteLength) throw new Error("Invalid section length");
  return { type: "section", cx, cz, sy, revision: view.getUint32(12, true), section: decodeSection(new Uint8Array(buffer, 24, size)), light: decodeLight(new Uint8Array(buffer, 24 + size, lightSize)) };
}
export function applySectionPacket(w: World, p: SectionPacket) {
  const key = sectionKey(p.cx, p.sy, p.cz), previous = w.sections.get(key);
  p.section.revision = p.revision;
  if (p.section.nonAir) w.sections.set(key, p.section); else w.sections.delete(key);
  let column = w.light.columns.get(`${p.cx},${p.cz}`);
  if (!column) { column = { values: new Uint8Array(196608), top: new Int16Array(1024).fill(-1) }; w.light.columns.set(`${p.cx},${p.cz}`, column); }
  column.values.set(p.light, p.sy * 32768);
  if (previous || p.section.nonAir) w.meshDirty.add(key);
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) w.meshDirty.add(sectionKey(p.cx + dx, p.sy + dy, p.cz + dz));
}
export type PlayerDelta = { id: string } & Partial<Player>;
export interface Snapshot { type: "state"; tick: number; revision: number; players: PlayerDelta[]; removed: string[]; online: number; save: string }
export function entityDelta(players: Player[], viewer: Player, previous: Map<string, Player>): { players: PlayerDelta[]; removed: string[] } {
  const visible = players.filter(p => p.id === viewer.id || Math.hypot(p.x - viewer.x, p.y - viewer.y, p.z - viewer.z) <= ENGINE.interestRadius);
  const ids = new Set(visible.map(p => p.id)), removed = [...previous.keys()].filter(id => !ids.has(id));
  for (const id of removed) previous.delete(id);
  const changes: PlayerDelta[] = [];
  for (const p of visible) {
    const before = previous.get(p.id);
    if (!before) changes.push(structuredClone(p));
    else {
      const patch: Record<string, unknown> = { id: p.id };
      for (const key of Object.keys(p) as (keyof Player)[]) if (JSON.stringify(p[key]) !== JSON.stringify(before[key])) patch[key] = p[key];
      if (Object.keys(patch).length > 1) changes.push(patch as PlayerDelta);
    }
    previous.set(p.id, structuredClone(p));
  }
  return { players: changes, removed };
}
