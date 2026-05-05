# Architecture Context

## Runtime Layout

```text
Tauri desktop shell
  - src-tauri/
  - transparent always-on-top widget window
  - tray icon and native window controls
  - starts the local Node daemon in dev/build flows

React renderer
  - src/renderer/
  - mascot, speech bubble, controls, mode selector
  - connects to ws://127.0.0.1:4128

Local daemon
  - src/daemon/
  - WebSocket server
  - session/event protocol
  - Codex app-server bridge for resident Codex sessions
  - codex exec resume fallback for app-server startup failures or explicit exec mode
  - OAuth proxy streaming or mock streaming fallback for non-Codex auth modes
  - provider stubs for browser, screen, and terminal

Shared protocol
  - src/shared/protocol.ts
  - ClientMessage and ServerEvent contracts
```

## Ownership Boundaries

- `src-tauri/**`: native shell, tray, startup, and Tauri capabilities.
- `src/renderer/**`: UI and Tauri frontend API calls.
- `src/daemon/**`: local agent session runtime and provider routing.
- `src/shared/**`: protocol types shared by daemon and renderer.
- `docs/context/**` and `.vibe/agent/**`: vibe-doctor project state and operating memory.
- `.vibe/harness/**`, `.claude/**`, `.codex/**`: synced vibe-doctor harness files.

## Orchestration Boundary

This downstream project uses Codex as the main Orchestrator. The default role assignments in `.vibe/config.json` are:

- `orchestrator`: `codex`
- `sprintRoles.planner`: `codex`
- `sprintRoles.generator`: `codex`
- `sprintRoles.evaluator`: `codex`

Claude-specific harness assets remain in the repo for upstream compatibility, but they are not part of the default role path unless the user explicitly changes provider settings.

## Authentication Boundary

The renderer never receives a long-lived OpenAI/API key. Current behavior is:

- renderer -> local daemon: local WebSocket, no model credential.
- daemon -> local Codex app-server: background `codex app-server --listen ws://127.0.0.1:0` child process when `CODEX_WIDGET_AUTH_MODE=codex`.
- daemon -> Codex app-server WebSocket: JSON-RPC `thread/start`, `turn/start`, `turn/interrupt`, and streaming notifications such as `item/agentMessage/delta`.
- daemon -> OAuth provider: authorization-code + PKCE login, with callback on `/oauth/callback`.
- daemon -> backend agent proxy: `Authorization: Bearer <OAuth access token>` to `CODEX_WIDGET_AGENT_PROXY_URL`.
- backend agent proxy -> OpenAI Platform or another model runtime: server-side credentials only.
- no OAuth config or no sign-in: daemon uses deterministic mock streaming for local UI development.

OAuth access tokens are held in memory by the daemon for the current session. Refresh tokens are not persisted in project files.

Codex ChatGPT auth stays in the user's Codex CLI auth store. The daemon only starts and supervises the local app-server process; it does not expose Codex auth tokens to the renderer.

## Codex Runtime Boundary

- Default runtime: `CODEX_WIDGET_CODEX_RUNTIME=app-server`.
- App-server process ownership: daemon starts the child process, parses its loopback WebSocket URL, initializes the protocol, and terminates the child process on daemon shutdown or sign-out.
- Session model: one widget daemon keeps one Codex `threadId` alive and sends each prompt as a new `turn/start`.
- Fallback: set `CODEX_WIDGET_CODEX_RUNTIME=exec` to force the older `codex exec` / `codex exec resume` runtime.
- Policy injection: widget-specific file-operation and protected-source-root rules are sent once as app-server thread developer instructions instead of being appended as conversation history.

## Provider Roadmap

- Browser DOM provider: Chrome extension/native messaging or localhost bridge for active-tab DOM, selection, accessible labels, and element highlighting.
- Controlled browser provider: Playwright/CDP for automation in a managed browser context.
- Screen provider: Windows capture/crop/diff pipeline feeding image input or computer-use loops.
- Terminal provider: ConPTY/node-pty process sessions streamed as daemon tool events.

## Verification Commands

- `npm run lint`: TypeScript checks for renderer, shared, and daemon code.
- `npm run build:web`: compile daemon and renderer without invoking Cargo.
- `npm run smoke`: build web/daemon and verify WebSocket streaming.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`: native shell compile check on Windows.
