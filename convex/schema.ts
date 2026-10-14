import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  worlds: defineTable({
    room: v.string(),
    snapshot: v.string(),
    tick: v.number(),
    updatedAt: v.number(),
  }).index("by_room", ["room"]),
});
