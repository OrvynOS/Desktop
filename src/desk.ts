/**
 * The desk: everything the full Vyn window needs beyond chat.
 *
 * - Files: the workspace as a tree, read and write (paths can't leave it), served to previews at
 *   vynfile://w/<path> (read-only).
 * - Approvals: Vyn's risky steps (payments, file changes, depending on the person's approval
 *   level) become cards in the chat with Allow / Deny, answered from the window.
 * - Workspace tools: Vyn lists, reads and writes files; a write shows as a diff in the editor.
 * - Agents: the person's Orvyn agents, their activity, and chat with them.
 * - Screen: a live picture of Vyn's browser, and handing control to the person.
 */
import { app, protocol } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { vynApi, vynStream } from "./orvyn";
import { workspace } from "./workshop";

export type ApprovalLevel = "ask" | "edits" | "full";

const settingsFile = () => join(app.getPath("userData"), "desk.json");
export function deskSettings(): { approval: ApprovalLevel } {
  try {
    return { approval: "ask", ...JSON.parse(readFileSync(settingsFile(), "utf8")) };
  } catch {
    return { approval: "ask" };
  }
}
export function setApproval(level: ApprovalLevel) {
  writeFileSync(settingsFile(), JSON.stringify({ ...deskSettings(), approval: level }));
  return deskSettings();
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/** `rel` inside the workspace (absolute path), or an error. */
export function inside(rel: string) {
  const root = resolve(workspace());
  const full = resolve(root, rel.replace(/^[/\\]+/, ""));
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`${rel} is outside the Vyn workspace`);
  return full;
}

const toRel = (full: string) => relative(resolve(workspace()), full).split(sep).join("/");

export interface Node {
  name: string;
  path: string;
  dir: boolean;
  children?: Node[];
}

const HIDDEN = new Set([".git", "node_modules", ".DS_Store", ".chrome"]);

/** The workspace as a tree (at most `depth` levels, 400 entries per folder). */
export function tree(rel = "", depth = 4): Node[] {
  const dir = inside(rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => !HIDDEN.has(d.name))
    .slice(0, 400)
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((d) => {
      const path = toRel(join(dir, d.name));
      return d.isDirectory() ? { name: d.name, path, dir: true, children: depth > 1 ? tree(path, depth - 1) : [] } : { name: d.name, path, dir: false };
    });
}

const TEXT = /\.(json|html?|css|js|mjs|ts|tsx|md|txt|rhai|py|svg|srt|vtt|csv|xml|ya?ml|toml|excalidraw)$/i;

export function readText(rel: string) {
  const full = inside(rel);
  const st = statSync(full);
  if (st.size > 2_000_000) throw new Error(`${rel} is over 2 MB`);
  if (!TEXT.test(full)) throw new Error(`${rel} isn't a text file`);
  return readFileSync(full, "utf8");
}

export function writeText(rel: string, content: string) {
  const full = inside(rel);
  if (!TEXT.test(full)) throw new Error(`${rel}: only text files can be written (${extname(full) || "no extension"})`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return { path: toRel(full), bytes: Buffer.byteLength(content) };
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".glb": "model/gltf-binary", ".json": "application/json", ".txt": "text/plain", ".srt": "text/plain", ".vtt": "text/vtt" };

/** vynfile://w/<path>: workspace files for previews (images, video, audio). Read-only; HTML is served as text. */
export function registerFileProtocol() {
  protocol.handle("vynfile", (req) => {
    try {
      const url = new URL(req.url);
      const full = inside(decodeURIComponent(url.pathname));
      if (!existsSync(full) || !statSync(full).isFile()) return new Response("not found", { status: 404 });
      const type = MIME[extname(full).toLowerCase()] ?? "text/plain; charset=utf-8";
      return new Response(new Uint8Array(readFileSync(full)), { headers: { "content-type": type, "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" } });
    } catch (e) {
      return new Response(String((e as Error).message), { status: 400 });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------

let nextApproval = 1;
const waiting = new Map<number, (ok: boolean) => void>();

/** Show an approval card in the chat and wait for Allow / Deny. */
export function requestApproval(send: (channel: string, payload: unknown) => void, card: { kind: "payment" | "edit" | "action"; title: string; detail?: string; path?: string; before?: string; after?: string }) {
  const id = nextApproval++;
  send("chat:event", { type: "approval", id, ...card });
  return new Promise<boolean>((resolveApproval) => waiting.set(id, resolveApproval));
}

export function answerApproval(id: number, ok: boolean) {
  waiting.get(id)?.(ok);
  waiting.delete(id);
}

/** Deny everything still waiting (the person stopped Vyn). */
export function denyAll() {
  for (const [id, fn] of waiting) {
    fn(false);
    waiting.delete(id);
  }
}

// ---------------------------------------------------------------------------------------------
// Vyn's workspace tools
// ---------------------------------------------------------------------------------------------

export const DESK_TOOLS = ["workspace_list", "workspace_read", "workspace_write"] as const;

function flat(nodes: Node[], out: string[] = []) {
  for (const n of nodes) {
    out.push(n.dir ? `${n.path}/` : n.path);
    if (n.children) flat(n.children, out);
  }
  return out;
}

export async function runDeskTool(name: (typeof DESK_TOOLS)[number], input: Record<string, unknown>, send: (channel: string, payload: unknown) => void) {
  switch (name) {
    case "workspace_list":
      return { workspace: workspace(), files: flat(tree(String(input.dir ?? ""), 3)).slice(0, 500) };
    case "workspace_read": {
      const text = readText(String(input.path));
      return { path: String(input.path), content: text.length > 200_000 ? `${text.slice(0, 200_000)}\n…(truncated)` : text };
    }
    case "workspace_write": {
      const path = String(input.path);
      const after = String(input.content);
      let before = "";
      try {
        before = readText(path);
      } catch {
        // a new file
      }
      if (before === after) return { written: false, reason: "no change" };
      const level = deskSettings().approval;
      if (level === "ask") {
        const ok = await requestApproval(send, { kind: "edit", title: `${before ? "Change" : "Create"} ${path}`, detail: input.why ? String(input.why) : undefined, path, before, after });
        if (!ok) return { written: false, reason: "the person declined this change" };
      }
      const r = writeText(path, after);
      send("desk:file-changed", { path: r.path, before, after, by: "vyn" });
      return { written: true, ...r };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The person's Orvyn agents
// ---------------------------------------------------------------------------------------------

export const listAgents = () => vynApi<{ agents: unknown[] }>("GET", "/agents");
export const agentDetail = (id: string) => vynApi("GET", `/agents/${encodeURIComponent(id)}`);

const agentChats = new Map<string, AbortController>();

export async function chatWithAgent(id: string, message: string, send: (channel: string, payload: unknown) => void) {
  agentChats.get(id)?.abort();
  const ctl = new AbortController();
  agentChats.set(id, ctl);
  try {
    await vynStream(`/agents/${encodeURIComponent(id)}/chat`, { message }, (event) => send("agent:event", { agentId: id, ...event }), ctl.signal);
  } finally {
    agentChats.delete(id);
  }
}

export function stopAgentChats() {
  for (const c of agentChats.values()) c.abort();
  agentChats.clear();
}
