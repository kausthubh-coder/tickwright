import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const ports = JSON.parse(readFileSync(".local/ports.json", "utf8"));
execFileSync(
  process.platform === "win32" ? "bun.exe" : "bun",
  ["run", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, VITE_ROOM_SERVER: `ws://127.0.0.1:${ports.server}` },
  },
);
