/**
 * The work pane, beside the chat: Files (the workspace), Editor, Preview (games playing, images,
 * video, audio), Screen (Vyn's browser, live, with take-control), and Make (games, films and
 * Studio renders on this computer).
 */
import { api, h, type TreeNode } from "./bridge";
import * as editor from "./editor";
import { fileIcon, icon, type IconName } from "./icons";

type PaneTab = "files" | "editor" | "preview" | "screen" | "make";
const TABS: [PaneTab, string, IconName][] = [
  ["files", "Files", "folder"],
  ["editor", "Editor", "code"],
  ["preview", "Preview", "eye"],
  ["screen", "Screen", "monitor"],
  ["make", "Make", "wand"],
];

let current: PaneTab = "files";
const panes = {} as Record<PaneTab, HTMLElement>;
let tabButtons: HTMLElement;
const expanded = new Set<string>(["Games", "Films", "Renders"]);
let screenTimer: number | undefined;
let reveal: () => void = () => {};

export function mount(container: HTMLElement, hooks: { show: () => void }) {
  reveal = hooks.show;
  tabButtons = h("div", { class: "seg" });
  const body = h("div", { class: "pane-body" });
  for (const [id] of TABS) {
    panes[id] = h("div", { class: `pane-view ${id}` });
    body.append(panes[id]);
  }
  container.replaceChildren(h("div", { class: "pane-top" }, tabButtons), body);
  editor.mount(panes.editor, () => renderTabs());
  show("files");
}

function renderTabs() {
  tabButtons.replaceChildren(
    ...TABS.map(([id, label, ic]) =>
      h("button", { class: `seg-btn${id === current ? " active" : ""}`, type: "button", onclick: () => show(id) }, icon(ic, 14), h("span", {}, label), id === "editor" && editor.hasTabs() ? h("i", { class: "badge" }) : null),
    ),
  );
}

export function show(tab: PaneTab) {
  current = tab;
  reveal();
  for (const [id] of TABS) panes[id].classList.toggle("hidden", id !== tab);
  renderTabs();
  window.clearInterval(screenTimer);
  if (tab === "files") void refreshFiles();
  if (tab === "screen") {
    void refreshScreen();
    screenTimer = window.setInterval(() => void refreshScreen(), 1500);
  }
  if (tab === "make") void renderMake();
  if (tab === "preview") emptyPreview();
}

const head = (title: Node | string, ...actions: (Node | null)[]) => h("div", { class: "pane-head" }, h("div", { class: "ph-title" }, title), ...actions);
const act = (ic: IconName, label: string, onclick: () => void) => h("button", { class: "btn ghost sm", type: "button", onclick }, icon(ic, 14), label);

// ---------- Files ----------

const MEDIA = /\.(png|jpe?g|webp|gif|svg|mp4|webm|mp3|wav|ogg|m4a)$/i;
const TEXT = /\.(json|html?|css|js|mjs|ts|tsx|md|txt|rhai|py|srt|vtt|csv|xml|ya?ml|toml|excalidraw)$/i;

export async function refreshFiles() {
  const r = await api.desk.tree();
  const view = panes.files;
  if (!r.ok) return void view.replaceChildren(h("p", { class: "error pad" }, r.error ?? ""));
  const list = h("div", { class: "tree" });
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      const isGame = n.dir && n.path.startsWith("Games/") && n.path.split("/").length === 2;
      const open = expanded.has(n.path);
      const row = h(
        "div",
        {
          class: `node${n.dir ? " dir" : ""}`,
          style: { paddingLeft: `${10 + depth * 14}px`, "--depth": String(depth) },
          title: n.path,
          onclick: () => {
            if (n.dir) {
              if (open) expanded.delete(n.path);
              else expanded.add(n.path);
              void refreshFiles();
            } else void openFile(n.path);
          },
        },
        n.dir ? icon(open ? "chevronDown" : "chevronRight", 13, "chev") : h("span", { class: "chev-sp" }),
        n.dir ? (isGame ? icon("game", 14, "t-game") : icon(open ? "folderOpen" : "folder", 14, "t-dir")) : fileIcon(n.name),
        h("span", { class: "nm" }, n.name),
        isGame ? h("button", { class: "row-act", type: "button", title: "Play", onclick: (e: Event) => (e.stopPropagation(), previewGame(n.name)) }, icon("play", 13)) : null,
      );
      list.append(row);
      if (n.dir && open && n.children) walk(n.children, depth + 1);
    }
  };
  walk(r.data!.nodes, 0);
  const ws = r.data!.workspace;
  view.replaceChildren(head(h("span", { title: ws }, ws.split(/[\\/]/).pop() ?? ws), act("folderOpen", "Open folder", () => void api.workshop.open(""))), list);
}

