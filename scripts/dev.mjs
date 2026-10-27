import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const build = spawn(process.execPath, [join(root, "scripts/build.mjs")], {
  stdio: "inherit",
  cwd: root
});

build.on("exit", code => {
  if (code !== 0) process.exit(code ?? 1);

  const electron = spawn(
    process.platform === "win32"
      ? join(root, "node_modules", ".bin", "electron.cmd")
      : join(root, "node_modules", ".bin", "electron"),
    ["."],
    { stdio: "inherit", cwd: root, shell: process.platform === "win32" }
  );

  electron.on("exit", code => process.exit(code ?? 0));
});
