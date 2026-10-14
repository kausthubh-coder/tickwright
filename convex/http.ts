import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();
const world = httpAction(async (ctx, request) => {
  const secret = process.env.WORLD_SERVER_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`)
    return new Response("Unauthorized", { status: 401 });
  const room = new URL(request.url).searchParams.get("room") ?? "";
  if (!/^[a-z0-9-]{1,48}$/.test(room))
    return new Response("Invalid room", { status: 400 });
  if (request.method === "GET")
    return Response.json({
      snapshot: await ctx.runQuery(internal.worlds.load, { room }),
    });
  const text = await request.text();
  if (text.length > 600_000) return new Response("Too large", { status: 413 });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (
    parsed.version !== 1 ||
    !Number.isSafeInteger(parsed.tick) ||
    parsed.tick < 0 ||
    !Array.isArray(parsed.blocks)
  )
    return new Response("Invalid save", { status: 400 });
  await ctx.runMutation(internal.worlds.save, {
    room,
    snapshot: text,
    tick: parsed.tick,
  });
  return Response.json({ saved: true });
});
http.route({ path: "/world", method: "GET", handler: world });
http.route({ path: "/world", method: "POST", handler: world });
export default http;
