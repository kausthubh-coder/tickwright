import "./style.css";
import { WorldScene } from "./scene";
import { setupAuth, sessionToken } from "./auth";
import { createWorld, movePlayer, editBlock, setBlock, blockAt, lightAt, type World, type Player, type Input } from "../../../packages/sim/src/world";
import { BLOCKS, ENGINE } from "../../../packages/sim/src/codex/engine";
import { decodePacket, applySectionPacket, type Snapshot } from "../../../packages/sim/src/protocol";

const app = document.querySelector<HTMLElement>("#app")!;
const buildBlocks = [1,2,3,4,5];
app.innerHTML = `<div id="world"></div>
<div class="hud">
  <header><strong>Tickwright</strong><span id="room-status">Hoshino Meadows</span><button id="invite">Invite friend</button></header>
  <div class="status"><span id="save-state">Local guest play</span><span id="stream-state">Waiting for terrain</span><span id="camera-mode">Third person</span></div>
  <div id="crosshair" aria-hidden="true">+</div><div id="player-labels"></div>
  <div class="controls"><span>WASD move · Shift sprint · Space jump · V camera</span><span>Mouse look · Left click break · Right click place · Esc release mouse</span></div>
  <div class="toolbar" role="toolbar" aria-label="Building blocks">${buildBlocks.map((id,i) => `<button class="slot ${i===0?"active":""}" data-block="${id}" aria-label="Select ${BLOCKS[id]}" aria-pressed="${i===0}"><small>${i+1}</small>${BLOCKS[id]}</button>`).join("")}</div>
  <button id="resume">Capture mouse</button><div id="toast" role="status"></div>
</div>
<section id="lobby"><form id="join-form"><h1>Hoshino Meadows</h1><p>Explore a shared world. Build with friends. Your changes stay here.</p><label for="player-name">Your name</label><input id="player-name" maxlength="18" autocomplete="nickname" value="Wanderer" required><button id="join">Enter world</button><p id="join-status">Local guest · Convex saves · Up to 8 players</p><small>M1 engine foundation. Unlimited building blocks.</small></form></section>`;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const authHost = document.createElement("div"); authHost.className = "auth-control"; app.append(authHost);
setupAuth(authHost).catch(() => { byId("join-status").textContent = "Sign-in could not load. Check Clerk configuration."; });
const scene = new WorldScene(byId("world"));
let world: World = createWorld(0, "flat", false), socket: WebSocket | undefined, joined = false, myId = "", local: Player | undefined;
let seq = 0, selected = 1, editId = 0, save = "Local guest play", online = 0, binaryBytes = 0, sectionPackets = 0, confirmations = 0, rollbacks = 0;
let pending: Input[] = [];
const authoritative = new Map<string, Player>();
const history: { at: number; players: Player[] }[] = [];
const pendingEdits = new Map<number, { x: number; y: number; z: number; block: number; before: number }>();
const keys = new Set<string>(), lodColumns = new Set<string>();
let jump = false, toastUntil = 0, renderedPlayers: Player[] = [];
const requestedRoom = new URL(location.href).searchParams.get("room");
const room = requestedRoom && /^[a-z0-9-]{1,48}$/.test(requestedRoom) ? requestedRoom : "hoshino-meadows";
window.history.replaceState(null, "", `?room=${room}`);
const server = import.meta.env.VITE_ROOM_SERVER as string | undefined;
let guest = sessionStorage.getItem("tickwright-guest");
if (!guest) { guest = crypto.randomUUID(); sessionStorage.setItem("tickwright-guest", guest); }
function toast(text: string) { byId("toast").textContent = text; toastUntil = performance.now()+3500; byId("toast").hidden = false; }
function select(block: number) {
  selected = block;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".slot")) { const active = Number(button.dataset.block) === block; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(".slot")) button.onclick = () => select(Number(button.dataset.block));
