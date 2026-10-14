import { expect, test } from "bun:test";
import {
  createWorld,
  createPlayer,
  idleInput,
  stepWorld,
  movePlayer,
  setBlock,
  blockAt,
  spawnReason,
  lightAt,
  editBlock,
} from "../packages/sim/src/world";

test("seeded simulation replays identically after a save and restore", () => {
  const a = createWorld(),
    pa = createPlayer("a", "Pell", 0);
  const b = structuredClone(a),
    pb = structuredClone(pa);
  for (let tick = 0; tick < 120; tick++) {
    const input = {
      ...idleInput(),
      x: tick < 20 ? 1 : 0,
      jump: tick === 4,
      seq: tick + 1,
    };
    stepWorld(a, [pa], new Map([["a", { ...input }]]));
    stepWorld(b, [pb], new Map([["a", { ...input }]]));
  }
  expect(b).toEqual(a);
  expect(pb).toEqual(pa);
});
test("dark deck spawns; nearby players, headroom and lamps stop it", () => {
  const w = createWorld(),
    p = createPlayer("a", "Pell", 0);
  expect(spawnReason(w, [p], -19, 12, -7)).toBe("Ready to spawn");
  expect(lightAt(w, -19, 5, -7)).toBeGreaterThan(0);
  p.x = -18;
  p.z = -7;
  p.y = 12;
  expect(spawnReason(w, [p], -19, 12, -7)).toContain("too close");
  p.x = 8;
  p.z = 9;
  p.y = 4;
  setBlock(w, -18, 12, -7, 4);
  expect(spawnReason(w, [p], -19, 12, -7)).toContain("Too bright");
  setBlock(w, -19, 13, -7, 2);
  expect(spawnReason(w, [p], -19, 12, -7)).toContain("headroom");
});
test("server rejects distant, malformed and player-overlapping edits", () => {
  const w = createWorld(),
    p = createPlayer("a", "Pell", 0),
    revision = w.revision;
  expect(editBlock(w, [p], p, -20, 3, -10, 0)).toContain("closer");
  expect(editBlock(w, [p], p, NaN, 3, 8, 0)).toContain("Outside");
  expect(editBlock(w, [p], p, 8, 4, 9, 2)).toContain("player");
  expect(w.revision).toBe(revision);
  expect(editBlock(w, [p], p, 9, 4, 9, 2)).toBeNull();
  expect(blockAt(w, 9, 4, 9)).toBe(2);
  expect(editBlock(w, [p], p, 9, 4, 9, 0)).toBeNull();
  expect(blockAt(w, 9, 4, 9)).toBe(0);
});
test("dash cannot tunnel through a wall and jumping lands on the floor", () => {
  const w = createWorld(),
    p = createPlayer("a", "Pell", 0);
  setBlock(w, 10, 4, 9, 2);
  setBlock(w, 10, 5, 9, 2);
  movePlayer(w, p, { ...idleInput(), x: 1, dash: true });
  expect(p.x).toBeLessThan(9.74);
  p.grounded = true;
  movePlayer(w, p, { ...idleInput(), jump: true });
  expect(p.y).toBeGreaterThan(4);
  for (let i = 0; i < 40; i++) movePlayer(w, p, idleInput());
  expect(p.grounded).toBe(true);
  expect(p.y).toBeLessThan(4.15);
});
test("a falling Gloomling drops essence and nearby players collect it once", () => {
  const w = createWorld(),
    p = createPlayer("a", "Pell", 0);
  w.mobs.push({
    id: 100,
    x: p.x,
    y: 5,
    z: p.z,
    vy: -12,
    grounded: false,
    hp: 1,
    dx: 0,
    dz: 0,
    fallFrom: 14,
  });
  for (let i = 0; i < 40; i++) stepWorld(w, [p], new Map());
  expect(p.essence).toBeGreaterThan(0);
  expect(w.harvested).toBe(p.essence);
  const count = p.essence;
  for (let i = 0; i < 20; i++) stepWorld(w, [p], new Map());
  expect(p.essence).toBe(count);
});
test("starter farm produces dropped essence with no player attacks", () => {
  const w = createWorld(),
    p = createPlayer("a", "Pell", 0);
  for (let i = 0; i < 1200; i++) stepWorld(w, [p], new Map());
  expect(w.drops.length).toBeGreaterThan(0);
  expect(w.mobs.length).toBeLessThanOrEqual(30);
});
