/**
 * Vyn's window: sign in, then a title bar and three panes. Sidebar (Vyn's conversations and the
 * person's agents), the conversation, and the work pane (files, editor, previews, screen, make).
 * Runs sandboxed with no Node access; everything goes through window.vyn (preload.ts).
 */
import { api, h, $, type Result } from "./bridge";
import * as chat from "./chat";
import { face } from "./face";
import { icon } from "./icons";
import * as palette from "./palette";
import * as settings from "./settings";
import * as sidebar from "./sidebar";
import * as work from "./work";

let built = false;
let myName: string | undefined;
const mac = navigator.userAgent.includes("Mac");
document.documentElement.classList.add(mac ? "mac" : "not-mac");

/** A request that never reached Orvyn (offline, DNS, the server down), not an answer from it. */
const unreachable = (r: Result<unknown>) => r.status === undefined && /fetch failed|network|timed? ?out|abort|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(r.error ?? "");

function handleError(r: Result<unknown>) {
  if (r.status === 401) return signInScreen();
  if (unreachable(r) && !built) return offlineScreen();
  chat.setMood("sorry");
  toast(r.error ?? "Something went wrong.");
}

export function toast(text: string) {
  const el = h("div", { class: "toast" }, icon("x", 14), h("span", {}, text));
  document.body.append(el);
  window.setTimeout(() => el.classList.add("out"), 4600);
  window.setTimeout(() => el.remove(), 5000);
}

async function openSettings() {
  await settings.open({ signOut: () => void signOut(), section: "account" });
  void sidebar.refresh();
}

async function signOut() {
  await api.signOut();
  signInScreen();
}

/** A centred card on the sign-in ground, used while connecting and when Orvyn can't be reached. */
function centred(...children: (Node | string)[]) {
  $("app").replaceChildren(h("div", { class: "titlebar drag" }), h("section", { class: "signin" }, h("div", { class: "signin-inner" }, face(132), ...children)));
  built = false;
}

function connectingScreen() {
  centred(h("div", { class: "eyebrow" }, "Vyn · by Orvyn"), h("p", { class: "lede" }, h("span", { class: "pulse" }), " Connecting to Orvyn…"));
}

function offlineScreen() {
  const retry = h("button", { class: "btn primary lg", type: "button" }, "Try again") as HTMLButtonElement;
  retry.addEventListener("click", () => void start());
  centred(
    h("div", { class: "eyebrow" }, "Vyn · by Orvyn"),
    h("h1", {}, "Can't reach ", h("em", {}, "Orvyn"), "."),
    h("p", { class: "lede" }, "Check your internet connection. If it's working, Orvyn may be down for a moment: your chats are safe, and Vyn picks up where you left off."),
    retry,
  );
}

function signInScreen() {
  const err = h("p", { class: "error" });
  const code = h("div", { class: "code-box hidden" });
  const btn = h("button", { class: "btn primary lg", type: "button" }, "Sign in with Orvyn", icon("arrowUp", 15, "rot45")) as HTMLButtonElement;
  btn.addEventListener("click", async () => {
    err.textContent = "";
    btn.disabled = true;
    const r = await api.signIn();
    btn.disabled = false;
    if (!r.ok) return void (err.textContent = r.error ?? "Couldn't start sign-in.");
    code.replaceChildren(h("span", { class: "eyebrow" }, "Your code"), h("div", { class: "code" }, r.data!.userCode), h("p", {}, h("span", { class: "pulse" }), "Approve it in the page that just opened"));
    code.classList.remove("hidden");
  });
  $("app").replaceChildren(
    h("div", { class: "titlebar drag" }),
    h(
      "section",
      { class: "signin" },
      h(
        "div",
        { class: "signin-inner" },
        face(132),
        h("div", { class: "eyebrow" }, "Vyn · by Orvyn"),
        h("h1", {}, "Your companion,", h("br"), h("em", {}, "right here"), " on your desk."),
        h("p", { class: "lede" }, "Make games, films and pictures on this computer. Keep your reminders. Talk to your agents. Vyn asks before she pays for anything."),
        btn,
        code,
        err,
      ),
    ),
  );
  built = false;
}

