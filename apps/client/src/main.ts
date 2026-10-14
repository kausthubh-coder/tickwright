import "./style.css";
import { IslandScene } from "./scene";
import { setupAuth, sessionToken } from "./auth";
import {
  createWorld,
  movePlayer,
  spawnReason,
  lightAt,
  blockAt,
  BLOCKS,
  SIZE_Y,
  type World,
  type Player,
  type Input,
  type Snapshot,
} from "../../../packages/sim/src/world";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
<div id="world"></div><div class="vignette"></div>
<div class="hud">
  <header class="topbar"><div class="brand"><div class="sigil"><span>✧</span></div><div><h1>TICKWRIGHT</h1><div class="eyebrow">The Drift · First light</div></div></div><div class="room-info"><i class="dot" id="dot"></i><span id="room-status">Your island awaits</span><button id="invite">Invite friend ↗</button></div></header>
  <section class="quest panel"><div class="eyebrow">Chapter 01 / A borrowed sun</div><h2>Learn to bend the rules.</h2><p>Pell left a farm in the old watchtower. Find out what makes it work.</p><ol><li id="quest-move">Explore your island</li><li id="quest-build">Place or break a block</li><li id="quest-sight">Read a rule with Sight</li><li id="quest-loot">Collect Gloom Essence</li></ol><footer><span id="save-state">Local guest play</span><span>◇ THE ARCHIVE</span></footer></section>
  <div class="stats"><div class="stat"><strong id="essence">0</strong>Essence</div><div class="stat"><strong id="mob-count">0</strong>Gloomlings</div></div>
  <div class="layer-control panel"><button id="layer-down" aria-label="Lower cutaway layer">−</button><span id="layer-label">Full island</span><button id="layer-up" aria-label="Raise cutaway layer">+</button></div>
  <section class="inspect panel" id="inspect" hidden><strong>Sight</strong><p id="inspect-detail">Point at a floor to read its rules.</p><p id="inspect-reason"></p></section>
  <div id="player-labels"></div><div class="connection-banner" id="connection" hidden></div>
  <div class="controls"><div class="row"><span><kbd>W A S D</kbd>Move</span><span><kbd>Space</kbd>Jump</span></div><div class="row"><span><kbd>Shift</kbd>Dash</span><span><kbd>F</kbd>Strike</span></div><div class="row"><span><kbd>Q E</kbd>Orbit</span><span><kbd>Tab</kbd>Sight</span></div></div>
  <div class="toolbar-wrap"><div class="toolbar-label">Left click to break · Right click to place</div><div class="toolbar" role="toolbar" aria-label="Building blocks">${BLOCKS.slice(
    1,
  )
    .map(
      (name, i) =>
        `<button class="slot ${i === 0 ? "active" : ""}" data-block="${i + 1}" aria-label="Select ${name}" aria-pressed="${i === 0}"><small>${i + 1}</small><i class="cube" style="--swatch:${["#80b989", "#919ca4", "#ba8a64", "#f2cf79", "#a6d8c8"][i]}"></i>${name}</button>`,
    )
    .join("")}</div></div>
  <details class="help panel"><summary>Field notes <span style="float:right;margin-left:18px">?</span></summary><p>Gloomlings need a solid floor, two empty blocks, roof shade, and a player at least 24 blocks away. Lamps stop spawning nearby.</p><p>The watchtower's central hole drops them into sunlight. Wait near the altar, then collect the violet crystals underneath.</p><p><kbd>C</kbd> cuts the roof away. <kbd>[ ]</kbd> changes the visible layer. Scroll to zoom. Block supplies are unlimited in this prototype.</p><p>Worlds save in Convex. Local guests and their pockets reset when they leave. Desktop keyboard and mouse required.</p></details>
  <div class="toast" id="toast" role="status"></div>
