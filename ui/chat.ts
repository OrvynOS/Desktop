/**
 * The conversation in the middle: Vyn's threads. The person's own Orvyn agents open here as a
 * status view; talking to one goes through Vyn (she asks it and relays), so there's one conversation.
 *
 * Vyn's replies; what she's doing as a group of steps (spinner while running, a tick when done);
 * approval cards (payments and file changes, the change shown as a diff in the editor); her
 * questions; and Stop. Messages sent while she's working wait in a queue and go next.
 */
import { api, h, md, type Agent, type Result } from "./bridge";
import * as editor from "./editor";
import { face, glance, setFaceMood, talking } from "./face";
import type { Mood } from "./face-art";
import { icon, type IconName } from "./icons";
import * as work from "./work";

export type { Mood };
export type Convo = { kind: "vyn"; id: string; title: string } | { kind: "agent"; id: string; title: string; handle?: string | null };

let titleEl: HTMLElement;
let statusEl: HTMLElement;
let stage: HTMLElement;
let queueEl: HTMLElement;
let input: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;
let mentionMenu: HTMLElement;

let current: Convo | null = null;
const logs = new Map<string, HTMLElement>();
const keyOf = (c: Convo) => `${c.kind}:${c.id}`;

/** Vyn's turn in progress (its thread), and what's waiting behind it. */
let vynBusy: string | null = null;
const queue: { threadId: string; text: string }[] = [];

interface Hooks {
  activity: () => void;
  error: (r: Result<unknown>) => void;
  viaVyn: (text: string) => void;
  agents: () => Agent[];
  name: () => string | undefined;
}
let hooks: Hooks;

// ---------- Vyn's mood and voice ----------

let mood: Mood = "idle";
let settle: number | undefined;
let lastActive = Date.now();
export function setMood(next: Mood) {
  mood = next;
  setFaceMood(next);
  window.clearTimeout(settle);
  if (next === "happy" || next === "sorry") settle = window.setTimeout(() => setMood("idle"), 6000);
}
function wake() {
  lastActive = Date.now();
  if (mood === "sleepy") setMood("idle");
}
window.setInterval(() => {
  if (mood === "idle" && Date.now() - lastActive > 5 * 60_000) setMood("sleepy");
}, 30_000);
for (const ev of ["pointermove", "keydown", "focus"]) window.addEventListener(ev, wake);

export function readAloud(value?: boolean) {
  try {
    if (value !== undefined) localStorage.setItem("readAloud", value ? "1" : "0");
    return localStorage.getItem("readAloud") === "1";
  } catch {
    return false;
  }
}

