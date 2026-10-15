import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { decodeSection } from "../packages/sim/src/section";

const http = httpRouter();
const world = httpAction(async (ctx, request) => {
  const secret = process.env.WORLD_SERVER_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url), room = url.searchParams.get("room") ?? "";
  if (!/^[a-z0-9-]{1,48}$/.test(room)) return new Response("Invalid room", { status: 400 });
  if (request.method === "GET") {
    if (url.searchParams.has("cx")) {
      const cx = Number(url.searchParams.get("cx")), cz = Number(url.searchParams.get("cz"));
      if (![cx, cz].every(Number.isInteger) || cx < -32 || cx > 31 || cz < -32 || cz > 31) return new Response("Invalid column", { status: 400 });
      const sections = await ctx.runQuery(internal.worlds.loadColumn, { room, cx, cz });
      return Response.json({ sections: sections.map(s => ({ ...s, data: Array.from(new Uint8Array(s.data)) })) });
    }
    if (url.searchParams.has("identity")) return Response.json({ state: await ctx.runQuery(internal.worlds.loadPlayer, { room, identity: url.searchParams.get("identity")! }) });
    if (url.searchParams.has("manifest")) return Response.json(await ctx.runQuery(internal.worlds.manifest, { room, paginationOpts: { numItems: 64, cursor: url.searchParams.get("cursor") } }));
    return Response.json({ meta: await ctx.runQuery(internal.worlds.load, { room }) });
  }
  const text = await request.text();
  if (text.length > 8_000_000) return new Response("Too large", { status: 413 });
  try {
    const parsed = JSON.parse(text), meta = parsed.meta;
    if (meta?.version !== 2 || !Number.isSafeInteger(meta.tick) || meta.tick < 0 || !Number.isSafeInteger(meta.seed) || !Number.isSafeInteger(meta.revision) || !["meadows", "flat"].includes(meta.mode) || !Array.isArray(meta.scheduled) || !Number.isSafeInteger(meta.nextOrder) || !Array.isArray(parsed.sections) || !Array.isArray(parsed.players)) throw new Error("Invalid save");
    const sections = parsed.sections.map((s: { key: string; revision: number; data: number[] }) => {
      if (!Array.isArray(s.data) || s.data.length > 200000 || !s.data.every(v => Number.isInteger(v) && v >= 0 && v < 256)) throw new Error("Invalid section bytes");
      const data = Uint8Array.from(s.data); decodeSection(data);
      return { key: s.key, revision: s.revision, data: data.buffer };
    });
    await ctx.runMutation(internal.worlds.save, { room, meta: JSON.stringify(meta), tick: meta.tick, sections, players: parsed.players });
    return Response.json({ saved: true, sections: sections.length });
  } catch (error) {
    console.error("Invalid world save", error instanceof Error ? error.message : "Unknown error");
    return new Response("Invalid save", { status: 400 });
  }
});
http.route({ path: "/world", method: "GET", handler: world });
http.route({ path: "/world", method: "POST", handler: world });
export default http;
