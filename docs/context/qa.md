# QA Context

## Default Checks

Run these after ordinary TypeScript/daemon/renderer changes:

```powershell
npm run lint
npm run build:web
npm run smoke
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
- OpenAI live streaming path requires local credentials and is not covered by CI-like smoke tests.
