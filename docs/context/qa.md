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
npm run smoke:screen-capture:live
```

Run this after resident daemon lifecycle, runtime status, or resource-budget changes:

```powershell
npm run smoke:resident-soak
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
- Screen/Vision provider is snapshot-based and has a Windows capture helper plus app-server image input; OCR is not implemented yet.
- Terminal provider supports explicit one-shot commands and a persistent command session through `/pty`, but it is not a raw ConPTY/full-screen interactive terminal yet.
- OAuth proxy live streaming requires an auth/proxy service and is not covered by CI-like smoke tests.
- Packaged daemon restart backoff and child restart have Rust tests; end-to-end native crash/restart observation in an installed app is still manual.