byId("resume").onclick = () => { if (joined) void scene.lock(); };
document.addEventListener("pointerlockchange", () => { byId("resume").hidden = !!document.pointerLockElement; });
byId("invite").onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast("World link copied."); } catch { toast(`Share this room: ${room}`); } };
byId("join-form").onsubmit = event => { event.preventDefault(); void connect(); };
function forgetColumn(key: string) {
  const [cx,cz] = key.split(",");
  world.columns.delete(key); world.light.columns.delete(key); lodColumns.delete(key);
  for (let sy=0;sy<6;sy++) world.sections.delete(`${cx},${sy},${cz}`);
  scene.unload(key);
}
async function connect() {
  if (!server) { byId("join-status").textContent = "Run bun run dev to configure the room server."; return; }
  byId<HTMLButtonElement>("join").disabled = true; byId("join-status").textContent = "Loading your world...";
  try {
    const url = new URL(`${server}/parties/world-room/${room}`); url.searchParams.set("name", byId<HTMLInputElement>("player-name").value.trim() || "Wanderer");
    if (["127.0.0.1","localhost","[::1]"].includes(url.hostname)) url.searchParams.set("guest", guest!);
    else { const token = await sessionToken(); if (!token) throw new Error("Sign in to enter this hosted world."); url.searchParams.set("token", token); }
    socket = new WebSocket(url); socket.binaryType = "arraybuffer";
    socket.addEventListener("message", event => {
      if (event.data instanceof ArrayBuffer) {
        binaryBytes += event.data.byteLength;
        const packet = decodePacket(event.data);
        if (packet.type === "section") {
          applySectionPacket(world, packet); sectionPackets++;
          lodColumns.delete(`${packet.cx},${packet.cz}`);
        } else {
          const key = `${packet.cx},${packet.cz}`; if (world.columns.has(key)) forgetColumn(key); lodColumns.add(key);
        }
        scene.packet(event.data.slice(0));
        for (const edit of pendingEdits.values()) if (packet.type === "section" && edit.x>>5 === packet.cx && edit.y>>5 === packet.sy && edit.z>>5 === packet.cz) { setBlock(world, edit.x, edit.y, edit.z, edit.block); scene.edit(edit.x, edit.y, edit.z, edit.block); }
        return;
      }
      const data = JSON.parse(event.data);
      if (data.type === "welcome") {
        myId = data.id; world = createWorld(data.meta.seed, data.meta.mode, false); world.tick = data.meta.tick; world.revision = data.meta.revision;
        authoritative.clear(); authoritative.set(myId, data.player); local = structuredClone(data.player);
        pending = []; pendingEdits.clear(); history.length = 0; lodColumns.clear(); seq = editId = 0; binaryBytes = sectionPackets = confirmations = rollbacks = 0;
        joined = true; scene.reset(data.meta.seed, data.meta.mode); app.classList.add("playing"); byId("lobby").hidden = true;
        scene.renderer.domElement.focus(); toast("Click Capture mouse to look around. V changes camera.");
      } else if (data.type === "column") {
        world.columns.add(`${data.cx},${data.cz}`);
        // Reconstruct the source heights once, for incremental predicted lighting.
        const column = world.light.columns.get(`${data.cx},${data.cz}`);
        if (column) for (let z=0;z<32;z++) for (let x=0;x<32;x++) {
          let y=191; while(y>=0 && (column.values[(y*32+z)*32+x]&15)===15) y--; column.top[z*32+x]=y;
        }
      } else if (data.type === "unload") forgetColumn(data.key);
      else if (data.type === "state") {
        const state = data as Snapshot; world.tick = state.tick; world.revision = state.revision; online = state.online; save = state.save;
        for (const id of state.removed) authoritative.delete(id);
        for (const delta of state.players) authoritative.set(delta.id, { ...authoritative.get(delta.id), ...delta } as Player);
        const own = authoritative.get(myId);
        if (own) { local = structuredClone(own); pending = pending.filter(input => input.seq > own.ack); for (const input of pending) movePlayer(world, local, input); }
        history.push({ at: performance.now(), players: structuredClone([...authoritative.values()]) });
        while (history.length > 30) history.shift();
      } else if (data.type === "edit" || data.type === "edit-result") {
        if (data.type === "edit-result") { pendingEdits.delete(data.id); if (data.reason) { rollbacks++; toast(data.reason); } else confirmations++; }
        setBlock(world, data.x, data.y, data.z, data.block); scene.edit(data.x, data.y, data.z, data.block); world.revision = data.revision ?? world.revision;
      }
    });
    socket.addEventListener("close", event => {
      joined = false; keys.clear(); pending = []; pendingEdits.clear(); app.classList.remove("playing");
      if (document.pointerLockElement) document.exitPointerLock();
      byId<HTMLButtonElement>("join").disabled = false; byId("lobby").hidden = false; byId("join-status").textContent = event.reason || "Disconnected. Enter world to reconnect.";
    });
    socket.addEventListener("error", () => { byId("join-status").textContent = "Could not reach the world server. Check the dev terminal."; });
  } catch (error) { byId("join-status").textContent = String(error); byId<HTMLButtonElement>("join").disabled = false; }
}
window.addEventListener("keydown", event => {
  if (!joined || (event.target as HTMLElement).tagName === "INPUT") return;
  if (["Space","Tab"].includes(event.code)) event.preventDefault();
  keys.add(event.code); if (event.repeat) return;
  if (event.code === "Space") jump = true;
  if (event.code === "KeyV") scene.firstPerson = !scene.firstPerson;
  if (event.code === "Escape" && document.pointerLockElement) document.exitPointerLock();
  if (/^Digit[1-5]$/.test(event.code)) select(buildBlocks[Number(event.code.slice(-1))-1]);
});
window.addEventListener("keyup", event => keys.delete(event.code));
window.addEventListener("blur", () => { keys.clear(); jump=false; });
document.addEventListener("visibilitychange", () => { if (document.hidden) { keys.clear(); jump=false; } });
scene.renderer.domElement.addEventListener("contextmenu", event => event.preventDefault());
scene.renderer.domElement.addEventListener("pointerdown", event => {
  if (!joined || !local || socket?.readyState !== WebSocket.OPEN || ![0,2].includes(event.button)) return;
  scene.pick(world, local); const h=scene.hover; if (!h) return;
  const place=event.button===2, x=h.x+(place?h.nx:0), y=h.y+(place?h.ny:0), z=h.z+(place?h.nz:0), block=place?selected:0;
  if ([...pendingEdits.values()].some(edit=>edit.x===x&&edit.y===y&&edit.z===z)) return;
  const before=blockAt(world,x,y,z), reason=editBlock(world,[...authoritative.values()].map(p=>p.id===myId?local!:p),local,x,y,z,block);
  if (reason) { toast(reason); return; }
  const id=++editId; pendingEdits.set(id,{x,y,z,block,before}); scene.edit(x,y,z,block);
  socket.send(JSON.stringify({type:"edit",id,x,y,z,block}));
});
setInterval(() => {
  if (!joined || !local || socket?.readyState !== WebSocket.OPEN || !world.columns.has(`${Math.floor(local.x/32)},${Math.floor(local.z/32)}`)) return;
  if (pending.length >= ENGINE.inputQueueLimit) { socket.close(1000,"Connection is too far behind. Reconnect to continue."); return; }
  const movement=scene.movement(Number(keys.has("KeyD"))-Number(keys.has("KeyA")),Number(keys.has("KeyS"))-Number(keys.has("KeyW")));
  const input: Input={...movement,jump,sprint:keys.has("ShiftLeft")||keys.has("ShiftRight"),seq:++seq}; jump=false;
  socket.send(JSON.stringify({type:"input",...input})); pending.push(input); movePlayer(world,local,input);
},50);
function interpolated(now: number): Player[] {
  const target=now-ENGINE.interpolationMs;
  let a=history[0],b=history.at(-1);
  for (let i=1;i<history.length;i++) if(history[i].at>=target){a=history[i-1];b=history[i];break;}
  const result:Player[]=[];
  if(a&&b) for(const current of b.players){
    if(current.id===myId)continue;
    const before=a.players.find(p=>p.id===current.id)??current,t=Math.max(0,Math.min(1,(target-a.at)/Math.max(1,b.at-a.at)));
    result.push({...current,x:before.x+(current.x-before.x)*t,y:before.y+(current.y-before.y)*t,z:before.z+(current.z-before.z)*t});
  }
  if(local)result.push(local);return result;
}
const frameTimes=new Float32Array(3600),cpuTimes=new Float32Array(3600);let frameCount=0,last=performance.now();
function frame(now:number){
  const start=performance.now(),dt=Math.min((now-last)/1000,0.1);
  renderedPlayers=interpolated(now);scene.update(world,renderedPlayers,local,dt);
  if(joined&&!document.hidden&&now-last<1000){frameTimes[frameCount%3600]=now-last;cpuTimes[frameCount%3600]=performance.now()-start;frameCount++;}
  last=now;requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(()=>{
  byId("room-status").textContent=joined?`${room} · ${online}/8`:"Hoshino Meadows";
  byId("save-state").textContent=save;byId("stream-state").textContent=`${world.columns.size} detailed · ${lodColumns.size} distant columns`;
  byId("camera-mode").textContent=scene.firstPerson?"First person":"Third person";byId("toast").hidden=performance.now()>toastUntil;
},150);
// Detached snapshots only. No mutable world references or gameplay setters.
Object.defineProperty(window,"tickwright",{value:Object.freeze({
  inspect:()=>({joined,room,id:myId,tick:world.tick,seed:world.seed,revision:world.revision,players:structuredClone([...authoritative.values()]),predicted:structuredClone(local),renderedPlayers:structuredClone(renderedPlayers),online,save,
    sections:world.sections.size,columns:world.columns.size,lodColumns:lodColumns.size,sectionPackets,binaryBytes,pendingInputs:pending.length,pendingEdits:pendingEdits.size,confirmations,rollbacks,
    camera:scene.firstPerson?"first":"third",pointerLocked:!!document.pointerLockElement,hover:scene.hover?{...scene.hover}:null,meshJobs:scene.meshJobs,meshes:scene.terrain.size,
    drawCalls:scene.renderer.info.render.calls,triangles:scene.renderer.info.render.triangles,viewport:{width:innerWidth,height:innerHeight,dpr:scene.renderer.getPixelRatio()},frames:frameCount,
    light:scene.hover?lightAt(world,scene.hover.x,scene.hover.y+1,scene.hover.z):null,cpuFrames:Array.from(cpuTimes.slice(0,Math.min(frameCount,3600))),}),
  block:(x:number,y:number,z:number)=>blockAt(world,x,y,z),project:(x:number,y:number,z:number)=>scene.project(x,y,z),frames:()=>Array.from(frameTimes.slice(0,Math.min(frameCount,3600))),
})});
