import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "out");

let localConfig = {};
try {
  localConfig = JSON.parse(await readFile(join(root, "config.local.json"), "utf8"));
} catch {
  console.warn("config.local.json not found; checking environment overrides");
}

const envConfig = {
  epicClientId: process.env.OPENBRIDGE_EPIC_CLIENT_ID,
  algoliaAppId: process.env.OPENBRIDGE_ALGOLIA_APP_ID,
  algoliaApiKey: process.env.OPENBRIDGE_ALGOLIA_API_KEY,
  algoliaIndex: process.env.OPENBRIDGE_ALGOLIA_INDEX,
  apiBaseUrl: process.env.OPENBRIDGE_API_BASE,
  ssoBaseUrl: process.env.OPENBRIDGE_SSO_BASE,
  signedUrlBase: process.env.OPENBRIDGE_SIGNED_URL_BASE,
  realm: process.env.OPENBRIDGE_REALM
};
for (const [key, value] of Object.entries(envConfig)) {
  if (value && value.trim()) localConfig[key] = value.trim();
}

if (!localConfig.epicClientId || !localConfig.algoliaApiKey) {
  console.warn("legacy service credentials are empty; catalogue and sign-in will not work");
}

const define = {
  "process.env.NODE_ENV": '"production"',
  __OPENBRIDGE_CONFIG__: JSON.stringify(localConfig)
};

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "main"), { recursive: true });
await mkdir(join(out, "preload"), { recursive: true });
await mkdir(join(out, "renderer"), { recursive: true });

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  absWorkingDir: root
};

await build({
  ...shared,
  entryPoints: ["src/main/index.ts"],
  outfile: "out/main/index.js",
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  define
});

await build({
  ...shared,
  entryPoints: ["src/preload/index.ts"],
  outfile: "out/preload/index.js",
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  define
});

await build({
  ...shared,
  entryPoints: ["src/renderer/main.tsx"],
  outfile: "out/renderer/app.js",
  platform: "browser",
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  minify: true,
  loader: { ".css": "css", ".ttf": "file" },
  define
});

await cp(join(root, "src/renderer/index.html"), join(out, "renderer/index.html"));
console.log("build complete -> out/");


