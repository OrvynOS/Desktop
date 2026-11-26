/**
 * Vyn's workshop: Orvyn Engine, Reel and Orvyn Studio on this computer, for local work.
 *
 * - Workspace: everything Vyn makes or reads lives in Documents/Vyn (Games, Films, Renders,
 *   Inputs). Vyn's tools can't read or write outside it.
 * - Games: Orvyn Engine games as folders (game.json + images and sounds), checked by the engine
 *   itself (its WebAssembly, loaded here) and played in a sandboxed window that reloads on change.
 * - Reel: films rendered to MP4 by the `reel` program (bundled), previewed in a window.
 * - Studio: a local Orvyn Studio worker (bundled `orvyn-studio`), started on demand, that only
 *   this app can call (a random key) and that may read files from the workspace.
 *
 * Rendering uses Chromium (Chrome or Edge installed on the computer) and ffmpeg.
 */
import { app, BrowserWindow, protocol, shell } from "electron";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { checkWorld, isWorld, stopWorlds, WORLD_PAGE, worldSession } from "./worlds";

// ---------------------------------------------------------------------------------------------
// Paths, settings and tools
// ---------------------------------------------------------------------------------------------

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);
const repo = () => resolve(__dirname, "..");

/** A bundled resource (packaged: resources/<name>), or in development: native/ (pnpm build:native), or a checkout of its repository next to this one. */
function resource(packaged: string, ...dev: string[]) {
  if (app.isPackaged) return join(process.resourcesPath, packaged);
  for (const d of dev) {
    const p = join(repo(), d);
    if (existsSync(p)) return p;
  }
  return join(repo(), dev[0]);
}

/** A program's places in development: native/bin, then its repository's release or debug build. */
const native = (repo: string, name: string) => [
  join("native", "bin", exe(name)),
  join("..", repo, "target", "release", exe(name)),
  join("..", repo, "target", "debug", exe(name)),
];

export const paths = {
  reel: () => resource(join("bin", exe("reel")), ...native("orvyn-reel", "reel")),
  studio: () => resource(join("bin", exe("orvyn-studio")), ...native("orvyn-studio", "orvyn-studio")),
  worlds: () => resource(join("bin", exe("orvyn-worlds")), ...native("orvyn-worlds", "orvyn-worlds")),
  engine: () => resource("engine", join("native", "engine"), join("..", "orvyn-engine", "player", "dist")),
  studioLibs: () => resource("studio-libs", join("native", "studio-libs"), join("..", "orvyn-studio", "web", "node_modules")),
  templates: () => join(__dirname, "..", "static", "templates.json"),
};

