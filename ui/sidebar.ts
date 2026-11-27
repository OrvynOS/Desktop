/** The sidebar: new chat, Vyn's conversations, the person's own Orvyn agents, and you at the foot. */
import { api, h, type Account, type Agent, type Result } from "./bridge";
import * as chat from "./chat";
import { face } from "./face";
import { icon } from "./icons";

let root: HTMLElement;
let threads: { id: string; title: string }[] = [];
let agents: Agent[] = [];
let agentsError: string | null = null;
let me: { handle?: string | null; connected: boolean } = { connected: false };
let account: Account | null = null;
let hooks: { error: (r: Result<unknown>) => void; settings: () => void };

export function mount(container: HTMLElement, h0: typeof hooks) {
  root = container;
  hooks = h0;
}

export const allThreads = () => threads;
export const allAgents = () => agents;

export async function refresh(select?: { kind: "vyn" | "agent"; id: string }) {
  const [t, a, c, acct] = await Promise.all([api.listThreads(), api.agents.list(), api.companion.status(), api.account()]);
  me = c.ok && c.data ? c.data : { connected: false };
  account = acct.ok && acct.data ? acct.data : account;
  if (!t.ok) return hooks.error(t);
  threads = t.data!.threads;
  if (!threads.length) {
    const n = await api.createThread();
    if (!n.ok) return hooks.error(n);
    threads = [n.data!.thread];
  }
  agents = a.ok ? a.data!.agents : [];
  agentsError = a.ok ? null : (a.error ?? null);
  const cur = chat.currentConvo();
  let want = select ?? (cur ? { kind: cur.kind, id: cur.id } : { kind: "vyn" as const, id: threads[0].id });
  const exists = want.kind === "vyn" ? threads.some((x) => x.id === want.id) : agents.some((x) => x.id === want.id);
  if (!exists) want = { kind: "vyn", id: threads[0].id };
  render(want);
  if (!cur || cur.kind !== want.kind || cur.id !== want.id) await openItem(want);
}

function render(active: { kind: string; id: string }) {
  const isActive = (kind: string, id: string) => active.kind === kind && active.id === id;
  root.replaceChildren(
    h(
      "div",
      { class: "side-scroll" },
      h("button", { class: "new-chat", type: "button", onclick: () => void newChat() }, icon("plus", 15), h("span", {}, "New chat"), h("kbd", {}, "Ctrl N")),
      h("div", { class: "eyebrow side" }, "Chats"),
      h(
        "nav",
        { class: "side-list" },
        ...threads.map((t) =>
          h(
            "div",
            { class: `side-item${isActive("vyn", t.id) ? " active" : ""}`, title: t.title, onclick: () => void select("vyn", t.id) },
            h("span", { class: "nm" }, t.title),
            h("button", { class: "row-act", type: "button", title: "Delete chat", onclick: (e: Event) => (e.stopPropagation(), void remove(t.id, t.title)) }, icon("trash", 13)),
          ),
        ),
      ),
      h("div", { class: "eyebrow side" }, "Your agents"),
      h(
        "nav",
        { class: "side-list" },
        ...agents.map((a) =>
          h(
            "div",
            { class: `side-item agent${isActive("agent", a.id) ? " active" : ""}`, title: `${a.name} · ${a.status} · ${a.tier}`, onclick: () => void select("agent", a.id) },
            a.icon ? h("img", { class: "av", src: a.icon, alt: "" }) : h("span", { class: "av" }, a.symbol.slice(0, 2)),
            h("span", { class: "nm" }, a.name),
            h("span", { class: `dot ${a.status === "active" || a.status === "live" ? "on" : ""}` }),
          ),
        ),
        !agents.length ? h("p", { class: "side-note" }, agentsError ?? "Agents you create on Orvyn show up here. Talk to them through Vyn.") : null,
      ),
    ),
    h(
      "div",
      { class: "side-foot" },
      h(
        "button",
        { class: "me", type: "button", title: "Your account and settings", onclick: () => hooks.settings() },
        ...person(),
        icon("settings", 15, "me-gear"),
      ),
    ),
  );
}

async function openItem(sel: { kind: "vyn" | "agent"; id: string }) {
  if (sel.kind === "vyn") {
    const t = threads.find((x) => x.id === sel.id) ?? threads[0];
    await chat.open({ kind: "vyn", id: t.id, title: t.title });
  } else {
    const a = agents.find((x) => x.id === sel.id);
    if (a) await chat.open({ kind: "agent", id: a.id, title: a.name, handle: a.handle });
  }
}

export async function select(kind: "vyn" | "agent", id: string) {
  render({ kind, id });
  await openItem({ kind, id });
}

export async function newChat() {
  const r = await api.createThread();
  if (!r.ok) return hooks.error(r);
  await refresh({ kind: "vyn", id: r.data!.thread.id });
}

async function remove(id: string, title: string) {
  if (!confirm(`Delete “${title}”? Vyn keeps what she remembers about you.`)) return;
  const r = await api.deleteThread(id);
  if (!r.ok) return hooks.error(r);
  const cur = chat.currentConvo();
  await refresh(cur ? { kind: cur.kind, id: cur.id } : undefined);
}

/** You, at the foot: your Social picture (or initial), your name and Agent ID; Vyn's face until it loads. */
function person(): HTMLElement[] {
  const a = account;
  if (!a) return [face(26), h("span", { class: "me-text" }, h("b", {}, "Vyn"), h("span", {}, me.connected && me.handle ? `@${me.handle}` : "Your companion"))];
  const p = a.social && a.social.member ? a.social.profile : null;
  const name = p?.name || a.me.email || (a.me.social?.username ? `@${a.me.social.username}` : `${a.me.accountId.slice(0, 6)}…${a.me.accountId.slice(-4)}`);
  const sub = p ? `@${p.handle} · ${p.agentId}` : a.agents.total ? `${a.agents.total} agent${a.agents.total === 1 ? "" : "s"} · ${a.agents.live} live` : "Your account";
  const av = p?.avatar ? h("img", { class: "me-av", src: p.avatar, alt: "" }) : h("span", { class: "me-av" }, (name.replace(/[^A-Za-z0-9]/g, "")[0] ?? "O").toUpperCase());
  return [av, h("span", { class: "me-text" }, h("b", {}, name), h("span", {}, sub))];
}