</div>
<section class="lobby" id="lobby"><form class="lobby-content" id="join-form"><div class="eyebrow">A co-op world of curious rules</div><h2>Grow something<br><em>impossible.</em></h2><p>Build above the clouds. Turn shadows into power. Learn the rules, then make them work for you.</p><label for="player-name">What should Pell call you?</label><div class="join-fields"><input id="player-name" name="name" maxlength="18" placeholder="Your name" value="Wanderer" autocomplete="nickname" required><button id="join" type="submit">Enter island →</button></div><p class="subtext" id="join-status">Local guest · Saved worlds with Convex · Up to 8 friends</p><div class="small-rule"></div><p class="subtext">A first playable experiment. Bring a keyboard, a mouse,<br>and a slightly unreasonable idea.</p></form></section>`;

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const authHost = document.createElement("div");
authHost.className = "auth-control";
app.append(authHost);
setupAuth(authHost).catch(() => {
  byId("join-status").textContent =
    "Sign-in could not load. Check Clerk configuration.";
});
let scene: IslandScene;
try {
  scene = new IslandScene(byId("world"));
} catch (error) {
  byId("join-status").textContent =
    "WebGL2 is unavailable. Enable hardware acceleration and reload.";
  byId<HTMLButtonElement>("join").disabled = true;
  throw error;
}
let world: World = createWorld(),
  players: Player[] = [],
  myId = "",
  socket: WebSocket | undefined;
let pending: Input[] = [],
  seq = 0,
  selected = 1,
  joined = false,
  moved = false,
  built = false,
  seen = false;
let cutaway = false,
  manualLayer = SIZE_Y,
  save = "Local guest play";
const keys = new Set<string>();
let jump = false,
  dash = false,
  attack = false;
const roomParam = new URL(location.href).searchParams.get("room");
const room =
  roomParam && /^[a-z0-9-]{1,48}$/.test(roomParam) ? roomParam : "hearth-isle";
history.replaceState(null, "", `?room=${room}`);
const server = import.meta.env.VITE_ROOM_SERVER as string | undefined;
let toastUntil = 0,
  joinedAt = 0;
function toast(message: string) {
  byId("toast").textContent = message;
  byId("toast").classList.add("show");
  toastUntil = performance.now() + 3500;
}
function me() {
  return players.find((p) => p.id === myId);
}
function select(block: number) {
  selected = block;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".slot")) {
    const active = Number(button.dataset.block) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(".slot"))
  button.addEventListener("click", () => {
    select(Number(button.dataset.block));
    scene.renderer.domElement.focus();
  });
function setLayer(offset: number) {
  manualLayer = Math.max(1, Math.min(SIZE_Y, manualLayer + offset));
  cutaway = false;
  scene.layer = manualLayer;
  byId("layer-label").textContent =
    manualLayer === SIZE_Y ? "Full island" : `Layer ${manualLayer}`;
}
byId("layer-down").addEventListener("click", () => setLayer(-1));
byId("layer-up").addEventListener("click", () => setLayer(1));
byId("invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Island link copied. Open it in another local browser.");
  } catch {
    toast(`Share this room: ${room}`);
  }
});
byId("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  connect();
});
async function connect() {
  if (!server) {
    byId("join-status").textContent =
      "The room server is not configured. Run bun run dev for local play.";
    return;
  }
  byId<HTMLButtonElement>("join").disabled = true;
  byId("join-status").textContent = "Waking your island…";
  const name = byId<HTMLInputElement>("player-name").value.trim() || "Wanderer";
  const url = new URL(`${server}/parties/world-room/${room}`);
  url.searchParams.set("name", name);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    const token = await sessionToken();
    if (!token) {
      byId("join-status").textContent = "Sign in to enter this hosted island.";
      byId<HTMLButtonElement>("join").disabled = false;
      return;
    }
    url.searchParams.set("token", token);
  }
  socket = new WebSocket(url);
  socket.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === "welcome") {
      myId = data.id;
      world = data.world;
      players = data.players;
      pending = [];
      seq = 0;
      joined = true;
      joinedAt = performance.now();
      app.classList.add("playing");
      byId("lobby").hidden = true;
      byId("connection").hidden = true;
      byId("dot").classList.add("online");
      scene.renderer.domElement.focus();
      toast("Welcome to the Drift. WASD to move. Tab reveals the rules.");
    } else if (data.type === "state") {
      const state = data as Snapshot;
      world.tick = state.tick;
      world.revision = state.revision;
      world.mobs = state.mobs;
      world.drops = state.drops;
      world.harvested = state.harvested;
      if (state.blocks) world.blocks = state.blocks;
      players = state.players;
      save = state.save;
      const local = me();
      if (local) {
        pending = pending.filter((input) => input.seq > local.ack);
        for (const input of pending) movePlayer(world, local, input);
      }
    } else if (data.type === "notice") toast(data.message);
  });
  socket.addEventListener("close", (event) => {
    joined = false;
    keys.clear();
    pending = [];
    app.classList.remove("playing");
    byId("dot").classList.remove("online");
    byId<HTMLButtonElement>("join").disabled = false;
    byId("lobby").hidden = false;
    byId("join-status").textContent =
      event.reason || "Connection closed. Enter the island to reconnect.";
    byId("room-status").textContent = "Disconnected";
    byId("connection").hidden = false;
    byId("connection").textContent = "Disconnected · world controls paused";
  });
  socket.addEventListener("error", () => {
    byId("join-status").textContent =
      "Could not reach the island server. Check the bun run dev terminal.";
  });
}
window.addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement).tagName === "INPUT" || !joined) return;
  if (
    [
      "Space",
      "Tab",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(event.code)
  )
    event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === "Space") jump = true;
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") dash = true;
  if (event.code === "KeyF") attack = true;
  if (event.code === "KeyQ") scene.angle -= Math.PI / 4;
  if (event.code === "KeyE") scene.angle += Math.PI / 4;
  if (event.code === "Tab") {
    scene.sight = !scene.sight;
    seen = true;
    byId("inspect").hidden = !scene.sight;
  }
  if (event.code === "KeyC") {
    cutaway = !cutaway;
    toast(
      cutaway
        ? "Cutaway follows your height. Press C for the full island."
        : "Full island restored.",
    );
  }
  if (event.code === "BracketLeft") setLayer(-1);
  if (event.code === "BracketRight") setLayer(1);
  if (/^Digit[1-5]$/.test(event.code)) select(Number(event.code.slice(-1)));
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
addEventListener("blur", () => {
  keys.clear();
  jump = dash = attack = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    jump = dash = attack = false;
  }
});
scene.renderer.domElement.addEventListener("contextmenu", (event) =>
  event.preventDefault(),
);
scene.renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!joined || socket?.readyState !== WebSocket.OPEN) return;
  scene.pick(world);
  const h = scene.hover;
  if (!h) return;
  if (event.button !== 0 && event.button !== 2) return;
  const place = event.button === 2;
  socket.send(
    JSON.stringify({
      type: "edit",
      x: h.x + (place ? h.nx : 0),
      y: h.y + (place ? h.ny : 0),
      z: h.z + (place ? h.nz : 0),
      block: place ? selected : 0,
    }),
  );
});
let priorRevision = world.revision;
setInterval(() => {
  if (!joined || socket?.readyState !== WebSocket.OPEN) return;
  const p = me();
  if (!p) return;
  const x = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    z = (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0);
  const movement = scene.movement(x, z);
  const input: Input = {
    x: movement.x,
    z: movement.z,
    jump,
    dash,
    attack,
    seq: ++seq,
  };
  jump = dash = attack = false;
  socket.send(JSON.stringify({ type: "input", ...input }));
  pending.push(input);
  if (pending.length > 40) pending.shift();
  movePlayer(world, p, input);
  if (x || z) moved = true;
}, 50);
const labelNodes = new Map<string, HTMLElement>();
setInterval(() => {
  const p = me();
  byId("essence").textContent = String(p?.essence ?? 0);
  byId("mob-count").textContent = String(world.mobs.length);
  byId("save-state").textContent = save;
  if (joined) byId("room-status").textContent = `${room} · ${players.length}/8`;
  if (
    joined &&
    performance.now() - joinedAt > 1000 &&
    world.revision !== priorRevision
  )
    built = true;
  priorRevision = world.revision;
  for (const [id, done] of [
    ["quest-move", moved],
    ["quest-build", built],
    ["quest-sight", seen],
    ["quest-loot", (p?.essence ?? 0) > 0],
  ] as const)
    byId(id).classList.toggle("done", done);
  let underRoof = false;
  if (p)
    for (let y = Math.floor(p.y) + 2; y < SIZE_Y; y++)
      if (blockAt(world, p.x, y, p.z)) {
        underRoof = true;
        break;
      }
  if ((cutaway || underRoof) && p) {
    scene.layer = Math.min(manualLayer, Math.floor(p.y) + 3);
    byId("layer-label").textContent = `Cutaway ${scene.layer}`;
  } else {
    scene.layer = manualLayer;
    byId("layer-label").textContent =
      manualLayer === SIZE_Y ? "Full island" : `Layer ${manualLayer}`;
  }
  if (scene.sight) {
    const h = scene.hover;
    if (h) {
      const y = h.y + 1;
      byId("inspect-detail").textContent =
        `${BLOCKS[h.block]} · ${h.x}, ${h.y}, ${h.z} · light ${lightAt(world, h.x, y, h.z)}`;
      byId("inspect-reason").textContent = spawnReason(
        world,
        players,
        h.x,
        y,
        h.z,
      );
    } else {
      byId("inspect-detail").textContent =
        "Point at a floor to read its rules.";
      byId("inspect-reason").textContent =
        "Roof shade + headroom + 24 blocks from players";
    }
  }
  if (performance.now() > toastUntil) byId("toast").classList.remove("show");
  for (const other of players) {
    if (other.id === myId) continue;
    let label = labelNodes.get(other.id);
    if (!label) {
      label = document.createElement("span");
      label.className = "player-label";
      byId("player-labels").append(label);
      labelNodes.set(other.id, label);
    }
    label.textContent = other.name;
    const pos = scene.project(other.x, other.y + 2.1, other.z);
    label.style.left = `${pos.x}px`;
    label.style.top = `${pos.y}px`;
  }
  for (const [id, node] of labelNodes)
    if (!players.some((p) => p.id === id)) {
      node.remove();
      labelNodes.delete(id);
    }
}, 100);
const frameTimes = new Float32Array(3600);
let frameCount = 0,
  last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  if (joined && !document.hidden && now - last < 1000) {
    frameTimes[frameCount % frameTimes.length] = now - last;
    frameCount++;
  }
  last = now;
  scene.update(world, players, world.mobs, world.drops, me(), dt, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Read-only observations for browser verification; no gameplay setters or test endpoints.
Object.defineProperty(window, "tickwright", {
  value: {
    inspect: () => ({
      joined,
      room,
      id: myId,
      tick: world.tick,
      revision: world.revision,
      players: structuredClone(players),
      mobs: structuredClone(world.mobs),
      drops: structuredClone(world.drops),
      harvested: world.harvested,
      save,
      layer: scene.layer,
      hover: scene.hover,
      drawCalls: scene.renderer.info.render.calls,
      triangles: scene.renderer.info.render.triangles,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: scene.renderer.getPixelRatio(),
      },
      frames: frameCount,
    }),
    block: (x: number, y: number, z: number) =>
      world.blocks[(y * 48 + z + 24) * 56 + x + 28],
    project: (x: number, y: number, z: number) => scene.project(x, y, z),
    frames: () =>
      Array.from(frameTimes.slice(0, Math.min(frameCount, frameTimes.length))),
  },
});
