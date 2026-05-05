# QA Context

## Default Checks

Run these after ordinary TypeScript/daemon/renderer changes:

```powershell
npm run smoke:all
```

`smoke:all` includes daemon reconnect replay coverage through `npm run smoke:daemon-reconnect` and fake Codex app-server protocol coverage through `npm run smoke:app-server`.

Run this after conversation layout, markdown/table rendering, prompt composer, or response action menu changes:

```powershell
npm run smoke:renderer-chat
```

This smoke also verifies response Branch behavior: the UI sends `session.branch`, the next prompt includes a one-shot `branchContext`, and subsequent branch prompts do not keep replaying that seed.

Run this when changing the Windows screen capture helper and a desktop session is available:

```powershell
npm run smoke:all:live
npm run smoke:screen-helper:ocr
npm run smoke:screen-capture:live
```

Run this after resident daemon lifecycle, runtime status, or resource-budget changes:

```powershell
npm run smoke:resident-soak
npm run release:soak
```

Use `npm run smoke:release-soak` instead when the release build is already current and only the hidden release-exe soak needs to be rerun.

Run this after packaged daemon bundle/runtime resource changes:

```powershell
npm run smoke:node-runtime
npm run smoke:ocr-runtime
npm run smoke:pty-runtime
```

Run this after browser DOM extension, Options page, or package metadata changes:

```powershell
npm run smoke:extension
npm run smoke:browser-native-host
npm run smoke:browser-store
npm run smoke:dom
```

Run this after a release build when bundle resource wiring changes:

```powershell
npm run release:verify
```

Run this after `release:verify` and `release:soak` when preparing a release candidate:

```powershell
npm run release:readiness
```

Use `node scripts/release-readiness.mjs --require-manual-gates` only when browser store submission and true multi-hour soak have been explicitly confirmed with the corresponding environment flags.

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
- Browser DOM provider is snapshot-based and has an unpacked extension, a generated zip package, an optional Chrome/Edge native messaging host, and store submission metadata/readiness smoke; actual browser store account submission is still manual.
- Screen/Vision provider is snapshot-based and has a Windows capture helper, env-configured crop, optional local OCR command hook, bundled OCR runtime packaging, standard Windows Tesseract discovery, bundled tessdata language defaults, OCR-only PNG preprocessing, image hash/change metadata, and app-server image input; richer region-selection UI and image-diff thresholds remain future work.
- Terminal provider supports explicit one-shot commands, a persistent node-pty/ConPTY command session through `/pty`, resize/raw-input commands with short output drain, and a renderer PTY viewport with direct input controls; richer full-screen mouse handling remains open.
- OAuth proxy live streaming requires an auth/proxy service and is not covered by CI-like smoke tests.
- Packaged daemon restart backoff and child restart have Rust tests; installed-app daemon restart and app-kill orphan cleanup are covered by the NSIS release install smoke.
- Renderer-visible native daemon diagnostics are covered by type/build checks; installed-app restart UX screenshots are still manual.
- Bundled Node/PTY runtime smokes verify local daemon startup without repository `node_modules` and native node-pty packaging; installed MSI launch/uninstall observation is now covered by `npm run smoke:release-msi-install`.
- `npm run smoke:release-resources` verifies generated MSI/NSIS scripts include bundled daemon/runtime/provider resources, but it does not install and launch the artifacts.
- `npm run smoke:release-launch` starts the release exe hidden and verifies the daemon WebSocket on port `4128`.
- `npm run smoke:release-install` performs a Windows NSIS silent install, launches the installed app hidden, verifies the installed bundled daemon on port `4128`, kills that daemon to verify native supervisor restart, kills the app process to verify daemon orphan cleanup, silently uninstalls, and checks cleanup.
- `npm run smoke:release-msi-install` performs a Windows MSI silent install into a per-user test directory, launches the installed app hidden, verifies the installed bundled daemon on port `4128`, silently uninstalls, and checks cleanup.
- `npm run release:verify` is the single full release gate and runs the live provider/resident smokes, Tauri build, release resource smoke, release exe launch smoke, NSIS install smoke, and MSI install smoke.
- `npm run release:readiness` audits the current release artifacts, browser store readiness metadata/package, latest release soak JSON report, and manual release blockers; strict mode fails until browser store submission and true multi-hour soak are confirmed.
- `npm run release:soak` is the longer hidden release-exe soak. It defaults to 60 seconds and can be tuned with `CODEX_WIDGET_RELEASE_SOAK_MS`, `CODEX_WIDGET_RELEASE_SOAK_MAX_WORKING_SET_MB`, and `CODEX_WIDGET_RELEASE_SOAK_MAX_GROWTH_MB`. It writes a JSON evidence report to `dist/reports/release-soak-latest.json` by default; set `CODEX_WIDGET_RELEASE_SOAK_REPORT` when running a named multi-hour/manual soak.
