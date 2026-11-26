/**
 * Orvyn for Vyn desktop: sign-in with Orvyn OAuth's device flow, tokens kept with the operating
 * system's encryption (Electron safeStorage: Keychain, DPAPI, libsecret), and the Vyn API.
 */
import { app, safeStorage } from "electron";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const API = (process.env.ORVYN_API_URL || "https://api.orvyn.cash").replace(/\/$/, "");
const CLIENT_ID = process.env.VYN_CLIENT_ID || "orv_vyn";
const SCOPE = "openid profile offline_access vyn";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const file = () => join(app.getPath("userData"), "session.bin");
let tokens: Tokens | null = null;

function save(t: Tokens | null) {
  tokens = t;
  if (!t) return rmSync(file(), { force: true });
  const json = JSON.stringify(t);
  // Without OS encryption (some Linux setups), refuse to persist rather than store tokens in the clear.
  if (!safeStorage.isEncryptionAvailable()) return;
  writeFileSync(file(), safeStorage.encryptString(json));
}

export function loadSession() {
  if (tokens) return true;
  try {
    if (!existsSync(file()) || !safeStorage.isEncryptionAvailable()) return false;
    tokens = JSON.parse(safeStorage.decryptString(readFileSync(file()))) as Tokens;
    return true;
  } catch {
    return false;
  }
}

export const signOut = async () => {
  if (tokens) {
    await fetch(`${API}/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: tokens.refreshToken, client_id: CLIENT_ID }) }).catch(() => undefined);
  }
  save(null);
};

async function form(path: string, body: Record<string, string>) {
  const res = await fetch(`${API}${path}`, { method: "POST", body: new URLSearchParams(body), signal: AbortSignal.timeout(20_000) });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const store = (data: Record<string, unknown>) =>
  save({ accessToken: String(data.access_token), refreshToken: String(data.refresh_token), expiresAt: Date.now() + Number(data.expires_in ?? 900) * 1000 });

/** Start device sign-in: returns the code to show and a promise that resolves once approved. */
export async function startSignIn() {
  const { status, data } = await form("/oauth/device_authorization", { client_id: CLIENT_ID, scope: SCOPE });
  if (status !== 200) throw new Error(String(data.error_description ?? "couldn't start sign-in"));
  let interval = Number(data.interval ?? 5) * 1000;
  const deadline = Date.now() + Number(data.expires_in ?? 600) * 1000;
  const done = (async () => {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      const r = await form("/oauth/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: String(data.device_code), client_id: CLIENT_ID });
      if (r.status === 200) return store(r.data);
      if (r.data.error === "slow_down") interval += 5000;
      else if (r.data.error !== "authorization_pending") throw new Error(String(r.data.error_description ?? r.data.error ?? "sign-in failed"));
    }
    throw new Error("the code expired; start again");
  })();
  return { userCode: String(data.user_code), verificationUri: String(data.verification_uri_complete ?? data.verification_uri), done };
}

async function accessToken() {
  if (!tokens) throw new Error("not signed in");
  if (Date.now() > tokens.expiresAt - 60_000) {
    const r = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: CLIENT_ID });
    if (r.status !== 200) {
      save(null);
      throw new Error("signed out: please sign in again");
    }
    store(r.data);
  }
  return tokens!.accessToken;
}

/** Call the Vyn API as the signed-in person. */
export async function vynApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/api/vyn${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(130_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(data.error ?? `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function me() {
  const res = await fetch(`${API}/oauth/userinfo`, { headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(10_000) });
  return (await res.json().catch(() => ({}))) as { sub?: string; name?: string };
}

/** Call a streaming (server-sent events) Vyn API route; `onEvent` gets each event's JSON. */
export async function vynStream(path: string, body: unknown, onEvent: (event: Record<string, unknown>) => void, signal?: AbortSignal) {
  const res = await fetch(`${API}/api/vyn${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let at: number;
    while ((at = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, at).trim();
      buf = buf.slice(at + 2);
      if (chunk.startsWith("data: ")) {
        try {
          onEvent(JSON.parse(chunk.slice(6)));
        } catch {
          // a malformed event: skip it
        }
      }
    }
  }
}
