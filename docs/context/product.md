# Product Context

## One-line Product

Codex Widget for Desktop is a resident desktop assistant widget: a small mascot-style Tauri app that stays off the taskbar, streams agent responses in real time, and can grow into browser, screen, terminal, and local-workspace automation.

## User

The primary user is a developer who wants a persistent desktop companion similar to classic office assistants, but backed by a modern coding/agent runtime. The widget should be usable without opening a browser tab and should feel like a local desktop utility rather than a web page.

## Current State

- Tauri shell is in place with transparent, frameless, always-on-top, skip-taskbar window settings.
- The shell has tray Show/Hide/Quit behavior, hides to tray from the titlebar close button, and exposes a Windows start-at-login toggle in the widget settings panel.
- React/Vite renderer displays the generated mascot, speech bubble, mode controls, status, and prompt input.
- Local Node daemon exposes a WebSocket stream on `127.0.0.1:4128`.
- The daemon owns a background Codex `app-server` process when Codex auth is active, streams JSON-RPC deltas into the widget, and keeps one resident thread alive across prompts.
- App-server approval and user-input requests now surface as widget interaction cards, so the UI can participate in local file/tool flows instead of dropping those requests.
- Visible chat history is now owned by the daemon as SQLite-backed sessions/messages. The renderer receives `session.snapshot` events, shows internal session tabs, and can create, open, trash, and restore sessions without opening the database directly.
- Regenerate now truncates the visible chat from the selected answer onward and asks the app-server to roll back the same number of thread turns before starting the replacement response.
- The standard smoke gate now includes a fake Codex app-server protocol harness that verifies resident thread context, streaming deltas, approval forwarding, and rollback behavior without relying on a live Codex account. Logged-in developer machines can additionally run a live Codex app-server smoke to catch real CLI protocol drift.
- Response Branch now creates a new durable internal session tab seeded with the selected user/assistant exchange, resets the daemon runtime session, and carries the selected pair as a one-shot branch seed for the next prompt so visible branch state does not continue on hidden old app-server context.
- Mode tabs receive daemon-owned provider status, giving Agent, DOM, Vision, and PTY a stable contract before each provider becomes fully real.
- DOM mode accepts live browser snapshots through `POST /providers/dom/snapshot` and injects that context into the model request. An unpacked Chrome/Edge extension can send active-tab snapshots through an optional native messaging host or direct local HTTP fallback, and has an Options page for local daemon URL changes.
- Vision mode accepts screen snapshots through `POST /providers/screen/snapshot`, injects screen description/OCR context into the model request, and attaches captured image data as an app-server image input for Vision turns. The widget can ask the daemon to run a Windows PowerShell helper that captures the virtual desktop or a Settings/env configured crop rectangle, uses explicit/PATH/bundled Tesseract OCR when available, auto-selects `eng+kor` for bundled OCR when both language packs exist, preprocesses OCR input as an upscaled PNG, computes image hash/change/diff metadata with a configurable meaningful-change threshold, and posts a compressed image snapshot.
- Terminal/PTY mode executes explicit local shell commands, supports a persistent node-pty/ConPTY-backed `/pty` session with resize/raw-input commands, drains output after raw input/key writes, streams output as widget tool events, and renders those events in a dedicated terminal viewport with quick start/status/stop/clear actions plus direct PTY input controls. Live PTY text/key/mouse input can also use direct `terminal.input` daemon messages so terminal interactions do not create chat turns.
- Runtime health status is streamed from the daemon into the settings panel.
- App-server diagnostics include start count and latest error in runtime status so resident failures are visible from the widget.
- Iteration 3 has introduced the daemon-owned SQLite storage foundation for durable product state. The initial migration creates metadata tables for sessions, tabs, messages, runtime threads, provider snapshots, Vision streams, PTY events, artifacts, trash, activity logs, preferences, theme packs, mascot presets, persona presets, and future feature modules.
- Storage uses an app-data SQLite database plus a file-backed blob directory. Runtime status includes lightweight storage diagnostics, and `/storage/health` performs an explicit integrity check for smoke/debug use.
- Session tabs/trash are implemented as the first durable product-state slice: new chat creates a new session, switching tabs reloads messages from the daemon snapshot, branch creates a new tab, and deleted sessions move to a restorable trash list. Per-session model/reasoning/mode values are stored with the session and restored when the session becomes active.
- Artifact/activity ledger is implemented as the next durable product-state slice: daemon tool output and app-server file-change events are stored as artifact/activity records, generated output and before/after/diff snapshots live in the blob store, and the renderer can browse artifacts from the active chat timeline or a trashed session before restoring it.
- Vision recording and Agent screen streaming are implemented as the current Vision UX foundation. The Vision popup lets users choose a single snapshot, WebM recording, or Agent screen share. Recordings preserve daemon metadata plus a blob-store WebM. Agent screen share keeps metadata only and sends low-frequency live frames into the daemon Vision snapshot path so future turns can use screen context without storing a video file.
- The daemon retains recent assistant response snapshots and replays them to reconnecting renderer clients, so WebSocket/WebView reconnects do not automatically abort an active response or lose the latest streamed text.
- The chat renderer has a Playwright smoke for multi-turn layout, GFM tables, prompt resizing, and response action menu placement.
- `npm run build` produces Windows MSI and NSIS installer bundles with bundled daemon JS, Node runtime, OCR manifest, and PTY runtime resources, so the installed widget daemon does not require a user-installed `node` command.
- Installed builds resolve the exe-adjacent `_up_` resource directory before falling back to development paths, so NSIS/MSI-installed apps use the bundled Node runtime and daemon bundle.
- `npm run smoke:release-install` verifies the NSIS installer can silently install, launch the installed app with its bundled daemon, restart that daemon through native supervision after a forced kill, shut the daemon down after an app-process kill, and uninstall cleanly.
- `npm run smoke:release-msi-install` verifies the MSI installer can silently install into a per-user test directory, launch the installed app with its bundled daemon, uninstall, and clean up install state.
- `npm run release:verify` runs the full live release gate and reports release artifact sizes.
- `npm run release:browser-store-packet` generates a browser extension store submission packet with the extension zip, listing/privacy/review copy, icons, native-host notes, and checksums.
- `npm run release:confirm-browser-store` records actual store dashboard submission evidence after the manual Chrome Web Store or Edge Add-ons submit step.
- `npm run release:readiness` audits release artifacts, browser store package/submission packet/readiness metadata, the latest release soak evidence report, and remaining manual/deferred release gates.
- The daemon keeps `codex exec resume` as a fallback runtime and supports mock/OAuth proxy streaming for non-Codex auth modes.
- DOM and Vision modes have snapshot ingress; DOM has an unpacked browser extension bridge with icon assets, local-only Options URL configuration, optional Chrome/Edge native messaging host, generated zip package, store listing, privacy notes, review notes, generated store submission packet, and readiness smoke; Vision has a Windows capture helper, Settings/env configured crop plus visual drag selection, optional local OCR command hook, bundled OCR runtime packaging with explicit/PATH/standard Windows install discovery, tessdata language acquisition/defaults, OCR-only PNG preprocessing, image hash/change/diff metadata with thresholding, and direct app-server image input; Terminal has one-shot command execution, a persistent node-pty command/raw-input session, raw-input output drain, direct `terminal.input` protocol, SGR mouse forwarding, and a renderer terminal viewport with direct input controls. A two-hour release soak passed on 2026-05-05; final browser store account submission is deferred until after dogfooding.
- Windows Tauri prerequisites are documented and verified on the local machine.

