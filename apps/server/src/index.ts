/// <reference types="@cloudflare/workers-types" />
import { Server, routePartykitRequest, type Connection, type ConnectionContext } from "partyserver";
import { verifySession } from "./auth";
import { createWorld, createPlayer, stepWorld, editBlock, idleInput, blockAt, collides, restoreWorld, worldMeta, savedSection, type World, type Player, type Input, type SavedSection } from "../../../packages/sim/src/world";
import { ENGINE } from "../../../packages/sim/src/codex/engine";
import { encodeSectionPacket, encodeLodPacket, entityDelta, type Snapshot } from "../../../packages/sim/src/protocol";
import { heightAt, hash } from "../../../packages/sim/src/terrain";
import { Ticker } from "./ticker";

interface Env { WorldRoom: DurableObjectNamespace<WorldRoom>; CONVEX_SITE_URL: string; WORLD_SERVER_SECRET: string; CLERK_ISSUER?: string; CLIENT_ORIGIN?: string }
interface Client {
  identity: string; queue: Input[]; lastSeq: number; previous: Map<string, Player>;
  sent: Map<string, "detail" | "lod">; center: string; wanted: { cx: number; cz: number; detail: boolean }[];
  edits: { id: number; x: number; y: number; z: number; block: number }[]; lastEdit: number;
  retryAt: number;
}
export class WorldRoom extends Server<Env> {
  world!: World;
  players = new Map<string, Player>();
  clients = new Map<string, Client>();
  pendingPlayers = new Map<string, string>();
  prepared = new Map<string, Promise<void>>();
  timer: ReturnType<typeof setInterval> | undefined;
  saveStatus = "Waiting for first save";
  saveQueue: Promise<void> = Promise.resolve();
  streaming = false;
  joining = 0;
  joiningIdentities = new Set<string>();
  saveRetry: ReturnType<typeof setTimeout> | undefined;
  async storage(params = "", body?: unknown) {
    const response = await fetch(`${this.env.CONVEX_SITE_URL}/world?room=${encodeURIComponent(this.name)}${params}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${this.env.WORLD_SERVER_SECRET}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`Convex ${body ? "save" : "load"} failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<any>;
  }
  async onStart() {
    if (!this.env.CONVEX_SITE_URL || !this.env.WORLD_SERVER_SECRET) throw new Error("Run bun run setup to configure Convex saves");
    const data = await this.storage();
    let seed = 19283; for (const c of this.name) seed = hash(seed, c.charCodeAt(0));
    this.world = data.meta ? restoreWorld({ meta: JSON.parse(data.meta), sections: [] }) : createWorld(seed);
    this.world.autoGenerate = false;
    this.saveStatus = data.meta ? "Saved in Convex" : "New world";
  }
  prepareColumn(cx: number, cz: number): Promise<void> {
    const key = `${cx},${cz}`;
    let promise = this.prepared.get(key);
    if (!promise) {
      promise = this.storage(`&cx=${cx}&cz=${cz}`).then(async (data: { sections: SavedSection[] }) => {
        for (const section of data.sections) { this.world.overlays.set(section.key, section); this.world.modified.add(section.key); }
        await this.world.ensureColumnAsync(cx, cz);
      }).catch(error => { this.prepared.delete(key); throw error; });
      this.prepared.set(key, promise);
    }
    return promise;
  }
  async onConnect(connection: Connection, context: ConnectionContext) {
    if (this.players.size + this.joining >= ENGINE.maxPlayers) { connection.close(1008, "This world is full"); return; }
    this.joining++;
    let joiningIdentity: string | undefined;
    try {
      const url = new URL(context.request.url), identity = context.request.headers.get("X-Tickwright-Identity");
      if (!identity) { connection.close(1008, "Identity is missing"); return; }
      if (this.joiningIdentities.has(identity) || [...this.clients.values()].some(c => c.identity === identity)) { connection.close(1008, "This player is already in this world"); return; }
      joiningIdentity = identity; this.joiningIdentities.add(identity);
      await this.saveQueue;
      const saved = await this.storage(`&identity=${encodeURIComponent(identity)}`);
      const savedState = this.pendingPlayers.get(identity) ?? saved.state;
      const state: Player | null = savedState ? JSON.parse(savedState) : null;
      let x = 0.5;
      for (let r = 0; r < 128 && heightAt(this.world.seed, this.world.mode, Math.floor(x), 0) < ENGINE.seaLevel; r++) x = r + 0.5;
      await this.prepareColumn(Math.floor((state?.x ?? x) / 32), Math.floor((state?.z ?? 0.5) / 32));
      const name = (url.searchParams.get("name") ?? "Wanderer").replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 18) || "Wanderer";
      const player = state ? { ...state, id: connection.id, name, ack: 0, jumpBuffer: 0, coyote: 0 } : createPlayer(connection.id, name, this.players.size % 6, this.world);
      if (collides(this.world, player.x, player.y, player.z)) {
        while (player.y < 190 && collides(this.world, player.x, player.y, player.z)) player.y++;
      }
      if (connection.readyState !== WebSocket.OPEN) return;
      this.players.set(connection.id, player);
      this.clients.set(connection.id, { identity, queue: [], lastSeq: 0, previous: new Map(), sent: new Map(), center: "", wanted: [], edits: [], lastEdit: -10, retryAt: 0 });
      connection.send(JSON.stringify({ type: "welcome", id: connection.id, meta: worldMeta(this.world), player }));
      this.sendColumn(connection, Math.floor(player.x / 32), Math.floor(player.z / 32));
      this.broadcastState();
      if (!this.timer) {
        const ticker = new Ticker(Date.now());
        this.timer = setInterval(() => ticker.advance(Date.now(), () => this.tick()), 10);
      }
    } catch (error) { console.error("World join failed", error); connection.close(1011, "World could not load from Convex"); }
    finally { this.joining--; if (joiningIdentity) this.joiningIdentities.delete(joiningIdentity); }
  }
  onMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 2048) return;
    const client = this.clients.get(connection.id); if (!client) return;
    let data; try { data = JSON.parse(message); } catch { return; }
    if (data?.type === "input") {
      if (!Number.isSafeInteger(data.seq) || data.seq <= client.lastSeq || data.seq > client.lastSeq + 100 || !Number.isFinite(data.x) || !Number.isFinite(data.z)) return;
      if (client.queue.length >= ENGINE.inputQueueLimit) { connection.close(1008, "Input queue overflow"); return; }
      client.lastSeq = data.seq;
      client.queue.push({ seq: data.seq, x: Math.max(-1, Math.min(1, data.x)), z: Math.max(-1, Math.min(1, data.z)), jump: data.jump === true, sprint: data.sprint === true });
    } else if (data?.type === "edit" && Number.isSafeInteger(data.id) && [data.x, data.y, data.z, data.block].every(Number.isInteger)) {
      if (client.edits.length >= 8) { connection.send(JSON.stringify({ type: "edit-result", id: data.id, x: data.x, y: data.y, z: data.z, block: this.world.peek(data.x, data.y, data.z), reason: "Build queue is full" })); return; }
      client.edits.push({ id: data.id, x: data.x, y: data.y, z: data.z, block: data.block });
    }
  }
  async onClose(connection: Connection) {
    const client = this.clients.get(connection.id), player = this.players.get(connection.id);
    if (client && player) this.pendingPlayers.set(client.identity, JSON.stringify(player));
    this.clients.delete(connection.id); this.players.delete(connection.id);
    if (!this.players.size) { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.save(true); }
    else { void this.save(false, true); this.broadcastState(); }
  }
  tick() {
    const inputs = new Map<string, Input>();
    for (const [id, client] of this.clients) inputs.set(id, client.queue.shift() ?? { ...idleInput(), seq: this.players.get(id)!.ack });
    stepWorld(this.world, [...this.players.values()], inputs, {}, () => {
      for (const connection of this.getConnections()) {
        const client = this.clients.get(connection.id), player = this.players.get(connection.id);
        if (!client || !player) continue;
        for (const edit of client.edits.splice(0)) {
          const reason = !this.world.columns.has(`${edit.x>>5},${edit.z>>5}`) ? "Terrain is still loading" : this.world.tick - client.lastEdit < 2 ? "Build a little slower" : editBlock(this.world, [...this.players.values()], player, edit.x, edit.y, edit.z, edit.block);
          if (!reason) client.lastEdit = this.world.tick;
          const payload = { type: "edit-result", id: edit.id, author: player.id, x: edit.x, y: edit.y, z: edit.z, block: blockAt(this.world, edit.x, edit.y, edit.z), revision: this.world.revision, reason };
          connection.send(JSON.stringify(payload));
          if (!reason) for (const other of this.getConnections()) if (other.id !== connection.id && this.clients.get(other.id)?.sent.get(`${edit.x >> 5},${edit.z >> 5}`) === "detail") other.send(JSON.stringify({ ...payload, type: "edit" }));
        }
      }
    });
    this.broadcastState();
    if (!this.streaming) void this.stream();
    if (this.world.tick % 20 === 0) this.evictColumns();
    if (this.world.tick % ENGINE.sectionSaveTicks === 0) void this.save(this.world.tick % ENGINE.playerSaveTicks === 0);
  }
  broadcastState() {
    const players = [...this.players.values()];
    for (const connection of this.getConnections()) {
      const client = this.clients.get(connection.id), player = this.players.get(connection.id); if (!client || !player) continue;
      const payload: Snapshot = { type: "state", tick: this.world.tick, revision: this.world.revision, ...entityDelta(players, player, client.previous), online: players.length, save: this.saveStatus };
      connection.send(JSON.stringify(payload));
    }
  }
  evictColumns() {
    // Retain dirty sections until the save acknowledges their exact revision.
    // Everything else can be regenerated or reloaded from Convex on re-entry.
    const retained = new Set<string>();
    for (const client of this.clients.values()) for (const [key, detail] of client.sent) if (detail === "detail") retained.add(key);
    for (const key of this.world.columns) {
      if (retained.has(key) || this.world.anchors.has(key)) continue;
      const [cx,cz]=key.split(",").map(Number);
      if ([...this.players.values()].some(p=>Math.abs(Math.floor(p.x/32)-cx)<=7&&Math.abs(Math.floor(p.z/32)-cz)<=7)) continue;
      const keys=Array.from({length:6},(_,sy)=>`${cx},${sy},${cz}`);
      if(keys.some(key=>this.world.dirty.has(key)))continue;
      for(const sk of keys){this.world.sections.delete(sk);this.world.overlays.delete(sk);this.world.meshDirty.delete(sk);}
      this.world.light.columns.delete(key);this.world.columns.delete(key);this.prepared.delete(key);
    }
  }
  sendColumn(connection: Connection, cx: number, cz: number) {
    for (let sy = 0; sy < 6; sy++) connection.send(encodeSectionPacket(this.world, cx, sy, cz));
    connection.send(JSON.stringify({ type: "column", cx, cz }));
    this.clients.get(connection.id)?.sent.set(`${cx},${cz}`, "detail");
  }
  async stream() {
    this.streaming = true;
    try {
      // Light changes from a neighbor's arrival are sent only to existing subscribers.
      const changed = [...this.world.meshDirty]; this.world.meshDirty.clear(); this.world.lightChanged.clear();
      for (const key of changed) {
        const [cx, sy, cz] = key.split(",").map(Number); if (sy < 0 || sy > 5 || !this.world.columns.has(`${cx},${cz}`)) continue;
        let packet: ArrayBuffer | undefined;
        for (const connection of this.getConnections()) if (this.clients.get(connection.id)?.sent.get(`${cx},${cz}`) === "detail") connection.send(packet ??= encodeSectionPacket(this.world, cx, sy, cz));
      }
      for (const connection of this.getConnections()) {
        const client = this.clients.get(connection.id), p = this.players.get(connection.id); if (!client || !p) continue;
        if (Date.now() < client.retryAt) continue;
        const cx = Math.floor(p.x / 32), cz = Math.floor(p.z / 32), center = `${cx},${cz}`;
        if (client.center !== center) {
          client.center = center; client.wanted = [];
          const wanted = new Map<string, boolean>();
          for (let z = -12; z <= 12; z++) for (let x = -12; x <= 12; x++) {
            if (x*x + z*z > 144 || cx+x < -32 || cx+x > 31 || cz+z < -32 || cz+z > 31) continue;
            const detail = x*x + z*z <= 36; wanted.set(`${cx+x},${cz+z}`, detail);
            if (client.sent.get(`${cx+x},${cz+z}`) !== (detail ? "detail" : "lod")) client.wanted.push({ cx: cx+x, cz: cz+z, detail });
          }
          client.wanted.sort((a,b) => (a.cx-cx)**2 + (a.cz-cz)**2 - (b.cx-cx)**2 - (b.cz-cz)**2);
          for (const key of client.sent.keys()) if (!wanted.has(key)) { client.sent.delete(key); connection.send(JSON.stringify({ type: "unload", key })); }
        }
        for (let n = 0; n < ENGINE.columnsPerStreamTick; n++) {
          const next = client.wanted.shift(); if (!next) break;
          if (next.detail) {
            try { await this.prepareColumn(next.cx, next.cz); }
            catch (error) { client.wanted.unshift(next); client.retryAt = Date.now() + 1000; throw error; }
            if (this.clients.has(connection.id)) this.sendColumn(connection, next.cx, next.cz);
          }
          else { connection.send(encodeLodPacket(this.world, next.cx, next.cz)); client.sent.set(`${next.cx},${next.cz}`, "lod"); }
        }
      }
    } catch (error) { console.error("Chunk streaming failed", error); }
    finally { this.streaming = false; }
  }
  save(allPlayers: boolean, playersOnly = false) {
    this.saveQueue = this.saveQueue.then(async () => {
      const sections = playersOnly ? [] : [...this.world.dirty.keys()].map(key => savedSection(this.world, key));
      if (allPlayers) for (const [id, p] of this.players) this.pendingPlayers.set(this.clients.get(id)!.identity, JSON.stringify(p));
      const players = [...this.pendingPlayers].map(([identity, state]) => ({ identity, state })), meta = worldMeta(this.world);
      try {
        for (let offset = 0; offset < Math.max(1, sections.length, players.length); offset += 8) {
          const batch = sections.slice(offset, offset + 8), playerBatch = players.slice(offset, offset + 8);
          await this.storage("", { meta, sections: batch, players: playerBatch });
          for (const section of batch) if (this.world.dirty.get(section.key) === section.revision) this.world.dirty.delete(section.key);
          for (const p of playerBatch) if (this.pendingPlayers.get(p.identity) === p.state) this.pendingPlayers.delete(p.identity);
        }
        this.saveStatus = "Saved in Convex";
        if (this.saveRetry) { clearTimeout(this.saveRetry); this.saveRetry = undefined; }
      } catch (error) {
        this.saveStatus = "Save failed, retrying"; console.error("World save failed", error);
        // The world tick stops on last leave. Retry independently while dirty
        // sections and player states remain in this live Durable Object.
        this.saveRetry ??= setTimeout(() => { this.saveRetry = undefined; void this.save(true); }, 5000);
      }
    });
    return this.saveQueue;
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ app: "tickwright", storage: "convex", configured: !!env.CONVEX_SITE_URL && !!env.WORLD_SERVER_SECRET });
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), origin = request.headers.get("Origin");
    let identity: string;
    if (local) {
      if (origin && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) return new Response("Forbidden origin", { status: 403 });
      const guest = url.searchParams.get("guest") ?? "";
      if (!/^[a-zA-Z0-9-]{16,64}$/.test(guest)) return new Response("Local guest identity required", { status: 400 });
      identity = `guest:${guest}`;
    } else {
      if (!env.CLERK_ISSUER || !env.CLIENT_ORIGIN) return new Response("Hosted play requires Clerk setup", { status: 503 });
      if (origin !== env.CLIENT_ORIGIN) return new Response("Forbidden origin", { status: 403 });
      try { identity = await verifySession(url.searchParams.get("token") ?? "", env.CLERK_ISSUER, env.CLIENT_ORIGIN); }
      catch { return new Response("Sign in required", { status: 401 }); }
    }
    url.searchParams.delete("token");
    if (!/^\/parties\/world-room\/[a-z0-9-]{1,48}$/.test(url.pathname)) return new Response("Not found", { status: 404 });
    const headers = new Headers(request.headers); headers.set("X-Tickwright-Identity", identity);
    request = new Request(url, { headers, method: request.method, body: request.body });
    return (await routePartykitRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
};
