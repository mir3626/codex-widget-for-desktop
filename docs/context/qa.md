# QA policy

## Default Checks

Run these after ordinary TypeScript/daemon/renderer changes:

```powershell
npm run smoke:all
```

`smoke:all` includes daemon reconnect replay coverage through `npm run smoke:daemon-reconnect` and fake Codex app-server protocol coverage through `npm run smoke:app-server`.

Run this after daemon storage, schema, app-data path, or persistence-boundary changes:

```powershell
npm run smoke:storage
```

`smoke:storage` opens a temporary app-data root, applies SQLite migrations, verifies WAL/foreign-key/integrity health, persists a non-secret setting, rejects secret-like setting keys, records an activity entry, exercises session/ask/branch/trash/restore storage paths, records text and file-change artifacts, resolves artifact open paths, records/stops Vision recording and Agent screen-stream metadata, and reopens the database.

Run this after conversation layout, markdown/table rendering, prompt composer, or response action menu changes:

```powershell
npm run smoke:renderer-chat
```

This smoke also verifies response Branch behavior: the UI sends `session.branch`, the branch appears as a new durable session snapshot, the next prompt includes a one-shot `branchContext`, subsequent branch prompts do not keep replaying that seed, a trashed session can request and render its artifact ledger, and the Vision popup can send snapshot, WebM recording, and Agent screen-stream requests.

Run this when changing the Windows screen capture helper and a desktop session is available:

```powershell
npm run smoke:all:live
npm run smoke:app-server:live
npm run smoke:screen-helper:ocr
npm run smoke:screen-capture:live
```

