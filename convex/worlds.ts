import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";

export const load = internalQuery({
  args: { room: v.string() }, returns: v.union(v.string(), v.null()),
  handler: async (ctx, { room }) => (await ctx.db.query("worlds").withIndex("by_room", q => q.eq("room", room)).unique())?.meta ?? null,
});
export const loadColumn = internalQuery({
  args: { room: v.string(), cx: v.number(), cz: v.number() },
  returns: v.array(v.object({ key: v.string(), revision: v.number(), data: v.bytes() })),
  handler: async (ctx, { room, cx, cz }) => (await ctx.db.query("sections").withIndex("by_room_and_cx_and_cz", q => q.eq("room", room).eq("cx", cx).eq("cz", cz)).take(6)).map(({ key, revision, data }) => ({ key, revision, data })),
});
export const manifest = internalQuery({
  args: { room: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({ keys: v.array(v.string()), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, { room, paginationOpts }) => {
    const page = await ctx.db.query("sections").withIndex("by_room_and_key", q => q.eq("room", room)).paginate(paginationOpts);
    return { keys: page.page.map(s => s.key), cursor: page.continueCursor, done: page.isDone };
  },
});
export const loadPlayer = internalQuery({
  args: { room: v.string(), identity: v.string() }, returns: v.union(v.string(), v.null()),
  handler: async (ctx, { room, identity }) => (await ctx.db.query("playerStates").withIndex("by_room_and_identity", q => q.eq("room", room).eq("identity", identity)).unique())?.state ?? null,
});
export const save = internalMutation({
  args: { room: v.string(), meta: v.string(), tick: v.number(), sections: v.array(v.object({ key: v.string(), revision: v.number(), data: v.bytes() })), players: v.array(v.object({ identity: v.string(), state: v.string() })) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.sections.length > 8 || args.players.length > 8 || args.meta.length > 100000) throw new Error("Save batch exceeds budget");
    const existing = await ctx.db.query("worlds").withIndex("by_room", q => q.eq("room", args.room)).unique();
    if (existing?.meta && existing.tick > args.tick) throw new Error("Stale world save");
    const fields = { room: args.room, meta: args.meta, tick: args.tick, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields); else await ctx.db.insert("worlds", fields);
    for (const section of args.sections) {
      if (section.data.byteLength > 200000) throw new Error("Section exceeds budget");
      const [cx, sy, cz] = section.key.split(",").map(Number);
      if (![cx, sy, cz].every(Number.isInteger) || cx < -32 || cx > 31 || cz < -32 || cz > 31 || sy < 0 || sy > 5) throw new Error("Invalid section key");
      const old = await ctx.db.query("sections").withIndex("by_room_and_key", q => q.eq("room", args.room).eq("key", section.key)).unique();
      if (old && old.revision > section.revision) throw new Error("Stale section save");
      const values = { ...section, room: args.room, cx, cz, updatedAt: Date.now() };
      if (old) await ctx.db.patch(old._id, values); else await ctx.db.insert("sections", values);
    }
    for (const player of args.players) {
      if (player.state.length > 50000 || player.identity.length > 128) throw new Error("Player exceeds budget");
      const old = await ctx.db.query("playerStates").withIndex("by_room_and_identity", q => q.eq("room", args.room).eq("identity", player.identity)).unique();
      const values = { ...player, room: args.room, tick: args.tick, updatedAt: Date.now() };
      if (old) await ctx.db.patch(old._id, values); else await ctx.db.insert("playerStates", values);
    }
    return null;
  },
});
