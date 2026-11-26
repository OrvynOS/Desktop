/**
 * Vyn as an Orvyn agent. This computer holds her wallet key (made here, encrypted with the OS's
 * encryption: Keychain, DPAPI, libsecret; Orvyn never sees it). Connecting signs Orvyn's
 * standard self-hosted registration with that key; Orvyn returns her activity key, which this
 * app uses to report the computer she runs on (her environment, self-reported).
 */
import { app, safeStorage } from "electron";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, totalmem, platform, release, arch } from "node:os";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { API, vynApi } from "./orvyn";

interface Stored {
  privateKey: `0x${string}`;
  agentKey?: string;
  agentId?: string;
}

const file = () => join(app.getPath("userData"), "companion.bin");

function load(): Stored | null {
  try {
    if (!existsSync(file()) || !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(readFileSync(file()))) as Stored;
  } catch {
    return null;
  }
}

function save(s: Stored) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("this computer has no system encryption, so Vyn can't keep a wallet key here safely");
  writeFileSync(file(), safeStorage.encryptString(JSON.stringify(s)));
}

/** Vyn's wallet on this computer (made on first use). */
function wallet() {
  let s = load();
  if (!s) {
    s = { privateKey: generatePrivateKey() };
    save(s);
  }
  return { stored: s, account: privateKeyToAccount(s.privateKey) };
}

interface Status {
  connected: boolean;
  id?: string;
  handle?: string | null;
  name?: string;
  wallet?: string | null;
  environment?: unknown;
  challenge?: { issuedAt: string; name: string; message: string };
}

export async function status() {
  const s = load();
  const here = s ? privateKeyToAccount(s.privateKey).address : null;
  const r = await vynApi<Status>("GET", "/companion");
  // Connected from another device's wallet: not this computer's Vyn.
  const thisDevice = r.connected && !!here && r.wallet?.toLowerCase() === here.toLowerCase();
  return { ...r, thisDevice, walletHere: here };
}

/** Connect Vyn to Orvyn under the handle the person chose (<handle>.orvyn.cash). */
export async function connect(handle: string, name = "Vyn") {
  const { stored, account } = wallet();
  const c = await vynApi<Status>("GET", `/companion?wallet=${account.address}&name=${encodeURIComponent(name)}`);
  if (!c.challenge) throw new Error("Orvyn didn't return a registration message");
  const signature = await account.signMessage({ message: c.challenge.message });
  const r = await vynApi<{ agentId: string; handle: string | null; key: string }>("POST", "/companion", { wallet: account.address, name: c.challenge.name, handle, issuedAt: c.challenge.issuedAt, signature });
  save({ ...stored, agentKey: r.key, agentId: r.agentId });
  await reportEnvironment().catch(() => {});
  return { id: r.agentId, handle: r.handle };
}

/** Report this computer again (already connected from here). */
export async function refresh() {
  return reportEnvironment();
}

export async function disconnect() {
  await vynApi("DELETE", "/companion");
  const s = load();
  if (s) save({ privateKey: s.privateKey });
}

/** Forget the wallet key on this computer (after disconnecting). */
export function forgetWallet() {
  rmSync(file(), { force: true });
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? "" : String(out))));

/** This computer, in the shape Orvyn's environment records use. */
async function hardware() {
  const list = cpus();
  const gpus: { name: string; memoryGb: number | null }[] = [];
  const smi = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  for (const line of smi.split("\n").filter(Boolean).slice(0, 8)) {
    const [name, mib] = line.split(",").map((x) => x.trim());
    gpus.push({ name: name.slice(0, 120), memoryGb: Number(mib) ? Math.round((Number(mib) / 1024) * 10) / 10 : null });
  }
  const osName = { win32: "Windows", darwin: "macOS", linux: "Linux" }[platform() as string] ?? platform();
  return {
    cpuModel: (list[0]?.model ?? "unknown").trim().slice(0, 120),
    cpus: list.length || 1,
    hostCpus: list.length || 1,
    memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    gpus,
    os: `${osName} ${release()}`.slice(0, 120),
    arch: arch(),
    container: false,
    runtime: `Vyn desktop ${app.getVersion()}`.slice(0, 60),
  };
}

/** Report the computer Vyn runs on (on connect and at each start). */
export async function reportEnvironment() {
  const s = load();
  if (!s?.agentKey) return { reported: false };
  const res = await fetch(`${API}/api/agents/external/environment`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.agentKey}`, "content-type": "application/json" },
    body: JSON.stringify({ hardware: await hardware() }),
    signal: AbortSignal.timeout(20_000),
  });
  return { reported: res.ok };
}
