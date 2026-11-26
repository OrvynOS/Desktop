/**
 * Ctrl/⌘K: jump to a conversation, an agent, a file or a command. Also Ctrl/⌘N (new chat),
 * Ctrl/⌘. (stop Vyn) and Ctrl/⌘/ (focus the message box).
 */
import { api, h, type TreeNode } from "./bridge";
import * as chat from "./chat";
import * as sidebar from "./sidebar";
import * as work from "./work";
import { fileIcon, icon, type IconName } from "./icons";

const KIND: Record<string, IconName> = { chat: "chat", agent: "bot", pane: "panel", file: "file" };

interface Entry {
  label: string;
  hint: string;
  run: () => void;
}

let overlay: HTMLElement | null = null;

export function install(openSettings: () => void) {
  const commands = (): Entry[] => [
    { label: "New chat with Vyn", hint: "Ctrl N", run: () => void sidebar.newChat() },
    { label: "Stop Vyn", hint: "Ctrl .", run: () => chat.stop() },
    { label: "Files", hint: "pane", run: () => work.show("files") },
    { label: "Editor", hint: "pane", run: () => work.show("editor") },
    { label: "Preview", hint: "pane", run: () => work.show("preview") },
    { label: "Vyn's screen", hint: "pane", run: () => work.show("screen") },
    { label: "Make a game, film or render", hint: "pane", run: () => work.show("make") },
    { label: "Settings", hint: "", run: openSettings },
  ];

  window.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape" && overlay) return close();
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "k") (e.preventDefault(), void open(commands()));
    else if (k === "n") (e.preventDefault(), void sidebar.newChat());
    else if (k === ".") (e.preventDefault(), chat.stop());
    else if (k === "/") (e.preventDefault(), chat.focusInput());
  });
  window.addEventListener("vyn:palette", () => void open(commands()));
}

function close() {
  overlay?.remove();
  overlay = null;
}

const flat = (nodes: TreeNode[], out: string[] = []) => {
  for (const n of nodes) {
    if (!n.dir) out.push(n.path);
    if (n.children) flat(n.children, out);
  }
  return out;
};

async function open(commands: Entry[]) {
  if (overlay) return close();
  const entries: Entry[] = [
    ...sidebar.allThreads().map((t) => ({ label: t.title, hint: "chat", run: () => void sidebar.select("vyn", t.id) })),
    ...sidebar.allAgents().map((a) => ({ label: a.name, hint: "agent", run: () => void sidebar.select("agent", a.id) })),
    ...commands,
  ];
  const q = h("input", { placeholder: "Search chats, agents, files and commands" }) as HTMLInputElement;
  const list = h("div", { class: "pal-list" });
  overlay = h("div", { class: "overlay", onclick: (e: Event) => e.target === overlay && close() }, h("div", { class: "palette" }, h("div", { class: "pal-search" }, icon("search", 16), q), list));
  document.body.append(overlay);
  q.focus();

  // Files load after the palette shows.
  void api.desk.tree().then((r) => {
    if (!r.ok || !overlay) return;
    entries.push(...flat(r.data!.nodes).map((p) => ({ label: p, hint: "file", run: () => void work.openFile(p) })));
    draw();
  });

  let sel = 0;
  let shown: Entry[] = [];
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = entries.filter((e) => words.every((w) => `${e.label} ${e.hint}`.toLowerCase().includes(w))).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(
      ...shown.map((e, i) =>
        h("div", { class: `pal-item${i === sel ? " sel" : ""}`, onmousemove: () => sel !== i && ((sel = i), draw()), onclick: () => pick(e) }, e.hint === "file" ? fileIcon(e.label) : icon(KIND[e.hint] ?? "command", 14), h("span", { class: "grow" }, e.label), h("span", { class: "pal-hint" }, e.hint)),
      ),
      ...(shown.length ? [] : [h("p", { class: "muted small pad" }, "Nothing matches.")]),
    );
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };
  const pick = (e: Entry) => {
    close();
    e.run();
  };
  q.addEventListener("input", () => ((sel = 0), draw()));
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") (e.preventDefault(), (sel = Math.min(shown.length - 1, sel + 1)), draw());
    else if (e.key === "ArrowUp") (e.preventDefault(), (sel = Math.max(0, sel - 1)), draw());
    else if (e.key === "Enter" && shown[sel]) (e.preventDefault(), pick(shown[sel]));
  });
  draw();
}
