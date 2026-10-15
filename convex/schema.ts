import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Retain legacy snapshots without interpreting or deleting the old island data.
  worlds: defineTable({ room: v.string(), snapshot: v.optional(v.string()), meta: v.optional(v.string()), tick: v.number(), updatedAt: v.number() }).index("by_room", ["room"]),
  sections: defineTable({ room: v.string(), key: v.string(), cx: v.number(), cz: v.number(), revision: v.number(), data: v.bytes(), updatedAt: v.number() })
    .index("by_room_and_key", ["room", "key"]).index("by_room_and_cx_and_cz", ["room", "cx", "cz"]),
  playerStates: defineTable({ room: v.string(), identity: v.string(), state: v.string(), tick: v.number(), updatedAt: v.number() }).index("by_room_and_identity", ["room", "identity"]),
});
