# Architecture Context

## Runtime Layout

```text
Tauri desktop shell
  - src-tauri/
  - transparent always-on-top widget window
  - tray icon, start-at-login command, and native window controls
  - starts a supervised local daemon process
  - packaged builds prefer bundled Node runtime + bundled daemon JS resources

React renderer
  - src/renderer/
  - mascot, speech bubble, controls, mode selector
  - connects to ws://127.0.0.1:4128
  - persists visible chat timeline in localStorage and exposes explicit New chat reset

Local daemon
  - src/daemon/
  - WebSocket server
  - session/event protocol
  - Codex app-server bridge for resident Codex sessions
  - codex exec resume fallback for app-server startup failures or explicit exec mode
  - OAuth proxy streaming or mock streaming fallback for non-Codex auth modes
  - provider status registry for agent, browser, screen, and terminal modes
  - DOM snapshot ingress and terminal command provider

Packaged daemon resources
  - dist/daemon-bundle/standalone.js
  - dist/node-runtime/node.exe on Windows builds
  - copied into the Tauri resource tree under _up_/dist

Shared protocol
  - src/shared/protocol.ts
  - ClientMessage and ServerEvent contracts, including session reset and runtime interaction requests
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
- Approval policy: `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request` is the default so app-server command/file/user-input requests can surface in the widget instead of being silently declined. Set it to `never` only for trusted automation experiments.
- Interaction model: app-server server requests become `interaction.required` events. The renderer shows compact approval/input cards and returns `interaction.respond` messages to the daemon.
- Reset model: `session.reset` clears the renderer-visible chat, local persistence, proxy session id, and app-server thread id. The next prompt starts a fresh Codex thread.
- Regeneration model: response regenerate sends a `regenerate.dropTurns` boundary from the renderer. In Codex app-server mode the daemon applies `thread/rollback` before starting the replacement turn, preserving the thread before the selected answer without replaying visible chat history through the prompt.
- Branch model: response Branch sends `session.branch` to reset daemon-side proxy/app-server session state without clearing the visible branch. The next `ask` carries the selected user/assistant exchange as `branchContext` once, then clears it locally so future branch turns continue through the new resident app-server thread instead of replaying hidden history every turn.
- Reconnect model: daemon-side agent requests are not tied to a single renderer WebSocket. Agent events are broadcast to all connected clients, recent assistant response snapshots are retained, and reconnecting clients receive `message.snapshot` events before live deltas continue.
- Provider status model: daemon emits `provider.status` after connection so each mode tab has a stable capability/status surface. DOM and Screen become ready after snapshots are posted; terminal is ready by default.
- Runtime health model: daemon emits `runtime.status` on connection and periodically after that. The renderer settings panel displays daemon uptime, client count, active request count, app-server state, app-server start count, and the latest app-server error.

## Provider Boundary

- DOM provider: external browser tooling can `POST /providers/dom/snapshot` to the local daemon with `{ url, title, selection, text }`. The latest snapshot is surfaced as a tool event in Browser/DOM mode and injected into the model request context. `providers/browser-dom-extension` packages the Chrome/Edge Manifest V3 bridge for active-tab snapshots, includes an Options page for local daemon URL changes, tries the optional `providers/browser-native-host` native messaging bridge first, and `npm run package:extension` writes a zip artifact for manual installation or store-prep review.
- Screen/Vision provider: external capture tooling can `POST /providers/screen/snapshot` with `{ source, title, description, ocrText, imageDataUrl }`. The latest text/description/OCR snapshot is surfaced as a Vision mode tool event and injected into the model request context; base64 image data is retained in daemon state and attached to Codex app-server Vision turns as an image input. `providers/screen-capture-helper/capture-screen.ps1` is the first Windows helper for posting a compressed virtual-screen capture, and the renderer can ask the daemon to run it through `provider.captureScreen`. The helper supports optional local OCR through `tesseract` auto-detection or a `CODEX_WIDGET_SCREEN_OCR_COMMAND` command template that receives the captured JPEG path as `{image}`.
- OCR runtime packaging: `npm run build:ocr-runtime` always creates `dist/ocr-runtime/ocr-runtime.json` and can copy a Tesseract runtime from `CODEX_WIDGET_OCR_RUNTIME_DIR`, `CODEX_WIDGET_TESSERACT_EXE`, or `PATH`. Tauri bundles `dist/ocr-runtime`; installed helpers resolve `_up_/dist/ocr-runtime` before falling back to PATH OCR.
- Terminal provider: Terminal/PTY mode has two local command paths. One-shot commands use explicit prefixes (`/run`, `$`, `PS>`, `run:`, or fenced shell blocks), stream stdout/stderr as `tool.output`, and summarize the result into the assistant response. Persistent command sessions use `/pty start`, `/pty <command>`, `/pty status`, and `/pty stop` to keep shell state between commands in a daemon-owned child process. Both paths block destructive command patterns unless `CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE=1`. The persistent session is still command-oriented; raw interactive TTY/full-screen ConPTY behavior is not implemented yet.

## Resident Desktop Boundary

- The native window is configured with `skipTaskbar: true`; tray Show/Hide/Quit is the resident control surface.
- The titlebar close button hides the window to tray. The tray Quit item exits the app.
- Windows start-at-login is implemented by setting the current executable in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` through native Tauri commands.
- Packaged builds do not depend on a user-installed `node` command for the widget daemon. `npm run build:web` creates a dependency-bundled daemon entry at `dist/daemon-bundle/standalone.js` and copies the current build Node executable into `dist/node-runtime`; Tauri bundles both directories as resources. The native resolver checks Tauri's resource directory and the installed exe-adjacent `_up_` resource directory before falling back to development `dist` or system `node`.
- The native daemon supervisor resolves the bundled daemon and bundled Node runtime from the Tauri resource directory first, then falls back to system `node` only if the resource runtime is absent.
- `npm run build` must produce both MSI and NSIS bundles before a release is considered installable on Windows.

## Provider Roadmap

- Browser DOM provider: browser store submission metadata, accessible labels, and element highlighting on top of the packaged localhost/native-messaging extension bridge.
- Controlled browser provider: Playwright/CDP for automation in a managed browser context.
- Screen provider: crop/diff and higher-quality OCR model/runtime acquisition on top of the existing daemon-triggered Windows capture helper, bundled OCR runtime packaging, optional OCR command hook, and direct app-server image input.
- Terminal provider: true ConPTY/node-pty process sessions for raw interactive terminal programs on top of the current command-oriented `/pty` session path.

## Verification Commands

- `npm run lint`: TypeScript checks for renderer, shared, and daemon code.
- `npm run build:web`: compile daemon and renderer without invoking Cargo.
- `npm run smoke:node-runtime`: verify the bundled Node runtime can execute the bundled daemon without relying on repository `node_modules`.
- `npm run smoke:ocr-runtime`: verify OCR runtime copy/manifest packaging and daemon bundled OCR command resolution.
- `npm run smoke:release-launch`: launch the release exe hidden and verify the packaged daemon WebSocket responds on `127.0.0.1:4128`.
- `npm run smoke:release-install`: run the NSIS installer silently, verify installed resources, launch the installed app hidden, verify the installed bundled daemon WebSocket, kill the bundled daemon to verify native supervisor restart, kill the app process to verify daemon parent-watchdog orphan cleanup, silently uninstall, and check cleanup.
- `npm run release:verify`: run the full live release gate in sequence and report the release artifact sizes.
- `npm run smoke`: build web/daemon and verify WebSocket streaming.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`: native shell compile check on Windows.
