import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
let good = true;
for (const [path, label] of [
  ["node_modules", "Dependencies"],
  [".local/ports.json", "Checkout ports"],
  [".claude/skills", "Agent skill link"],
]) {
  const ok = existsSync(path);
  console.log(
    `${ok ? "OK" : "MISSING"} ${label}${ok ? "" : ": run bun run setup"}`,
  );
  good &&= ok;
}
if (existsSync(".local/ports.json")) {
  const p = JSON.parse(readFileSync(".local/ports.json", "utf8"));
  console.log(
    `Client http://127.0.0.1:${p.client} · rooms ${p.server} · Convex ${p.convex}/${p.site}`,
  );
}
try {
  console.log(
    `Commits behind origin/main: ${execFileSync("git", ["rev-list", "--count", "HEAD..origin/main"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()}`,
  );
} catch {
  console.log("No origin/main configured. Local branch only.");
}
process.exitCode = good ? 0 : 1;
