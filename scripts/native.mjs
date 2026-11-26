// The native parts Vyn bundles, into native/: reel, orvyn-studio and orvyn-worlds (bin/), the
// Orvyn Engine player (engine/) and Studio's page libraries (studio-libs/).
// Each comes from its repository checked out next to this one (built here), or else from its
// GitHub release at the version in package.json "orvynNative".
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "native");
const versions = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).orvynNative;
const owner = process.env.ORVYN_GITHUB_OWNER ?? "OrvynOS";
const REMOTE = {"orvyn-core":"Core","orvyn-api":"Api","orvyn-web":"Web","orvyn-agent":"Agent","orvyn-docs":"Docs","vyn-desktop":"Desktop","orvyn-mobile":"Mobile","orvyn-engine":"Engine","orvyn-reel":"Reel","orvyn-studio":"Studio","orvyn-worlds":"Worlds","orvyn-contracts":"Contracts","orvyn-infra":"Infra"};
const token = process.env.ORVYN_REPO_TOKEN;
const exe = (n) => (process.platform === "win32" ? `${n}.exe` : n);
const platform = `${{ win32: "windows", darwin: "macos", linux: "linux" }[process.platform]}-${process.arch}`;
const sibling = (repo) => join(root, "..", repo);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

async function download(url, to) {
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}
async function release(repo, asset, into) {
  const tar = join(out, ".download.tar.gz");
  await download(`https://github.com/${owner}/${REMOTE[repo] ?? repo}/releases/download/${versions[repo.replace("orvyn-", "")]}/${asset}`, tar);
  mkdirSync(into, { recursive: true });
  execFileSync("tar", ["-xzf", tar, "-C", into]);
  rmSync(tar);
}

mkdirSync(join(out, "bin"), { recursive: true });

// Programs.
for (const [repo, bin] of [["orvyn-reel", "reel"], ["orvyn-studio", "orvyn-studio"], ["orvyn-worlds", "orvyn-worlds"]]) {
  if (existsSync(sibling(repo))) {
    run("cargo", ["build", "--release", "--bins"], sibling(repo));
    cpSync(join(sibling(repo), "target", "release", exe(bin)), join(out, "bin", exe(bin)));
  } else await release(repo, `${bin}-${platform}.tar.gz`, join(out, "bin"));
  console.log(`${bin} ✓`);
}

// The engine player.
rmSync(join(out, "engine"), { recursive: true, force: true });
if (existsSync(sibling("orvyn-engine"))) {
  const player = join(sibling("orvyn-engine"), "player");
  run("pnpm", ["install"], player);
  run("pnpm", ["build"], player);
  cpSync(join(player, "dist"), join(out, "engine"), { recursive: true });
} else await release("orvyn-engine", "orvyn-engine-player.tar.gz", join(out, "engine"));
console.log("engine ✓");

// Studio's page libraries (three, gsap, roughjs: what renders may load).
const libs = join(out, ".studio-libs");
rmSync(libs, { recursive: true, force: true });
mkdirSync(libs, { recursive: true });
if (existsSync(sibling("orvyn-studio"))) cpSync(join(sibling("orvyn-studio"), "web", "package.json"), join(libs, "package.json"));
else await download(`https://raw.githubusercontent.com/${owner}/Studio/${versions.studio}/web/package.json`, join(libs, "package.json"));
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], libs);
rmSync(join(out, "studio-libs"), { recursive: true, force: true });
cpSync(join(libs, "node_modules"), join(out, "studio-libs"), { recursive: true });
rmSync(libs, { recursive: true, force: true });
console.log("studio-libs ✓");
