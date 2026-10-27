# Reverse-engineering toolchain

Everything below was installed locally under `tools/` (git-ignored) on Windows 11 x64. No admin
rights were required.

## Installed software

| Tool | Version | Path | Used for |
|---|---|---|---|
| Node.js | 24.22.1 | `tools/node-v24.22.1-win-x64/node.exe` | running asar, prettier, esbuild |
| npm | 11.19.1 | `tools/node-v24.22.1-win-x64/npm.cmd` | packages |
| @electron/asar | 4.3.1 | global npm prefix | `app.asar` extraction |
| prettier | 3.9.10 | global npm prefix | pretty-printing minified bundles |
| ripgrep | 15.2.0 | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\BurntSushi.ripgrep.MSVC_...\rg.exe` | fast source search |
| jq | 1.8.2 | `tools/jq.exe` | source-map and manifest queries |
| 7-Zip reduced (`7zr`) | 26.04 | `tools/7zr.exe` | `.7z` extraction only |
| Ghidra | 12.2 PUBLIC | `tools/ghidra/ghidra_12.2_PUBLIC/` | native analysis |
| JDK (Temurin) | 25.0.5+8 | `tools/jdk/jdk-25.0.5+8/` | Ghidra 12.2 requires JDK 25+ |
| JDK (Temurin) | 21.0.12.1+1 | `tools/jdk/jdk-21.0.12.1+1/` | kept for older tools |
| Python | 3.13.14 | system | source-map dump, generic scripting |
| Git | 2.55.0 | system | cloning leanrea |

`7zr.exe` is the reduced 7-Zip build and **cannot open `.zip`**. Use Windows `tar -xf file.zip -C dest`
or `Expand-Archive` for zips. Ghidra is a `.zip`, so it was extracted with `tar`.

## leanrea

The workflow skill was cloned to `third_party/leanrea`, read, and installed as a project skill at
`.opencode/skills/leanrea/SKILL.md`. Restart opencode once to make it appear in the skill list; the
current session follows it manually. The rules used:

- work on a copy; extract into a scratch dir
- route by magic bytes/`file` first; run the cheapest inventory next
- always search extracted trees with `rg -uu` (bundlers hide code in dot-folders)
- never `cat` minified files; slice around needles
- batch probes; mark claims as **seen** vs **inferred**

For this target the winning move was the Electron row:

```sh
npx -y @electron/asar extract app.asar X
jq '{name,version,main}' X/package.json
rg -uu -l --glob '!node_modules' 'exposeInMainWorld' X
```

The renderer source map had `sourcesContent`, so instead of reading a 3.2 MB minified bundle we
recovered the original module sources with `analysis/tools/dump_map.py`.

## Ghidra setup

```powershell
$env:JAVA_HOME = "C:\Users\<user>\Documents\openbridge\tools\jdk\jdk-25.0.5+8"
tools\ghidra\ghidra_12.2_PUBLIC\support\analyzeHeadless.bat
```

The first attempt with JDK 21 failed with "JDK 25+ could not be found"; JDK 25 fixed it. Native
analysis is not required for the JS logic, but is available for `Bridge.exe`, `.node` addons and the
bundled Assimp / image-processor binaries.

## Reproducing the extraction

```powershell
powershell -ExecutionPolicy Bypass -File scripts\extract-original.ps1
```

This re-extracts `C:\Program Files\Bridge\resources\app.asar` into `analysis/asar`, dumps the
renderer sources to `analysis/renderer-src`, and writes `analysis/main.pretty.js`.

## Runtime access on Windows

- Application log: `%APPDATA%\Bridge\bridge.log` (JSON lines, Winston).
- Chromium/Electron logs: launch `Bridge.exe --enable-logging=stderr --v=1` and capture stderr, or use
  `--enable-logging --log-file=<path>`.
- DevTools in the original app: the main process handles `asset-right-click` by calling
  `openDevTools()` and `inspectElement(x,y)` (`analysis/main.pretty.js:817`). Right-clicking an asset
  opens the inspector/console. Because the renderer has `nodeIntegration: true`, the console can
  `require()` Node modules — useful for live probing.
- Network: the app forces `User-Agent: megascans-bridge` on every request
  (`analysis/main.pretty.js:588`). If you need to inspect TLS traffic, set a local proxy with a
  trusted CA rather than trying to decrypt captures after the fact.

## Notes / traps

- PowerShell 5.1 `Invoke-WebRequest` can prompt in non-interactive mode; use `curl.exe -s` for probes.
- `Start-Process` with `-RedirectStandardOutput` is the reliable way to capture Electron stderr.
- The original Bridge renderer owns the local ports. Close it before testing OpenBridge, or expect
  `EADDRINUSE` on `28852/28456/28458`.
- `npm` 11.19 blocks install scripts unless approved (`npm install-scripts ls`). Electron's download
  script had to be run manually: `node node_modules/electron/install.js`.
