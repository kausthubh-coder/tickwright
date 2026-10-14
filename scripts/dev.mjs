import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

process.chdir(resolve(import.meta.dirname, ".."));
if (!existsSync(".local/ports.json"))
  execFileSync(process.execPath, ["scripts/setup.mjs"], { stdio: "inherit" });
const ports = JSON.parse(readFileSync(".local/ports.json", "utf8"));
const children = [];
let stopping = false;
function start(file, args, env = {}) {
  const child = spawn(process.execPath, [file, ...args], {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`Dev service exited (${code})`);
      stop();
    }
  });
  return child;
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    try {
      if (process.platform === "win32")
        execFileSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      else c.kill("SIGTERM");
    } catch {}
  }
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
async function wait(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Service did not start: ${url}`);
}
try {
  start(
    "node_modules/convex/bin/main.js",
    [
      "dev",
      "--local-cloud-port",
      String(ports.convex),
      "--local-site-port",
      String(ports.site),
    ],
    { CONVEX_AGENT_MODE: "anonymous" },
  );
  await wait(`http://127.0.0.1:${ports.site}/world?room=health`);
  mkdirSync(".local", { recursive: true });
  const secretPath = ".local/server-token";
  if (!existsSync(secretPath))
    writeFileSync(secretPath, randomBytes(32).toString("hex"));
  const secret = readFileSync(secretPath, "utf8");
  execFileSync(
    process.execPath,
    [
      "node_modules/convex/bin/main.js",
      "env",
      "set",
      "WORLD_SERVER_SECRET",
      secret,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    },
  );
  writeFileSync(
    ".dev.vars",
    `CONVEX_SITE_URL=http://127.0.0.1:${ports.site}\nWORLD_SERVER_SECRET=${secret}\n`,
  );
  start(
    "node_modules/wrangler/bin/wrangler.js",
    [
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(ports.server),
      "--inspector-port",
      String(ports.server + 6000),
      "--persist-to",
      ".local/worker",
    ],
    { WRANGLER_SEND_METRICS: "false" },
  );
  await wait(`http://127.0.0.1:${ports.server}/health`);
  start(
    "node_modules/vite/bin/vite.js",
    [
      ...(process.argv.includes("--preview") ? ["preview"] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(ports.client),
    ],
    { VITE_ROOM_SERVER: `ws://127.0.0.1:${ports.server}` },
  );
  writeFileSync(
    ".local/processes.json",
    JSON.stringify(
      {
        root: process.cwd(),
        startedAt: new Date().toISOString(),
        supervisor: process.pid,
        children: children.map((c) => c.pid),
      },
      null,
      2,
    ),
  );
  console.log(`\nPLAY: http://127.0.0.1:${ports.client}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Dev startup failed");
  stop();
}