let workVisible = true;
function setWorkVisible(on: boolean) {
  workVisible = on;
  document.documentElement.classList.toggle("no-work", !on);
  try {
    localStorage.setItem("workVisible", on ? "1" : "0");
  } catch {
    // not remembered
  }
}

function build() {
  const side = h("aside", { class: "sidebar" });
  const middle = h("main", { class: "chat" });
  const right = h("section", { class: "work" });
  const split = h("div", { class: "splitter", title: "Drag to resize" });
  const titlebar = h(
    "header",
    { class: "titlebar drag" },
    h("div", { class: "tb-left" }, h("span", { class: "wordmark" }, h("i", {}), "Vyn")),
    h("button", { class: "tb-search no-drag", type: "button", onclick: () => window.dispatchEvent(new CustomEvent("vyn:palette")) }, icon("search", 14), h("span", {}, "Search chats, agents, files"), h("kbd", {}, mac ? "⌘K" : "Ctrl K")),
    h("div", { class: "tb-right no-drag" }, h("button", { class: "icon-btn", type: "button", title: "Show or hide the work pane (Ctrl+B)", onclick: () => setWorkVisible(!workVisible) }, icon("panel", 16))),
  );
  $("app").replaceChildren(titlebar, h("div", { class: "shell" }, side, middle, split, right));

  const setWidth = (px: number) => document.documentElement.style.setProperty("--work-w", `${Math.max(340, Math.min(window.innerWidth - 700, px))}px`);
  try {
    const w = Number(localStorage.getItem("workWidth"));
    if (w) setWidth(w);
    setWorkVisible(localStorage.getItem("workVisible") !== "0");
  } catch {
    // defaults
  }
  split.addEventListener("pointerdown", (e) => {
    split.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("resizing");
    const move = (m: PointerEvent) => setWidth(window.innerWidth - m.clientX);
    const up = () => {
      document.documentElement.classList.remove("resizing");
      split.removeEventListener("pointermove", move);
      try {
        localStorage.setItem("workWidth", String(right.getBoundingClientRect().width));
      } catch {
        // not remembered
      }
    };
    split.addEventListener("pointermove", move);
    split.addEventListener("pointerup", up, { once: true });
  });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") (e.preventDefault(), setWorkVisible(!workVisible));
  });

  sidebar.mount(side, { error: handleError, settings: () => void openSettings() });
  chat.mount(middle, {
    activity: () => void sidebar.refresh(),
    error: handleError,
    // Talking to an agent goes through Vyn: her latest conversation, with an @mention.
    viaVyn: async (text) => {
      const t = sidebar.allThreads()[0];
      if (!t) return;
      await sidebar.select("vyn", t.id);
      chat.say(text);
    },
    agents: () => sidebar.allAgents(),
    name: () => myName,
  });
  work.mount(right, { show: () => setWorkVisible(true) });
  built = true;
}

async function start() {
  if (!built) connectingScreen();
  const state = await api.authState();
  if (!state.ok && unreachable(state)) return offlineScreen();
  if (!state.ok || !state.data!.signedIn) return signInScreen();
  const s = await api.getSettings();
  if (!s.ok) return handleError(s);
  const named = s.data?.settings?.persona?.callMe || state.data!.me?.name || "";
  myName = named && !/^0x[0-9a-f]{6,}/i.test(named) && named.length <= 40 ? named.split(" ")[0] : undefined;
  if (!built) build();
  await sidebar.refresh();
}

api.on("auth:done", (p: { ok: boolean; error?: string }) => {
  if (p.ok) void start();
  else toast(p.error ?? "Sign-in failed.");
});
api.on("chat:event", (ev: { type: string; threadId?: string }) => {
  if (ev.type === "open-thread" && ev.threadId && built) void sidebar.refresh({ kind: "vyn", id: ev.threadId });
});

palette.install(() => void openSettings());
void start();
