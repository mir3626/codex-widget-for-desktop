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
  - renders daemon-owned session snapshots and internal session tabs
  - keeps localStorage only for UI preferences and temporary fallbacks; renderer should remain UI/interaction focused
  - frontend structure is split by responsibility:
    - App.tsx: runtime state orchestration, daemon protocol effects, native shell integration handlers
    - components/: titlebar/system strip, session tabs/trash, mode tabs, settings, conversation, composer, activity, terminal, Vision menu, artifacts, markdown renderers, and interaction cards
    - hooks/: shared UI behavior such as viewport-aware floating-surface placement
    - utils/: chat/message shaping, storage preference IO, terminal formatting, speech helpers, Vision capture helpers, and generic formatting
    - styles/: CSS partials grouped by shell, sessions/status, chat, artifacts/interactions, terminal, settings/Vision, composer/activity/mascot, animations, and base tokens

Local daemon
  - src/daemon/
  - WebSocket server
  - session/event protocol
  - Codex app-server bridge for resident Codex sessions
  - codex exec resume fallback for app-server startup failures or explicit exec mode
  - OAuth proxy streaming or mock streaming fallback for non-Codex auth modes
  - provider status registry for agent, browser, screen, and terminal modes
  - DOM snapshot ingress and terminal command provider
  - daemon-owned SQLite storage service plus file-backed blob store path

Packaged daemon resources
  - dist/daemon-bundle/standalone.js
  - dist/node-runtime/node.exe on Windows builds
  - dist/pty-runtime/node_modules/node-pty for native PTY support
  - copied into the Tauri resource tree under _up_/dist

Shared protocol
  - src/shared/protocol.ts
  - ClientMessage and ServerEvent contracts, including session snapshot/create/open/trash/restore/branch and runtime interaction requests