export async function openFile(path: string) {
  if (MEDIA.test(path)) return previewFile(path);
  if (TEXT.test(path)) {
    show("editor");
    return editor.open(path);
  }
  void api.workshop.show(path);
}

// ---------- Preview ----------

const fileUrl = (path: string) => `vynfile://w/${path.split("/").map(encodeURIComponent).join("/")}`;

export function previewFile(path: string) {
  const url = fileUrl(path);
  const media = /\.(mp4|webm)$/i.test(path)
    ? h("video", { src: url, controls: true, autoplay: true })
    : /\.(mp3|wav|ogg|m4a)$/i.test(path)
      ? h("audio", { src: url, controls: true, autoplay: true })
      : h("img", { src: url, alt: path });
  panes.preview.replaceChildren(head(h("span", {}, fileIcon(path), path), act("folderOpen", "Show in folder", () => void api.workshop.show(path))), h("div", { class: "stage" }, media));
  show("preview");
}

/** Play a workspace game right here (sandboxed; it reloads when its files change on save). */
export function previewGame(name: string) {
  const frame = h("iframe", { src: `vyngame://play/${encodeURIComponent(name)}/`, sandbox: "allow-scripts allow-pointer-lock", title: name }) as HTMLIFrameElement;
  panes.preview.replaceChildren(
    head(
      h("span", {}, icon("game", 14), name),
      act("restart", "Restart", () => (frame.src = frame.src)),
      act("pencil", "Edit", () => (show("editor"), void editor.open(`Games/${name}/game.json`))),
      act("external", "Window", () => void api.workshop.playGame(name)),
    ),
    h("div", { class: "stage game" }, frame),
  );
  show("preview");
  frame.focus();
}

function emptyPreview() {
  if (panes.preview.childElementCount) return;
  panes.preview.replaceChildren(h("div", { class: "pane-empty" }, icon("eye", 22), h("b", {}, "Nothing to preview yet"), h("span", {}, "Games Vyn makes play here. Open an image, video or sound from Files to see it.")));
}

// ---------- Screen ----------

async function refreshScreen() {
  const r = await api.screen.capture();
  const view = panes.screen;
  if (!(r.ok && r.data)) {
    view.replaceChildren(h("div", { class: "pane-empty" }, icon("monitor", 22), h("b", {}, "Vyn's browser isn't open"), h("span", {}, "When she browses for you, you'll see it here live. Take control any time to sign in or solve a check yourself; she never sees your passwords.")));
    return;
  }
  view.replaceChildren(
    head(h("span", { title: r.data.url }, icon("globe", 14), r.data.title || r.data.url), h("button", { class: "btn sm", type: "button", onclick: () => void api.screen.control() }, icon("click", 14), "Take control")),
    h("div", { class: "stage" }, h("img", { src: r.data.image, alt: "Vyn's browser" })),
  );
}

// ---------- Make: games, films, Studio ----------

const SPEC_EXAMPLES: Record<string, unknown> = {
  diagram: { width: 720, height: 280, style: "sketch", elements: [{ id: "a", type: "rect", x: 40, y: 100, w: 160, h: 80, label: "Idea" }, { id: "b", type: "ellipse", x: 300, y: 90, w: 180, h: 100, label: "Vyn" }, { id: "c", type: "diamond", x: 560, y: 80, w: 140, h: 120, label: "Done?" }, { type: "arrow", from: "a", to: "b" }, { type: "arrow", from: "b", to: "c" }] },
  "html-still": { files: [{ name: "index.html", content: "<!doctype html><body style='margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#f0b90b;font:700 64px system-ui'>Hello from Vyn</body>" }], viewports: [{ width: 1200, height: 630 }] },
  "design-review": { url: "https://example.com", widths: [375, 1440] },
  ffmpeg: { files: [], args: ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "{out:test.mp4}"] },
  "html-video": { files: [{ name: "index.html", content: "<!doctype html><style>body{margin:0;background:#111}#b{position:absolute;top:300px;width:80px;height:80px;background:#f0b90b;border-radius:50%;animation:m 3s linear forwards}@keyframes m{to{transform:translateX(1100px)}}</style><div id=b></div>" }], width: 1280, height: 720, fps: 30, seconds: 3 },
  reel: { files: [{ name: "index.html", content: "<!doctype html><body><script type=module>import { film, clip, tween } from '/_reel/reel.js'; const f = film({ width: 1280, height: 720, fps: 30, background: '#111' }); f.add(clip({ for: 3, setup: (r) => { const h = document.createElement('h1'); h.textContent = 'Made with Reel'; h.style.cssText = 'color:#fff;font:800 80px system-ui;text-align:center;margin-top:300px'; r.append(h); return h; }, draw: (h, { t }) => { h.style.opacity = tween(t, [0, 1], [0, 1]); } })); f.mount();</script></body>" }] },
};

