import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "out");

function repositoryFromGit() {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8"
    }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    return match ? `${match[1]}/${match[2]}` : "";
  } catch {
    return "";
  }
}

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

const repository = (
  process.env.OPENBRIDGE_REPOSITORY ||
  process.env.GITHUB_REPOSITORY ||
  localConfig.repository ||
  repositoryFromGit()
).trim();
if (!repository) {
  console.warn(
    "repository owner/name not detected; set OPENBRIDGE_REPOSITORY for update checks"
  );
}

const define = {
  "process.env.NODE_ENV": '"production"',
  __OPENBRIDGE_CONFIG__: JSON.stringify(localConfig),
  __OPENBRIDGE_REPOSITORY__: JSON.stringify(repository)
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


