// Exports Vyn's face (ui/face-art.ts) for every app: SVGs for the desktop and the web app (its landing),
// transparent 512px PNGs for the mobile app (rendered with a local Chrome or Edge).
//   node scripts/export-vyn.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apps = join(root, "..");
const tmp = join(tmpdir(), `vyn-export-${process.pid}`);
mkdirSync(tmp, { recursive: true });

const mod = join(tmp, "face-art.mjs");
await build({ entryPoints: [join(root, "ui", "face-art.ts")], outfile: mod, bundle: true, format: "esm", platform: "node", logLevel: "warning" });
const { MOODS, vynSvg, vynIcon } = await import(pathToFileURL(mod).href);

for (const dir of [join(root, "static", "vyn"), join(apps, "orvyn-web", "public", "vyn")]) {
  if (!existsSync(dirname(dir))) continue;
  mkdirSync(dir, { recursive: true });
  for (const m of MOODS) writeFileSync(join(dir, `${m}.svg`), vynSvg(m));
  console.log(`svg → ${dir}`);
}

const browsers = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browser = browsers.find((b) => existsSync(b));
const mobile = join(apps, "orvyn-mobile", "assets", "vyn");
if (!browser) console.log("no Chrome or Edge found: skipped the mobile PNGs");
else if (existsSync(mobile)) {
  for (const m of MOODS) {
    const page = join(tmp, `${m}.html`);
    writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:512px;height:512px">${vynSvg(m).replace("<svg ", '<svg width="512" height="512" ')}</div></body></html>`);
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", "--window-size=512,512", `--screenshot=${join(mobile, `${m}.png`)}`, pathToFileURL(page).href], { stdio: "ignore" });
  }
  console.log(`png → ${mobile}`);
}

// App icons (1024 px PNG): the desktop's rounded tile; a full tile where the platform masks it.
if (browser) {
  const icons = [
    [join(root, "build", "icon.png"), "rounded"],
    [join(apps, "orvyn-mobile", "assets", "vyn", "icon.png"), "full"],
    [join(apps, "orvyn-web", "public", "vyn", "icon.png"), "rounded"],
  ];
  for (const [file, tile] of icons) {
    if (!existsSync(dirname(file))) continue;
    const page = join(tmp, `icon-${tile}.html`);
    writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent">${vynIcon(tile)}</body></html>`);
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", "--window-size=1024,1024", `--screenshot=${file}`, pathToFileURL(page).href], { stdio: "ignore" });
    console.log(`icon → ${file}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
