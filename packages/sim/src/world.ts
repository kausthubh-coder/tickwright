import { nextRandom, TICK_SECONDS } from "./clock";

export const SIZE_X = 56,
  SIZE_Y = 24,
  SIZE_Z = 48;
export const MIN_X = -28,
  MIN_Z = -24;
export const BLOCKS = [
  "Air",
  "Meadow",
  "Stone",
  "Timber",
  "Lamp",
  "Glass",
] as const;
export type Block = 0 | 1 | 2 | 3 | 4 | 5;
export interface Body {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
}
export interface Input {
  x: number;
  z: number;
  jump: boolean;
  dash: boolean;
  attack: boolean;
  seq: number;
}
export interface Player extends Body {
  id: string;
  name: string;
  color: number;
  essence: number;
  dashCd: number;
  attackCd: number;
  ack: number;
  facingX: number;
  facingZ: number;
}
export interface Mob extends Body {
  id: number;
  hp: number;
  dx: number;
  dz: number;
  fallFrom: number;
}
export interface Drop extends Body {
  id: number;
  count: number;
  born: number;
}
export interface World {
  version: 1;
  tick: number;
  seed: number;
  nextId: number;
  revision: number;
  blocks: number[];
  mobs: Mob[];
  drops: Drop[];
  harvested: number;
}
export interface Snapshot {
  type: "state";
  tick: number;
  revision: number;
  players: Player[];
  mobs: Mob[];
  drops: Drop[];
  harvested: number;
  save: string;
  blocks?: number[];
}
export const idleInput = (): Input => ({
  x: 0,
  z: 0,
  jump: false,
  dash: false,
  attack: false,
  seq: 0,
});
export function index(x: number, y: number, z: number): number {
  return (y * SIZE_Z + z - MIN_Z) * SIZE_X + x - MIN_X;
}
export function inBounds(x: number, y: number, z: number): boolean {
  return (
    x >= MIN_X &&
    x < MIN_X + SIZE_X &&
    y >= 0 &&
    y < SIZE_Y &&
    z >= MIN_Z &&
    z < MIN_Z + SIZE_Z
  );
}
export function blockAt(w: World, x: number, y: number, z: number): number {
  x = Math.floor(x);
  y = Math.floor(y);
  z = Math.floor(z);
  return inBounds(x, y, z) ? w.blocks[index(x, y, z)] : 0;
}
export function setBlock(
  w: World,
  x: number,
  y: number,
  z: number,
  value: number,
): void {
  if (inBounds(x, y, z)) {
    w.blocks[index(x, y, z)] = value;
    w.revision++;
  }
}
export function createWorld(): World {
  const w: World = {
    version: 1,
    tick: 0,
    seed: 19283,
    nextId: 1,
    revision: 0,
    blocks: new Array(SIZE_X * SIZE_Y * SIZE_Z).fill(0),
    mobs: [],
    drops: [],
    harvested: 0,
  };
  for (let x = -24; x <= 23; x++)
    for (let z = -20; z <= 19; z++) {
      const edge = (x / 25) ** 2 + (z / 21) ** 2;
      if (edge > 1 || (((x * 17 + z * 11) & 15) === 0 && edge > 0.91)) continue;
      const bottom = edge < 0.45 ? 0 : edge < 0.75 ? 1 : 2;
      for (let y = bottom; y <= 3; y++) setBlock(w, x, y, z, y === 3 ? 1 : 2);
    }
  // A raised dark deck surrounds a drop shaft. Gloomlings wander into it.
  for (let x = -20; x <= -12; x++)
    for (let z = -9; z <= -1; z++) {
      if (!(x >= -17 && x <= -15 && z >= -6 && z <= -4))
        setBlock(w, x, 11, z, 2);
      setBlock(w, x, 15, z, 3);
    }
  for (const x of [-20, -12])
    for (const z of [-9, -1])
      for (let y = 4; y < 15; y++) setBlock(w, x, y, z, 3);
  // Light the collection floor so spawning happens on the raised deck only.
  for (const x of [-19, -16, -13])
    for (const z of [-8, -5, -2]) setBlock(w, x, 4, z, 4);
  // Steps give the player access to the roofed spawn deck.
  for (let step = 0; step < 8; step++)
    for (let x = -14; x <= -12; x++)
      for (let y = 4; y <= step + 4; y++) setBlock(w, x, y, 7 - step, 2);
  for (const [x, z] of [
    [4, 6],
    [11, 6],
    [4, 12],
    [11, 12],
  ])
    setBlock(w, x, 4, z, 4);
  return w;
}
export function createPlayer(id: string, name: string, color: number): Player {
  return {
    id,
    name,
    color,
    x: 8.5,
    y: 4,
    z: 9.5,
    vy: 0,
    grounded: false,
    essence: 0,
    dashCd: 0,
    attackCd: 0,
    ack: 0,
    facingX: 0,
    facingZ: -1,
  };
}
function collides(
  w: World,
  x: number,
  y: number,
  z: number,
  height: number,
  radius: number,
): boolean {
  for (let bx = Math.floor(x - radius); bx <= Math.floor(x + radius); bx++)
    for (let bz = Math.floor(z - radius); bz <= Math.floor(z + radius); bz++)
      for (
        let by = Math.floor(y + 0.001);
        by <= Math.floor(y + height - 0.001);
        by++
      )
        if (blockAt(w, bx, by, bz)) return true;
  return false;
}
export function moveBody(
  w: World,
  b: Body,
  dx: number,
  dz: number,
  height = 1.65,
  radius = 0.27,
): void {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.2),
  );
  for (let i = 0; i < steps; i++) {
    if (!collides(w, b.x + dx / steps, b.y, b.z, height, radius))
      b.x += dx / steps;
    if (!collides(w, b.x, b.y, b.z + dz / steps, height, radius))
      b.z += dz / steps;
  }
  b.vy -= 22 * TICK_SECONDS;
  const dy = b.vy * TICK_SECONDS;
  const verticalSteps = Math.max(1, Math.ceil(Math.abs(dy) / 0.15));
  b.grounded = false;
  for (let i = 0; i < verticalSteps; i++) {
    if (collides(w, b.x, b.y + dy / verticalSteps, b.z, height, radius)) {
      if (dy < 0) b.grounded = true;
      b.vy = 0;
      break;
    }
    b.y += dy / verticalSteps;
  }
}
export function movePlayer(w: World, p: Player, input: Input): void {
  const length = Math.hypot(input.x, input.z);
  let dx = length > 0 ? input.x / Math.max(1, length) : 0;
  let dz = length > 0 ? input.z / Math.max(1, length) : 0;
  if (length > 0) {
    p.facingX = dx;
    p.facingZ = dz;
  }
  p.dashCd = Math.max(0, p.dashCd - 1);
  p.attackCd = Math.max(0, p.attackCd - 1);
  if (input.jump && p.grounded) p.vy = 8.3;
  let distance = 5.5 * TICK_SECONDS;
  if (input.dash && p.dashCd === 0) {
    distance = 3.2;
    dx = p.facingX;
    dz = p.facingZ;
    p.dashCd = 24;
  }
  moveBody(w, p, dx * distance, dz * distance);
  if (p.y < -8) {
    p.x = 8.5;
    p.y = 5;
    p.z = 9.5;
    p.vy = 0;
  }
  p.ack = input.seq;
}
export function lightAt(w: World, x: number, y: number, z: number): number {
  let light = 15;
  for (let roof = y; roof < SIZE_Y; roof++)
    if (blockAt(w, x, roof, z) && blockAt(w, x, roof, z) !== 5) {
      light = 0;
      break;
    }
  if (light === 15) return light;
  // The slice uses roof shade and a Manhattan lamp radius, exposed in Sight.
  for (let lx = x - 5; lx <= x + 5; lx++)
    for (let lz = z - 5; lz <= z + 5; lz++)
      for (
        let ly = Math.max(0, y - 5);
        ly <= Math.min(SIZE_Y - 1, y + 5);
        ly++
      ) {
        if (blockAt(w, lx, ly, lz) === 4)
          light = Math.max(
            light,
            15 - 3 * (Math.abs(lx - x) + Math.abs(ly - y) + Math.abs(lz - z)),
          );
      }
  return light;
}
export function spawnReason(
  w: World,
  players: Player[],
  x: number,
  y: number,
  z: number,
): string {
  if (!blockAt(w, x, y - 1, z)) return "Needs a solid floor";
  if (blockAt(w, x, y, z) || blockAt(w, x, y + 1, z))
    return "Needs two blocks of headroom";
  const light = lightAt(w, x, y, z);
  if (light > 0) return `Too bright: light ${light}`;
  let nearest = Infinity;
  for (const p of players)
    nearest = Math.min(
      nearest,
      Math.hypot(p.x - x - 0.5, p.y - y, p.z - z - 0.5),
    );
  if (nearest < 24) return "Player too close: move 24 blocks away";
  if (nearest > 128) return "Needs a player within 128 blocks";
  if (w.mobs.length >= Math.min(60, players.length * 30))
    return "Mob cap reached";
  return "Ready to spawn";
}
export function editBlock(
  w: World,
  players: Player[],
  p: Player,
  x: number,
  y: number,
  z: number,
  value: number,
): string | null {
  if (
    ![x, y, z, value].every(Number.isInteger) ||
    !inBounds(x, y, z) ||
    value < 0 ||
    value > 5
  )
    return "Outside the build area";
  if (Math.hypot(p.x - x - 0.5, p.y + 0.8 - y - 0.5, p.z - z - 0.5) > 7)
    return "Move closer to build";
  if (value && blockAt(w, x, y, z)) return "That cell is occupied";
  if (!value && !blockAt(w, x, y, z)) return "No block here";
  if (
    value &&
    players.some(
      (other) =>
        Math.abs(other.x - x - 0.5) < 0.78 &&
        Math.abs(other.z - z - 0.5) < 0.78 &&
        other.y < y + 1 &&
        other.y + 1.65 > y,
    )
  )
    return "A player is standing there";
  if (
    value &&
    ![
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].some(([dx, dy, dz]) => blockAt(w, x + dx, y + dy, z + dz))
  )
    return "Attach blocks to a surface";
  setBlock(w, x, y, z, value);
  return null;
}
export function stepWorld(
  w: World,
  players: Player[],
  inputs: Map<string, Input>,
): void {
  w.tick++;
  for (const p of players) {
    const input = inputs.get(p.id) ?? idleInput();
    movePlayer(w, p, input);
    if (input.attack && p.attackCd === 0) {
      p.attackCd = 8;
      for (const m of w.mobs)
        if (Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z) < 3) m.hp -= 4;
    }
    input.jump = input.dash = input.attack = false;
  }
  for (const m of w.mobs) {
    if (w.tick % 40 === m.id % 40) {
      m.dx = nextRandom(w) * 2 - 1;
      m.dz = nextRandom(w) * 2 - 1;
      for (const p of players) {
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d > 0.5 && d < 12) {
          m.dx = (p.x - m.x) / d;
          m.dz = (p.z - m.z) / d;
          break;
        }
      }
      if (m.grounded) m.vy = 3.5;
    }
    m.fallFrom = Math.max(m.fallFrom, m.y);
    moveBody(w, m, m.dx * 0.055, m.dz * 0.055, 0.8, 0.3);
    if (m.grounded) {
      m.hp -= Math.max(0, Math.floor(m.fallFrom - m.y) - 3);
      m.fallFrom = m.y;
    }
    if (
      w.tick % 20 === m.id % 20 &&
      lightAt(w, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)) >= 12
    )
      m.hp--;
    if (m.hp <= 0 && m.y >= 0 && w.drops.length < 128)
      w.drops.push({
        id: w.nextId++,
        x: m.x,
        y: m.y + 0.3,
        z: m.z,
        vy: 2,
        grounded: false,
        count: 1 + (nextRandom(w) > 0.5 ? 1 : 0),
        born: w.tick,
      });
  }
  w.mobs = w.mobs.filter((m) => m.hp > 0 && m.y > -8);
  for (const drop of w.drops) {
    moveBody(w, drop, 0, 0, 0.22, 0.1);
    for (const p of players)
      if (
        Math.hypot(drop.x - p.x, drop.y - p.y - 0.5, drop.z - p.z) < 1.7 &&
        w.tick - drop.born > 10
      ) {
        p.essence += drop.count;
        w.harvested += drop.count;
        drop.count = 0;
        break;
      }
  }
  if (w.tick % 10 === 0)
    for (let i = 0; i < w.drops.length; i++)
      for (let j = i + 1; j < w.drops.length; j++) {
        const a = w.drops[i],
          b = w.drops[j];
        if (
          a.count &&
          b.count &&
          a.count + b.count <= 64 &&
          Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.5
        ) {
          a.count += b.count;
          b.count = 0;
        }
      }
  w.drops = w.drops.filter(
    (d) => d.count > 0 && d.y > -8 && w.tick - d.born < 6000,
  );
  // Scan a seeded column sample. The same saved seed and inputs replay exactly.
  if (w.tick % 5 === 0 && w.mobs.length < Math.min(60, players.length * 30)) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const x = MIN_X + Math.floor(nextRandom(w) * SIZE_X),
        z = MIN_Z + Math.floor(nextRandom(w) * SIZE_Z);
      for (let y = 1; y < SIZE_Y - 2; y++) {
        if (
          blockAt(w, x, y - 1, z) &&
          !blockAt(w, x, y, z) &&
          spawnReason(w, players, x, y, z) === "Ready to spawn"
        ) {
          w.mobs.push({
            id: w.nextId++,
            x: x + 0.5,
            y,
            z: z + 0.5,
            vy: 0,
            grounded: false,
            hp: 8,
            dx: nextRandom(w) * 2 - 1,
            dz: nextRandom(w) * 2 - 1,
            fallFrom: y,
          });
          return;
        }
      }
    }
  }
}
