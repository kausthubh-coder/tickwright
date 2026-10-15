import { expect, test } from "bun:test";
import { createWorld, createPlayer, idleInput, stepWorld, movePlayer, moveBody, setBlock, blockAt, lightAt, editBlock, saveWorld, restoreWorld, worldHash, simulationColumns, spawnReason } from "../packages/sim/src/world";
import { Section, encodeSection, decodeSection, sectionKey } from "../packages/sim/src/section";
import { generateColumn } from "../packages/sim/src/terrain";
import { TICK_PHASES } from "../packages/sim/src/codex/engine";
import { scheduleBlock } from "../packages/sim/src/tick";
import { encodeSectionPacket, decodePacket, entityDelta } from "../packages/sim/src/protocol";
import { meshSection } from "../packages/sim/src/mesh";

test("2000 ticks replay twice and across a midpoint save with identical world and player hashes", () => {
  function run(restore: boolean, mode: "flat"|"meadows") {
    let w = createWorld(41, mode), p = createPlayer("a", "Pell", 0, w);
    for (let tick = 0; tick < 2000; tick++) {
      if (tick === 1000 && restore) { w = restoreWorld(JSON.parse(JSON.stringify(saveWorld(w)))); p = JSON.parse(JSON.stringify(p)); }
      const input = { ...idleInput(), seq: tick + 1, x: tick % 80 < 40 ? 1 : -1, z: tick % 160 < 80 ? 0.3 : -0.3, jump: tick % 23 === 0, sprint: tick % 20 < 10 };
      stepWorld(w, [p], new Map([[p.id, input]]), {}, () => {
        if (tick % 100 === 0) setBlock(w, 5, 9, 5, tick % 200 === 0 ? 0xf002 : 0);
      });
    }
    return worldHash(w, [p]);
  }
  for(const mode of ["flat","meadows"] as const){const first=run(false,mode);expect(run(false,mode)).toBe(first);expect(run(true,mode)).toBe(first);}
}, 30000);

