/**
 * The editor: open workspace files in tabs (CodeMirror), save with ⌘S, and see Vyn's changes as
 * diffs. When the person's approval level asks, a change Vyn proposes is shown here as a diff with
 * Accept / Reject (answering the approval card in the chat too).
 */
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { unifiedMergeView } from "@codemirror/merge";
import { tags as t } from "@lezer/highlight";
import { api, h } from "./bridge";
import { fileIcon, icon } from "./icons";

const style = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: "var(--accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--up)" },
  { tag: [t.number, t.bool, t.null], color: "var(--fg-2)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--fg-2)" },
  { tag: [t.comment], color: "var(--fg-3)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.tagName], color: "var(--fg)", fontWeight: "600" },
  { tag: [t.typeName, t.className], color: "var(--accent)" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent", color: "var(--fg)" },
    ".cm-scroller": { fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace", lineHeight: "1.55" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--fg-3)", border: "none" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.035)" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(139,200,255,0.22) !important" },
    ".cm-changedLine": { backgroundColor: "rgba(166,227,161,0.07)" },
    ".cm-deletedChunk": { backgroundColor: "rgba(248,113,113,0.10)" },
    ".cm-insertedLine, .cm-changedText": { backgroundColor: "rgba(166,227,161,0.15)" },
  },
  { dark: true },
);

function language(path: string): Extension[] {
  if (/\.(json|excalidraw)$/i.test(path)) return [json()];
  if (/\.(ts|tsx)$/i.test(path)) return [javascript({ typescript: true, jsx: path.endsWith("x") })];
  if (/\.(js|mjs|rhai)$/i.test(path)) return [javascript()];
  if (/\.html?$/i.test(path)) return [html()];
  if (/\.md$/i.test(path)) return [markdown()];
  return [];
}

interface Tab {
  path: string;
  saved: string;
  view: EditorView;
  diff?: { before: string; onDecide?: (ok: boolean) => void };
}

let host: HTMLElement;
let tabBar: HTMLElement;
let actions: HTMLElement;
const tabs: Tab[] = [];
let active: Tab | null = null;
let onChange: () => void = () => {};

export function mount(container: HTMLElement, changed: () => void) {
  onChange = changed;
  tabBar = h("div", { class: "ed-tabs" });
  actions = h("div", { class: "ed-actions" });
  host = h("div", { class: "ed-host" });
  container.replaceChildren(h("div", { class: "ed-top" }, tabBar, actions), host);
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && active) {
      e.preventDefault();
      void save(active);
    }
  });
  render();
}

function extensions(path: string, readOnly = false, before?: string): Extension[] {
  return [
    lineNumbers(),
    foldGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(style),
    theme,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    ...language(path),
    EditorView.updateListener.of((u) => u.docChanged && render()),
    ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ...(before !== undefined ? [unifiedMergeView({ original: before, mergeControls: false, gutter: true })] : []),
  ];
}

const dirty = (tab: Tab) => !tab.diff && tab.view.state.doc.toString() !== tab.saved;

function render() {
  tabBar.replaceChildren(
    ...tabs.map((tab) =>
      h(
        "button",
        { class: `ed-tab${tab === active ? " active" : ""}${tab.diff ? " diff" : ""}`, title: tab.path, onclick: () => select(tab) },
        fileIcon(tab.path, 13), `${tab.path.split("/").pop()}${tab.diff ? " (changes)" : ""}${dirty(tab) ? " •" : ""}`,
        h("span", { class: "x", title: "Close", onclick: (e: Event) => (e.stopPropagation(), close(tab)) }, icon("x", 12)),
      ),
    ),
  );
  actions.replaceChildren();
  if (active?.diff) {
    const a = active;
    actions.append(
      h("span", { class: "muted small" }, a.diff!.onDecide ? "Vyn wants to make this change" : "Vyn changed this file"),
      ...(a.diff!.onDecide
        ? [h("button", { class: "btn sm", onclick: () => decide(a, false) }, "Reject"), h("button", { class: "btn sm primary", onclick: () => decide(a, true) }, "Accept")]
        : [h("button", { class: "btn sm", onclick: () => decide(a, true) }, "Done")]),
    );
  } else if (active) {
    const a = active;
    actions.append(h("button", { class: "btn sm", disabled: !dirty(a), onclick: () => save(a) }, "Save"));
  }
  host.replaceChildren(...(active ? [active.view.dom] : [h("div", { class: "empty" }, "Open a file from Files, or ask Vyn to make something.")]));
  onChange();
}

function select(tab: Tab) {
  active = tab;
  render();
  tab.view.focus();
}

function close(tab: Tab) {
  if (dirty(tab) && !confirm(`Discard your changes to ${tab.path}?`)) return;
  tab.diff?.onDecide?.(false);
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  tab.view.destroy();
  if (active === tab) active = tabs[Math.max(0, i - 1)] ?? null;
  render();
}

async function save(tab: Tab) {
  const content = tab.view.state.doc.toString();
  const r = await api.desk.write(tab.path, content);
  if (!r.ok) return alert(r.error ?? "Couldn't save.");
  tab.saved = content;
  render();
}

/** Open a workspace file in a tab (or focus it). */
export async function open(path: string) {
  const existing = tabs.find((t) => t.path === path && !t.diff);
  if (existing) return select(existing);
  const r = await api.desk.read(path);
  if (!r.ok) return alert(r.error ?? "Couldn't open it.");
  const view = new EditorView({ state: EditorState.create({ doc: r.data!, extensions: extensions(path) }) });
  const tab: Tab = { path, saved: r.data!, view };
  tabs.push(tab);
  select(tab);
}

/**
 * Show a change as a diff. With `onDecide`, the person accepts or rejects it (an approval);
 * without, it has already been written and this shows what changed.
 */
export function showDiff(path: string, before: string, after: string, onDecide?: (ok: boolean) => void) {
  for (const t of tabs.filter((x) => x.path === path && x.diff)) {
    t.diff?.onDecide?.(false);
    tabs.splice(tabs.indexOf(t), 1);
    t.view.destroy();
  }
  const view = new EditorView({ state: EditorState.create({ doc: after, extensions: extensions(path, true, before) }) });
  const tab: Tab = { path, saved: after, view, diff: { before, onDecide } };
  tabs.push(tab);
  select(tab);
}

function decide(tab: Tab, ok: boolean) {
  const fn = tab.diff?.onDecide;
  tab.diff = { before: tab.diff!.before }; // answered: no more buttons
  fn?.(ok);
  tabs.splice(tabs.indexOf(tab), 1);
  tab.view.destroy();
  active = tabs[tabs.length - 1] ?? null;
  // An accepted change: reopen the file as normal text.
  if (ok) void reload(tab.path);
  render();
}

/** The file changed on disk (Vyn wrote it): refresh an open, unchanged tab. */
export async function reload(path: string) {
  const tab = tabs.find((t) => t.path === path && !t.diff);
  if (!tab) return;
  if (dirty(tab)) return;
  const r = await api.desk.read(path);
  if (!r.ok) return;
  tab.view.dispatch({ changes: { from: 0, to: tab.view.state.doc.length, insert: r.data! } });
  tab.saved = r.data!;
  render();
}

export const hasTabs = () => tabs.length > 0;
