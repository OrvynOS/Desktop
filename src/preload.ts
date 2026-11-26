/** The only bridge between Vyn's chat window and the app: named calls, no Node access. */
import { contextBridge, ipcRenderer } from "electron";

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("vyn", {
  authState: () => call("auth:state"),
  signIn: () => call("auth:start"),
  signOut: () => call("auth:signOut"),
  getSettings: () => call("settings:get"),
  saveSettings: (s: unknown) => call("settings:save", s),
  listThreads: () => call("threads:list"),
  createThread: () => call("threads:create"),
  messages: (id: string) => call("threads:messages", id),
  deleteThread: (id: string) => call("threads:delete", id),
  send: (threadId: string, text: string) => call("chat:send", threadId, text),
  answer: (text: string) => call("ask:answer", text),
  memories: () => call("memories:list"),
  forget: (id: number) => call("memories:delete", id),
  routines: () => call("routines:list"),
  cancelRoutine: (id: string) => call("routines:cancel", id),
  linkTelegram: () => call("telegram:link"),
  unlinkTelegram: (id: number) => call("telegram:unlink", id),
  binance: { get: () => call("binance:get"), connect: () => call("binance:connect"), disconnect: () => call("binance:disconnect") },
  stop: () => call("chat:stop"),
  desk: {
    tree: (rel?: string) => call("desk:tree", rel),
    read: (rel: string) => call("desk:read", rel),
    write: (rel: string, content: string) => call("desk:write", rel, content),
    approve: (id: number, ok: boolean) => call("desk:approve", id, ok),
    settings: () => call("desk:settings"),
    setApproval: (level: string) => call("desk:setApproval", level),
  },
  agents: {
    list: () => call("agents:list"),
    get: (id: string) => call("agents:get", id),
    chat: (id: string, message: string) => call("agents:chat", id, message),
    stop: () => call("agents:stop"),
  },
  companion: {
    status: () => call("companion:status"),
    connect: (handle: string) => call("companion:connect", handle),
    refresh: () => call("companion:refresh"),
    disconnect: (forget?: boolean) => call("companion:disconnect", forget),
  },
  screen: {
    capture: () => call("screen:capture"),
    control: () => call("screen:control"),
  },
  workshop: {
    status: () => call("workshop:status"),
    locate: (what: "chrome" | "ffmpeg") => call("workshop:locate", what),
    chooseWorkspace: () => call("workshop:workspace"),
    open: (rel: string) => call("workshop:open", rel),
    show: (file: string) => call("files:show", file),
    games: () => call("games:list"),
    templates: () => call("games:templates"),
    newGame: (templateId: string, name: string) => call("games:new", templateId, name),
    checkGame: (name: string) => call("games:check", name),
    playGame: (name: string) => call("games:play", name),
    playtest: (name: string) => call("games:playtest", name),
    renderFilm: () => call("reel:render"),
    previewFilm: () => call("reel:preview"),
    startStudio: () => call("studio:start"),
    stopStudio: () => call("studio:stop"),
    render: (renderer: string, spec: unknown) => call("studio:render", renderer, spec),
    importFiles: () => call("studio:import"),
  },
  on: (channel: "chat:event" | "auth:done" | "workshop:progress" | "agent:event" | "desk:file-changed", fn: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