interface WorkshopSettings {
  workspace?: string;
  chrome?: string;
  ffmpeg?: string;
}
const settingsFile = () => join(app.getPath("userData"), "workshop.json");
function settings(): WorkshopSettings {
  try {
    return JSON.parse(readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}
export function saveSettings(next: WorkshopSettings) {
  writeFileSync(settingsFile(), JSON.stringify({ ...settings(), ...next }, null, 2));
}

export function workspace() {
  const dir = settings().workspace ?? join(app.getPath("documents"), "Vyn");
  for (const sub of ["Games", "Films", "Renders", "Inputs"]) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

/** `rel` inside the workspace, or an error (Vyn's tools never leave it). */
function inWorkspace(p: string) {
  const root = resolve(workspace());
  const full = resolve(root, p);
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`${p} is outside the Vyn workspace (${root})`);
  return full;
}

function onPath(name: string) {
  try {
    return execFileSync(process.platform === "win32" ? "where" : "which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

export function chrome() {
  const s = settings().chrome;
  if (s && existsSync(s)) return s;
  const candidates =
    process.platform === "win32"
      ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function ffmpeg() {
  const s = settings().ffmpeg;
  if (s && existsSync(s)) return s;
  return onPath("ffmpeg");
}

const ffprobe = () => {
  const f = ffmpeg();
  if (!f) return null;
  const sibling = join(dirname(f), exe("ffprobe"));
  return existsSync(sibling) ? sibling : onPath("ffprobe");
};

export function status() {
  return {
    workspace: workspace(),
    chrome: chrome(),
    ffmpeg: ffmpeg(),
    reel: existsSync(paths.reel()) ? paths.reel() : null,
    studio: existsSync(paths.studio()) ? paths.studio() : null,
    engine: existsSync(join(paths.engine(), "orvyn_engine.wasm")) ? paths.engine() : null,
    studioRunning: !!worker,
  };
}

// ---------------------------------------------------------------------------------------------
// Orvyn Engine: checks (its WebAssembly, here) and the play window
// ---------------------------------------------------------------------------------------------

interface EngineExports {
  memory: WebAssembly.Memory;
  orvyn_alloc(len: number): number;
  orvyn_free(ptr: number, len: number): void;
  orvyn_out_ptr(): number;
  orvyn_out_len(): number;
  orvyn_validate(ptr: number, len: number): number;
  orvyn_smoke(ptr: number, len: number, frames: number): number;
  orvyn_playtest(ptr: number, len: number): number;
}
let engineExports: Promise<EngineExports> | null = null;

async function engineCall<T>(input: string, run: (x: EngineExports, p: number, l: number) => number): Promise<T> {
  engineExports ??= WebAssembly.instantiate(readFileSync(join(paths.engine(), "orvyn_engine.wasm")), {}).then((r) => r.instance.exports as unknown as EngineExports);
  const x = await engineExports;
  const bytes = new TextEncoder().encode(input);
  const p = x.orvyn_alloc(bytes.length);
  new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);
  run(x, p, bytes.length);
  x.orvyn_free(p, bytes.length);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.orvyn_out_ptr(), x.orvyn_out_len()))) as T;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "game";
const gameDir = (name: string) => inWorkspace(join("Games", slug(name)));

export function listGames() {
  const root = join(workspace(), "Games");
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "game.json")))
    .map((d) => {
      const file = join(root, d.name, "game.json");
      let title = d.name;
      try {
        title = String(JSON.parse(readFileSync(file, "utf8")).title ?? d.name);
      } catch {
        // shown by its folder name
      }
      return { name: d.name, title, folder: join(root, d.name), updated: statSync(file).mtimeMs };
    })
    .sort((a, b) => b.updated - a.updated);
}

/** A dream world to start from (plays here with Orvyn Dream). */
const DREAM_WORLD = { id: "dream-world", name: "Dream world", blurb: "Describe a place; fly through it as it's generated.", game: { format: "orvyn-world/1", title: "My world", description: "Fly over a land no one has seen before.", model: "dream", prompt: "A golden dusk over endless dunes and still water", seconds: 300, size: [640, 360] } };

export function templates(): { id: string; name: string; blurb: string; game: Record<string, unknown> }[] {
  try {
    return [...JSON.parse(readFileSync(paths.templates(), "utf8")), DREAM_WORLD];
  } catch {
    return [DREAM_WORLD];
  }
}

/** Problems in the game (validation, files it names that aren't in its folder, a headless run). */
export async function checkGame(name: string) {
  const dir = gameDir(name);
  const raw = readFileSync(join(dir, "game.json"), "utf8");
  let game: { assets?: { images?: Record<string, { src: string }>; sounds?: Record<string, string> }; scripts?: Record<string, string> };
  try {
    game = JSON.parse(raw);
  } catch (e) {
    return { ok: false, problems: [`game.json isn't valid JSON: ${(e as Error).message}`] };
  }
  if (isWorld(game)) {
    const problems = checkWorld(game as Record<string, unknown>);
    return { ok: problems.length === 0, problems, folder: dir };
  }
  const problems = (await engineCall<{ problems: string[] }>(raw, (x, p, l) => x.orvyn_validate(p, l))).problems;
  const files = [...Object.values(game.assets?.images ?? {}).map((i) => i.src), ...Object.values(game.assets?.sounds ?? {})].filter((s) => s && !s.startsWith("data:"));
  for (const f of files) if (!existsSync(join(dir, f))) problems.push(`${f} isn't in the game's folder`);
  if (Object.keys(game.scripts ?? {}).some((k) => k.endsWith(".ts"))) problems.push("TypeScript scripts run once the game is published on Orvyn (compiled there); locally, use Rhai or .js scripts");
  if (!problems.length) {
    const smoke = await engineCall<{ errors: string[]; halted: string | null; frames: number }>(raw, (x, p, l) => x.orvyn_smoke(p, l, 600));
    if (smoke.halted) problems.push(`it stopped after ${smoke.frames} frames: ${smoke.halted}`);
    problems.push(...smoke.errors.filter((e) => e !== smoke.halted).map((e) => `while playing: ${e}`));
  }
  return { ok: problems.length === 0, problems, folder: dir };
}

