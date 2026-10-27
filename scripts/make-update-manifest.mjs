import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

function repositoryFromGit() {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      encoding: "utf8"
    }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    return match ? `${match[1]}/${match[2]}` : "";
  } catch {
    return "";
  }
}

const version = (process.argv[2] ?? "").replace(/^v/i, "");
const zipPath = process.argv[3];
if (!version || !zipPath) {
  console.error("Usage: node scripts/make-update-manifest.mjs <version> <portable-zip>");
  process.exit(1);
}

const repository =
  process.env.OPENBRIDGE_REPOSITORY?.trim() ||
  process.env.GITHUB_REPOSITORY?.trim() ||
  repositoryFromGit();
if (!repository) {
  console.error(
    "Repository owner/name is unknown. Set OPENBRIDGE_REPOSITORY=owner/repo or run from a GitHub clone."
  );
  process.exit(1);
}

const file = await readFile(zipPath);
const info = await stat(zipPath);
const manifest = {
  version,
  url: `https://github.com/${repository}/releases/download/v${version}/${basename(zipPath)}`,
  size: info.size,
  sha256: createHash("sha256").update(file).digest("hex").toUpperCase(),
  notes: `OpenBridge ${version}`
};
const target = join(process.cwd(), "latest.json");
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${target}`);
