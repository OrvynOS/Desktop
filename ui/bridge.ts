/** The window's only way to the app (preload.ts): typed. */

export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export interface Settings {
  aiProvider: string;
  aiModel: string;
  persona?: { callMe?: string; tone?: string; about?: string };
  timezone?: string;
  checkInTime?: string | null;
}

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children?: TreeNode[];
}

export interface Agent {
  id: string;
  name: string;
  handle: string | null;
  symbol: string;
  icon: string | null;
  status: string;
  tier: string;
  autopilot: boolean;
  selfHosted: boolean;
}

type R<T> = Promise<Result<T>>;

export interface Bridge {
  authState(): R<{ signedIn: boolean; me?: { name?: string } }>;
  signIn(): R<{ userCode: string; verificationUri: string }>;
  signOut(): R<void>;
  getSettings(): R<{ settings: Settings | null; providers: { id: string; label: string; keyUrl?: string; preferredModel?: string | null }[]; telegram: { available: boolean; chats: { id: number; label: string | null }[] } }>;
  saveSettings(s: Record<string, unknown>): R<unknown>;
  listThreads(): R<{ threads: { id: string; title: string }[] }>;
  createThread(): R<{ thread: { id: string; title: string } }>;
  messages(id: string): R<{ messages: { message: { role: string; content: unknown } }[] }>;
  deleteThread(id: string): R<unknown>;
  send(threadId: string, text: string): R<void>;
  stop(): Promise<void>;
  answer(text: string): R<void>;
  memories(): R<{ memories: { id: number; text: string; kind: string }[] }>;
  forget(id: number): R<unknown>;
  routines(): R<{ routines: { id: string; title: string; nextRunAt: string | null; schedule: { kind: string } }[] }>;
  cancelRoutine(id: string): R<unknown>;
  linkTelegram(): R<{ url: string }>;
  unlinkTelegram(id: number): R<unknown>;
  binance: {
    get(): R<{ connected: boolean; expired?: boolean; tools?: { name: string; read: boolean }[] }>;
    connect(): R<{ url: string }>;
    disconnect(): R<unknown>;
  };
  desk: {
    tree(rel?: string): R<{ workspace: string; nodes: TreeNode[] }>;
    read(rel: string): R<string>;
    write(rel: string, content: string): R<{ path: string; bytes: number }>;
    approve(id: number, ok: boolean): Promise<void>;
    settings(): R<{ approval: "ask" | "edits" | "full" }>;
    setApproval(level: string): R<{ approval: string }>;
  };
  agents: {
    list(): R<{ agents: Agent[] }>;
    get(id: string): R<{ agent: { id: string; name: string; status: string; tier: string }; messages: { role: string; text: string }[]; activity: { kind: string; message: string; at?: string; createdAt?: string }[] }>;
    chat(id: string, message: string): R<void>;
    stop(): R<void>;
  };
  companion: {
    status(): R<{ connected: boolean; thisDevice: boolean; walletHere: string | null; id?: string; handle?: string | null; name?: string; wallet?: string | null }>;
    connect(handle: string): R<{ id: string; handle: string | null }>;
    refresh(): R<{ reported: boolean }>;
    disconnect(forget?: boolean): R<void>;
  };
  screen: {
    capture(): R<{ url: string; title: string; image: string } | null>;
    control(): R<{ url: string }>;
  };
  workshop: {
    status(): R<Record<string, string | boolean | null>>;
    locate(what: "chrome" | "ffmpeg"): R<unknown>;
    chooseWorkspace(): R<unknown>;
    open(rel: string): R<unknown>;
    show(file: string): R<unknown>;
    games(): R<{ name: string; title: string; folder: string }[]>;
    templates(): R<{ id: string; name: string; blurb: string }[]>;
    newGame(templateId: string, name: string): R<{ ok: boolean; problems: string[] }>;
    checkGame(name: string): R<{ ok: boolean; problems: string[] }>;
    playGame(name: string): R<unknown>;
    playtest(name: string): R<{ ok: boolean; problems?: string[]; findings?: string[]; runs?: { bot: string; status: string; seconds: number }[]; sheet?: string | null }>;
    renderFilm(): R<{ video: string; captions: string[] } | null>;
    previewFilm(): R<null>;
    startStudio(): R<{ available: string[]; missing: Record<string, string> }>;
    stopStudio(): R<void>;
    render(renderer: string, spec: unknown): R<{ ok: boolean; error: string | null; folder: string; files: { file: string; ok: boolean; notes: string[] }[] }>;
    importFiles(): R<{ name: string; path: string }[]>;
  };
  on(channel: "chat:event" | "auth:done" | "workshop:progress" | "agent:event" | "desk:file-changed", fn: (payload: any) => void): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const api = (window as unknown as { vyn: Bridge }).vyn;

/** Element helper: h("div", { class: "x", onclick }, child, "text"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string | null | false | undefined)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** A tiny, safe Markdown subset for chat: paragraphs, **bold**, `code`, ```blocks```, links, lists. */
export function md(text: string) {
  const root = h("div", { class: "md" });
  const blocks = text.split(/```/);
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      const body = block.replace(/^[a-z0-9]*\n/i, "");
      root.append(h("pre", {}, h("code", {}, body)));
      return;
    }
    for (const para of block.split(/\n{2,}/)) {
      const lines = para.split("\n").filter((l) => l.trim());
      if (!lines.length) continue;
      const list = lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l));
      const target = list ? h("ul") : h("p");
      for (const [j, line] of lines.entries()) {
        const container = list ? h("li") : target;
        if (!list && j > 0) container.append(h("br"));
        inline(list ? line.replace(/^\s*([-*]|\d+\.)\s/, "") : line, container);
        if (list) target.append(container);
      }
      root.append(target);
    }
  });
  return root;
}

function inline(text: string, into: HTMLElement) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    into.append(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) into.append(h("b", {}, t.slice(2, -2)));
    else if (t.startsWith("`")) into.append(h("code", {}, t.slice(1, -1)));
    else {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      into.append(h("a", { href, target: "_blank", rel: "noreferrer" }, label));
    }
    last = (m.index ?? 0) + t.length;
  }
  into.append(text.slice(last));
}