/**
 * Bots play a local game (idle, explorer, random) and report what they found; a contact sheet of
 * snapshots is saved as Games/<name>/playtest.png.
 */
export async function playtestGame(name: string, seconds = 30) {
  const dir = gameDir(name);
  const raw = readFileSync(join(dir, "game.json"), "utf8");
  const game = JSON.parse(raw) as { assets?: { images?: Record<string, { src: string }> } };
  if (isWorld(game)) return { ok: false, problems: ["A dream world is explored, not won: there is nothing for bots to playtest. Open it with Play to look around."] };
  // Sprites for the sheet: PNG files in the game's folder.
  const images: Record<string, string> = {};
  for (const [key, img] of Object.entries(game.assets?.images ?? {})) {
    const src = img.src ?? "";
    if (src.startsWith("data:image/png;base64,")) images[key] = src;
    else if (/\.png$/i.test(src) && existsSync(join(dir, src))) images[key] = readFileSync(join(dir, src)).toString("base64");
  }
  const r = await engineCall<{ problems?: string[]; findings: string[]; runs: { bot: string; status: string; seconds: number; vars: Record<string, unknown> }[]; keys: string[]; can_win: boolean; sheet?: string }>(
    JSON.stringify({ game: raw, options: { seconds: Math.min(120, Math.max(5, seconds)) }, sheet: true, images }),
    (x, p, l) => x.orvyn_playtest(p, l),
  );
  if (r.problems?.length) return { ok: false, problems: r.problems };
  let sheet: string | null = null;
  if (r.sheet) {
    writeFileSync(join(dir, "playtest.png"), Buffer.from(r.sheet, "base64"));
    sheet = relative(workspace(), join(dir, "playtest.png")).split(sep).join("/");
  }
  return {
    ok: true,
    findings: r.findings,
    runs: r.runs.map((x) => ({ bot: x.bot, status: x.status, seconds: Math.round(x.seconds * 10) / 10, vars: x.vars })),
    keys: r.keys,
    canWin: r.can_win,
    sheet,
  };
}

export async function saveGame(name: string, game: unknown) {
  const dir = gameDir(name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "game.json"), JSON.stringify(game, null, 2));
  return checkGame(name);
}

export async function newGame(templateId: string, name: string) {
  const t = templates().find((x) => x.id === templateId);
  const game = t ? { ...t.game, title: name } : { format: "orvyn-game/1", title: name, size: [480, 270], background: "#111318", start: "main", scenes: { main: { entities: [], rules: [] } } };
  if (existsSync(join(gameDir(name), "game.json"))) throw new Error(`There's already a game called ${name}.`);
  return saveGame(name, game);
}