## Product Goals

- Keep the assistant resident on the desktop with tray control and no taskbar clutter.
- Stream partial answers, tool state, approvals, and local provider output into the widget.
- Avoid prompt-injecting one-shot CLI calls as the core architecture. The local daemon owns session state and talks to a background Codex runtime over a structured protocol.
- Keep the renderer-daemon protocol explicit enough that future DOM, screen, terminal, approval, and provider features can be added without patching ad hoc UI state.
- Move product state out of renderer-only persistence. Sessions, messages, app-server runtime metadata, provider snapshots, artifacts, activity logs, and durable preferences should be daemon-owned and backed by SQLite/blob storage.
- Keep end-user auth in OAuth and keep OpenAI/API credentials behind a backend proxy.
- Add real providers incrementally: controlled browser automation, screen capture/vision, and a richer terminal-emulator UI on top of PTY.

## Non-goals

- Do not rely on unofficial attachment to ChatGPT or Codex web-app sessions.
- Do not expose long-lived OpenAI/API keys in renderer/client code.
- Do not make the Vite dev URL the product surface; it is only a development asset server.

## Success Criteria

- `npm run dev` launches a native Tauri widget window.
- The widget can send a prompt to the local daemon and receive streamed `message.delta` events.
- Installed Windows builds include the daemon runtime resources needed to launch the local daemon.
- The repository can be continued through the vibe-doctor Sprint process with initialized project context, roadmap, QA commands, and harness state.
