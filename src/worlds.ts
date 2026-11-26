/**
 * Dream worlds on this computer: Orvyn Worlds (crates/worlds) runs locally, started on demand on a
 * random local port with a fresh key, and this app signs its own sessions. Only Orvyn Dream runs
 * locally (no GPU, no model); GPU world models run on Orvyn's servers once a world is published.
 *
 * A world game is one file, `orvyn-world/1` (see crates/core/src/games/worlds.rs):
 *   { "format": "orvyn-world/1", "title", "description", "model": "dream", "prompt", "seconds", "size" }
 */
import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

export const WORLD_FORMAT = "orvyn-world/1";
export const isWorld = (game: unknown) => !!game && typeof game === "object" && (game as { format?: unknown }).format === WORLD_FORMAT;

let server: { proc: ChildProcess; port: number; key: string } | null = null;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

/** Start the local Worlds server (once) and wait until it answers. */
export async function ensureWorlds(binary: string) {
  if (server && server.proc.exitCode === null) return server;
  if (!existsSync(binary)) throw new Error("Orvyn Worlds isn't in this build of Vyn (build it with cargo build --release -p orvyn-worlds).");
  const key = randomBytes(32).toString("hex");
  const port = await freePort();
  const dataDir = join(app.getPath("userData"), "worlds");
  mkdirSync(dataDir, { recursive: true });
  const proc = spawn(binary, [], { env: { ...process.env, WORLDS_KEY: key, PORT: String(port), DATA_DIR: dataDir, WORLDS_SLOTS: "2", WORLDS_IDLE_SECONDS: "300" }, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr?.on("data", (d) => console.log(`[worlds] ${String(d).trim()}`));
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error("Orvyn Worlds stopped as it started.");
    const up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false);
    if (up) {
      server = { proc, port, key };
      return server;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error("Orvyn Worlds didn't start.");
}

export function stopWorlds() {
  server?.proc.kill();
  server = null;
}

/** Problems in a world file, for playing it here. */
export function checkWorld(world: Record<string, unknown>): string[] {
  const p: string[] = [];
  const title = typeof world.title === "string" ? world.title.trim() : "";
  if (!title || title.length > 80) p.push("give the world a title (up to 80 characters)");
  const prompt = typeof world.prompt === "string" ? world.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 2000) p.push("describe the world in the prompt (3–2000 characters)");
  const model = String(world.model ?? "dream");
  if (model !== "dream") p.push(`${model} runs on Orvyn's GPU servers: publish the world on Orvyn to play it there. On this computer, use "dream".`);
  const seconds = Number(world.seconds ?? 300);
  if (!(seconds >= 30 && seconds <= 3600)) p.push("seconds (one visit) must be 30–3600");
  const size = world.size as [number, number] | undefined;
  if (size !== undefined && (!Array.isArray(size) || !(size[0] >= 256 && size[0] <= 1280 && size[1] >= 144 && size[1] <= 720))) p.push("size must be [width, height] within 256x144 and 1280x720");
  return p;
}

/** A fresh session for a local world: the WebSocket URL to play it. */
export async function worldSession(binary: string, world: Record<string, unknown>) {
  const problems = checkWorld(world);
  if (problems.length) throw new Error(problems.join("; "));
  const s = await ensureWorlds(binary);
  const [width, height] = Array.isArray(world.size) ? [Number(world.size[0]), Number(world.size[1])] : [640, 360];
  const claims = {
    sid: `local${randomBytes(6).toString("hex")}`,
    game: "local",
    account: "local",
    model: "dream",
    prompt: String(world.prompt ?? ""),
    image: null,
    seconds: Math.min(3600, Math.max(30, Number(world.seconds ?? 300))),
    width,
    height,
    exp: Math.floor(Date.now() / 1000) + 120,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", s.key).update(`world:${body}`).digest("base64url");
  return { url: `ws://127.0.0.1:${s.port}/play?token=${body}.${sig}`, seconds: claims.seconds };
}

const esc = (s: string) => s.replace(/[<>&"]/g, "");

/** The page a local world plays in (its session comes from vyngame://…/session). */
export const WORLD_PAGE = (title: string, description: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}#c{position:fixed;inset:0;margin:auto;display:block}#hud{position:fixed;top:10px;right:12px;color:#fff;font:600 13px system-ui;background:#0008;padding:4px 10px;border-radius:999px;display:none}
#panel{position:fixed;inset:0;display:grid;place-content:center;gap:12px;text-align:center;color:#fff;background:radial-gradient(circle at 50% 40%,#0006,#000d);padding:20px}#panel h1{margin:0;font-size:24px}#panel p{margin:0;max-width:420px;color:#ddd;white-space:pre-line}#panel button{justify-self:center;padding:10px 20px;border-radius:999px;border:0;background:#fff;color:#000;font:600 15px system-ui;cursor:pointer}</style></head>
<body><canvas id="c"></canvas><div id="hud"></div><div id="panel"><h1>${esc(title)}</h1><p>${esc(description)}\nW A S D to move, arrows to look, space to rise.</p><button id="go">Enter the world</button></div>
<script>
const canvas = document.getElementById("c"), ctx = canvas.getContext("2d"), hud = document.getElementById("hud"), panel = document.getElementById("panel");
const KEYS = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Space: "space", ShiftLeft: "shift", ShiftRight: "shift" };
const show = (t, b, label) => { panel.innerHTML = ""; const h = document.createElement("h1"); h.textContent = t; const p = document.createElement("p"); p.textContent = b || ""; panel.append(h, p); if (label) { const x = document.createElement("button"); x.textContent = label; x.onclick = start; panel.append(x); } panel.style.display = "grid"; };
let w = 640, h = 360;
const fit = () => { const s = Math.min(innerWidth / w, innerHeight / h); canvas.style.width = Math.floor(w * s) + "px"; canvas.style.height = Math.floor(h * s) + "px"; };
addEventListener("resize", fit);
async function start() {
  show("Opening the world…", "");
  const r = await fetch("session").then((x) => x.json()).catch(() => ({ error: "Couldn't start the world." }));
  if (!r.url) return show("Can't open this world", r.error, "Try again");
  const ws = new WebSocket(r.url); ws.binaryType = "blob";
  const held = new Set(); let drawing = false, ended = false;
  const send = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "keys", keys: [...held] }));
  const down = (e) => { const k = KEYS[e.code]; if (!k) return; e.preventDefault(); if (!held.has(k)) { held.add(k); send(); } };
  const up = (e) => { const k = KEYS[e.code]; if (k && held.delete(k)) send(); };
  addEventListener("keydown", down); addEventListener("keyup", up);
  const beat = setInterval(send, 20000);
  const finish = (t, b) => { if (ended) return; ended = true; clearInterval(beat); removeEventListener("keydown", down); removeEventListener("keyup", up); hud.style.display = "none"; show(t, b, "Enter again"); };
  ws.onmessage = async (m) => {
    if (typeof m.data === "string") {
      const v = JSON.parse(m.data);
      if (v.type === "loading") show("Loading the world…", "");
      else if (v.type === "ready") { w = v.width; h = v.height; canvas.width = w; canvas.height = h; fit(); panel.style.display = "none"; hud.style.display = "block"; }
      else if (v.type === "time") hud.textContent = Math.floor(v.left / 60) + ":" + String(v.left % 60).padStart(2, "0");
      else if (v.type === "busy" || v.type === "error") finish("Can't open this world", v.message);
      else if (v.type === "ended") finish("The visit ended", v.reason === "time's up" ? "Your time in this world is up." : v.reason);
      return;
    }
    if (drawing) return; drawing = true;
    try { const b = await createImageBitmap(m.data); ctx.drawImage(b, 0, 0, w, h); b.close(); } finally { drawing = false; }
  };
  ws.onclose = () => finish("The visit ended", "");
}
document.getElementById("go").onclick = start;
</script></body></html>`;
