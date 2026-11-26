/**
 * Settings, as a panel: sections in a list on the left, one page each on the right, each saving
 * its own changes. You (how Vyn talks to you), AI (provider, model, key), Files (what she may
 * change), Vyn on Orvyn (her agent identity), Telegram, Reminders, Memory.
 */
import { api, h } from "./bridge";
import * as chat from "./chat";
import { icon, type IconName } from "./icons";

/** The same rules Orvyn applies (it checks again, and whether the handle is free). */
function handleProblem(v: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(v)) return "3–32 lowercase letters, digits or inner hyphens";
  if (v.includes("--")) return "no double hyphens";
  if (v === "vyn") return "that one is Orvyn's; make it yours, like vyn-sam";
  return null;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

type Section = "you" | "ai" | "files" | "orvyn" | "binance" | "telegram" | "reminders" | "memory";
const SECTIONS: [Section, string, IconName][] = [
  ["you", "You", "sparkles"],
  ["ai", "AI", "key"],
  ["files", "Files", "folder"],
  ["orvyn", "Vyn on Orvyn", "bot"],
  ["binance", "Binance", "wallet"],
  ["telegram", "Telegram", "chat"],
  ["reminders", "Reminders", "restart"],
  ["memory", "Memory", "eye"],
];

let lastSection: Section = "you";

/** A labelled setting: the label and a hint on the left, the control on the right. */
const field = (label: string, hint: string | null, control: HTMLElement) =>
  h("div", { class: "set-row" }, h("div", { class: "set-label" }, h("b", {}, label), hint ? h("span", {}, hint) : null), h("div", { class: "set-control" }, control));

const status = () => h("span", { class: "set-status" });
const flash = (el: HTMLElement, text: string, good = true) => {
  el.textContent = text;
  el.classList.toggle("bad", !good);
  el.classList.add("on");
  window.setTimeout(() => el.classList.remove("on"), 2600);
};

