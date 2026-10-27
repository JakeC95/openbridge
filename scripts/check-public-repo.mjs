import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const self = "scripts/check-public-repo.mjs";
const ownerMatch = `${String.fromCharCode(74, 97, 107, 101)}C?95`;
const ownerName = `${String.fromCharCode(74, 97, 107, 101)}C95`;
const userMatch = `${String.fromCharCode(106, 97, 107, 101)}h`;

const checks = [
  { label: "Windows user path", pattern: /[A-Za-z]:\\Users\\(?![<%$])/i },
  { label: "Unix home path", pattern: /\/(?:Users|home)\/(?![<%$])/ },
  { label: "email address", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { label: "personal name or handle", pattern: new RegExp(`\\b(?:${ownerMatch}|${userMatch})\\b`, "i") },
  { label: "machine-specific detail", pattern: /CPU|\bCPU\b/i },
  { label: "private project path", pattern: /openbridge/i },
  { label: "recovered secret", pattern: /REDACTED|REDACTED/i },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "cloud access token", pattern: /(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/ },
  { label: "hard-coded personal repository", pattern: new RegExp(`github\\.com/${ownerName}`, "i") }
];

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024
})
  .split("\0")
  .filter(Boolean);

const violations = [];

for (const file of tracked) {
  if (file === self) continue;

  const buffer = readFileSync(join(root, file));
  if (buffer.includes(0, 0, Math.min(buffer.length, 8192))) continue;

  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const check of checks) {
      if (check.pattern.test(lines[index])) {
        violations.push(`${file}:${index + 1}  ${check.label}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Public-repository hygiene check failed:");
  for (const violation of violations) console.error(`  ${violation}`);
  console.error("\nRemove the flagged data before committing. Do not paste the matched value into CI.");
  process.exit(1);
}

console.log(`Public-repository hygiene check passed (${tracked.length} tracked files).`);