function speak(text: string) {
  if (!readAloud() || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}]/gu, "").replace(/[`*_#>]/g, ""));
  const voice = speechSynthesis.getVoices().find((v) => /female|zira|samantha|aria|jenny|libby|sonia/i.test(v.name) && v.lang.startsWith(navigator.language.slice(0, 2)));
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.pitch = 1.1;
  u.onstart = () => talking(true);
  u.onend = u.onerror = () => talking(false);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ---------- Layout ----------

export function mount(container: HTMLElement, h0: Hooks) {
  hooks = h0;
  titleEl = h("div", { class: "chat-title" });
  statusEl = h("div", { class: "chat-status hidden" }, h("span", { class: "pulse" }), "Working");
  stage = h("div", { class: "chat-stage" });
  queueEl = h("div", { class: "queue hidden" });
  input = h("textarea", { rows: 1, placeholder: "Ask Vyn anything, or @ an agent" }) as HTMLTextAreaElement;
  sendBtn = h("button", { class: "send", type: "submit", title: "Send (Enter)" }, icon("arrowUp", 16)) as HTMLButtonElement;
  mentionMenu = h("div", { class: "mention hidden" });
  const tool = (name: IconName, label: string, onclick: () => void) => h("button", { class: "chip-btn", type: "button", title: label, onclick }, icon(name, 14), h("span", {}, label));
  const form = h(
    "form",
    { class: "composer" },
    mentionMenu,
    input,
    h(
      "div",
      { class: "composer-bar" },
      tool("at", "Agents", () => insertMention()),
      tool("clip", "Files", () => void attach()),
      h("span", { class: "spacer" }),
      h("span", { class: "hint" }, "Enter to send · Shift Enter for a new line"),
      sendBtn,
    ),
  );
  form.addEventListener("submit", (e) => (e.preventDefault(), busyHere() && !input.value.trim() ? stop() : submit()));
  input.addEventListener("keydown", (e) => {
    if (!mentionMenu.classList.contains("hidden") && mentionList.length && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return mentionKey(e);
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  input.addEventListener("input", () => (grow(), mentionCheck(), refreshControls(), noticeTyping()));
  // Follow new output only while the person is at the bottom; otherwise offer a way back.
  jump = h("button", { class: "jump hidden", type: "button", onclick: () => toBottom(true) }, icon("chevronDown", 14), "Latest") as HTMLButtonElement;
  stage.addEventListener("scroll", () => {
    stuck = stage.scrollHeight - stage.scrollTop - stage.clientHeight < 80;
    if (stuck) jump.classList.add("hidden");
  });
  container.replaceChildren(
    h("header", { class: "chat-head drag" }, titleEl, statusEl),
    stage,
    h("div", { class: "composer-wrap" }, jump, queueEl, form),
  );

  api.on("chat:event", vynEvent);
  api.on("desk:file-changed", fileChanged);
}

function grow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(240, input.scrollHeight)}px`;
}

export const focusInput = () => input.focus();
export const currentConvo = () => current;
const busyHere = () => current?.kind === "vyn" && vynBusy !== null;

function logFor(c: Convo) {
  let el = logs.get(keyOf(c));
  if (!el) {
    el = h("div", { class: "thread" });
    logs.set(keyOf(c), el);
  }
  return el;
}

let stuck = true;
let jump: HTMLButtonElement;
let typingTimer: number | undefined;

/** New output: follow it if the person is at the bottom, else show "Latest". */
function scroll(log: HTMLElement) {
  const sc = log.parentElement;
  if (!sc || !log.isConnected) return;
  if (stuck) sc.scrollTop = sc.scrollHeight;
  else jump.classList.remove("hidden");
}

function toBottom(smooth = false) {
  stuck = true;
  jump.classList.add("hidden");
  stage.scrollTo({ top: stage.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

/** The person is typing: Vyn looks at what they're writing, and settles when they pause. */
function noticeTyping() {
  if (busyHere() || !input.value.trim()) return;
  if (mood === "idle" || mood === "sleepy") setMood("attentive");
  glance(input);
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => {
    if (mood === "attentive" && !busyHere()) setMood("idle");
  }, 1800);
}

function line(log: HTMLElement, kind: "user" | "vyn" | "notice" | "error", text: string) {
  if (kind === "vyn") closeSteps(log);
  const el =
    kind === "user"
      ? h("div", { class: "msg user" }, h("div", { class: "bubble" }, text))
      : kind === "error"
        ? h("div", { class: "msg error" }, icon("x", 14), h("span", {}, text))
        : h("div", { class: `msg ${kind}` }, md(text));
  log.append(el);
  scroll(log);
  return el;
}

function refreshControls() {
  const busy = busyHere();
  statusEl.classList.toggle("hidden", !busy);
  const empty = !input.value.trim();
  sendBtn.classList.toggle("stopping", busy && empty);
  sendBtn.replaceChildren(icon(busy && empty ? "stop" : "arrowUp", busy && empty ? 12 : 16));
  sendBtn.title = busy && empty ? "Stop (Ctrl+.)" : busy ? "Send next (Enter)" : "Send (Enter)";
  sendBtn.disabled = !busy && empty;
  input.placeholder = current?.kind === "agent" ? `Ask ${current.title} through Vyn` : busy ? "Vyn is working. What you send now goes next" : "Ask Vyn anything, or @ an agent";
  queueEl.classList.toggle("hidden", !queue.length);
  queueEl.replaceChildren(
    ...queue.map((q, i) =>
      h("div", { class: "queued" }, h("span", { class: "q-label" }, "Next"), h("span", { class: "grow" }, q.text), h("button", { class: "icon-btn", type: "button", title: "Remove", onclick: () => (queue.splice(i, 1), refreshControls()) }, icon("x", 13))),
    ),
  );
}

// ---------- Opening conversations ----------

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.filter((p: { type?: string }) => p.type === "text").map((p: { text?: string }) => p.text ?? "").join("") : "";

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Up late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
}

function emptyState() {
  const name = hooks.name();
  const ideas: [IconName, string, string, string][] = [
    ["game", "Make a game", "A small platformer you can play right here", "Make me a small platformer with a frog that collects dew."],
    ["clapper", "Make a film", "A 15-second intro with Reel, rendered to MP4", "Make a 15-second intro film for my project with Reel."],
    ["bot", "Ask your agents", "What they did today, in one answer", "What did my agents do today?"],
    ["sparkles", "Plan my week", "Reminders and a daily check-in", "Help me plan this week and set reminders."],
  ];
  return h(
    "div",
    { class: "empty-state" },
    face(84),
    h("h1", { class: "hello-title" }, `${greeting()}${name ? `, ${name}` : ""}.`, h("br"), "What are we ", h("em", {}, "making"), "?"),
    h(
      "div",
      { class: "ideas" },
      ...ideas.map(([ic, title, sub, prompt]) =>
        h("button", { class: "idea", type: "button", onclick: () => ((input.value = prompt), grow(), refreshControls(), input.focus()) }, icon(ic, 16), h("b", {}, title), h("span", {}, sub)),
      ),
    ),
  );
}

export async function open(c: Convo) {
  current = c;
  stuck = true;
  jump.classList.add("hidden");
  titleEl.replaceChildren(
    c.kind === "agent" ? icon("bot", 15) : icon("chat", 15),
    h("span", { class: "t" }, c.title),
    c.kind === "agent" ? h("span", { class: "sub" }, "your agent · Vyn talks to it for you") : "",
  );
  const log = logFor(c);
  stage.replaceChildren(log);
  refreshControls();
  if (c.kind === "agent") log.replaceChildren();
  if (!log.childElementCount) {
    if (c.kind === "vyn") {
      const r = await api.messages(c.id);
      if (!r.ok) return hooks.error(r);
      for (const { message } of r.data!.messages) {
        const text = textOf(message.content);
        if (message.role === "user" && text && !text.startsWith("[Scheduled:")) line(log, "user", text);
        if (message.role === "assistant" && text) line(log, "vyn", text);
      }
      if (!log.childElementCount) log.append(emptyState());
    } else {
      const r = await api.agents.get(c.id);
      if (!r.ok) return hooks.error(r);
      const { agent, messages, activity } = r.data!;
      log.append(
        h(
          "section",
          { class: "agent-sheet" },
          h("div", { class: "agent-top" }, h("span", { class: "av lg" }, agent.name.slice(0, 2).toUpperCase()), h("div", {}, h("h2", {}, agent.name), h("div", { class: "meta" }, h("span", { class: `dot ${agent.status === "live" || agent.status === "active" ? "on" : ""}` }), `${agent.status} · ${agent.tier}`))),
          h("div", { class: "eyebrow" }, "Recent activity"),
          h("div", { class: "activity" }, ...(activity.length ? activity.slice(0, 8).map((a) => h("div", { class: "act" }, h("span", { class: "kind" }, a.kind), h("span", {}, a.message))) : [h("div", { class: "muted" }, "Nothing yet.")])),
        ),
        h("div", { class: "eyebrow pad-top" }, "Conversation"),
      );
      for (const m of messages) line(log, m.role === "user" ? "user" : "vyn", m.text);
      if (!messages.length) log.append(h("p", { class: "muted" }, `Nothing yet. Ask below, or write @${c.handle ?? c.title} in any chat with Vyn.`));
    }
  }
  scroll(log);
  input.focus();
}

// ---------- Sending ----------

/** Send text in the current Vyn conversation (queued if she's working). */
export function say(text: string) {
  if (current?.kind !== "vyn") return;
  if (vynBusy) {
    queue.push({ threadId: current.id, text });
    return refreshControls();
  }
  void sendToVyn(current.id, text);
}

function submit() {
  const text = input.value.trim();
  if (!text || !current) return;
  input.value = "";
  grow();
  wake();
  hideMention();
  // Sending brings you back to the conversation's end.
  toBottom();
  if (current.kind === "agent") return hooks.viaVyn(`@${current.handle ?? current.title} ${text}`);
  say(text);
  refreshControls();
}

async function sendToVyn(threadId: string, text: string, echo = true) {
  const log = logFor({ kind: "vyn", id: threadId, title: "" });
  log.querySelector(".empty-state")?.remove();
  if (echo) line(log, "user", text);
  vynBusy = threadId;
  refreshControls();
  const r = await api.send(threadId, text);
  vynBusy = null;
  settleLive(log);
  closeAsk(log);
  closeSteps(log);
  if (!r.ok && r.status === 412) {
    // No AI key yet: ask for one right here, then send this message again.
    void keyCard(log, () => void sendToVyn(threadId, text, false));
    queue.length = 0;
    refreshControls();
    return;
  }
  if (!r.ok) line(log, "error", r.error ?? "Something went wrong.");
  if (!r.ok) hooks.error(r);
  const next = queue.shift();
  refreshControls();
  hooks.activity();
  if (next) void sendToVyn(next.threadId, next.text);
}

export function stop() {
  if (!vynBusy) return;
  queue.length = 0;
  void api.stop();
  refreshControls();
}

// ---------- @agents and files in the composer ----------

let mentionSel = 0;
let mentionList: Agent[] = [];

function mentionQuery() {
  const upto = input.value.slice(0, input.selectionStart ?? input.value.length);
  const m = /(^|\s)@([\w-]*)$/.exec(upto);
  return m ? m[2].toLowerCase() : null;
}

function mentionCheck() {
  const q = mentionQuery();
  if (q === null) return hideMention();
  mentionList = hooks.agents().filter((a) => `${a.handle ?? ""} ${a.name}`.toLowerCase().includes(q)).slice(0, 6);
  if (!mentionList.length) {
    mentionMenu.replaceChildren(h("div", { class: "mention-empty" }, hooks.agents().length ? "No agent matches." : "No agents yet. Create one on Orvyn and it shows up here."));
    return mentionMenu.classList.remove("hidden");
  }
  mentionSel = Math.min(mentionSel, mentionList.length - 1);
  mentionMenu.replaceChildren(
    h("div", { class: "mention-head" }, "Ask one of your agents"),
    ...mentionList.map((a, i) =>
      h("button", { class: `mention-item${i === mentionSel ? " sel" : ""}`, type: "button", onmousedown: (e: Event) => (e.preventDefault(), pickMention(a)) }, h("span", { class: "av" }, a.symbol.slice(0, 2)), h("b", {}, a.name), h("span", { class: "muted" }, a.handle ? `@${a.handle}` : "")),
    ),
  );
  mentionMenu.classList.remove("hidden");
}

function mentionKey(e: KeyboardEvent) {
  e.preventDefault();
  if (e.key === "Escape") return hideMention();
  if (e.key === "ArrowDown") mentionSel = (mentionSel + 1) % Math.max(1, mentionList.length);
  else if (e.key === "ArrowUp") mentionSel = (mentionSel - 1 + mentionList.length) % Math.max(1, mentionList.length);
  else if (mentionList[mentionSel]) return pickMention(mentionList[mentionSel]);
  mentionCheck();
}

function pickMention(a: Agent) {
  const at = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, at).replace(/@[\w-]*$/, `@${a.handle ?? a.name} `);
  input.value = before + input.value.slice(at);
  input.selectionStart = input.selectionEnd = before.length;
  hideMention();
  input.focus();
  refreshControls();
}

function hideMention() {
  mentionMenu.classList.add("hidden");
  mentionSel = 0;
}

function insertMention() {
  const at = input.selectionStart ?? input.value.length;
  const pre = input.value.slice(0, at);
  const add = pre && !/\s$/.test(pre) ? " @" : "@";
  input.value = pre + add + input.value.slice(at);
  input.selectionStart = input.selectionEnd = at + add.length;
  input.focus();
  mentionCheck();
}

/** Copy files into the workspace (Inputs) and point Vyn at them. */
async function attach() {
  const r = await api.workshop.importFiles();
  if (!r.ok || !r.data?.length) return;
  const names = r.data.map((f) => `Inputs/${f.name}`).join(", ");
  input.value = `${input.value.trim() ? `${input.value.trim()}\n` : ""}(Files: ${names})`;
  grow();
  refreshControls();
  input.focus();
}

// ---------- Her AI key, asked for in the chat ----------

async function keyCard(log: HTMLElement, retry: () => void) {
  setMood("curious");
  log.querySelector(".card.key.open")?.remove();
  const r = await api.getSettings();
  const providers = r.data?.providers ?? [];
  const provider = h("select", {}, ...providers.map((p) => h("option", { value: p.id }, p.label))) as HTMLSelectElement;
  const model = h("input", { placeholder: "Model" }) as HTMLInputElement;
  const key = h("input", { type: "password", autocomplete: "off", placeholder: "Paste your API key" }) as HTMLInputElement;
  const getKey = h("a", { class: "link", target: "_blank", rel: "noreferrer" }, "Get a key", icon("external", 12));
  const note = h("div", { class: "note" });
  const pick = () => {
    const p = providers.find((x) => x.id === provider.value);
    model.value = p?.preferredModel ?? "";
    if (p?.keyUrl) getKey.setAttribute("href", p.keyUrl);
    getKey.classList.toggle("hidden", !p?.keyUrl);
  };
  provider.addEventListener("change", pick);
  pick();
  const saveBtn = h("button", { class: "btn primary", type: "button" }, "Save and continue");
  const card = h(
    "div",
    { class: "card key open" },
    h("div", { class: "card-head" }, icon("key", 16), h("b", {}, "Connect an AI to Vyn")),
    h("p", { class: "card-text" }, "Vyn runs on your own AI provider key. It's stored encrypted on Orvyn and never shown again; change it any time in Settings."),
    h("div", { class: "fields" }, h("label", {}, "Provider", provider), h("label", {}, "Model", model)),
    h("label", { class: "full" }, h("span", { class: "lbl-row" }, "API key", getKey), key),
    h("div", { class: "card-actions" }, note, saveBtn),
  );
  const save = async () => {
    if (!key.value.trim() || !model.value.trim()) return void (note.textContent = "Add the model and the key.");
    note.textContent = "Checking the key…";
    saveBtn.setAttribute("disabled", "");
    const res = await api.saveSettings({ aiProvider: provider.value, aiModel: model.value.trim(), apiKey: key.value.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    saveBtn.removeAttribute("disabled");
    if (!res.ok) return void (note.textContent = res.error ?? "That didn't work.");
    key.value = "";
    card.classList.remove("open");
    card.classList.add("done");
    card.replaceChildren(h("div", { class: "card-head" }, icon("check", 16), h("span", {}, "AI connected")));
    setMood("happy");
    retry();
  };
  saveBtn.addEventListener("click", () => void save());
  key.addEventListener("keydown", (e) => e.key === "Enter" && void save());
  log.append(card);
  scroll(log);
  key.focus();
}

// ---------- Vyn's steps ----------

const TOOL: Record<string, [IconName, (i: Record<string, unknown>) => string]> = {
  browser_open: ["globe", (i) => `Opening ${String(i.url).replace(/^https?:\/\//, "")}`],
  browser_read: ["eye", () => "Reading the page"],
  browser_click: ["click", (i) => `Clicking “${i.target}”`],
  browser_type: ["pencil", (i) => `Typing into “${i.target}”`],
  ask_person: ["chat", () => "Asking you"],
  approve_payment: ["wallet", (i) => `Asking you to approve ${i.amount} ${String(i.currency).toUpperCase()} to ${i.merchant}`],
  approve_binance: ["wallet", (i) => `Asking you to approve on Binance: ${String(i.summary ?? i.tool)}`],
  local_render: ["wand", (i) => `Rendering with Studio · ${i.renderer}`],
  local_film: ["clapper", () => "Rendering the film"],
  local_game_save: ["game", (i) => `Saving ${i.name}`],
  local_game_play: ["play", (i) => `Opening ${i.name}`],
  local_game_playtest: ["bot", (i) => `Playtesting ${i.name}`],
  workspace_list: ["folder", () => "Looking through your workspace"],
  workspace_read: ["fileText", (i) => `Reading ${i.path}`],
  workspace_write: ["fileEdit", (i) => `Writing ${i.path}`],
};

/** The open group of steps at the end of the log (or a new one). */
function stepsGroup(log: HTMLElement) {
  const last = log.lastElementChild as HTMLElement | null;
  if (last?.classList.contains("steps") && last.classList.contains("running")) return last;
  const head = h("button", { class: "steps-head", type: "button" }, h("span", { class: "state" }, icon("loader", 14, "spin")), h("span", { class: "label" }, "Working"), icon("chevronDown", 14, "chev"));
  const body = h("div", { class: "steps-body" });
  const group = h("div", { class: "steps running" }, head, body);
  head.addEventListener("click", () => group.classList.toggle("collapsed"));
  log.append(group);
  return group;
}

function step(log: HTMLElement, name: string, input: Record<string, unknown>) {
  const group = stepsGroup(log);
  const body = group.querySelector(".steps-body")!;
  for (const s of body.querySelectorAll(".step.running")) finishStep(s as HTMLElement);
  const [ic, label] = TOOL[name] ?? (["sparkles", () => name.replace(/_/g, " ")] as const);
  const row = h("div", { class: "step running" }, icon(ic, 14), h("span", { class: "text" }, label(input)), h("span", { class: "progress" }), h("span", { class: "st" }, icon("loader", 13, "spin")));
  body.append(row);
  scroll(log);
  return row;
}

function finishStep(row: HTMLElement) {
  row.classList.remove("running");
  row.querySelector(".st")?.replaceChildren(icon("check", 13));
}

/** Close the running group: every step done, header becomes a summary. */
function closeSteps(log: HTMLElement) {
  for (const group of log.querySelectorAll(".steps.running")) {
    const rows = group.querySelectorAll(".step");
    for (const r of rows) finishStep(r as HTMLElement);
    group.classList.remove("running");
    group.classList.add("collapsed");
    group.querySelector(".state")?.replaceChildren(icon("check", 14));
    const label = group.querySelector(".label");
    if (label) label.textContent = `${rows.length} step${rows.length === 1 ? "" : "s"}`;
  }
}

let lastStep: HTMLElement | null = null;

/** Vyn's message being written right now (streamed), and its text so far. */
let live: { el: HTMLElement; raw: string; frame: number } | null = null;

function growLive(log: HTMLElement, piece: string) {
  if (!live || !live.el.isConnected) {
    closeSteps(log);
    const el = h("div", { class: "msg vyn writing" });
    log.append(el);
    live = { el, raw: "", frame: 0 };
  }
  live.raw += piece;
  // Re-render at most once a frame.
  if (!live.frame) {
    const l = live;
    l.frame = requestAnimationFrame(() => {
      l.frame = 0;
      l.el.replaceChildren(md(l.raw));
      scroll(log);
    });
  }
}

/** The step's words are complete: settle the message (rendered once more, cursor gone). */
function settleLive(log: HTMLElement | null) {
  if (!live) return "";
  const l = live;
  live = null;
  if (l.frame) cancelAnimationFrame(l.frame);
  l.el.classList.remove("writing");
  l.el.replaceChildren(md(l.raw));
  if (log) scroll(log);
  return l.raw;
}

function vynEvent(ev: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const log = vynBusy ? logFor({ kind: "vyn", id: vynBusy, title: "" }) : current?.kind === "vyn" ? logFor(current) : null;
  switch (ev.type) {
    case "mood":
      setMood(ev.mood);
      break;
    case "delta":
      if (log && ev.text) growLive(log, ev.text);
      break;
    case "text":
      if (ev.streamed) {
        const said = settleLive(log);
        speak(said);
        break;
      }
      if (log && ev.text) line(log, "vyn", ev.text);
      speak(ev.text ?? "");
      break;
    case "tool":
      if (!log) break;
      lastStep = step(log, ev.name, ev.input ?? {});
      if (ev.name?.startsWith("browser_")) work.show("screen");
      break;
    case "progress":
      if (lastStep) lastStep.querySelector(".progress")!.textContent = ev.text ?? "";
      break;
    case "stopped":
      settleLive(log);
      if (log) {
        closeSteps(log);
        log.append(h("div", { class: "msg notice" }, "Stopped."));
      }
      setMood("idle");
      break;
    case "notice":
      setMood("happy");
      if (current?.kind === "vyn" && ev.threadId === current.id) line(logFor(current), "notice", ev.text ?? "");
      speak(ev.text ?? "");
      hooks.activity();
      break;
    case "open-thread":
      hooks.activity();
      break;
    case "ask":
      if (log) ask(log, ev.question ?? "", ev.choices ?? []);
      break;
    case "approval":
      if (log) approval(log, ev as Approval);
      break;
    case "playtest":
      if (ev.sheet) work.previewFile(ev.sheet);
      break;
  }
}

function closeAsk(log: HTMLElement) {
  for (const a of log.querySelectorAll(".card.ask.open")) a.classList.remove("open"), a.classList.add("done");
}

function ask(log: HTMLElement, question: string, choices: string[]) {
  setMood("curious");
  const card = h("div", { class: "card ask open" }, h("div", { class: "card-head" }, icon("chat", 16), h("b", {}, question)));
  const reply = (answer: string) => {
    if (!card.classList.contains("open")) return;
    card.classList.remove("open");
    card.classList.add("done");
    card.querySelector(".choices")?.remove();
    card.append(h("div", { class: "answer" }, answer));
    setMood("thinking");
    void api.answer(answer);
  };
  const free = h("input", { placeholder: choices.length ? "Or type your answer" : "Type your answer and press Enter" }) as HTMLInputElement;
  free.addEventListener("keydown", (k) => {
    if (k.key === "Enter" && free.value.trim()) reply(free.value.trim());
  });
  card.append(h("div", { class: "choices" }, ...choices.map((c) => h("button", { class: "btn pill", type: "button", onclick: () => reply(c) }, c)), free));
  log.append(card);
  scroll(log);
  free.focus();
}

interface Approval {
  id: number;
  kind: "payment" | "edit" | "action";
  title: string;
  detail?: string;
  path?: string;
  before?: string;
  after?: string;
}

/** Lines added and removed (multiset difference; enough for a summary). */
function diffStat(before: string, after: string) {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s ? s.split("\n") : []) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const b = count(before);
  const a = count(after);
  let add = 0;
  let del = 0;
  for (const [l, n] of a) add += Math.max(0, n - (b.get(l) ?? 0));
  for (const [l, n] of b) del += Math.max(0, n - (a.get(l) ?? 0));
  return { add, del };
}

function approval(log: HTMLElement, a: Approval) {
  setMood("attentive");
  closeSteps(log);
  const actions = h("div", { class: "card-actions" });
  const card = h(
    "div",
    { class: `card approval ${a.kind} open` },
    h("div", { class: "card-head" }, icon(a.kind === "payment" ? "wallet" : a.kind === "edit" ? "fileEdit" : "shield", 16), h("b", {}, a.title)),
    a.detail ? h("p", { class: "card-text" }, a.detail) : null,
  );
  let answered = false;
  const decide = (ok: boolean) => {
    if (answered) return;
    answered = true;
    void api.desk.approve(a.id, ok);
    card.classList.remove("open");
    card.classList.add("done", ok ? "allowed" : "denied");
    actions.replaceChildren(h("span", { class: "verdict" }, icon(ok ? "check" : "x", 14), ok ? (a.kind === "payment" ? "Approved" : "Accepted") : "Declined"));
    setMood("thinking");
  };
  if (a.kind === "edit" && a.path !== undefined) {
    const review = () => {
      work.show("editor");
      editor.showDiff(a.path!, a.before ?? "", a.after ?? "", decide);
    };
    const { add, del } = diffStat(a.before ?? "", a.after ?? "");
    card.append(
      h("button", { class: "file-chip", type: "button", onclick: review, title: "Review the change" }, icon("fileCode", 14), h("span", { class: "path" }, a.path), a.before ? "" : h("span", { class: "tag" }, "new"), h("span", { class: "add" }, `+${add}`), h("span", { class: "del" }, `−${del}`)),
    );
    actions.append(h("button", { class: "btn ghost", type: "button", onclick: review }, "Review"), h("span", { class: "spacer" }), h("button", { class: "btn", type: "button", onclick: () => decide(false) }, "Reject"), h("button", { class: "btn primary", type: "button", onclick: () => decide(true) }, "Accept"));
    review();
  } else {
    actions.append(h("span", { class: "spacer" }), h("button", { class: "btn", type: "button", onclick: () => decide(false) }, "Decline"), h("button", { class: "btn primary", type: "button", onclick: () => decide(true) }, a.kind === "payment" ? "Approve payment" : "Allow"));
  }
  card.append(actions);
  log.append(card);
  scroll(log);
}

/** Vyn wrote a file: refresh it if open, and add it to her steps with a way to see the diff. */
function fileChanged(ev: { path: string; before: string; after: string; by: string }) {
  void editor.reload(ev.path);
  void work.refreshFiles();
  if (ev.by !== "vyn") return;
  const log = vynBusy ? logFor({ kind: "vyn", id: vynBusy, title: "" }) : null;
  if (!log) return;
  const { add, del } = diffStat(ev.before, ev.after);
  const group = stepsGroup(log);
  group
    .querySelector(".steps-body")!
    .append(
      h(
        "button",
        { class: "step file", type: "button", title: "Show what changed", onclick: () => (work.show("editor"), editor.showDiff(ev.path, ev.before, ev.after)) },
        icon("fileEdit", 14),
        h("span", { class: "text" }, ev.path),
        h("span", { class: "add" }, `+${add}`),
        h("span", { class: "del" }, `−${del}`),
      ),
    );
  scroll(log);
  if (/^Games\/[^/]+\/game\.json$/.test(ev.path)) work.previewGame(ev.path.split("/")[1]);
}
