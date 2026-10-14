import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const bun = process.platform === "win32" ? "bun.exe" : "bun";
if (
  !existsSync("node_modules") ||
  !existsSync(".local/install.stamp") ||
  readFileSync(".local/install.stamp", "utf8") !==
    readFileSync("bun.lock", "utf8")
) {
  execFileSync(bun, ["install", "--frozen-lockfile"], { stdio: "inherit" });
  mkdirSync(".local", { recursive: true });
  writeFileSync(".local/install.stamp", readFileSync("bun.lock"));
}
const common = resolve(
  execFileSync("git", ["rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  }).trim(),
);
const claimsFile = resolve(common, "tickwright-ports.json");
const claims = existsSync(claimsFile)
  ? JSON.parse(readFileSync(claimsFile, "utf8"))
  : {};
const hash = createHash("sha256")
  .update(root.toLowerCase())
  .digest()
  .readUInt16BE(0);
async function free(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error) =>
      resolve(error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL"),
    );
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
if (!claims[root]) {
  for (let offset = 0; offset < 1000; offset += 4) {
    const base = 14000 + (hash % 500) * 4 + offset;
    const ports = {
      client: base,
      server: base + 1,
      convex: base + 2,
      site: base + 3,
    };
    const reserved = new Set(Object.values(claims).flatMap(Object.values));
    if (Object.values(ports).some((p) => reserved.has(p))) continue;
    let available = true;
    for (const p of Object.values(ports))
      if (!(await free(p, "127.0.0.1")) || !(await free(p, "::1")))
        available = false;
    if (available) {
      claims[root] = ports;
      break;
    }
  }
  if (!claims[root]) throw new Error("Could not find local ports");
  writeFileSync(claimsFile, JSON.stringify(claims, null, 2));
}
writeFileSync(".local/ports.json", JSON.stringify(claims[root], null, 2));
mkdirSync(".agents/skills", { recursive: true });
mkdirSync(".claude", { recursive: true });
if (!existsSync(".claude/skills"))
  symlinkSync(
    resolve(".agents/skills"),
    resolve(".claude/skills"),
    process.platform === "win32" ? "junction" : "dir",
  );
execFileSync(process.execPath, ["scripts/doctor.mjs"], { stdio: "inherit" });
console.log("Setup ready. Start local play with bun run dev.");