/** Open settings over the app (optionally at a section). Resolves when closed. */
export async function open(opts: { signOut: () => void; section?: Section }) {
  const [r, desk] = await Promise.all([api.getSettings(), api.desk.settings()]);
  let s = r.data?.settings ?? null;
  const providers = r.data?.providers ?? [];

  return new Promise<void>((done) => {
    const close = () => {
      overlay.remove();
      window.removeEventListener("keydown", esc);
      done();
    };
    const page = h("div", { class: "set-page" });
    const nav = h("nav", { class: "set-nav" });

    const show = (sec: Section) => {
      lastSection = sec;
      nav.querySelectorAll(".set-tab").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.sec === sec));
      page.replaceChildren(...build(sec));
      page.scrollTop = 0;
    };

    const persona = () => s?.persona ?? {};
    /** Save with the current AI settings and these changes (needs an AI connected). */
    const saveWith = async (patch: Record<string, unknown>) => {
      if (!s) return { ok: false, error: "Connect an AI first (AI section)." };
      const res = await api.saveSettings({ aiProvider: s.aiProvider, aiModel: s.aiModel, persona: persona(), timezone: TZ, checkInTime: s.checkInTime ?? null, ...patch });
      if (res.ok) s = { ...s, ...(patch as object), persona: { ...persona(), ...((patch.persona as object) ?? {}) } } as typeof s;
      return res;
    };

    function build(sec: Section): (HTMLElement | string)[] {
      const head = (title: string, lede: string) => [h("h2", {}, title), h("p", { class: "set-lede" }, lede)];
      switch (sec) {
        case "you": {
          const callMe = h("input", { maxlength: 40, placeholder: "Your name or a nickname", value: persona().callMe ?? "" }) as HTMLInputElement;
          const tone = h("select", {}, ...["warm", "playful", "calm", "direct"].map((t) => h("option", { value: t }, t[0].toUpperCase() + t.slice(1)))) as HTMLSelectElement;
          tone.value = persona().tone ?? "warm";
          const about = h("textarea", { rows: 4, maxlength: 600, placeholder: "e.g. I'm vegetarian. I live in Lisbon. Keep it short in the mornings." }) as HTMLTextAreaElement;
          about.value = persona().about ?? "";
          const checkIn = h("input", { type: "time", value: s?.checkInTime ?? "" }) as HTMLInputElement;
          const aloud = h("input", { type: "checkbox" }) as HTMLInputElement;
          aloud.checked = chat.readAloud();
          aloud.addEventListener("change", () => chat.readAloud(aloud.checked));
          const st = status();
          return [
            ...head("You", "How Vyn talks to you, and what she always keeps in mind."),
            field("What should I call you?", null, callMe),
            field("How should I talk?", null, tone),
            field("Always keep in mind", "Up to 600 characters.", about),
            field("Daily check-in", `Empty for none. Your time zone: ${TZ}.`, checkIn),
            field("Read my replies aloud", "On this computer.", h("label", { class: "switch" }, aloud, h("i", {}))),
            h("div", { class: "set-actions" }, st, h("button", { class: "btn primary", type: "button", onclick: async () => {
              const res = await saveWith({ persona: { callMe: callMe.value.trim(), tone: tone.value, about: about.value.trim() }, checkInTime: checkIn.value || null });
              flash(st, res.ok ? "Saved" : (res.error ?? "Couldn't save."), res.ok);
              if (res.ok) chat.setMood("happy");
            } }, "Save")),
          ];
        }
        case "ai": {
          const provider = h("select", {}, ...providers.map((p) => h("option", { value: p.id }, p.label))) as HTMLSelectElement;
          const model = h("input", { placeholder: "Model" }) as HTMLInputElement;
          const key = h("input", { type: "password", autocomplete: "off", placeholder: s ? "Leave empty to keep your key" : "Paste your API key" }) as HTMLInputElement;
          const getKey = h("a", { class: "link", target: "_blank", rel: "noreferrer" }, "Get a key", icon("external", 12));
          const pick = (keepModel: boolean) => {
            const p = providers.find((x) => x.id === provider.value);
            if (!keepModel) model.value = p?.preferredModel ?? "";
            if (p?.keyUrl) getKey.setAttribute("href", p.keyUrl);
            getKey.classList.toggle("hidden", !p?.keyUrl);
          };
          if (s) {
            provider.value = s.aiProvider;
            model.value = s.aiModel;
          }
          pick(!!s);
          provider.addEventListener("change", () => pick(false));
          const st = status();
          return [
            ...head("AI", "Vyn runs on your own AI provider key. It's stored encrypted on Orvyn and never shown again."),
            field("Provider", null, provider),
            field("Model", null, model),
            field("API key", null, h("div", { class: "stack-sm" }, key, getKey)),
            h("div", { class: "set-actions" }, st, h("button", { class: "btn primary", type: "button", onclick: async () => {
              if (!s && !key.value.trim()) return flash(st, "Paste your key.", false);
              flash(st, "Checking the key…");
              const res = await api.saveSettings({ aiProvider: provider.value, aiModel: model.value.trim(), ...(key.value.trim() ? { apiKey: key.value.trim() } : {}), persona: persona(), timezone: TZ, checkInTime: s?.checkInTime ?? null });
              if (!res.ok) return flash(st, res.error ?? "That didn't work.", false);
              key.value = "";
              s = { ...(s ?? { persona: {} }), aiProvider: provider.value, aiModel: model.value.trim() } as typeof s;
              flash(st, "Saved");
              chat.setMood("happy");
            } }, s ? "Save" : "Connect")),
          ];
        }
        case "files": {
          const approval = h(
            "div",
            { class: "choice-list" },
            ...([
              ["ask", "Ask me first", "Every change shows as a diff you accept or reject."],
              ["edits", "Change, then show me", "Vyn changes files and shows you what changed."],
              ["full", "Don't ask", "Vyn changes files on her own."],
            ] as const).map(([value, title, sub]) => {
              const radio = h("input", { type: "radio", name: "approval", value }) as HTMLInputElement;
              radio.checked = (desk.data?.approval ?? "ask") === value;
              radio.addEventListener("change", async () => {
                const res = await api.desk.setApproval(value);
                flash(st, res.ok ? "Saved" : "Couldn't save.", res.ok);
              });
              return h("label", { class: "choice" }, radio, h("span", {}, h("b", {}, title), h("small", {}, sub)));
            }),
          );
          const st = status();
          return [
            ...head("Files", "Vyn only touches files inside your Vyn workspace. Payments always need your approval, whatever you choose here."),
            field("When Vyn changes files", null, approval),
            field("Workspace", "Games, films, renders and your own files.", h("button", { class: "btn sm", type: "button", onclick: async () => (await api.workshop.chooseWorkspace(), flash(st, "Workspace changed")) }, icon("folderOpen", 14), "Change folder…")),
            h("div", { class: "set-actions" }, st),
          ];
        }
        case "orvyn": {
          const box = h("div", {});
          const draw = async () => {
            const c = await api.companion.status();
            const st = status();
            if (!c.ok) return void box.replaceChildren(h("p", { class: "error" }, c.error ?? ""));
            const d = c.data!;
            const act = (label: string, primary: boolean, fn: () => Promise<{ ok: boolean; error?: string }>) =>
              h("button", { class: `btn${primary ? " primary" : ""}`, type: "button", onclick: async () => {
                flash(st, "…");
                const res = await fn();
                if (!res.ok) return flash(st, res.error ?? "Couldn't do that.", false);
                void draw();
              } }, label);
            if (d.connected) {
              box.replaceChildren(
                h("div", { class: "id-card" }, h("div", {}, h("b", {}, d.handle ? `@${d.handle}` : (d.name ?? "Vyn")), h("span", {}, d.handle ? `${d.handle}.orvyn.cash` : "")), h("span", { class: "pill-ok" }, icon("check", 12), d.thisDevice ? "Connected from this computer" : "Connected from another device")),
                d.walletHere ? field("Wallet on this computer", "Kept with this computer's encryption; Orvyn never holds it.", h("code", { class: "mono" }, d.walletHere)) : "",
                h("div", { class: "set-actions" }, st, d.thisDevice ? act("Report this computer again", false, () => api.companion.refresh()) : "", act("Disconnect", false, () => api.companion.disconnect(false))),
              );
              return;
            }
            const handleInput = h("input", { placeholder: "e.g. vyn-sam", maxlength: 32, spellcheck: false }) as HTMLInputElement;
            const where = h("span", { class: "mono" });
            const showWhere = () => {
              const v = handleInput.value.trim().toLowerCase();
              const bad = v ? handleProblem(v) : null;
              where.textContent = v ? `${v}.orvyn.cash${bad ? ` · ${bad}` : ""}` : "<handle>.orvyn.cash";
              where.classList.toggle("bad", !!bad);
            };
            handleInput.addEventListener("input", showWhere);
            showWhere();
            box.replaceChildren(
              field("Her handle", null, h("div", { class: "stack-sm" }, handleInput, where)),
              h("div", { class: "set-actions" }, st, act("Connect Vyn to Orvyn", true, async () => {
                const v = handleInput.value.trim().toLowerCase();
                const bad = handleProblem(v);
                return bad ? { ok: false, error: bad } : api.companion.connect(v);
              })),
            );
          };
          void draw();
          return [...head("Vyn on Orvyn", "Put Vyn on Orvyn as your agent: her own page, an Orvyn ID, and a record of the computer she runs on. Her wallet key is made here and stays here. What she does for you stays private."), box];
        }
        case "binance": {
          const box = h("div", { class: "set-list" }, h("p", { class: "set-empty" }, "Loading…"));
          const st = status();
          const draw = async () => {
            const b = await api.binance.get();
            const v = b.ok ? b.data! : { connected: false };
            const writes = v.tools?.filter((t) => !t.read).length ?? 0;
            box.replaceChildren(
              v.connected
                ? h("div", { class: "set-item" }, icon("wallet", 14), h("span", { class: "grow" }, v.expired ? "Access expired: connect again." : "Your Binance Agentic sub-account is connected.", h("small", {}, `${v.tools?.length ?? 0} tools, ${writes} that act (each one asks you first)`)), h("button", { class: "btn sm ghost", type: "button", onclick: async () => (await api.binance.disconnect(), void draw()) }, "Disconnect"))
                : h("p", { class: "set-empty" }, "Not connected."),
            );
          };
          void draw();
          return [
            ...head("Binance", "Let Vyn read markets and your Binance Agentic sub-account, and trade it for you. Every order, cancel and transfer is shown to you first and only runs if you approve. Withdrawals are never possible."),
            box,
            h("div", { class: "set-actions" }, st, h("button", { class: "btn", type: "button", onclick: async () => {
              const c = await api.binance.connect();
              flash(st, c.ok ? "Binance opened in your browser: sign in and choose what Vyn may do, then come back." : (c.error ?? "Couldn't start connecting."), c.ok);
            } }, "Connect Binance")),
          ];
        }
        case "telegram": {
          const tg = r.data?.telegram;
          const list = h("div", { class: "set-list" });
          const st = status();
          const draw = (chats: { id: number; label: string | null }[]) =>
            list.replaceChildren(
              ...(chats.length
                ? chats.map((c) => h("div", { class: "set-item" }, icon("chat", 14), h("span", { class: "grow" }, c.label ? `@${c.label}` : "A Telegram chat"), h("button", { class: "btn sm ghost", type: "button", onclick: async () => {
                    const u = await api.unlinkTelegram(c.id);
                    if (u.ok) draw(chats.filter((x) => x.id !== c.id));
                  } }, "Unlink")))
                : [h("p", { class: "set-empty" }, "No Telegram chats linked.")]),
            );
          draw(tg?.chats ?? []);
          return [
            ...head("Telegram", "Talk to Vyn from Telegram too, with the same memory and reminders."),
            tg?.available ? list : h("p", { class: "set-empty" }, "Telegram isn't set up on this Orvyn server yet."),
            tg?.available ? h("div", { class: "set-actions" }, st, h("button", { class: "btn", type: "button", onclick: async () => {
              const l = await api.linkTelegram();
              flash(st, l.ok ? "Telegram opened: press Start there to finish (the link works for 15 minutes)." : (l.error ?? "Couldn't link."), l.ok);
            } }, "Link Telegram")) : "",
          ];
        }
        case "reminders": {
          const list = h("div", { class: "set-list" }, h("p", { class: "set-empty" }, "Loading…"));
          const load = async () => {
            const rou = await api.routines();
            const items = rou.ok ? rou.data!.routines : [];
            list.replaceChildren(
              ...(items.length
                ? items.map((x) =>
                    h("div", { class: "set-item" }, icon("restart", 14), h("span", { class: "grow" }, x.title, h("small", {}, x.nextRunAt ? `Next ${new Date(x.nextRunAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}${x.schedule.kind === "daily" ? " · repeats" : ""}` : "")), h("button", { class: "btn sm ghost", type: "button", onclick: async () => (await api.cancelRoutine(x.id), void load()) }, "Cancel")),
                  )
                : [h("p", { class: "set-empty" }, "No reminders. Try “remind me to call mum on Sunday at 6”.")]),
            );
          };
          void load();
          return [...head("Reminders", "What Vyn will do or tell you later, on every device."), list];
        }
        case "memory": {
          const list = h("div", { class: "set-list" }, h("p", { class: "set-empty" }, "Loading…"));
          const load = async () => {
            const mem = await api.memories();
            const items = mem.ok ? mem.data!.memories : [];
            list.replaceChildren(
              ...(items.length
                ? items.map((m) => h("div", { class: "set-item" }, h("span", { class: "grow" }, m.text), h("button", { class: "btn sm ghost", type: "button", onclick: async () => (await api.forget(m.id), void load()) }, "Forget")))
                : [h("p", { class: "set-empty" }, "Nothing yet. Tell Vyn about yourself and she'll remember.")]),
            );
          };
          void load();
          return [...head("Memory", "What Vyn remembers about you. Delete anything you'd rather she forgot."), list];
        }
      }
    }

    nav.append(
      ...SECTIONS.map(([id, label, ic]) => {
        const b = h("button", { class: "set-tab", type: "button", onclick: () => show(id) }, icon(ic, 15), h("span", {}, label));
        b.dataset.sec = id;
        return b;
      }),
      h("span", { class: "spacer" }),
      h("button", { class: "set-tab danger", type: "button", onclick: () => (close(), opts.signOut()) }, icon("logOut", 15), h("span", {}, "Sign out")),
    );

    const overlay = h(
      "div",
      { class: "overlay", onclick: (e: Event) => e.target === overlay && close() },
      h(
        "div",
        { class: "settings" },
        h("aside", {}, h("div", { class: "set-title" }, "Settings"), nav),
        h("div", { class: "set-main" }, h("button", { class: "icon-btn set-close", type: "button", title: "Close (Esc)", onclick: close }, icon("x", 16)), !r.ok ? h("p", { class: "error" }, r.error ?? "") : null, page),
      ),
    );
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    document.body.append(overlay);
    show(opts.section ?? (s ? lastSection : "ai"));
  });
}
