# Project Milestones

## resident-widget-mvp

Goal: keep a small Tauri desktop widget resident on Windows with reliable window controls, prompt/chat UX, streaming Codex responses, session reset, and recoverable daemon lifecycle.

Current progress: 0.72

Evidence:
- Tauri shell, borderless resize, pin, opacity, mascot drag, and model/reasoning controls are implemented.
- Daemon WebSocket streaming works with Codex CLI auth.
- Default runtime now uses daemon-owned `codex app-server` with `exec` fallback.
- Visible chat history persists locally across renderer reloads after Iteration 2 kickoff.

## durable-codex-runtime

Goal: use a long-lived Codex runtime boundary instead of prompt-injected one-shot calls, while preserving fallback and safe process cleanup.

Current progress: 0.55

Evidence:
- `CodexAppServerBridge` owns process startup, WebSocket JSON-RPC initialization, thread creation, turn streaming, interrupt, and shutdown.
- `CODEX_WIDGET_CODEX_RUNTIME=app-server` is the default with `exec` fallback.
- Approval and user-input request plumbing is being promoted to first-class widget UI.

## real-tool-providers

Goal: replace Agent/DOM/Vision/PTY stubs with real desktop/browser/terminal context providers that stream tool events through one widget protocol.

Current progress: 0.16

Evidence:
- Provider modes and tool-event rendering exist.
- Browser DOM, screen vision, and PTY providers are still mostly stubs.

## resident-desktop-readiness

Goal: make the widget practical as a daily resident desktop utility: tray/autostart, resource budget, crash recovery, and install/release checklist.

Current progress: 0.2

Evidence:
- Dev hot services and daemon lifecycle exist.
- Packaging, tray, autostart, and long-run resource gates remain open.
