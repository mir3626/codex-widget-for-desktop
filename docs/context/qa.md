# QA Context

## Default Checks

Run these after ordinary TypeScript/daemon/renderer changes:

```powershell
npm run lint
npm run build:web
npm run smoke
npm run smoke:resident
```

Run this after Tauri/Rust/native shell changes:

```powershell
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
- No real browser DOM provider yet.
- No real screen capture/vision provider yet.
- No real PTY provider yet.
- OAuth proxy live streaming requires an auth/proxy service and is not covered by CI-like smoke tests.
