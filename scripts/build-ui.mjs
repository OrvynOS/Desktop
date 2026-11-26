// Builds the window's UI (ui/app.ts → dist/ui.js) and the game templates Vyn starts from
// (orvyn-web's templates, checked out next to this repo → static/templates.json; kept as is otherwise).
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const ui = {
  entryPoints: [join(root, "ui", "app.ts")],
  outfile: join(root, "dist", "ui.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome130",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
};

// Templates: bundle the web app's module to CommonJS, load it, write JSON.
const templates = join(root, "..", "orvyn-web", "src", "app", "(app)", "games", "templates.ts");
if (existsSync(templates)) {
  const tmp = join(root, "dist", ".templates.cjs");
  mkdirSync(dirname(tmp), { recursive: true });
  await build({ entryPoints: [templates], outfile: tmp, bundle: true, format: "cjs", platform: "node", logLevel: "warning" });
  const { TEMPLATES } = createRequire(import.meta.url)(tmp);
  rmSync(tmp);
  writeFileSync(join(root, "static", "templates.json"), JSON.stringify(TEMPLATES));
  console.log(`templates.json: ${TEMPLATES.length} templates`);
} else console.log("templates.json: kept (no orvyn-web next to this repo)");

// Fonts (Schibsted Grotesk, JetBrains Mono: OFL), served from static/fonts.
const fonts = join(root, "static", "fonts");
mkdirSync(fonts, { recursive: true });
const req = createRequire(join(root, "package.json"));
const font = (pkg, file, out) => copyFileSync(join(dirname(req.resolve(`${pkg}/package.json`)), "files", file), join(fonts, out));
font("@fontsource-variable/schibsted-grotesk", "schibsted-grotesk-latin-wght-normal.woff2", "schibsted-grotesk.woff2");
font("@fontsource-variable/jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2", "jetbrains-mono.woff2");

if (watch) {
  const { context } = await import("esbuild");
  await (await context(ui)).watch();
} else await build(ui);
