import { TICK_SECONDS } from "./clock";
import { ENGINE, BLOCKS, solid } from "./codex/engine";
import { blockAt, setBlock, inBounds, type World, type Body, type Player, type Input } from "./world";

export function collides(w: World, x: number, y: number, z: number, height = ENGINE.bodyHeight, radius = ENGINE.bodyRadius) {
  for (let bx = Math.floor(x - radius + 1e-7); bx <= Math.floor(x + radius - 1e-7); bx++)
    for (let bz = Math.floor(z - radius + 1e-7); bz <= Math.floor(z + radius - 1e-7); bz++)
      for (let by = Math.floor(y + 1e-7); by <= Math.floor(y + height - 1e-7); by++)
        if (solid(blockAt(w, bx, by, bz))) return true;
  return false;
}
export function moveBody(w: World, b: Body, dx: number, dz: number) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.2));
  for (let n = 0; n < steps; n++) {
    for (const axis of ["x", "z"] as const) {
      const delta = (axis === "x" ? dx : dz) / steps;
      if (!delta) continue;
      const x = b.x + (axis === "x" ? delta : 0), z = b.z + (axis === "z" ? delta : 0);
      if (!collides(w, x, b.y, z)) b[axis] += delta;
      else if (b.grounded && !collides(w, b.x, b.y + ENGINE.stepHeight, b.z) && !collides(w, x, b.y + ENGINE.stepHeight, z)) {
        b.y += ENGINE.stepHeight; b[axis] += delta;
      }
    }
  }
  const dy = b.vy * TICK_SECONDS - ENGINE.gravity * TICK_SECONDS * TICK_SECONDS / 2;
  b.vy -= ENGINE.gravity * TICK_SECONDS;
  const stepsY = Math.max(1, Math.ceil(Math.abs(dy) / 0.15));
  b.grounded = false;
  for (let n = 0; n < stepsY; n++) {
    const delta = dy / stepsY;
    if (!collides(w, b.x, b.y + delta, b.z)) { b.y += delta; continue; }
    // Find the contact plane instead of leaving an accumulating substep gap.
    let low = 0, high = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (collides(w, b.x, b.y + delta * mid, b.z)) high = mid; else low = mid;
    }
    b.y += delta * low; b.grounded = dy < 0; b.vy = 0; break;
  }
}
export function movePlayer(w: World, p: Player, input: Input) {
  if (!w.generate && !w.columns.has(`${Math.floor(p.x / 32)},${Math.floor(p.z / 32)}`)) return;
  const length = Math.max(1, Math.hypot(input.x, input.z)), x = input.x / length, z = input.z / length;
  if (x || z) { p.facingX = x; p.facingZ = z; }
  p.coyote = p.grounded ? ENGINE.coyoteTicks : Math.max(0, p.coyote - 1);
  p.jumpBuffer = input.jump ? ENGINE.jumpBufferTicks : Math.max(0, p.jumpBuffer - 1);
  if (p.jumpBuffer && (p.grounded || p.coyote)) {
    p.vy = Math.sqrt(2 * ENGINE.gravity * ENGINE.jumpHeight); p.grounded = false; p.jumpBuffer = p.coyote = 0;
  }
  const speed = input.sprint ? ENGINE.sprintSpeed : ENGINE.runSpeed;
  // A client must not predict through an unreceived column at a streaming edge.
  const nx = p.x + x * speed * TICK_SECONDS, nz = p.z + z * speed * TICK_SECONDS;
  if (!w.generate && !w.columns.has(`${Math.floor(nx / 32)},${Math.floor(nz / 32)}`)) return;
  moveBody(w, p, x * speed * TICK_SECONDS, z * speed * TICK_SECONDS);
  p.ack = input.seq;
}
export function editBlock(w: World, players: Player[], p: Player, x: number, y: number, z: number, value: number): string | null {
  if (![x, y, z, value].every(Number.isInteger) || !inBounds(x, y, z) || y === 0 || value < 0 || value >= BLOCKS.length) return "Outside the build area";
  if (Math.hypot(p.x - x - 0.5, p.y + 1.5 - y - 0.5, p.z - z - 0.5) > ENGINE.reach) return "Move closer to build";
  if (value && blockAt(w, x, y, z)) return "That cell is occupied";
  if (!value && !blockAt(w, x, y, z)) return "No block here";
  if (value && players.some(other => Math.abs(other.x - x - 0.5) < 0.5 + ENGINE.bodyRadius && Math.abs(other.z - z - 0.5) < 0.5 + ENGINE.bodyRadius && other.y < y + 1 && other.y + ENGINE.bodyHeight > y)) return "A player is standing there";
  if (value && ![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => solid(blockAt(w, x + dx, y + dy, z + dz)))) return "Attach blocks to a surface";
  // A reach check alone allows editing through walls. Sample the eye-to-cell ray,
  // stopping before the target face; this also works with the shoulder camera.
  const distance = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y - 1.5, z + 0.5 - p.z);
  for (let d = 0.1; d < distance - 0.6; d += 0.1) {
    const t = d / distance, bx = Math.floor(p.x + (x + 0.5 - p.x) * t), by = Math.floor(p.y + 1.5 + (y + 0.5 - p.y - 1.5) * t), bz = Math.floor(p.z + (z + 0.5 - p.z) * t);
    if (bx === x && by === y && bz === z) break;
    if (solid(blockAt(w, bx, by, bz))) return "That block is hidden";
  }
  setBlock(w, x, y, z, value);
  return null;
}
