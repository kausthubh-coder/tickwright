import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const room = process.argv[2];
if (!room || !/^[a-z0-9-]{1,48}$/.test(room))
  throw new Error("Pass a QA room name");
const ports = JSON.parse(readFileSync(".local/ports.json", "utf8"));
const secret = readFileSync(".local/server-token", "utf8");
const response = await fetch(
  `http://127.0.0.1:${ports.site}/world?room=${room}`,
  { headers: { Authorization: `Bearer ${secret}` } },
);
if (!response.ok) throw new Error(`Convex read failed (${response.status})`);
const { snapshot } = await response.json();
if (!snapshot) throw new Error("No saved world");
const world = JSON.parse(snapshot);
console.log(
  JSON.stringify(
    {
      room,
      tick: world.tick,
      revision: world.revision,
      harvested: world.harvested,
      blocksHash: createHash("sha256")
        .update(JSON.stringify(world.blocks))
        .digest("hex"),
      marker: world.blocks[(4 * 48 + 7 + 24) * 56 + 12 + 28],
    },
    null,
    2,
  ),
);