```

## Ownership Boundaries

- `src-tauri/**`: native shell, tray, startup, and Tauri capabilities.
- `src/renderer/**`: UI and Tauri frontend API calls.
- `src/daemon/**`: local agent session runtime, provider routing, and durable local product state.
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

## Storage Boundary

- Storage owner: the local daemon owns SQLite access. The renderer must request state through daemon protocol or local HTTP/WebSocket surfaces instead of opening the database directly.
- Database path: by default the daemon resolves an app-data directory and writes `codex-widget.sqlite`. `CODEX_WIDGET_APP_DATA_DIR`, `CODEX_WIDGET_STORAGE_DB_PATH`, and `CODEX_WIDGET_BLOB_DIR` override the root, database path, and blob directory for tests or controlled local runs.
- Native shell integration: packaged Tauri builds pass `CODEX_WIDGET_APP_DATA_DIR` from Tauri's app data directory into the supervised daemon child. The daemon still has OS-specific fallbacks for development and direct script runs.
- SQLite setup: the storage service enables WAL mode, foreign keys, and a busy timeout, then applies ordered migrations from `src/daemon/storage/schema.ts`.
- Initial schema: migration v1 creates tables for app settings, sessions, session tabs, messages, runtime threads, provider snapshots, vision streams, terminal sessions/events, blobs, artifacts, artifact files/versions, trash entries, activity logs, theme packs, mascot presets, persona presets, and future feature modules. It seeds a built-in default dog mascot preset.
- Session state: the daemon exposes `session.snapshot` with the active session id, active/restorable sessions, trashed sessions, and active session messages. New chat creates a new SQLite session, opening a tab reloads that session from storage, branch creates a new child session, and trash moves sessions into `trash_entries` for restore.
- Artifact/activity state: the daemon exposes `ledger.snapshot` and accepts `ledger.refresh` plus `artifact.open`. Tool output and app-server file-change events are persisted as artifacts/activity records; generated text output, before/after file snapshots, and text diffs are written to the blob directory and referenced by artifact file/version metadata. Artifact file summaries include bounded text/image previews, current-version metadata, and version availability flags; `artifact.open` can target the current file or a specific version. The renderer reuses the artifact browser in the active chat timeline and in session trash.
- Vision stream state: the daemon stores recording and Agent screen-stream metadata in `vision_streams`. WebM recording completion writes the video payload into the blob directory and links it from `recording_blob_id`; Agent screen-stream sessions store metadata only and rely on low-frequency frames posted to `/providers/screen/snapshot` for live context. Renderer start requests include browser-capture consent, retention mode, cadence, and duration metadata so later resource/retention policy UI can be built from daemon-owned state.
- Blob boundary: large generated files, screenshots, screen recordings, before/after file snapshots, and diffs should live in the blob directory. SQLite stores metadata, hashes, paths, and relationships.
- Secret boundary: OAuth/Codex credentials are not product state. The storage service rejects secret-like app setting keys such as access tokens, refresh tokens, API keys, secrets, passwords, and credentials.
- Health boundary: `runtime.status` includes lightweight storage diagnostics without running a full integrity check. `GET /storage/health` runs the explicit integrity check for smoke/debug use.

## Codex Runtime Boundary

- Default runtime: `CODEX_WIDGET_CODEX_RUNTIME=app-server`.
- App-server process ownership: daemon starts the child process, parses its loopback WebSocket URL, initializes the protocol, and terminates the child process on daemon shutdown or sign-out.
- Session model: one widget daemon keeps one Codex `threadId` alive and sends each prompt as a new `turn/start`.
- Fallback: set `CODEX_WIDGET_CODEX_RUNTIME=exec` to force the older `codex exec` / `codex exec resume` runtime.
- Policy injection: widget-specific file-operation and protected-source-root rules are sent once as app-server thread developer instructions instead of being appended as conversation history.
- Widget context injection: each Agent turn also carries a compact daemon-owned `Codex Widget desktop context` section describing current mode, selected model/reasoning, sanitized auth state, mode/provider statuses, session/artifact/activity controls, Vision/DOM/PTY use cases, and safety boundaries. This lets Agent mode answer questions about the widget UI itself without replaying full project history or exposing credentials.
- Mascot/persona context: the initial built-in mascot preset is Default Dog. Widget context includes the current mascot persona, concise/practical tone expectations, and status-state hints so Agent answers can align with the companion preset without hard-coding UI copy in prompts outside the daemon-owned context builder.
- Approval policy: `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request` is the default so app-server command/file/user-input requests can surface in the widget instead of being silently declined. Set it to `never` only for trusted automation experiments.
- Interaction model: app-server server requests become `interaction.required` events. The renderer shows compact approval/input cards and returns `interaction.respond` messages to the daemon.
- Reset/new-chat model: `session.create` creates a fresh durable session and resets the proxy/app-server thread id. Legacy `session.reset` remains as a compatibility command and now creates a fresh durable session snapshot instead of being the primary renderer state store.
- Regeneration model: response regenerate sends a `regenerate.dropTurns` boundary from the renderer. In Codex app-server mode the daemon applies `thread/rollback` before starting the replacement turn, preserving the thread before the selected answer without replaying visible chat history through the prompt.
- Branch model: response Branch sends `session.branch` with the selected user/assistant pair. The daemon creates a new durable child session tab, resets daemon-side proxy/app-server session state, and the next `ask` carries the same pair as `branchContext` once so future branch turns continue through the new resident app-server thread instead of replaying hidden history every turn.
- Reconnect model: daemon-side agent requests are not tied to a single renderer WebSocket. Agent events are broadcast to all connected clients, recent assistant response snapshots are retained, and reconnecting clients receive `message.snapshot` events before live deltas continue.
- Provider status model: daemon emits `provider.status` after connection so each mode tab has a stable capability/status surface. DOM and Screen become ready after snapshots are posted; terminal is ready by default.
- Runtime health model: daemon emits `runtime.status` on connection and periodically after that. The renderer settings panel displays daemon uptime, client count, active request count, app-server state, app-server start count, and the latest app-server error.
- Storage health model: daemon emits storage readiness in `runtime.status`, including schema version, migration count, table count, WAL mode, foreign-key state, and database/blob paths. Full SQLite integrity checks are reserved for `/storage/health` and storage smoke tests.
- Runtime/session caveat: persisted messages restore across app restarts, but Codex app-server thread ids are still in-memory process state. Switching or restoring a session currently resets hidden runtime context; durable per-session app-server thread rebinding remains a later sprint risk.

## Provider Boundary

- DOM provider: external browser tooling can `POST /providers/dom/snapshot` to the local daemon with `{ url, title, selection, text }`. The latest snapshot is surfaced as a tool event in Browser/DOM mode and injected into the model request context. `providers/browser-dom-extension` packages the Chrome/Edge Manifest V3 bridge for active-tab snapshots, includes an Options page for local daemon URL changes, tries the optional `providers/browser-native-host` native messaging bridge first, and `npm run package:extension` writes a zip artifact for manual installation or store-prep review. `npm run release:browser-store-packet` creates `dist/browser-store-submission/codex-widget-dom-extension-<version>` with the extension zip, listing/privacy/review copy, native-host notes, icons, and SHA-256 manifest for store dashboard upload.
- Screen/Vision provider: external capture tooling can `POST /providers/screen/snapshot` with `{ source, title, description, ocrText, imageDataUrl }`. The latest text/description/OCR snapshot is surfaced as a Vision mode tool event and injected into the model request context; base64 image data is retained in daemon state and attached to Codex app-server Vision turns as an image input. The daemon computes a stable image hash, exact-change flag, byte-level image diff ratio, configurable diff threshold, and meaningful-change flag for repeated-capture awareness. `CODEX_WIDGET_SCREEN_DIFF_THRESHOLD` defaults to `0.01`. `providers/screen-capture-helper/capture-screen.ps1` is the first Windows helper for posting a compressed virtual-screen capture, and the renderer can ask the daemon to run it through `provider.captureScreen`. The helper supports optional virtual-screen crop parameters from env defaults, the renderer Settings panel, or a visual drag selector that converts the selected webview rectangle through Tauri window geometry. Optional local OCR runs through `tesseract` auto-detection or a `CODEX_WIDGET_SCREEN_OCR_COMMAND` command template that receives the captured image path as `{image}`. Auto-generated bundled/PATH Tesseract commands can use `CODEX_WIDGET_SCREEN_OCR_LANGUAGE`, bundled tessdata defaults to `eng+kor` when both language packs exist, and OCR input uses an upscaled PNG temp image by default while the snapshot payload remains JPEG. The renderer has a Vision popup for snapshot capture, WebM recording, and Agent screen share: recording uses display capture plus `MediaRecorder` and stores the finished WebM as a daemon blob; Agent screen share keeps metadata only, uses persisted cadence/duration controls, and posts low-frequency JPEG frames to the same snapshot endpoint so no video file is required for live context. Voice prompt input is currently a renderer-side Web Speech API dictation boundary that fills the prompt; it is not yet a full duplex voice session.
- Terminal/PTY provider: Terminal mode keeps the existing daemon-owned PTY session contract for `/pty start/status/stop`, direct text/key input, Ctrl+C, resize, and mouse-aware terminal apps. The renderer PTY viewport now includes a concise guide for use cases and connection boundaries. The PTY popout entry opens a terminal-focused widget URL on the same daemon port (`mode=terminal&surface=pty`); the popout uses the same daemon protocol rather than a separate local terminal backend.
- OCR runtime packaging: `npm run build:ocr-runtime` always creates `dist/ocr-runtime/ocr-runtime.json`, records available `.traineddata` languages, can fetch requested tessdata language packs with `CODEX_WIDGET_TESSDATA_LANGUAGES`, and can copy a Tesseract runtime from `CODEX_WIDGET_OCR_RUNTIME_DIR`, `CODEX_WIDGET_TESSERACT_EXE`, `PATH`, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, or standard Windows install locations such as Program Files, Chocolatey, Scoop, and per-user LocalAppData installs. `npm run ocr:fetch-languages -- eng kor` is the ad hoc language-pack acquisition path and `CODEX_WIDGET_TESSDATA_BASE_URL` can point at a mirror. Tauri bundles `dist/ocr-runtime`; installed helpers resolve `_up_/dist/ocr-runtime` before falling back to PATH OCR.
- Terminal provider: Terminal/PTY mode has two local command paths. One-shot commands use explicit prefixes (`/run`, `$`, `PS>`, `run:`, or fenced shell blocks), stream stdout/stderr as `tool.output`, and summarize the result into the assistant response. Persistent command sessions use `/pty start`, `/pty <command>`, `/pty resize 120x30`, `/pty write <input>`, `/pty key enter`, `/pty status`, and `/pty stop` to keep shell state in a daemon-owned node-pty/ConPTY process when available, falling back to a stdio shell only when `CODEX_WIDGET_TERMINAL_BACKEND=pipe` or node-pty is unavailable. Raw write/key requests drain shell output for a short quiet window so direct PTY input can update the viewport. The renderer-daemon protocol also supports direct `terminal.input` messages for live text/key input and SGR mouse click/drag/wheel forwarding without creating a chat turn; idle PTY output is broadcast back as `terminal.output`. Command-oriented terminal paths block destructive command patterns unless `CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE=1`. The renderer has a dedicated PTY viewport that accumulates terminal tool/idle output, exposes quick start/status/stop/clear actions, keeps text/Enter/Tab/Escape/Ctrl+C controls usable during active PTY work, and has an explicit mouse-input toggle for terminal apps that enable mouse reporting.

## Resident Desktop Boundary

- The native window is configured with `skipTaskbar: true`; tray Show/Hide/Quit is the resident control surface.
- The titlebar close button hides the window to tray. The tray Quit item exits the app.
- Windows start-at-login is implemented by setting the current executable in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` through native Tauri commands.
- Packaged builds do not depend on a user-installed `node` command for the widget daemon. `npm run build:web` creates a dependency-bundled daemon entry at `dist/daemon-bundle/standalone.js`, copies the current build Node executable into `dist/node-runtime`, and prepares native `node-pty` resources in `dist/pty-runtime`; Tauri bundles those directories as resources. The native resolver checks Tauri's resource directory and the installed exe-adjacent `_up_` resource directory before falling back to development `dist` or system `node`.
- The native daemon supervisor resolves the bundled daemon and bundled Node runtime from the Tauri resource directory first, then falls back to system `node` only if the resource runtime is absent.
- `npm run build` must produce both MSI and NSIS bundles before a release is considered installable on Windows.

## Provider Roadmap

- Browser DOM provider: browser store submission metadata, accessible labels, and element highlighting on top of the packaged localhost/native-messaging extension bridge.
- Controlled browser provider: Playwright/CDP for automation in a managed browser context.
- Screen provider: deeper native integrations on top of the existing Settings crop controls, visual drag selector, daemon-triggered Windows capture helper crop parameters, hash/diff metadata with configurable thresholds, bundled OCR runtime packaging, standard Windows Tesseract discovery, language-pack acquisition, language selection defaults, OCR-only PNG preprocessing, optional OCR command hook, and direct app-server image input.
- Terminal provider: terminal-emulator polish on top of the current node-pty/ConPTY session path, direct `terminal.input` protocol, SGR mouse forwarding, raw-input output drain, and renderer PTY viewport controls.

## Verification Commands

- `npm run lint`: TypeScript checks for renderer, shared, and daemon code.
- `npm run build:web`: compile daemon and renderer without invoking Cargo.
- `npm run smoke:storage`: verify daemon storage opens a temp app-data directory, applies migrations, enables WAL/foreign keys, persists a non-secret setting, rejects secret-like setting keys, records activity, exercises durable session/ask/branch/trash/restore paths, records text and file-change artifacts, resolves artifact open paths, records/stops Vision recording and Agent stream metadata, reopens cleanly, and reports integrity.
- `npm run smoke:node-runtime`: verify the bundled Node runtime can execute the bundled daemon without relying on repository `node_modules`.
- `npm run smoke:app-server`: verify daemon-owned Codex app-server thread reuse, streaming deltas, approval interaction forwarding, and `thread/rollback` without requiring a live Codex account.
- `npm run smoke:app-server:live`: verify the installed/logged-in Codex CLI can start the real `codex app-server`, connect through the widget daemon, and stream a real turn without falling back to `codex exec`.
- `npm run smoke:ocr-runtime`: verify OCR runtime copy/manifest packaging, standard Windows install discovery, tessdata language acquisition/selection, ad hoc fetch CLI, and daemon bundled OCR command resolution.
- `npm run smoke:pty-runtime`: verify native node-pty runtime packaging and daemon PTY runtime resolution.
- `npm run smoke:release-launch`: launch the release exe hidden and verify the packaged daemon WebSocket responds on `127.0.0.1:4128`.
- `npm run smoke:release-install`: run the NSIS installer silently, verify installed resources, launch the installed app hidden, verify the installed bundled daemon WebSocket, kill the bundled daemon to verify native supervisor restart, kill the app process to verify daemon parent-watchdog orphan cleanup, silently uninstall, and check cleanup.
- `npm run smoke:release-msi-install`: run the MSI installer silently into a per-user test directory, verify installed resources, launch the installed app hidden, verify the bundled daemon WebSocket, silently uninstall, and check cleanup.
- `npm run release:verify`: run the full live release gate in sequence and report the release artifact sizes.
- `npm run release:browser-store-packet`: generate the browser extension store submission packet with checksums.
- `npm run release:confirm-browser-store`: after an actual store dashboard submission, write a local confirmation report with store name, submission id or listing URL, submitted timestamp, package name, and package SHA-256.
- `npm run release:readiness`: audit existing release artifacts, browser store package/submission packet/readiness metadata, optional browser store submission confirmation report, latest soak evidence, and manual release blockers. Strict mode fails until browser store submission is confirmed.
- `npm run smoke`: build web/daemon and verify WebSocket streaming.
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`: native shell compile check on Windows.