`smoke:all:live` includes the live Codex app-server smoke and live screen-helper checks; run the individual commands when isolating one live dependency.

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
npm run release:browser-store-packet
npm run smoke:dom
```

Run this after Browser Action prompt/approval UX, Browser Bridge command delivery, or live-runner automation changes:

```powershell
npm run dogfood:browser-action:live:widget-ui
```

This launches a separate target Chromium profile with the unpacked Browser Bridge extension plus a separate browser-hosted widget UI, then submits prompts and approval responses through the real chat controls.

Run this after capability transaction, prepared context, shared safety, or agent-tool boundary changes:

```powershell
npm run smoke:architecture-foundations
```

This verifies the shared transaction timing/debug bundle, prepared-context identity, safety decision, and simulated Browser Action tool boundary.

Run this after computer-use eval, ASR decoding, perception graph, ROI cascade,
failure memory, or capability DAG changes:

```powershell
npm run smoke:research-performance-architecture
```

This verifies schema v4, eval ledger storage/rollup, deterministic ASR
command-slot decoding, perception graph thresholding, ROI/delta cascade
planning, structured failure memory safety, and DAG capability/eval integration.

Run this after scoped autonomy, permission profile, generated Toolsmith
template, or missing-capability handling changes:

```powershell
npm run smoke:scoped-autonomy-toolsmith
```

This verifies schema v5, scoped autonomy permission profiles, capability gap
detection, reviewed template materialization, smoke-before-execute gating,
Markdown/PDF artifact generation, credential redaction, blocked missing-grant
behavior, and eval ledger/resource recording.

Run this for realistic safe computer-use scenario coverage across Browser,
Windows, ASR, Vision, Terminal, and cross-app DAG paths:

```powershell
npm run dogfood:research-computer-use
npm run dogfood:computer-use-process-30
npm run dogfood:scoped-autonomy-toolsmith
```

These write dated scenario catalogs under `docs/dogfood/`, JSON evidence under
`docs/reports/assets/`, and Markdown reports under `docs/reports/`. The 30-case
process validation set records passed, blocked, and needs-follow-up outcomes so
unsupported or unsafe workflows remain visible as product work instead of false
successes.

Run this after Semantic Interface golden-trace, trace corpus, or deterministic scoring changes:

```powershell
npm run smoke:semantic-trace-corpus
```

This verifies the reviewed semantic trace corpus still maps to the golden trace
suite and keeps calibration seed metrics at the expected baseline.

Run this after promoting reviewed live Browser Action evidence into the semantic feedback loop:

```powershell
npm run smoke:browser-action:semantic-live-corpus
```

This verifies that the live semantic corpus only references reviewed report rows
and still covers read, target activation, history navigation, search form, and
representative content intents.

Run this after a release build when bundle resource wiring changes:

```powershell
npm run release:verify
```

Run this after `release:verify` and `release:soak` when preparing a release candidate:

```powershell
npm run release:readiness
```

Use `node scripts/release-readiness.mjs --require-manual-gates` only after `npm run release:confirm-browser-store -- --store <store> --submission-id <id>` or equivalent listing URL evidence has recorded the actual store dashboard submission. The default two-hour soak evidence is recorded in `docs/reports/release-soak-2026-05-05-2h.md`.

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
- Browser DOM provider is snapshot-based and has an unpacked extension, a generated zip package, an optional Chrome/Edge native messaging host, store submission metadata, a generated submission packet, and readiness smoke; actual browser store account submission is still manual.
- Screen/Vision provider has snapshot capture, a Windows capture helper, Settings/env configured crop plus visual drag selection, optional local OCR command hook, bundled OCR runtime packaging, standard Windows Tesseract discovery, bundled tessdata language acquisition/defaults, OCR-only PNG preprocessing, image hash/change/diff metadata with configurable thresholding, app-server image input, WebM recording metadata/blob preservation, and metadata-only Agent screen sharing that posts low-frequency frames to the snapshot endpoint.
- Terminal provider supports explicit one-shot commands, a persistent node-pty/ConPTY command session through `/pty`, resize/raw-input commands with short output drain, direct `terminal.input` text/key/mouse input, idle PTY output broadcast, and a renderer PTY viewport with direct input controls.
- SQLite storage foundation, session tabs/trash, artifact/activity ledger, and Vision stream metadata slices have smoke coverage, but app-server thread rebinding per restored session, deeper provider snapshot history UI, and full migration cleanup away from renderer localStorage fallback remain future work.
- OAuth proxy live streaming requires an auth/proxy service and is not covered by CI-like smoke tests.
- Packaged daemon restart backoff and child restart have Rust tests; installed-app daemon restart and app-kill orphan cleanup are covered by the NSIS release install smoke.
- Renderer-visible native daemon diagnostics are covered by type/build checks; installed-app restart UX screenshots are still manual.
- Bundled Node/PTY runtime smokes verify local daemon startup without repository `node_modules` and native node-pty packaging; installed MSI launch/uninstall observation is now covered by `npm run smoke:release-msi-install`.
- `npm run smoke:release-resources` verifies generated MSI/NSIS scripts include bundled daemon/runtime/provider resources, but it does not install and launch the artifacts.
- `npm run smoke:release-launch` starts the release exe hidden and verifies the daemon WebSocket on port `4128`.
- `npm run smoke:release-install` performs a Windows NSIS silent install, launches the installed app hidden, verifies the installed bundled daemon on port `4128`, kills that daemon to verify native supervisor restart, kills the app process to verify daemon orphan cleanup, silently uninstalls, and checks cleanup.
- `npm run smoke:release-msi-install` performs a Windows MSI silent install into a per-user test directory, launches the installed app hidden, verifies the installed bundled daemon on port `4128`, silently uninstalls, and checks cleanup.
- `npm run release:verify` is the single full release gate and runs the live provider/resident smokes, Tauri build, release resource smoke, release exe launch smoke, NSIS install smoke, and MSI install smoke.
- `npm run release:browser-store-packet` generates the browser extension store submission packet with listing/privacy/review copy, native-host notes, icons, and checksums.
- `npm run release:confirm-browser-store` records actual Chrome Web Store or Edge Add-ons submission evidence into `dist/reports/browser-store-submission-confirmation.json`.
- `npm run release:readiness` audits the current release artifacts, browser store readiness metadata/package/submission packet/submission confirmation, latest release soak JSON report, and manual release blockers; after the 2026-05-05 two-hour soak, strict mode fails only until browser store submission is confirmed.
- `npm run release:soak` is the longer hidden release-exe soak. It defaults to 60 seconds and can be tuned with `CODEX_WIDGET_RELEASE_SOAK_MS`, `CODEX_WIDGET_RELEASE_SOAK_MAX_WORKING_SET_MB`, and `CODEX_WIDGET_RELEASE_SOAK_MAX_GROWTH_MB`. It writes a JSON evidence report to `dist/reports/release-soak-latest.json` by default; set `CODEX_WIDGET_RELEASE_SOAK_REPORT` when running a named multi-hour/manual soak. The 2026-05-05 two-hour run passed with 1,439 runtime samples, 3,587 pongs, 358.5 MB ending working set, and -54.0 MB growth.
