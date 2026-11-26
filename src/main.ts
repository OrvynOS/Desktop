/**
 * Vyn desktop (Electron): the main window (chat), sign-in with Orvyn, and the device side of Vyn's
 * turns. The conversation and the model run on Orvyn's server; this app runs the tools that act on
 * this computer (Vyn's browser, questions to the person, payment approvals) and sends the results
 * back, so the same conversation can continue on the person's phone or in Telegram. It also shows
 * Vyn's reminders and check-ins as system notifications.
 */
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as browser from "./browser";
import { loadSession, me, signOut, startSignIn, vynApi, vynStream } from "./orvyn";
import * as workshop from "./workshop";
import * as desk from "./desk";
import * as companion from "./companion";

const TOOLS = ["browser_open", "browser_read", "browser_click", "browser_type", "ask_person", "approve_payment", "approve_binance", ...workshop.WORKSHOP_TOOLS, ...desk.DESK_TOOLS] as const;
type ToolName = (typeof TOOLS)[number];
interface ToolCall {
  toolCallId: string;
  toolName: ToolName;
  input: Record<string, unknown>;
}
interface Turn {
  text: string;
  toolCalls: ToolCall[];
  done: boolean;
  mood?: string;
}

let main: BrowserWindow | null = null;
const send = (channel: string, payload: unknown) => main?.webContents.send(channel, payload);

if (!app.requestSingleInstanceLock()) app.quit();
workshop.registerSchemes();
app.setAsDefaultProtocolClient("vyn");

function createWindow() {
  main = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 560,
    title: "Vyn",
    backgroundColor: "#000000",
    // The window draws its own title bar; the OS keeps its window controls.
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 14 } } : { titleBarOverlay: { color: "#000000", symbolColor: "#8b8b95", height: 42 } }),
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  void main.loadFile(join(__dirname, "..", "static", "index.html"));
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  workshop.registerGameProtocol();
  desk.registerFileProtocol();
  createWindow();
  startNotices();
  // Vyn on Orvyn: report the computer she runs on (if connected from here).
  setTimeout(() => void (loadSession() && companion.reportEnvironment().catch(() => {})), 8000);
});
app.on("second-instance", () => main?.show());
app.on("will-quit", () => {
  workshop.shutdown();
  desk.stopAgentChats();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});

// ---- Questions and approvals ----

let pendingAnswer: ((answer: string) => void) | null = null;
ipcMain.handle("ask:answer", (_e, answer: string) => {
  pendingAnswer?.(String(answer).slice(0, 2000));
  pendingAnswer = null;
});

