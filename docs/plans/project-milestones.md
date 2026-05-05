# Project Milestones

## resident-widget-mvp

Goal: keep a small Tauri desktop widget resident on Windows with reliable window controls, prompt/chat UX, streaming Codex responses, session reset, and recoverable daemon lifecycle.

Current progress: 0.88

Evidence:
- Tauri shell, borderless resize, pin, opacity, mascot drag, and model/reasoning controls are implemented.
- Daemon WebSocket streaming works with Codex CLI auth.
- Default runtime now uses daemon-owned `codex app-server` with `exec` fallback.
- Visible chat history persists locally across renderer reloads after Iteration 2 kickoff.
- Multi-turn chat layout, GFM tables, prompt resizing, and response action menu placement are covered by a Playwright renderer smoke.
- Response Branch is covered by the renderer smoke and now resets daemon runtime state before sending a one-shot branch seed with the next prompt.
- Reconnecting renderer clients receive retained daemon response snapshots, and active requests continue after the original WebSocket closes.
- The widget hides to tray, stays off the taskbar, and exposes resident settings.
- Packaged Tauri builds now supervise the Node daemon and restart it after unexpected exits.
- Native daemon supervisor diagnostics are visible in the renderer status strip and Settings runtime grid.
- Packaged Tauri builds include a bundled daemon JS entry and bundled Node runtime resource for daemon startup.

## durable-codex-runtime

Goal: use a long-lived Codex runtime boundary instead of prompt-injected one-shot calls, while preserving fallback and safe process cleanup.

Current progress: 0.86

Evidence:
- `CodexAppServerBridge` owns process startup, WebSocket JSON-RPC initialization, thread creation, turn streaming, interrupt, and shutdown.
- `CODEX_WIDGET_CODEX_RUNTIME=app-server` is the default with `exec` fallback.
- Approval and user-input request plumbing is first-class widget UI.
- The daemon emits runtime health status for clients, active requests, and app-server state.
- `npm run smoke:app-server` verifies fake app-server thread reuse, streaming deltas, approval forwarding, and rollback behavior.
- `npm run smoke:app-server:live` verifies a logged-in local Codex CLI can run the real app-server path end to end.
- The native Tauri shell supervises the daemon process with capped restart backoff and shutdown cleanup.
- Renderer code can read native daemon state while WebSocket reconnect is in progress.
- The native shell resolves bundled daemon/runtime resources before falling back to a system `node` command.
- Response Branch uses `session.branch` plus one-shot `branchContext` so branch UI state and app-server/proxy session state do not silently diverge.
- Agent events are broadcast to connected clients and retained as bounded response snapshots for reconnect replay, reducing coupling between Codex turns and a single renderer socket.

## real-tool-providers

Goal: replace Agent/DOM/Vision/PTY stubs with real desktop/browser/terminal context providers that stream tool events through one widget protocol.

Current progress: 0.98

Evidence:
- Provider modes and tool-event rendering exist.
- Browser DOM mode accepts live snapshots through the local daemon and injects them into model context.
- An unpacked Chrome/Edge extension can send active-tab DOM snapshots to the daemon, exposes a local-only Options page for daemon URL changes, can use an optional Chrome/Edge native messaging host before falling back to HTTP, and `npm run package:extension` produces a zip package with icon assets. Store listing, privacy notes, review notes, permission rationales, `npm run release:browser-store-packet`, and `npm run smoke:browser-store` are in place.
- Screen/Vision mode accepts live snapshots through the local daemon, injects description/OCR context into model requests, and attaches image data to app-server Vision turns.
- A Windows PowerShell helper captures the virtual desktop or Settings/env/visual-drag configured crop rectangles as compressed JPEG data, can run a local OCR command, bundled Tesseract runtime, or auto-detected `tesseract` against an OCR-only upscaled PNG, and posts the result to the Screen/Vision endpoint; the widget can trigger that helper through the daemon protocol.
- The Screen/Vision registry computes image hash/change/diff metadata with configurable thresholding so repeated and below-threshold captures can be treated as unchanged context.
- `npm run build:ocr-runtime`, `npm run ocr:fetch-languages`, and `npm run smoke:ocr-runtime` package and verify a Tesseract-compatible OCR runtime resource slot for installed builds, including standard Windows install discovery, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, tessdata language acquisition/manifesting, and bundled `eng+kor` auto-selection when both language packs exist.
- Terminal/PTY mode executes explicit shell commands, supports a persistent node-pty/ConPTY-backed `/pty` command/raw-input session, drains output after raw input/key writes, streams output as tool events, displays terminal output in a dedicated renderer viewport with direct input controls, and forwards live text/key/mouse input through direct `terminal.input` protocol messages.
- Final browser store account submission remains open; two-hour release soak evidence is recorded in `docs/reports/release-soak-2026-05-05-2h.md`.

## resident-desktop-readiness

Goal: make the widget practical as a daily resident desktop utility: tray/autostart, resource budget, crash recovery, and install/release checklist.

Current progress: 0.92

Evidence:
- Dev hot services, daemon lifecycle, tray menu, and start-at-login toggle exist.
- `npm run build` produces release exe plus MSI and NSIS installer bundles.
- `npm run smoke:resident` verifies idle runtime health and RSS budget.
- `npm run smoke:resident-soak` adds a short resident runtime sample, ping/pong health, and RSS growth gate.
- `npm run smoke:all` provides a serial readiness gate that avoids parallel build races across provider smokes.
- `npm run smoke:screen-capture:live` verifies the widget-protocol screen capture request path.
- `npm run smoke:screen-helper:ocr` verifies the helper OCR command hook.
- `npm run smoke:ocr-runtime` verifies OCR runtime packaging and bundled OCR command resolution.
- `npm run smoke:pty-runtime` verifies native node-pty runtime packaging and daemon PTY runtime resolution.
- Runtime status exposes app-server start count and latest error in the widget settings panel.
- `npm run smoke:tauri-supervisor` covers native supervisor restart backoff and actual child restart after exit.
- `npm run smoke:node-runtime` verifies bundled Node can run the dependency-bundled daemon entry.
- `npm run smoke:release-resources` verifies generated MSI/NSIS scripts include the bundled daemon/runtime and provider helper resources.
- `npm run smoke:release-launch` verifies the release exe can start hidden and expose the daemon WebSocket on `127.0.0.1:4128`.
- `npm run smoke:release-install` verifies the NSIS installer can silently install, launch the installed app with its bundled daemon, force-kill the bundled daemon and observe native restart supervision, force-kill the app process and observe daemon orphan cleanup, silently uninstall, and leave no install directory, uninstall entry, product install key, or desktop shortcut.
- `npm run smoke:release-msi-install` verifies the MSI installer can silently install into a per-user test directory, launch the installed app with its bundled daemon, silently uninstall, and leave no install directory, uninstall entry, or desktop shortcut.
- `npm run release:verify` runs the full live release gate and reports release artifact sizes.
- `npm run release:readiness` audits current release artifacts, browser store metadata/package/submission packet readiness, latest soak report evidence, and manual release blockers.
- `npm run release:soak` builds the release app and runs a longer hidden release-exe soak with runtime samples, ping/pong health checks, daemon process detection, process-tree working-set limits, and JSON evidence report output for manual/multi-hour runs.
- A two-hour release soak passed on 2026-05-05 with 1,439 runtime samples, 3,587 pong responses, 358.5 MB ending working set, and -54.0 MB growth; evidence is recorded in `docs/reports/release-soak-2026-05-05-2h.md`.
- Native crash-recovery UX is surfaced through renderer diagnostics; final browser store account submission remains open before final release.
