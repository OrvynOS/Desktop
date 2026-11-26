/**
 * Vyn's browser: a visible window with its own profile (separate cookies from the person's
 * everyday browser), driven from the main process. Vyn reads pages and clicks or types for the
 * person; it never types into password, card or one-time-code fields (enforced here, whatever the
 * model asks).
 */
import { BrowserWindow, shell } from "electron";

let win: BrowserWindow | null = null;

function browser() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Vyn browser",
    webPreferences: { partition: "persist:vyn-browser", contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Pop-ups open in the person's own browser, not silently.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

const run = <T>(code: string) => browser().webContents.executeJavaScript(code, true) as Promise<T>;

export async function open(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) pages");
  const w = browser();
  w.show();
  await w.loadURL(url);
  return { title: w.webContents.getTitle(), url: w.webContents.getURL() };
}

/** Visible text plus numbered interactive elements (links, buttons, fields). */
export async function read() {
  return run<{ url: string; title: string; text: string; elements: { n: number; kind: string; label: string }[] }>(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const els = [...document.querySelectorAll("a[href], button, input, select, textarea, [role=button]")].filter(visible).slice(0, 150);
    const elements = els.map((el, i) => {
      el.setAttribute("data-vyn", String(i + 1));
      const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.name || el.getAttribute("href") || "").trim().replace(/\\s+/g, " ").slice(0, 80);
      const kind = el.tagName === "A" ? "link" : el.tagName === "INPUT" ? "field:" + (el.type || "text") : el.tagName.toLowerCase();
      return { n: i + 1, kind, label };
    });
    return { url: location.href, title: document.title, text: (document.body?.innerText || "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 8000), elements };
  })()`);
}

const find = (target: string) => `(() => {
  const t = ${JSON.stringify(target)};
  let el = /^\\d+$/.test(t) ? document.querySelector('[data-vyn="' + t + '"]') : null;
  if (!el) {
    const lower = t.toLowerCase();
    el = [...document.querySelectorAll("a, button, input, select, textarea, label, [role=button]")].find((e) =>
      ((e.getAttribute("aria-label") || e.innerText || e.value || e.placeholder || e.name || "") + "").toLowerCase().includes(lower));
    if (el && el.tagName === "LABEL" && el.control) el = el.control;
  }
  return el;
})()`;

export async function click(target: string) {
  const r = await run<{ ok: boolean; label?: string }>(`(() => { const el = ${find(target)}; if (!el) return { ok: false }; el.scrollIntoView({ block: "center" }); el.click(); return { ok: true, label: (el.innerText || el.value || "").slice(0, 80) }; })()`);
  if (!r.ok) throw new Error(`nothing on the page matches "${target}"`);
  await new Promise((res) => setTimeout(res, 800));
  return { clicked: r.label, url: browser().webContents.getURL() };
}

export async function type(target: string, text: string, submit?: boolean) {
  const r = await run<{ ok: boolean; refused?: string }>(`(() => {
    const el = ${find(target)};
    if (!el || !("value" in el)) return { ok: false };
    const type = (el.getAttribute("type") || "").toLowerCase();
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    const name = ((el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "")).toLowerCase();
    if (type === "password" || ac.startsWith("cc-") || ac === "one-time-code" || /card.?num|cvc|cvv|security.?code|otp/.test(name)) return { ok: false, refused: "sensitive" };
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    el.focus(); setter ? setter.call(el, ${JSON.stringify(text)}) : (el.value = ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    if (${submit ? "true" : "false"}) { el.form ? el.form.requestSubmit() : el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    return { ok: true };
  })()`);
  if (r.refused) throw new Error("that's a password, card or one-time-code field: ask the person to type it themselves");
  if (!r.ok) throw new Error(`no field matches "${target}"`);
  return { typed: true, url: browser().webContents.getURL() };
}

/** A picture of Vyn's browser (for the Screen view), or null if it isn't open. */
export async function capture() {
  if (!win || win.isDestroyed()) return null;
  const img = await win.webContents.capturePage();
  return { url: win.webContents.getURL(), title: win.webContents.getTitle(), image: img.resize({ width: Math.min(1100, img.getSize().width) }).toDataURL() };
}

/** Bring Vyn's browser to the front, so the person can take over (sign in, solve a check). */
export function focus() {
  const w = browser();
  w.show();
  w.focus();
  return { url: w.webContents.getURL() };
}
