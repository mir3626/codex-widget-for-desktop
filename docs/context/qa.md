# QA Context

## Default Checks

Run these after ordinary TypeScript/daemon/renderer changes:

```powershell
npm run smoke:all
```

Run this after conversation layout, markdown/table rendering, prompt composer, or response action menu changes:

```powershell
npm run smoke:renderer-chat
```

Run this when changing the Windows screen capture helper and a desktop session is available:

```powershell
npm run smoke:all:live
npm run smoke:screen-helper:ocr
npm run smoke:screen-capture:live
```

Run this after resident daemon lifecycle, runtime status, or resource-budget changes:

```powershell
npm run smoke:resident-soak
```

Run this after packaged daemon bundle/runtime resource changes:

```powershell
npm run smoke:node-runtime
```

Run this after browser DOM extension, Options page, or package metadata changes:

```powershell
npm run smoke:extension
npm run smoke:dom
```

Run this after a release build when bundle resource wiring changes:

```powershell
npm run release:verify
```

Run this after Tauri/Rust/native shell changes:

```powershell
npm run smoke:tauri-supervisor
.\scripts\use-msvc-env.ps1
Push-Location src-tauri
cargo check --no-default-features
Pop-Location
```

Run this to launch the widget locally:

```powershell
.\scripts\use-msvc-env.ps1
npm run dev
```

`npm run dev` starts renderer HMR and a daemon restart loop through `scripts/dev-hot.mjs`. Renderer changes hot-reload in the Tauri WebView; daemon TypeScript changes rebuild and restart the daemon. Rust/Tauri shell changes still use the normal Tauri dev rebuild cycle.

## Harness Checks

After vibe-doctor setup or sync:

```powershell
node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap
npm run vibe:doctor
npm run vibe:checkpoint
```

## Known Local Requirements

- Rust/Cargo installed through rustup.
- Visual Studio Build Tools with Desktop development with C++.
- Windows SDK and WebView2 runtime.
- Node.js 24+ and npm.

## Current Test Gaps

- No automated screenshot assertion for the native transparent Tauri window.
- Renderer chat layout has a browser smoke, but native transparent-window screenshots are still manual.
- Browser DOM provider is snapshot-based and has an unpacked extension plus a generated zip package; browser store submission metadata and native messaging are not implemented yet.
- Screen/Vision provider is snapshot-based and has a Windows capture helper, optional local OCR command hook, and app-server image input; bundled OCR engine packaging is not implemented yet.
- Terminal provider supports explicit one-shot commands and a persistent command session through `/pty`, but it is not a raw ConPTY/full-screen interactive terminal yet.
- OAuth proxy live streaming requires an auth/proxy service and is not covered by CI-like smoke tests.
- Packaged daemon restart backoff and child restart have Rust tests; end-to-end native crash/restart observation in an installed app is still manual.
- Renderer-visible native daemon diagnostics are covered by type/build checks; installed-app restart UX screenshots are still manual.
- Bundled Node runtime smoke verifies local daemon startup without repository `node_modules`; installed MSI launch observation is still manual.
- `npm run smoke:release-resources` verifies generated MSI/NSIS scripts include bundled daemon/runtime/provider resources, but it does not install and launch the artifacts.
- `npm run smoke:release-launch` starts the release exe hidden and verifies the daemon WebSocket on port `4128`.
- `npm run smoke:release-install` performs a Windows NSIS silent install, launches the installed app hidden, verifies the installed bundled daemon on port `4128`, kills that daemon to verify native supervisor restart, silently uninstalls, and checks cleanup; MSI install/uninstall is still manual.
- `npm run release:verify` is the single full release gate and runs the live provider/resident smokes, Tauri build, release resource smoke, release exe launch smoke, and NSIS install smoke.
