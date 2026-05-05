# Project Milestones

## resident-widget-mvp

Goal: keep a small Tauri desktop widget resident on Windows with reliable window controls, prompt/chat UX, streaming Codex responses, session reset, and recoverable daemon lifecycle.

Current progress: 0.78

Evidence:
- Tauri shell, borderless resize, pin, opacity, mascot drag, and model/reasoning controls are implemented.
- Daemon WebSocket streaming works with Codex CLI auth.
- Default runtime now uses daemon-owned `codex app-server` with `exec` fallback.
- Visible chat history persists locally across renderer reloads after Iteration 2 kickoff.
- The widget hides to tray, stays off the taskbar, and exposes resident settings.

## durable-codex-runtime

Goal: use a long-lived Codex runtime boundary instead of prompt-injected one-shot calls, while preserving fallback and safe process cleanup.

Current progress: 0.68

Evidence:
- `CodexAppServerBridge` owns process startup, WebSocket JSON-RPC initialization, thread creation, turn streaming, interrupt, and shutdown.
- `CODEX_WIDGET_CODEX_RUNTIME=app-server` is the default with `exec` fallback.
- Approval and user-input request plumbing is being promoted to first-class widget UI.
- The daemon emits runtime health status for clients, active requests, and app-server state.

## real-tool-providers

Goal: replace Agent/DOM/Vision/PTY stubs with real desktop/browser/terminal context providers that stream tool events through one widget protocol.

Current progress: 0.64

Evidence:
- Provider modes and tool-event rendering exist.
- Browser DOM mode accepts live snapshots through the local daemon and injects them into model context.
- An unpacked Chrome/Edge extension can send active-tab DOM snapshots to the daemon.
- Screen/Vision mode accepts live snapshots through the local daemon and injects description/OCR context into model requests.
- A Windows PowerShell helper captures the virtual desktop as compressed JPEG data and posts it to the Screen/Vision endpoint.
- Terminal/PTY mode executes explicit shell commands and streams output as tool events.
- OCR/direct image model input, store extension packaging, and deeper interactive PTY remain open.

## resident-desktop-readiness

Goal: make the widget practical as a daily resident desktop utility: tray/autostart, resource budget, crash recovery, and install/release checklist.

Current progress: 0.62

Evidence:
- Dev hot services, daemon lifecycle, tray menu, and start-at-login toggle exist.
- `npm run build` produces release exe plus MSI and NSIS installer bundles.
- `npm run smoke:resident` verifies idle runtime health and RSS budget.
- `npm run smoke:all` provides a serial readiness gate that avoids parallel build races across provider smokes.
- Runtime status exposes app-server start count and latest error in the widget settings panel.
- Crash-recovery polish and longer soak tests remain open.
