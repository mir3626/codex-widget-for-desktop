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
- Visible chat history is persisted locally across renderer reloads and can be cleared with an explicit New chat reset that also resets daemon session state.
- Regenerate now truncates the visible chat from the selected answer onward and asks the app-server to roll back the same number of thread turns before starting the replacement response.
- The standard smoke gate now includes a fake Codex app-server protocol harness that verifies resident thread context, streaming deltas, approval forwarding, and rollback behavior without relying on a live Codex account.
- Response Branch now resets the daemon runtime session and carries the selected user/assistant exchange as a one-shot branch seed for the next prompt, so visible branch state does not continue on hidden old app-server context.
- Mode tabs receive daemon-owned provider status, giving Agent, DOM, Vision, and PTY a stable contract before each provider becomes fully real.
- DOM mode accepts live browser snapshots through `POST /providers/dom/snapshot` and injects that context into the model request. An unpacked Chrome/Edge extension can send active-tab snapshots through an optional native messaging host or direct local HTTP fallback, and has an Options page for local daemon URL changes.
- Vision mode accepts screen snapshots through `POST /providers/screen/snapshot`, injects screen description/OCR context into the model request, and attaches captured image data as an app-server image input for Vision turns. The widget can ask the daemon to run a Windows PowerShell helper that captures the virtual desktop or a Settings/env configured crop rectangle, uses explicit/PATH/bundled Tesseract OCR when available, auto-selects `eng+kor` for bundled OCR when both language packs exist, preprocesses OCR input as an upscaled PNG, computes image hash/change metadata, and posts a compressed image snapshot.
- Terminal/PTY mode executes explicit local shell commands, supports a persistent node-pty/ConPTY-backed `/pty` session with resize/raw-input commands, drains output after raw input/key writes, streams output as widget tool events, and renders those events in a dedicated terminal viewport with quick start/status/stop/clear actions plus direct PTY input controls.
- Runtime health status is streamed from the daemon into the settings panel.
- App-server diagnostics include start count and latest error in runtime status so resident failures are visible from the widget.
- The daemon retains recent assistant response snapshots and replays them to reconnecting renderer clients, so WebSocket/WebView reconnects do not automatically abort an active response or lose the latest streamed text.
- The chat renderer has a Playwright smoke for multi-turn layout, GFM tables, prompt resizing, and response action menu placement.
- `npm run build` produces Windows MSI and NSIS installer bundles with bundled daemon JS, Node runtime, OCR manifest, and PTY runtime resources, so the installed widget daemon does not require a user-installed `node` command.
- Installed builds resolve the exe-adjacent `_up_` resource directory before falling back to development paths, so NSIS/MSI-installed apps use the bundled Node runtime and daemon bundle.
- `npm run smoke:release-install` verifies the NSIS installer can silently install, launch the installed app with its bundled daemon, restart that daemon through native supervision after a forced kill, shut the daemon down after an app-process kill, and uninstall cleanly.
- `npm run smoke:release-msi-install` verifies the MSI installer can silently install into a per-user test directory, launch the installed app with its bundled daemon, uninstall, and clean up install state.
- `npm run release:verify` runs the full live release gate and reports release artifact sizes.
- `npm run release:readiness` audits release artifacts, browser store package/readiness metadata, the latest release soak evidence report, and remaining manual blockers.
- The daemon keeps `codex exec resume` as a fallback runtime and supports mock/OAuth proxy streaming for non-Codex auth modes.
- DOM and Vision modes have snapshot ingress; DOM has an unpacked browser extension bridge with icon assets, local-only Options URL configuration, optional Chrome/Edge native messaging host, generated zip package, store listing, privacy notes, review notes, and readiness smoke; Vision has a Windows capture helper, Settings/env configured crop, optional local OCR command hook, bundled OCR runtime packaging with explicit/PATH/standard Windows install discovery, tessdata language defaults, OCR-only PNG preprocessing, image hash/change metadata, and direct app-server image input; Terminal has one-shot command execution, a persistent node-pty command/raw-input session, raw-input output drain, and a renderer terminal viewport with direct input controls. Final browser store account submission, richer full-screen terminal key/mouse UX, visual drag region selection, image-diff thresholds, and multi-hour/manual soak are still open.
- Windows Tauri prerequisites are documented and verified on the local machine.

## Product Goals

- Keep the assistant resident on the desktop with tray control and no taskbar clutter.
- Stream partial answers, tool state, approvals, and local provider output into the widget.
- Avoid prompt-injecting one-shot CLI calls as the core architecture. The local daemon owns session state and talks to a background Codex runtime over a structured protocol.
- Keep the renderer-daemon protocol explicit enough that future DOM, screen, terminal, approval, and provider features can be added without patching ad hoc UI state.
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
