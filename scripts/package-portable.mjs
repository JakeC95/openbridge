import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, chmod, cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { platform, arch } = process;
if (platform === "win32" && arch === "x64") {
  require("electron");
  execFileSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/package-portable.ps1")
  ], { cwd: root, stdio: "inherit" });
} else if (platform === "linux" && arch === "x64") {
  const electron = require("electron");
  await access(electron, constants.X_OK);
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const name = `OpenBridge-${version}-linux-x64-portable`;
  const dist = join(root, "dist");
  const target = join(dist, name);
  const archive = `${target}.tar.gz`;
  const archiveTemp = `${archive}.tmp`;

  await mkdir(dist, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(dirname(electron), target, { recursive: true });
  await rename(join(target, "electron"), join(target, "OpenBridge"));
  // The portable runtime uses Chromium's unprivileged namespace sandbox.
  await chmod(join(target, "chrome-sandbox"), 0o755);
  const app = join(target, "resources", "app");
  await mkdir(app, { recursive: true });
  await cp(join(root, "out"), join(app, "out"), { recursive: true });
  await cp(join(root, "package.json"), join(app, "package.json"));
  await cp(join(root, "LICENSE"), join(target, "LICENSE"));
  await cp(join(root, "integrations", "houdini"), join(target, "integrations", "houdini"), { recursive: true });
  try {
    execFileSync("tar", ["--mode=go-w", "-czf", archiveTemp, "-C", dist, name], { stdio: "inherit" });
    await rename(archiveTemp, archive);
  } finally {
    await rm(archiveTemp, { force: true });
  }
  console.log(`Portable build: ${target}\nPortable archive: ${archive}`);
} else {
  throw new Error(`Portable packaging is unavailable for ${platform}/${arch}`);
}