let studioRenderers: { available: string[]; missing: Record<string, string> } | null = null;

async function renderMake() {
  const view = panes.make;
  const [games, templates, status] = await Promise.all([api.workshop.games(), api.workshop.templates(), api.workshop.status()]);
  const s = status.data ?? {};
  const note = h("pre", { class: "problems hidden" });
  const say = (text: string | null) => {
    note.classList.toggle("hidden", !text);
    note.textContent = text ?? "";
  };

  // Games
  const name = h("input", { placeholder: "Name, e.g. Moss Run", maxlength: 50 }) as HTMLInputElement;
  const tpl = h("select", {}, ...(templates.data ?? []).map((t) => h("option", { value: t.id }, t.name)), h("option", { value: "blank" }, "Blank")) as HTMLSelectElement;
  const gameRows = (games.data ?? []).map((g) =>
    h(
      "div",
      { class: "item" },
      h("span", { class: "grow" }, g.title),
      h("button", { class: "btn sm primary", onclick: () => previewGame(g.name) }, "Play"),
      h("button", { class: "btn sm", onclick: () => (show("editor"), void editor.open(`Games/${g.name}/game.json`)) }, "Edit"),
      h(
        "button",
        {
          class: "btn sm",
          title: "Bots play it and report what they find",
          onclick: async () => {
            say("Bots are playing it…");
            const r = await api.workshop.playtest(g.name);
            if (!r.ok || !r.data?.ok) return say(r.error ?? r.data?.problems?.join("\n") ?? "Couldn't playtest it.");
            say(`${g.title}, playtested:\n- ${(r.data.findings ?? []).join("\n- ")}`);
            if (r.data.sheet) previewFile(r.data.sheet);
          },
        },
        "Playtest",
      ),
      h(
        "button",
        {
          class: "btn sm",
          onclick: async () => {
            say("Checking…");
            const r = await api.workshop.checkGame(g.name);
            say(!r.ok ? (r.error ?? "") : r.data!.ok ? `${g.title}: no problems.` : `${g.title}:\n- ${r.data!.problems.join("\n- ")}`);
          },
        },
        "Check",
      ),
    ),
  );

  // Studio
  const renderer = h("select", {}) as HTMLSelectElement;
  const spec = h("textarea", { rows: 9, spellcheck: false, class: "mono" }) as HTMLTextAreaElement;
  const fillRenderers = () => {
    const caps = studioRenderers;
    renderer.replaceChildren(
      ...(caps ? caps.available : Object.keys(SPEC_EXAMPLES)).map((x) => h("option", { value: x }, x)),
      ...Object.entries(caps?.missing ?? {}).map(([x, why]) => h("option", { value: x, disabled: true, title: why }, `${x} (unavailable)`)),
    );
    if (!spec.value) spec.value = JSON.stringify(SPEC_EXAMPLES[renderer.value] ?? {}, null, 2);
  };
  renderer.onchange = () => (spec.value = JSON.stringify(SPEC_EXAMPLES[renderer.value] ?? {}, null, 2));
  fillRenderers();
  const outputs = h("div", { class: "list" });

  const film = h("p", { class: "muted small" });
  const progress = h("progress", { max: 100, value: 0, class: "hidden" }) as HTMLProgressElement;
  api.on("workshop:progress", (p: { pct: number }) => {
    progress.classList.remove("hidden");
    progress.value = p.pct;
  });

  const check = (ok: unknown, label: string, hint: string) => h("div", { class: "item" }, h("span", { class: `state ${ok ? "ok" : "no"}` }, icon(ok ? "check" : "x", 13)), h("span", { class: "grow" }, label), h("span", { class: "muted small", title: String(ok ?? "") }, ok ? String(ok).split(/[\\/]/).pop()! : hint));

  view.replaceChildren(
    h(
      "section",
      { class: "card" },
      h("h3", {}, icon("game", 15), "Games"),
      h("div", { class: "row" }, name, tpl, h("button", { class: "btn primary", onclick: async () => {
        if (!name.value.trim()) return say("Give the game a name.");
        const r = await api.workshop.newGame(tpl.value, name.value.trim());
        if (!r.ok) return say(r.error ?? "");
        say(r.data!.ok ? null : `- ${r.data!.problems.join("\n- ")}`);
        previewGame(name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
        name.value = "";
      } }, "Create")),
      ...gameRows,
      note,
    ),
    h(
      "section",
      { class: "card" },
      h("h3", {}, icon("clapper", 15), "Films", h("span", { class: "tag" }, "Reel")),
      h("p", { class: "muted small" }, "A film is an HTML page made with Reel: scenes as functions of time, rendered to MP4 with its sound and captions."),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: async () => { const r = await api.workshop.previewFilm(); if (!r.ok) film.textContent = r.error ?? ""; } }, "Preview a film…"),
        h("button", { class: "btn primary", onclick: async () => {
          film.textContent = "";
          const r = await api.workshop.renderFilm();
          progress.classList.add("hidden");
          if (!r.ok) return void (film.textContent = r.error ?? "");
          if (r.data) film.textContent = `Saved ${r.data.video}${r.data.captions.length ? " with captions" : ""}.`;
        } }, "Render a film…")),
      progress,
      film,
    ),
    h(
      "section",
      { class: "card" },
      h("h3", {}, icon("wand", 15), "Studio"),
      h("p", { class: "muted small" }, "Diagrams, stills, design reviews, video edits, HTML video and Reel films, rendered on this computer. Added files are copied into Inputs."),
      h("div", { class: "row" }, renderer,
        h("button", { class: "btn", onclick: async () => {
          const r = await api.workshop.importFiles();
          if (!r.ok || !r.data!.length) return;
          let sp: { files?: unknown[] } = {};
          try { sp = JSON.parse(spec.value || "{}"); } catch { /* replaced */ }
          sp.files = [...(sp.files ?? []), ...r.data!];
          spec.value = JSON.stringify(sp, null, 2);
        } }, "Add files…"),
        h("button", { class: "btn primary", onclick: async () => {
          let body: unknown;
          try { body = JSON.parse(spec.value); } catch (e) { return void outputs.replaceChildren(h("p", { class: "error" }, `The spec isn't valid JSON: ${(e as Error).message}`)); }
          outputs.replaceChildren(h("p", { class: "muted small" }, "Starting Studio and rendering…"));
          if (!studioRenderers) {
            const st = await api.workshop.startStudio();
            if (!st.ok) return void outputs.replaceChildren(h("p", { class: "error" }, st.error ?? ""));
            studioRenderers = st.data!;
            fillRenderers();
          }
          const r = await api.workshop.render(renderer.value, body);
          if (!r.ok) return void outputs.replaceChildren(h("p", { class: "error" }, r.error ?? ""));
          const ws = (await api.desk.tree()).data?.workspace ?? "";
          outputs.replaceChildren(
            ...(r.data!.error ? [h("p", { class: "error" }, r.data!.error)] : []),
            ...r.data!.files.map((f) => {
              const rel = f.file.startsWith(ws) ? f.file.slice(ws.length + 1).split("\\").join("/") : f.file;
              return h("div", { class: "item" }, h("span", { class: `state ${f.ok ? "ok" : "no"}` }, icon(f.ok ? "check" : "x", 13)), fileIcon(rel), h("span", { class: "grow", title: f.notes.join("; ") }, rel.split("/").pop()), h("button", { class: "btn sm", onclick: () => void openFile(rel) }, "Open"));
            }),
          );
        } }, "Render")),
      spec,
      outputs,
    ),
    h(
      "section",
      { class: "card" },
      h("h3", {}, icon("settings", 15), "Setup"),
      check(s.workspace, "Workspace", ""),
      check(s.chrome, "Chrome or Edge", "needed to render"),
      check(s.ffmpeg, "ffmpeg", "needed for video"),
      check(s.reel, "Reel", "not in this build"),
      check(s.studio, "Orvyn Studio", "not in this build"),
      check(s.engine, "Orvyn Engine", "not in this build"),
      h("div", { class: "row" },
        h("button", { class: "btn sm", onclick: async () => (await api.workshop.chooseWorkspace(), void renderMake()) }, "Change workspace…"),
        h("button", { class: "btn sm", onclick: async () => (await api.workshop.locate("chrome"), void renderMake()) }, "Locate Chrome/Edge…"),
        h("button", { class: "btn sm", onclick: async () => (await api.workshop.locate("ffmpeg"), void renderMake()) }, "Locate ffmpeg…")),
    ),
  );
}
