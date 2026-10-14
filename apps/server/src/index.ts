/// <reference types="@cloudflare/workers-types" />
import {
  Server,
  routePartykitRequest,
  type Connection,
  type ConnectionContext,
} from "partyserver";
import { verifySession } from "./auth";
import {
  createWorld,
  createPlayer,
  stepWorld,
  editBlock,
  idleInput,
  type World,
  type Player,
  type Input,
  type Snapshot,
} from "../../../packages/sim/src/world";

interface Env {
  WorldRoom: DurableObjectNamespace<WorldRoom>;
  CONVEX_SITE_URL: string;
  WORLD_SERVER_SECRET: string;
  CLERK_ISSUER?: string;
  CLIENT_ORIGIN?: string;
}
export class WorldRoom extends Server<Env> {
  world!: World;
  players = new Map<string, Player>();
  inputs = new Map<string, Input>();
  lastInput = new Map<string, number>();
  timer: ReturnType<typeof setInterval> | undefined;
  saveStatus = "Waiting for first save";
  saveQueue: Promise<void> = Promise.resolve();
  sentRevision = -1;
  async onStart() {
    if (!this.env.CONVEX_SITE_URL || !this.env.WORLD_SERVER_SECRET)
      throw new Error("Run bun run setup to configure Convex saves");
    const response = await fetch(
      `${this.env.CONVEX_SITE_URL}/world?room=${encodeURIComponent(this.name)}`,
      { headers: { Authorization: `Bearer ${this.env.WORLD_SERVER_SECRET}` } },
    );
    if (!response.ok)
      throw new Error(`Convex load failed (${response.status})`);
    const data = (await response.json()) as { snapshot: string | null };
    this.world = data.snapshot ? JSON.parse(data.snapshot) : createWorld();
    this.saveStatus = data.snapshot ? "Saved in Convex" : "New island";
  }
  onConnect(connection: Connection, context: ConnectionContext) {
    if (this.players.size >= 8) {
      connection.close(1008, "This island is full");
      return;
    }
    const name =
      (new URL(context.request.url).searchParams.get("name") ?? "Wanderer")
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .slice(0, 18) || "Wanderer";
    const player = createPlayer(connection.id, name, this.players.size % 6);
    this.players.set(connection.id, player);
    this.inputs.set(connection.id, idleInput());
    connection.send(
      JSON.stringify({
        type: "welcome",
        id: connection.id,
        world: this.world,
        players: [...this.players.values()],
      }),
    );
    this.broadcastState(true);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 50);
  }
  onMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 2048) return;
    const p = this.players.get(connection.id);
    if (!p) return;
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (data?.type === "input") {
      const current = this.inputs.get(p.id)!;
      if (
        !Number.isSafeInteger(data.seq) ||
        data.seq <= current.seq ||
        typeof data.x !== "number" ||
        typeof data.z !== "number" ||
        !Number.isFinite(data.x) ||
        !Number.isFinite(data.z)
      )
        return;
      this.inputs.set(p.id, {
        seq: data.seq,
        x: Math.max(-1, Math.min(1, data.x)),
        z: Math.max(-1, Math.min(1, data.z)),
        jump: current.jump || data.jump === true,
        dash: current.dash || data.dash === true,
        attack: current.attack || data.attack === true,
      });
      this.lastInput.set(p.id, this.world.tick);
    } else if (data?.type === "edit") {
      if (p.attackCd > 0) return;
      const reason = editBlock(
        this.world,
        [...this.players.values()],
        p,
        data.x,
        data.y,
        data.z,
        data.block,
      );
      if (reason)
        connection.send(JSON.stringify({ type: "notice", message: reason }));
      else {
        p.attackCd = 3;
        this.broadcastState(true);
      }
    }
  }
  async onClose(connection: Connection) {
    this.players.delete(connection.id);
    this.inputs.delete(connection.id);
    this.lastInput.delete(connection.id);
    if (!this.players.size) {
      if (this.timer !== undefined) clearInterval(this.timer);
      this.timer = undefined;
      await this.save();
    } else this.broadcastState();
  }
  tick() {
    for (const [id, input] of this.inputs)
      if (this.world.tick - (this.lastInput.get(id) ?? 0) > 10) {
        input.x = 0;
        input.z = 0;
      }
    stepWorld(this.world, [...this.players.values()], this.inputs);
    if (this.world.tick % 2 === 0) this.broadcastState();
    if (this.world.tick % 200 === 0) void this.save();
  }
  broadcastState(force = false) {
    const payload: Snapshot = {
      type: "state",
      tick: this.world.tick,
      revision: this.world.revision,
      players: [...this.players.values()],
      mobs: this.world.mobs,
      drops: this.world.drops,
      harvested: this.world.harvested,
      save: this.saveStatus,
    };
    if (force || this.sentRevision !== this.world.revision) {
      payload.blocks = this.world.blocks;
      this.sentRevision = this.world.revision;
    }
    this.broadcast(JSON.stringify(payload));
  }
  save() {
    const snapshot = JSON.stringify(this.world);
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const response = await fetch(
          `${this.env.CONVEX_SITE_URL}/world?room=${encodeURIComponent(this.name)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.env.WORLD_SERVER_SECRET}`,
              "Content-Type": "application/json",
            },
            body: snapshot,
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.saveStatus = "Saved in Convex";
      } catch (error) {
        this.saveStatus = "Save failed · retrying";
        console.error("World save failed", error);
      }
    });
    return this.saveQueue;
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return Response.json({
        app: "tickwright",
        storage: "convex",
        configured: !!env.CONVEX_SITE_URL,
      });
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const origin = request.headers.get("Origin");
    if (local) {
      if (
        origin &&
        !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)
      )
        return new Response("Forbidden origin", { status: 403 });
    } else {
      if (!env.CLERK_ISSUER || !env.CLIENT_ORIGIN)
        return new Response("Hosted play requires Clerk setup", {
          status: 503,
        });
      if (origin !== env.CLIENT_ORIGIN)
        return new Response("Forbidden origin", { status: 403 });
      try {
        await verifySession(
          url.searchParams.get("token") ?? "",
          env.CLERK_ISSUER,
          env.CLIENT_ORIGIN,
        );
      } catch {
        return new Response("Sign in required", { status: 401 });
      }
      url.searchParams.delete("token");
      request = new Request(url, request);
    }
    if (!/^\/parties\/world-room\/[a-z0-9-]{1,48}$/.test(url.pathname))
      return new Response("Not found", { status: 404 });
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
