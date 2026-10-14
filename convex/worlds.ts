import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const load = internalQuery({
  args: { room: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { room }) =>
    (
      await ctx.db
        .query("worlds")
        .withIndex("by_room", (q) => q.eq("room", room))
        .unique()
    )?.snapshot ?? null,
});
export const save = internalMutation({
  args: { room: v.string(), snapshot: v.string(), tick: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.snapshot.length > 600_000)
      throw new Error("World exceeds save budget");
    const existing = await ctx.db
      .query("worlds")
      .withIndex("by_room", (q) => q.eq("room", args.room))
      .unique();
    if (existing && existing.tick > args.tick)
      throw new Error("Stale world save");
    const fields = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("worlds", fields);
    return null;
  },
});
