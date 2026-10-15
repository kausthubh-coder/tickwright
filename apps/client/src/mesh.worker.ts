import { createWorld, setBlock } from "../../../packages/sim/src/world";
import { decodePacket, applySectionPacket } from "../../../packages/sim/src/protocol";
import { meshSection } from "../../../packages/sim/src/mesh";
import { sectionKey } from "../../../packages/sim/src/section";

let world = createWorld(0, "flat", false), generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
const lod = new Map<string, { cx: number; cz: number; heights: Uint16Array }>();
let lodTimer: ReturnType<typeof setTimeout> | undefined;
const post = (data: unknown, transfer: Transferable[] = []) => self.postMessage(data, { transfer });
function rebuildLod() {
  lodTimer = undefined;
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], lights: number[] = [], indices: number[] = [];
  for (const { cx, cz, heights } of lod.values()) for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    const base = positions.length / 3;
    for (const [dx, dz] of [[0,0],[0,1],[1,1],[1,0]]) {
      positions.push(cx*32+(x+dx)*4, heights[(z+dz)*9+x+dx], cz*32+(z+dz)*4);
      normals.push(0,1,0); colors.push(0.47,0.64,0.34); lights.push(1,0);
    }
    indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const mesh = { positions: Float32Array.from(positions), normals: Float32Array.from(normals), colors: Float32Array.from(colors), lights: Float32Array.from(lights), indices: Uint32Array.from(indices) };
  post({ type: "mesh", key: "lod", generation, ...mesh }, Object.values(mesh).map(a => a.buffer));
}
function drain() {
  timer = undefined;
  // Yield between sections so packet arrivals coalesce and edits are not starved.
  const key = world.meshDirty.values().next().value as string | undefined;
  if (!key) return;
  world.meshDirty.delete(key);
  const [cx, sy, cz] = key.split(",").map(Number);
  const mesh = meshSection(world, cx, sy, cz);
  post({ type: "mesh", key, generation, ...mesh }, Object.values(mesh).map(array => array.buffer));
  if (world.meshDirty.size) timer = setTimeout(drain, 0);
}
self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "reset") { world = createWorld(message.seed, message.mode, false); generation = message.generation; lod.clear(); }
  else if (message.type === "packet") {
    const packet = decodePacket(message.buffer);
    if (packet.type === "section") { applySectionPacket(world, packet); lod.delete(`${packet.cx},${packet.cz}`); }
    else lod.set(`${packet.cx},${packet.cz}`, packet);
    if (!lodTimer) lodTimer = setTimeout(rebuildLod, 300);
  } else if (message.type === "edit") {
    // Server sends authoritative light packets after every edit. The immediate
    // local mesh change supplies prediction while that packet is in flight.
    setBlock(world, message.x, message.y, message.z, message.block);
  } else if (message.type === "unload") {
    const [cx, cz] = message.key.split(",").map(Number);
    world.light.columns.delete(message.key);
    lod.delete(message.key);
    if (!lodTimer) lodTimer = setTimeout(rebuildLod, 300);
    for (let sy = 0; sy < 6; sy++) { const key = sectionKey(cx, sy, cz); world.sections.delete(key); world.meshDirty.delete(key); }
  }
  for (const key of world.meshDirty) {
    const [,sy] = key.split(",").map(Number);
    if (sy < 0 || sy > 5 || !world.sections.has(key)) { world.meshDirty.delete(key); post({ type: "empty", key, generation }); }
  }
  if (!timer && world.meshDirty.size) timer = setTimeout(drain, 0);
};