/** Called before the app is ready: the play windows' own scheme. */
export function registerSchemes() {
  // Electron takes one call: the play windows' scheme and the desk's file previews (desk.ts).
  protocol.registerSchemesAsPrivileged([
    { scheme: "vyngame", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: "vynfile", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

const PLAY_PAGE = (title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, "")}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#s{position:fixed;inset:0;display:grid;place-items:center}canvas{display:block;image-rendering:pixelated}#m{color:#ddd;font:14px system-ui;padding:16px;white-space:pre-wrap}</style></head>
<body><div id="s"><canvas id="c"></canvas></div><script type="module">
try {
  const { play } = await import("./engine/player.js");
  const game = await (await fetch("./game/game.json")).json();
  await play({ canvas: document.getElementById("c"), wasm: "./engine/orvyn_engine.wasm", game, asset: (p) => "./game/" + encodeURIComponent(p) });
} catch (e) { const s = document.getElementById("s"); s.textContent = ""; const m = document.createElement("div"); m.id = "m"; m.textContent = e.message; s.append(m); }
</script></body></html>`;

const MIME: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".html": "text/html" };

/** Serve vyngame://play/<game>/… : the page, the engine, and the game's own folder (nothing else). */
export function registerGameProtocol() {
  protocol.handle("vyngame", async (req) => {
    const url = new URL(req.url);
    const [, game, ...rest] = url.pathname.split("/").map(decodeURIComponent);
    // Dream worlds stream from the local Worlds server (ws://127.0.0.1).
    const csp = "default-src 'none'; script-src vyngame: 'unsafe-inline' 'wasm-unsafe-eval' blob:; connect-src vyngame: ws://127.0.0.1:*; img-src vyngame: data: blob:; media-src vyngame: data: blob:; style-src 'unsafe-inline'";
    const reply = (body: BodyInit, type: string, status = 200) => new Response(body, { status, headers: { "content-type": type, "content-security-policy": csp, "cache-control": "no-store" } });
    try {
      const dir = gameDir(game);
      const file0 = JSON.parse(readFileSync(join(dir, "game.json"), "utf8")) as Record<string, unknown>;
      if (isWorld(file0)) {
        if (rest[0] === "session") {
          try {
            return reply(JSON.stringify(await worldSession(paths.worlds(), file0)), "application/json");
          } catch (e) {
            return reply(JSON.stringify({ error: (e as Error).message }), "application/json", 200);
          }
        }
        return reply(WORLD_PAGE(String(file0.title ?? game), String(file0.description ?? "")), "text/html; charset=utf-8");
      }
      if (rest.length === 0 || (rest.length === 1 && rest[0] === "")) {
        const title = file0.title ?? game;
        return reply(PLAY_PAGE(String(title)), "text/html; charset=utf-8");
      }
      let file: string;
      if (rest[0] === "engine" && ["player.js", "orvyn_engine.wasm"].includes(rest[1])) file = join(paths.engine(), rest[1]);
      else if (rest[0] === "game") {
        file = resolve(dir, rest.slice(1).join("/"));
        if (!file.startsWith(dir + sep)) return reply("not found", "text/plain", 404);
      } else return reply("not found", "text/plain", 404);
      if (!existsSync(file)) return reply("not found", "text/plain", 404);
      return reply(new Uint8Array(readFileSync(file)), MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
    } catch (e) {
      return reply(String((e as Error).message), "text/plain", 400);
    }
  });
}

const playWindows = new Map<string, { win: BrowserWindow; watcher: FSWatcher }>();

/** Play a local game in its own sandboxed window; it reloads when the game's files change. */
export function playGame(name: string) {
  const dir = gameDir(name);
  if (!existsSync(join(dir, "game.json"))) throw new Error(`No game called ${name} in the workspace.`);
  const key = slug(name);
  const open = playWindows.get(key);
  if (open && !open.win.isDestroyed()) {
    open.win.webContents.reload();
    open.win.focus();
    return { playing: key };
  }
  let size: [number, number] = [480, 270];
  try {
    size = JSON.parse(readFileSync(join(dir, "game.json"), "utf8")).size ?? size;
  } catch {
    // default size
  }
  const scale = Math.max(1, Math.min(3, Math.floor(960 / size[0])));
  const win = new BrowserWindow({ width: size[0] * scale, height: size[1] * scale + 28, title: name, backgroundColor: "#000000", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(dir, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => !win.isDestroyed() && win.webContents.reload(), 250);
  });
  win.on("closed", () => {
    watcher.close();
    playWindows.delete(key);
  });
  playWindows.set(key, { win, watcher });
  void win.loadURL(`vyngame://play/${encodeURIComponent(key)}/`);
  return { playing: key };
}

export const openFolder = (p: string) => shell.openPath(inWorkspace(p));

// ---------------------------------------------------------------------------------------------
// Reel
// ---------------------------------------------------------------------------------------------

function toolEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const c = chrome();
  const f = ffmpeg();
  if (c) env.CHROME_PATH = c;
  if (f) env.FFMPEG_PATH = f;
  const p = ffprobe();
  if (p) env.FFPROBE_PATH = p;
  return env;
}

function need(what: "chrome" | "ffmpeg" | "reel" | "studio") {
  const s = status();
  if (what === "chrome" && !s.chrome) throw new Error("Rendering needs Chrome or Edge installed (or set its path in Workshop settings).");
  if (what === "ffmpeg" && !s.ffmpeg) throw new Error("Video needs ffmpeg: install it, or set its path in Workshop settings.");
  if (what === "reel" && !s.reel) throw new Error("The reel program isn't included in this build of Vyn.");
  if (what === "studio" && !s.studio) throw new Error("Orvyn Studio isn't included in this build of Vyn.");
}

/** Render a film page to MP4; `onProgress` gets the percent. */
export function renderFilm(page: string, out: string, onProgress?: (pct: number) => void) {
  need("reel");
  need("chrome");
  need("ffmpeg");
  return new Promise<{ video: string; captions: string[]; log: string }>((resolveRender, reject) => {
    const child = spawn(paths.reel(), ["render", page, "-o", out], { cwd: dirname(page), env: toolEnv(), windowsHide: true });
    let log = "";
    const take = (d: Buffer) => {
      const s = d.toString();
      log = (log + s).slice(-20_000);
      const m = [...s.matchAll(/(\d+)% \(/g)].pop();
      if (m) onProgress?.(Number(m[1]));
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(log.trim().split("\n").slice(-6).join("\n") || `reel exited with ${code}`));
      const captions = [".srt", ".vtt"].map((x) => out.replace(/\.mp4$/i, x)).filter((p) => existsSync(p));
      resolveRender({ video: out, captions, log: log.trim().split("\n").slice(-4).join("\n") });
    });
  });
}