test("palette packing and canonical save restore preserve all 16 state bits", () => {
  const s = new Section(); expect(s.words.length).toBe(0);
  for (let i = 0; i < 32768; i++) s.set(i, (i * 17) & 65535);
  const bytes = encodeSection(s), restored = decodeSection(bytes);
  expect(restored.cells()).toEqual(s.cells()); expect(encodeSection(restored)).toEqual(bytes);
  expect(() => decodeSection(bytes.subarray(0, bytes.length - 1))).toThrow();
  const w = createWorld(12, "flat"); setBlock(w, -1, 31, 32, 0xff02);
  expect(blockAt(restoreWorld(JSON.parse(JSON.stringify(saveWorld(w)))), -1, 31, 32)).toBe(0xff02);
});
test("worldgen section bytes are seed deterministic including border trees", () => {
  for (const [cx, cz] of [[0, 0], [-1, 2], [12, -8]]) {
    const a = generateColumn(421, "meadows", cx, cz), b = generateColumn(421, "meadows", cx, cz);
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [y, section] of a) expect(encodeSection(section)).toEqual(encodeSection(b.get(y)!));
  }
  expect(encodeSection(generateColumn(422, "meadows", 0, 0).get(1)!)).not.toEqual(encodeSection(generateColumn(421, "meadows", 0, 0).get(1)!));
});
test("sky light spreads under an overhang and recovers when its roof is removed", () => {
  const w = createWorld(1, "flat");
  for (let z = 10; z <= 18; z++) for (let x = 10; x <= 18; x++) setBlock(w, x, 12, z, 2);
  expect(lightAt(w, 9, 11, 14).sky).toBe(15); expect(lightAt(w, 10, 11, 14).sky).toBe(14); expect(lightAt(w, 14, 11, 14).sky).toBe(10);
  setBlock(w, 14, 12, 14, 0); expect(lightAt(w, 14, 11, 14).sky).toBe(15);
  setBlock(w, 14, 12, 14, 2); expect(lightAt(w, 14, 11, 14).sky).toBe(10);
});
test("block light attenuates, respects opacity, crosses sections and removes stale light", () => {
  const w = createWorld(1, "flat"); w.ensureColumn(1, 0); setBlock(w, 31, 31, 16, 4);
  expect(lightAt(w, 31, 31, 16).block).toBe(15); expect(lightAt(w, 32, 32, 16).block).toBe(13);
  setBlock(w, 32, 31, 16, 2); expect(lightAt(w, 32, 31, 16).block).toBe(0); expect(lightAt(w, 33, 31, 16).block).toBe(11);
  setBlock(w, 32, 31, 16, 0); expect(lightAt(w, 33, 31, 16).block).toBe(13);
  setBlock(w, 35, 31, 16, 10); setBlock(w, 31, 31, 16, 0); expect(lightAt(w, 31, 31, 16).block).toBe(3);
  setBlock(w, 35, 31, 16, 0); expect(lightAt(w, 31, 31, 16).block).toBe(0);
});
test("player collision stops at walls, ceilings, whole-block steps, chunk borders and Null", () => {
  const w = createWorld(1, "flat"), p = createPlayer("a", "Pell", 0, w); p.x = 30.5; p.z = 2.5;
  for (let y = 8; y < 12; y++) setBlock(w, 32, y, 2, 2);
  for (let i = 0; i < 15; i++) movePlayer(w, p, { ...idleInput(), x: 1, sprint: true });
  expect(p.x).toBeLessThanOrEqual(31.7);
  p.x = 5.5; p.z = 5.5; setBlock(w, 6, 8, 5, 2);
  for (let i = 0; i < 5; i++) movePlayer(w, p, { ...idleInput(), x: 1 }); expect(p.x).toBeLessThan(5.71);
  for (let i = 0; i < 20; i++) movePlayer(w, p, { ...idleInput(), x: i < 5 ? 1 : 0, jump: i === 0 }); expect(p.y).toBeCloseTo(9, 3);
  p.x = 12.5; p.z = 12.5; p.y = 8; p.grounded = true; setBlock(w, 12, 10, 12, 2);
  for (let i = 0; i < 20; i++) movePlayer(w, p, { ...idleInput(), jump: i === 0 });
  expect(p.y).toBeCloseTo(8, 3); expect(p.grounded).toBe(true);
  p.x = 1023.6; p.y = 8; p.z = 0.5; moveBody(w, p, 10, 0); expect(p.x).toBeLessThanOrEqual(1023.7);
});
test("jump reaches 1.25m and lands without sinking", () => {
  const w = createWorld(1, "flat"), p = createPlayer("a", "Pell", 0, w); let apex = p.y;
  for (let i = 0; i < 60; i++) { movePlayer(w, p, { ...idleInput(), jump: i === 0 }); apex = Math.max(apex, p.y); }
  expect(apex - 8).toBeCloseTo(1.25, 1); expect(p.y).toBeCloseTo(8, 4); expect(p.grounded).toBe(true);
});
test("eight ordered phases, FIFO scheduling, active columns, spawning scaffold and empty pause", () => {
  const w = createWorld(1, "flat"), p = createPlayer("a", "Pell", 0, w), phases: string[] = [], scheduled: string[] = [], attempts: string[] = [];
  scheduleBlock(w, { due: 1, x: 1, y: 8, z: 1, kind: "first" }); scheduleBlock(w, { due: 1, x: 1, y: 8, z: 1, kind: "second" }); scheduleBlock(w, { due: 1, x: 400, y: 8, z: 1, kind: "inactive" });
  stepWorld(w, [p], new Map(), { phase: v => phases.push(v), scheduled: v => scheduled.push(v.kind), spawn: (x,y,z,reason) => attempts.push(reason) });
  expect(phases).toEqual([...TICK_PHASES]); expect(scheduled).toEqual(["first", "second"]); expect(attempts.length).toBe(w.columns.size);
  expect(simulationColumns([p]).size).toBe(81); expect(spawnReason(w, 1, 8, 1)).toContain("Too bright"); expect(spawnReason(w, 1, 1, 1)).toContain("not enabled");
  const tick = w.tick; stepWorld(w, [], new Map()); expect(w.tick).toBe(tick);
});
test("binary palette and light packets round trip; entity deltas remove out-of-range players", () => {
  const w = createWorld(1, "flat"), p = createPlayer("a", "Pell", 0, w), q = createPlayer("b", "Bit", 1, w); setBlock(w, 1, 9, 1, 0x9002);
  const packet = decodePacket(encodeSectionPacket(w, 0, 0, 0)); expect(packet.type).toBe("section");
  if (packet.type === "section") expect(encodeSection(packet.section)).toEqual(encodeSection(w.sections.get(sectionKey(0, 0, 0))!));
  const previous = new Map(); expect(entityDelta([p, q], p, previous).players.length).toBe(2); expect(entityDelta([p, q], p, previous).players.length).toBe(0);
  q.x += 0.5; expect(entityDelta([p, q], p, previous).players).toEqual([{ id: "b", x: q.x }]); q.x = 100; expect(entityDelta([p, q], p, previous).removed).toEqual(["b"]);
});
test("invalid and overlapping edits are rejected without dirtying the world", () => {
  const w = createWorld(1, "flat"), p = createPlayer("a", "Pell", 0, w);
  expect(editBlock(w, [p], p, NaN, 9, 1, 2)).toContain("Outside"); expect(editBlock(w, [p], p, 80, 8, 80, 2)).toContain("closer"); expect(editBlock(w, [p], p, 0, 8, 0, 2)).toContain("player");
  expect(w.dirty.size).toBe(0); expect(editBlock(w, [p], p, 2, 8, 0, 2)).toBeNull(); expect(w.dirty.size).toBe(1);
});
test("cooperative terrain generation yields the same blocks and light as synchronous generation", async () => {
  const a=createWorld(740355335),b=createWorld(740355335);
  for(const [x,z]of [[0,0],[1,0],[1,-1]]){a.ensureColumn(x,z);await b.ensureColumnAsync(x,z);}
  for(const [key,section]of a.sections)expect(encodeSection(b.sections.get(key)!)).toEqual(encodeSection(section));
  for(const [key,column]of a.light.columns)expect(b.light.columns.get(key)!.values).toEqual(column.values);
});
test("lighting converges across adjacent columns regardless of generation order", () => {
  const a=createWorld(3),b=createWorld(3);
  a.ensureColumn(0,0);a.ensureColumn(1,0);b.ensureColumn(1,0);b.ensureColumn(0,0);
  for(const key of ["0,0","1,0"])expect(a.light.columns.get(key)!.values).toEqual(b.light.columns.get(key)!.values);
});
test("restored empty sections remain tombstones and generation does not dirty saves", () => {
  const w=createWorld(3,"flat");w.ensureColumn(0,0);expect(w.dirty.size).toBe(0);
  setBlock(w,2,90,2,0xff02);setBlock(w,2,90,2,0);
  const restored=restoreWorld(saveWorld(w));expect(blockAt(restored,2,90,2)).toBe(0);expect(saveWorld(restored)).toEqual(saveWorld(w));
});
test("greedy meshing merges a uniform slab and emits simulation sky/block attributes", () => {
  const w=createWorld(3,"flat");w.ensureColumn(0,0);
  const mesh=meshSection(w,0,0,0);
  expect(mesh.indices.length).toBeLessThan(2000);expect(mesh.positions.length/3).toBe(mesh.lights.length/2);
  expect([...mesh.lights].every(v=>v>=0&&v<=1)).toBe(true);
  setBlock(w,2,9,2,4);expect(meshSection(w,0,0,0).lights.some((v,i)=>i%2===1&&v>0)).toBe(true);
});
test("manual streaming keeps unprepared columns solid instead of bypassing saved terrain", () => {
  const w=createWorld(3,"flat");w.autoGenerate=false;
  expect(blockAt(w,0,8,0)).toBe(2);expect(w.columns.size).toBe(0);
  w.ensureColumn(0,0);expect(blockAt(w,0,8,0)).toBe(0);
});
