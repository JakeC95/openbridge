# Research toolchain

These notes describe the optional tools used to study the original Bridge package. They are not
required to build or run OpenBridge. Local tool archives live under `tools/` and `analysis/`, both
of which are git-ignored.

## Tools

| Tool | Used for |
|---|---|
| Node.js 24+ and npm | running extraction scripts, esbuild and project tooling |
| `@electron/asar` | extracting `app.asar` |
| Prettier | formatting minified bundles |
| ripgrep | searching extracted sources |
| `jq` | JSON and source-map queries |
| `7zr` or Windows `tar` | archive extraction |
| Ghidra and a supported JDK | optional native binary analysis |
| Python 3 | renderer source-map dumping |

Install paths vary by machine. The commands below use placeholders:

```powershell
$env:JAVA_HOME = "<repo>\tools\jdk"
<repo>\tools\ghidra\support\analyzeHeadless.bat
```

## Extracting the original package

```powershell
powershell -ExecutionPolicy Bypass -File scripts\extract-original.ps1
```

The script expects an installed Bridge package by default at
`C:\Program Files\Bridge\resources\app.asar`. Pass `-BridgeDir` when it is installed elsewhere. It
writes the extracted tree to `analysis/asar`, recovered renderer sources to `analysis/renderer-src`
and a formatted main bundle to `analysis/main.pretty.js`.

## Runtime inspection

- Application logs: `%APPDATA%\Bridge\bridge.log` (JSON lines).
- Chromium/Electron logs: launch the original app with `--enable-logging=stderr --v=1`.
- DevTools: the original renderer enables `nodeIntegration`, so the console can inspect Node
  modules. This is unsafe and must not be copied into OpenBridge.
- Network: the original app sends a fixed `User-Agent`. Use a trusted local proxy with a test CA if
  TLS inspection is needed.

## Hygiene

- Keep original artwork, extracted sources, logs and tool archives out of Git.
- Do not publish account identifiers, tokens, absolute user paths or machine details from research
  sessions.
- Run `npm run check:public` before opening a pull request.
