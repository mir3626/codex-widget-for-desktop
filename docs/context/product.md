# Product Context

## One-line Product

Codex Widget for Desktop is a resident desktop assistant widget: a small mascot-style Tauri app that stays off the taskbar, streams agent responses in real time, and can grow into browser, screen, terminal, and local-workspace automation.

## User

The primary user is a developer who wants a persistent desktop companion similar to classic office assistants, but backed by a modern coding/agent runtime. The widget should be usable without opening a browser tab and should feel like a local desktop utility rather than a web page.

## Current State

- Tauri shell is in place with transparent, frameless, always-on-top, skip-taskbar window settings.
- React/Vite renderer displays the generated mascot, speech bubble, mode controls, status, and prompt input.
- Local Node daemon exposes a WebSocket stream on `127.0.0.1:4128`.
- The daemon owns a background Codex `app-server` process when Codex auth is active, streams JSON-RPC deltas into the widget, and keeps one resident thread alive across prompts.
- The daemon keeps `codex exec resume` as a fallback runtime and supports mock/OAuth proxy streaming for non-Codex auth modes.
- Browser DOM, screen vision, and terminal PTY modes currently have provider stubs rather than real integrations.
- Windows Tauri prerequisites are documented and verified on the local machine.

## Product Goals

- Keep the assistant resident on the desktop with tray control and no taskbar clutter.
- Stream partial answers, tool state, approvals, and local provider output into the widget.
- Avoid prompt-injecting one-shot CLI calls as the core architecture. The local daemon owns session state and talks to a background Codex runtime over a structured protocol.
- Keep end-user auth in OAuth and keep OpenAI/API credentials behind a backend proxy.
- Add real providers incrementally: browser DOM bridge, controlled browser automation, screen capture/vision, and terminal PTY.

## Non-goals

- Do not rely on unofficial attachment to ChatGPT or Codex web-app sessions.
- Do not expose long-lived OpenAI/API keys in renderer/client code.
- Do not make the Vite dev URL the product surface; it is only a development asset server.

## Success Criteria

- `npm run dev` launches a native Tauri widget window.
- The widget can send a prompt to the local daemon and receive streamed `message.delta` events.
- The repository can be continued through the vibe-doctor Sprint process with initialized project context, roadmap, QA commands, and harness state.