/** Write a film page into the workspace (Films/<name>/index.html, with files copied from the workspace) and render it. */
export async function makeFilm(name: string, html: string, files: { name: string; path: string }[] = [], onProgress?: (pct: number) => void) {
  const dir = inWorkspace(join("Films", slug(name)));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  for (const f of files) {
    const from = inWorkspace(f.path);
    const to = resolve(dir, basename(f.name));
    writeFileSync(to, readFileSync(from));
  }
  return renderFilm(join(dir, "index.html"), join(dir, `${slug(name)}.mp4`), onProgress);
}

const previews = new Set<ChildProcess>();

async function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolvePort(port));
    });
    srv.on("error", reject);
  });
}

/** Open a film in a preview window (play, scrub, step frames). */
export async function previewFilm(page: string) {
  need("reel");
  const port = await freePort();
  const child = spawn(paths.reel(), ["preview", page, "--port", String(port)], { cwd: dirname(page), env: toolEnv(), windowsHide: true });
  previews.add(child);
  await new Promise((r) => setTimeout(r, 600));
  const win = new BrowserWindow({ width: 1100, height: 720, title: `Preview · ${basename(dirname(page))}`, backgroundColor: "#111111", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("closed", () => {
    child.kill();
    previews.delete(child);
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

// ---------------------------------------------------------------------------------------------
// Orvyn Studio (local worker)
// ---------------------------------------------------------------------------------------------

let worker: { child: ChildProcess; url: string; key: string } | null = null;

export async function startStudio() {
  if (worker) return worker;
  need("studio");
  const key = randomBytes(32).toString("hex");
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...toolEnv(),
    STUDIO_KEY: key,
    PORT: String(port),
    DATA_DIR: join(app.getPath("userData"), "studio"),
    STUDIO_LIB_DIR: paths.studioLibs(),
    STUDIO_ENGINE_DIR: paths.engine(),
    STUDIO_LOCAL_ROOT: workspace(),
    STUDIO_CONCURRENCY: "1",
    STUDIO_RETENTION_DAYS: "7",
  };
  const child = spawn(paths.studio(), [], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr?.on("data", (d: Buffer) => (log = (log + d.toString()).slice(-8000)));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Orvyn Studio didn't start:\n${log.trim().split("\n").slice(-5).join("\n")}`);
    if (await fetch(`${url}/health`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  worker = { child, url, key };
  child.on("exit", () => (worker = null));
  return worker;
}

export function stopStudio() {
  worker?.child.kill();
  worker = null;
}

export async function studioCapabilities() {
  const w = await startStudio();
  const r = await fetch(`${w.url}/capabilities`, { headers: { authorization: `Bearer ${w.key}` } });
  return r.json();
}

const LOCAL_LIMITS = { maxRenderSeconds: 3600, maxVideoSeconds: 1800, maxWidth: 3840, maxHeight: 3840, maxOutputMb: 4000 };

interface RenderResult {
  id: string;
  ok: boolean;
  error: string | null;
  log: string;
  files: { name: string; bytes: number; check: { ok: boolean; notes: string[] } }[];
}

/** Render locally; outputs are saved in Renders/<id>/ in the workspace. */
export async function studioRender(renderer: string, spec: unknown) {
  const w = await startStudio();
  const res = await fetch(`${w.url}/renders`, { method: "POST", headers: { authorization: `Bearer ${w.key}`, "content-type": "application/json" }, body: JSON.stringify({ renderer, spec, limits: LOCAL_LIMITS }) });
  const r = (await res.json()) as RenderResult & { error?: string };
  if (!res.ok || !r.id) throw new Error(r.error ?? `Studio returned HTTP ${res.status}`);
  const dir = inWorkspace(join("Renders", `${new Date().toISOString().slice(0, 10)}-${r.id.slice(-8)}`));
  mkdirSync(dir, { recursive: true });
  const saved: { file: string; ok: boolean; notes: string[] }[] = [];
  for (const f of r.files) {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = createHmac("sha256", w.key).update(`${r.id}/${f.name}:${exp}`).digest("hex");
    const got = await fetch(`${w.url}/files/${r.id}/${encodeURIComponent(f.name)}?exp=${exp}&sig=${sig}`);
    if (!got.ok) continue;
    const file = join(dir, f.name);
    writeFileSync(file, Buffer.from(await got.arrayBuffer()));
    saved.push({ file, ok: f.check.ok, notes: f.check.notes });
  }
  return { ok: r.ok, error: r.error, log: r.log, folder: dir, files: saved };
}

/** Copy a file the person picked into Inputs/ so renders (and Vyn) can use it. */
export function importInput(path: string) {
  const name = basename(path).replace(/[^A-Za-z0-9._-]/g, "_");
  const to = join(workspace(), "Inputs", name);
  writeFileSync(to, readFileSync(path));
  return { name, path: relative(workspace(), to).split(sep).join("/") };
}

/** Local `{ name, path }` inputs are workspace-relative for Vyn: make them absolute for Studio. */
function resolveInputs(spec: Record<string, unknown>) {
  const files = spec.files as { name: string; path?: string }[] | undefined;
  if (!Array.isArray(files)) return spec;
  return { ...spec, files: files.map((f) => (f.path ? { ...f, path: inWorkspace(f.path) } : f)) };
}

// ---------------------------------------------------------------------------------------------
// Vyn's device tools
// ---------------------------------------------------------------------------------------------

export const WORKSHOP_TOOLS = ["local_render", "local_film", "local_game_save", "local_game_play", "local_game_playtest"] as const;

export async function runWorkshopTool(name: (typeof WORKSHOP_TOOLS)[number], input: Record<string, unknown>, onProgress?: (text: string) => void) {
  switch (name) {
    case "local_render": {
      const r = await studioRender(String(input.renderer), resolveInputs((input.spec ?? {}) as Record<string, unknown>));
      return { ...r, files: r.files.map((f) => ({ ...f, file: relative(workspace(), f.file) })), workspace: workspace() };
    }
    case "local_film": {
      const r = await makeFilm(String(input.name), String(input.html), (input.files as { name: string; path: string }[]) ?? [], (p) => onProgress?.(`Rendering… ${p}%`));
      return { video: relative(workspace(), r.video), captions: r.captions.map((c) => relative(workspace(), c)), workspace: workspace() };
    }
    case "local_game_save": {
      const r = await saveGame(String(input.name), input.game);
      return { ok: r.ok, problems: r.problems, folder: relative(workspace(), r.folder ?? "") };
    }
    case "local_game_play":
      return playGame(String(input.name));
    case "local_game_playtest":
      return playtestGame(String(input.name), Number(input.seconds) || 30);
  }
}

export function shutdown() {
  stopStudio();
  stopWorlds();
  for (const p of previews) p.kill();
}