async function approvePayment(input: Record<string, unknown>) {
  const amount = `${Number(input.amount).toFixed(2)} ${String(input.currency).toUpperCase()}`;
  if (main && main.isVisible()) {
    const approved = await desk.requestApproval(send, { kind: "payment", title: `Pay ${amount} to ${String(input.merchant)}?`, detail: `${String(input.description)} · ${String(input.method)}. Vyn only pays if you allow it.` });
    return { approved };
  }
  const { response } = await dialog.showMessageBox(main!, {
    type: "question",
    title: "Approve payment",
    message: `Pay ${amount} to ${String(input.merchant)}?`,
    detail: `${String(input.description)}\nMethod: ${String(input.method)}\n\nVyn only pays if you approve.`,
    buttons: ["Decline", "Approve"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return { approved: response === 1 };
}

/** A Binance action Vyn wants to take: Orvyn runs exactly this call, and only if the person approves. */
async function approveBinance(input: Record<string, unknown>) {
  const summary = String(input.summary ?? input.tool ?? "a Binance action");
  if (main && main.isVisible()) {
    const approved = await desk.requestApproval(send, { kind: "action", title: "Approve this Binance action?", detail: `${summary}. It runs on your Binance Agentic sub-account only if you approve.` });
    return { approved };
  }
  const { response } = await dialog.showMessageBox(main!, {
    type: "question",
    title: "Approve Binance action",
    message: "Approve this Binance action?",
    detail: `${summary}

It runs on your Binance Agentic sub-account only if you approve.`,
    buttons: ["Decline", "Approve"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return { approved: response === 1 };
}

async function runTool(call: ToolCall): Promise<unknown> {
  const i = call.input;
  send("chat:event", { type: "tool", name: call.toolName, input: i });
  try {
    switch (call.toolName) {
      case "browser_open":
        return await browser.open(String(i.url));
      case "browser_read":
        return await browser.read();
      case "browser_click":
        return await browser.click(String(i.target));
      case "browser_type":
        return await browser.type(String(i.target), String(i.text), Boolean(i.submit));
      case "ask_person":
        send("chat:event", { type: "ask", question: i.question, choices: i.choices ?? [] });
        return { answer: await new Promise<string>((resolve) => (pendingAnswer = resolve)) };
      case "approve_payment":
        return await approvePayment(i);
      case "approve_binance":
        return await approveBinance(i);
      case "local_render":
      case "local_film":
      case "local_game_save":
      case "local_game_play":
      case "local_game_playtest":
        {
          const out = await workshop.runWorkshopTool(call.toolName, i, (text) => send("chat:event", { type: "progress", text }));
          // Show the bots' contact sheet in the window.
          if (call.toolName === "local_game_playtest" && out && typeof out === "object" && "sheet" in out && out.sheet) send("chat:event", { type: "playtest", sheet: out.sheet, findings: (out as { findings?: string[] }).findings ?? [] });
          return out;
        }
      case "workspace_list":
      case "workspace_read":
      case "workspace_write":
        return await desk.runDeskTool(call.toolName, i, send);
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

let stopRequested = false;
ipcMain.handle("chat:stop", () => {
  stopRequested = true;
  desk.denyAll();
  pendingAnswer?.("(The person stopped you. Don't continue this task unless they ask again.)");
  pendingAnswer = null;
});

/**
 * One step of a turn, streamed: Vyn's words go to the window as she writes them ("delta"), then
 * the step's result. Falls back to a plain request if streaming fails before anything arrived.
 */
async function turnStep(threadId: string, body: Record<string, unknown>): Promise<Turn & { streamed: boolean }> {
  let turn: Turn | null = null;
  let failure: { message: string; status: number } | null = null;
  let streamed = false;
  try {
    await vynStream(`/threads/${threadId}/turn?stream=1`, body, (ev) => {
      if (ev.type === "text" && typeof ev.text === "string") {
        streamed = true;
        send("chat:event", { type: "delta", text: ev.text });
      } else if (ev.type === "turn") turn = ev.turn as Turn;
      else if (ev.type === "error") failure = { message: String(ev.message), status: Number(ev.status) || 500 };
    });
  } catch (e) {
    if (streamed || (e as { status?: number }).status) throw e;
    return { ...(await vynApi<Turn>("POST", `/threads/${threadId}/turn`, body)), streamed: false };
  }
  if (failure) throw Object.assign(new Error((failure as { message: string }).message), { status: (failure as { status: number }).status });
  if (!turn) throw new Error("Vyn's reply was cut off; try again.");
  return { ...(turn as Turn), streamed };
}

/** A whole turn: send the message, run the tools Vyn asks for, until she answers (or is stopped). */
async function chat(threadId: string, text: string) {
  stopRequested = false;
  send("chat:event", { type: "mood", mood: "thinking" });
  let turn = await turnStep(threadId, { text, tools: TOOLS, device: "desktop" });
  for (let steps = 0; steps < 25; steps++) {
    if (turn.mood) send("chat:event", { type: "mood", mood: turn.mood });
    if (turn.text || turn.streamed) send("chat:event", { type: "text", text: turn.text, streamed: turn.streamed });
    if (turn.done) return;
    const toolResults = [];
    for (const call of turn.toolCalls) {
      const output = stopRequested ? { error: "The person stopped this. Don't continue unless they ask." } : await runTool(call);
      toolResults.push({ toolCallId: call.toolCallId, toolName: call.toolName, output });
    }
    if (stopRequested) {
      // Let Vyn see why, but end the turn here.
      await vynApi<Turn>("POST", `/threads/${threadId}/turn`, { toolResults, tools: [], device: "desktop" }).catch(() => undefined);
      send("chat:event", { type: "stopped" });
      return;
    }
    send("chat:event", { type: "mood", mood: "thinking" });
    turn = await turnStep(threadId, { toolResults, tools: TOOLS, device: "desktop" });
  }
  send("chat:event", { type: "text", text: "(Stopped after 25 steps. Tell me how to continue.)" });
}

// ---- IPC for the chat window ----

const wrap =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (_e: unknown, ...args: A) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), status: (error as { status?: number }).status };
    }
  };

// Signed in: who it is. If Orvyn can't be reached at all, say so (the window shows "Can't reach
// Orvyn" with Retry) rather than carrying on to requests that would only time out.
ipcMain.handle(
  "auth:state",
  wrap(async () => {
    if (!loadSession()) return { signedIn: false };
    const who = await me().catch((e: Error) => {
      if (/fetch failed|timeout|abort|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(`${e.message} ${(e.cause as Error | undefined)?.message ?? ""}`)) throw new Error("fetch failed: Orvyn can't be reached");
      return {};
    });
    return { signedIn: true, me: who };
  }),
);
ipcMain.handle(
  "auth:start",
  wrap(async () => {
    const s = await startSignIn();
    void shell.openExternal(s.verificationUri);
    s.done.then(
      () => send("auth:done", { ok: true }),
      (e: Error) => send("auth:done", { ok: false, error: e.message }),
    );
    return { userCode: s.userCode, verificationUri: s.verificationUri };
  }),
);
ipcMain.handle("auth:signOut", wrap(signOut));
ipcMain.handle("settings:get", wrap(() => vynApi("GET", "/settings")));
ipcMain.handle("settings:save", wrap((s: Record<string, unknown>) => vynApi("PUT", "/settings", s)));
ipcMain.handle("threads:list", wrap(() => vynApi("GET", "/threads")));
ipcMain.handle("threads:create", wrap(() => vynApi("POST", "/threads", {})));
ipcMain.handle("threads:messages", wrap((id: string) => vynApi("GET", `/threads/${encodeURIComponent(id)}`)));
ipcMain.handle("threads:delete", wrap((id: string) => vynApi("DELETE", `/threads/${encodeURIComponent(id)}`)));
ipcMain.handle("chat:send", wrap((threadId: string, text: string) => chat(threadId, text)));
ipcMain.handle("memories:list", wrap(() => vynApi("GET", "/memories")));
ipcMain.handle("memories:delete", wrap((id: number) => vynApi("DELETE", `/memories?id=${Number(id)}`)));
ipcMain.handle("routines:list", wrap(() => vynApi("GET", "/routines")));
ipcMain.handle("routines:cancel", wrap((id: string) => vynApi("DELETE", `/routines?id=${encodeURIComponent(id)}`)));
ipcMain.handle(
  "telegram:link",
  wrap(async () => {
    const r = await vynApi<{ url: string }>("POST", "/telegram");
    // Only ever open Telegram's own link.
    if (/^https:\/\/t\.me\//.test(r.url)) void shell.openExternal(r.url);
    return r;
  }),
);
ipcMain.handle("binance:get", wrap(() => vynApi("GET", "/binance")));
ipcMain.handle(
  "binance:connect",
  wrap(async () => {
    const r = await vynApi<{ url: string }>("POST", "/binance", {});
    // Only ever open Binance's own sign-in.
    const u = new URL(r.url);
    if (u.protocol === "https:" && (u.hostname === "binance.com" || u.hostname.endsWith(".binance.com"))) void shell.openExternal(r.url);
    return r;
  }),
);
ipcMain.handle("binance:disconnect", wrap(() => vynApi("DELETE", "/binance")));
ipcMain.handle("telegram:unlink", wrap((id: number) => vynApi("DELETE", `/telegram?id=${Number(id)}`)));

// ---- Reminders and check-ins: Vyn's own messages, as system notifications ----

const seenFile = () => join(app.getPath("userData"), "notices.json");
function lastSeen() {
  try {
    return existsSync(seenFile()) ? Number(JSON.parse(readFileSync(seenFile(), "utf8")).after) || 0 : 0;
  } catch {
    return 0;
  }
}

function startNotices() {
  let after = lastSeen();
  let first = after === 0;
  const poll = async () => {
    if (!loadSession()) return;
    try {
      const { notices } = await vynApi<{ notices: { id: number; threadId: string; title: string; text: string }[] }>("GET", `/notices?after=${after}`);
      for (const n of notices) {
        after = Math.max(after, n.id);
        // On the very first run, don't replay old reminders as notifications.
        if (first) continue;
        send("chat:event", { type: "notice", threadId: n.threadId, title: n.title, text: n.text });
        if (Notification.isSupported()) {
          const note = new Notification({ title: `Vyn · ${n.title}`, body: n.text.slice(0, 240), icon: join(__dirname, "..", "build", "icon.png") });
          note.on("click", () => {
            main?.show();
            main?.focus();
            send("chat:event", { type: "open-thread", threadId: n.threadId });
          });
          note.show();
        }
      }
      first = false;
      writeFileSync(seenFile(), JSON.stringify({ after }));
    } catch {
      // Offline or signed out: try again next time.
    }
  };
  void poll();
  setInterval(() => void poll(), 60_000);
}

// ---- Workshop: Orvyn Engine, Reel and Studio on this computer ----

ipcMain.handle("workshop:status", wrap(async () => workshop.status()));
ipcMain.handle(
  "workshop:locate",
  wrap(async (what: "chrome" | "ffmpeg") => {
    const r = await dialog.showOpenDialog(main!, { title: what === "chrome" ? "Choose Chrome or Edge" : "Choose ffmpeg", properties: ["openFile"] });
    if (!r.canceled && r.filePaths[0]) workshop.saveSettings({ [what]: r.filePaths[0] });
    return workshop.status();
  }),
);
ipcMain.handle(
  "workshop:workspace",
  wrap(async () => {
    const r = await dialog.showOpenDialog(main!, { title: "Choose the Vyn workspace folder", properties: ["openDirectory", "createDirectory"] });
    if (!r.canceled && r.filePaths[0]) workshop.saveSettings({ workspace: r.filePaths[0] });
    return workshop.status();
  }),
);
ipcMain.handle("workshop:open", wrap(async (rel: string) => workshop.openFolder(rel)));
ipcMain.handle("games:list", wrap(async () => workshop.listGames()));
ipcMain.handle("games:templates", wrap(async () => workshop.templates().map(({ id, name, blurb }) => ({ id, name, blurb }))));
ipcMain.handle("games:new", wrap((templateId: string, name: string) => workshop.newGame(templateId, name)));
ipcMain.handle("games:check", wrap((name: string) => workshop.checkGame(name)));
ipcMain.handle("games:playtest", wrap((name: string) => workshop.playtestGame(String(name))));
ipcMain.handle("games:play", wrap(async (name: string) => workshop.playGame(name)));
ipcMain.handle(
  "reel:render",
  wrap(async () => {
    const r = await dialog.showOpenDialog(main!, { title: "Choose a film page (HTML)", defaultPath: workshop.workspace(), filters: [{ name: "Film", extensions: ["html", "htm"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const page = r.filePaths[0];
    const out = page.replace(/.html?$/i, ".mp4");
    return workshop.renderFilm(page, out, (pct) => send("workshop:progress", { what: "reel", pct }));
  }),
);
ipcMain.handle(
  "reel:preview",
  wrap(async () => {
    const r = await dialog.showOpenDialog(main!, { title: "Choose a film page (HTML)", defaultPath: workshop.workspace(), filters: [{ name: "Film", extensions: ["html", "htm"] }], properties: ["openFile"] });
    if (!r.canceled && r.filePaths[0]) await workshop.previewFilm(r.filePaths[0]);
    return null;
  }),
);
ipcMain.handle("studio:start", wrap(async () => (await workshop.startStudio(), workshop.studioCapabilities())));
ipcMain.handle("studio:stop", wrap(async () => workshop.stopStudio()));
ipcMain.handle("studio:render", wrap((renderer: string, spec: unknown) => workshop.studioRender(renderer, spec)));
ipcMain.handle(
  "studio:import",
  wrap(async () => {
    const r = await dialog.showOpenDialog(main!, { title: "Add files to the workspace", properties: ["openFile", "multiSelections"] });
    return r.canceled ? [] : r.filePaths.map((p) => workshop.importInput(p));
  }),
);
ipcMain.handle("files:show", wrap(async (file: string) => shell.showItemInFolder(file)));

// ---- The desk: files, approvals, agents, screen ----

ipcMain.handle("desk:tree", wrap(async (rel?: string) => ({ workspace: workshop.workspace(), nodes: desk.tree(rel ?? "") })));
ipcMain.handle("desk:read", wrap(async (rel: string) => desk.readText(rel)));
ipcMain.handle("desk:write", wrap(async (rel: string, content: string) => desk.writeText(rel, content)));
ipcMain.handle("desk:approve", (_e, id: number, ok: boolean) => desk.answerApproval(Number(id), Boolean(ok)));
ipcMain.handle("desk:settings", wrap(async () => desk.deskSettings()));
ipcMain.handle("desk:setApproval", wrap(async (level: desk.ApprovalLevel) => desk.setApproval(["ask", "edits", "full"].includes(level) ? level : "ask")));
ipcMain.handle("agents:list", wrap(() => desk.listAgents()));
ipcMain.handle("companion:status", wrap(() => companion.status()));
ipcMain.handle("companion:connect", wrap((handle: string) => companion.connect(String(handle ?? "").trim().toLowerCase().slice(0, 32))));
ipcMain.handle("companion:refresh", wrap(() => companion.refresh()));
ipcMain.handle("companion:disconnect", wrap(async (forget?: boolean) => {
  await companion.disconnect();
  if (forget) companion.forgetWallet();
}));
ipcMain.handle("agents:get", wrap((id: string) => desk.agentDetail(id)));
ipcMain.handle("agents:chat", wrap((id: string, message: string) => desk.chatWithAgent(id, String(message).slice(0, 4000), send)));
ipcMain.handle("agents:stop", wrap(async () => desk.stopAgentChats()));
ipcMain.handle("screen:capture", wrap(async () => browser.capture()));
ipcMain.handle("screen:control", wrap(async () => browser.focus()));
