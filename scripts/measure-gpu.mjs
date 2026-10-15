import puppeteer from "puppeteer-core";
// Measures real-GPU frame and GPU time for the running client (`bun run dev --preview` first).
// Usage: node scripts/measure-gpu.mjs [low|high] [on|off vsync] [url] [samples]
// low = integrated GPU (the mid-laptop target), high = discrete GPU. Opens a visible Chrome window.
// GPU time comes from EXT_disjoint_timer_query_webgl2 wrapped around the game's own animation frame.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ports = JSON.parse(readFileSync(".local/ports.json", "utf8"));
const [mode = "low", vsync = "on", url = `http://127.0.0.1:${ports.client}/`, samples = "5"] = process.argv.slice(2);
const gpuFlag = mode === "low" ? "--force_low_power_gpu" : "--force_high_performance_gpu";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: false,
  userDataDir: mkdtempSync(join(tmpdir(), "fps-")),
  defaultViewport: null,
  args: [gpuFlag, "--use-angle=d3d11", ...(vsync === "off" ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
    "--window-size=1920,1080", "--window-position=0,0", "--no-first-run", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
});
const page = (await browser.pages())[0];
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1.25 });
const errors = [];
let room, gpu, timeToPlayMs;
try {
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__gpu = { ms: [], ok: false };
  let gl, ext, pending = [];
  window.requestAnimationFrame = (cb) => raf((now) => {
    if (!gl) { const c = document.querySelector("canvas"); if (c) { gl = c.getContext("webgl2"); ext = gl && gl.getExtension("EXT_disjoint_timer_query_webgl2"); window.__gpu.ok = !!ext; } }
    let q = null;
    if (ext && !window.__inFrame && !cb.__probe) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    window.__inFrame = true; try { cb(now); window.__inFrame = false; } finally {
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
      if (ext) pending = pending.filter((p) => {
        if (!gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) return true;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) window.__gpu.ms.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p); return false;
      });
    }
  });
});
// Both adapters see the same generated terrain. The timestamped evidence records
// the world's tick because lighting may change between sequential measurements.
room = `qa-m1-gpu-${new Date().toISOString().slice(0,10).replaceAll("-", "")}`;
await page.goto(`${url}?room=${room}`, { waitUntil: "load" });
gpu = await page.evaluate(() => {
  const gl = document.querySelector("canvas").getContext("webgl2");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
});
await page.$eval("#player-name", el => { el.value = ""; });
await page.type("#player-name", "fps-bot");
const joinStarted = Date.now();
await page.click("#join");
await page.waitForFunction(() => window.tickwright?.inspect().joined, { timeout: 20000 });
await page.waitForFunction(() => window.tickwright.inspect().meshes > 0, { timeout: 20000 });
timeToPlayMs = Date.now() - joinStarted;
const streamingStarted = Date.now();
while (true) {
  const s = await page.evaluate(() => { const s = window.tickwright.inspect(); return { joined:s.joined, columns:s.columns, lodColumns:s.lodColumns, meshJobs:s.meshJobs }; });
  if (!s.joined) throw new Error("Disconnected while streaming");
  if (s.columns >= 113 && s.lodColumns >= 328 && s.meshJobs === 0) break;
  if (Date.now()-streamingStarted > 180000) throw new Error(`Full view did not finish in 180 seconds: ${JSON.stringify(s)}`);
  await new Promise(r => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 5000));
const runs = [];
for (let i = 0; i < Number(samples); i++) {
  runs.push(await page.evaluate(() => new Promise((resolve) => {
    const t = []; let last = performance.now(); const start = window.tickwright.inspect(); window.__gpu.ms.length = 0;
    const end = last + 3000;
    function f(now) { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else {
      t.shift(); t.sort((a, b) => a - b);
      const s = window.tickwright.inspect();
      const g = window.__gpu.ms.slice().sort((a, b) => a - b);
      const cpu = [];
      for (let n = Math.max(start.frames, s.frames-3600); n<s.frames; n++) cpu.push(s.cpuFrames[n%3600]);
      cpu.sort((a,b) => a-b);
      resolve({ gpuTimer: window.__gpu.ok, gpuP50: g[Math.floor(g.length * 0.5)], gpuP95: g[Math.floor(g.length * 0.95)], gpuSamples: g.length, frames: t.length, p50: t[Math.floor(t.length * 0.5)], p95: t[Math.floor(t.length * 0.95)],
        fps: t.length / 3, startTick: start.tick, endTick: s.tick, drawCalls: s.drawCalls, triangles: s.triangles,
        cpuP50: cpu[Math.floor(cpu.length*0.5)], cpuP95: cpu[Math.floor(cpu.length*0.95)],
        players: s.players.length, sections: s.sections, columns: s.columns, lodColumns: s.lodColumns, joined: s.joined, pendingInputs: s.pendingInputs, viewport: s.viewport });
    } }
    f.__probe = true; requestAnimationFrame(f);
  })));
}
await page.screenshot({path:`.agents/evidence/m1-gpu-${mode}.png`});
console.log(JSON.stringify({ mode, vsync, gpu, room, measuredAt:new Date().toISOString(), timeToPlayMs, fullViewMs:Date.now()-streamingStarted, cpuScope:"game render callback only; excludes socket and worker-message callbacks", runs: runs.map(r => ({...r, viewport: `${r.viewport.width}x${r.viewport.height}@${r.viewport.dpr}`})), errors }));
if (errors.length || runs.some(r => !r.joined || r.endTick <= r.startTick || !r.gpuTimer || !r.gpuSamples) || /swiftshader/i.test(gpu)) process.exitCode = 1;
} catch (error) {
  const state = await page.evaluate(() => ({ inspect: window.tickwright?.inspect(), text: document.body.innerText })).catch(() => null);
  if (state?.inspect) { delete state.inspect.cpuFrames; delete state.inspect.frameTimes; }
  await page.screenshot({path:`.agents/evidence/m1-gpu-${mode}-failure.png`}).catch(() => {});
  console.log(JSON.stringify({mode, vsync, room, gpu, timeToPlayMs, failure: String(error), state, errors}));
  process.exitCode = 1;
} finally { await browser.close(); }
