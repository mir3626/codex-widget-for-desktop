# Codex Widget for Desktop

A floating Tauri desktop agent widget inspired by old resident office assistants. It stays out of the taskbar, lives in the tray, streams responses in real time from a local daemon, and is structured for future browser, DOM, screen-capture, and terminal tools.

## Stack

- Tauri for a transparent, always-on-top, skip-taskbar desktop widget and tray icon
- React + Vite for the widget UI
- Node/TypeScript daemon with WebSocket event streaming
- OpenAI/ChatGPT account sign-in through the local Codex CLI
- Codex CLI-backed live responses after sign-in, using a daemon-owned `codex app-server` by default
- Optional OAuth Bearer-token proxy streaming for backend experiments
- Mock streaming fallback when no live auth path is available
- Packaged builds bundle the daemon JS and a Node runtime resource for the local daemon

## Prerequisites

Tauri requires Rust/Cargo on the development machine. On Windows, install the Tauri prerequisites first:

- Rust via `rustup`
- Microsoft C++ Build Tools with `Desktop development with C++`
- Microsoft Edge WebView2 runtime

If `cargo` fails with `link.exe not found`, Visual Studio is installed without the C++ toolchain. Open Visual Studio Installer and add `Desktop development with C++`, or run:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --norestart"
```

After installation, a normal PowerShell can load the compiler environment for this project:

```powershell
.\scripts\use-msvc-env.ps1
npm run dev
```

## Run

```powershell
npm install
npm run dev
```

`npm run dev` starts a native Tauri WebView window. Vite still serves the renderer at `127.0.0.1:5173` during development, but that URL is only a dev asset server. The widget itself is the native Tauri window, not the browser tab.

In development, `npm run dev` also starts `scripts/dev-hot.mjs`. Renderer changes use Vite HMR, and daemon TypeScript changes rebuild `dist/daemon` and restart the local daemon on port `4128`. Tauri/Rust shell changes still require the normal Tauri dev rebuild cycle.

By default, Sign in delegates to the local Codex CLI. That gives the widget the same workflow as Codex itself: click Sign in, complete OpenAI/ChatGPT browser authentication if needed, then return to the widget. No OpenAI token is typed into the widget.

Widget prompts are intentionally not executed from this repository. The daemon starts a background `codex app-server` from the user home directory with `danger-full-access`, so ordinary desktop file tasks can still search, create, edit, move, or delete requested user files without treating the widget source tree as the active project or paying the Windows home-directory sandbox setup cost. Override the root with `CODEX_WIDGET_CODEX_WORKDIR`, add extra writable roots with `CODEX_WIDGET_CODEX_ADD_DIRS`, set `CODEX_WIDGET_CODEX_SANDBOX=workspace-write|danger-full-access`, or force the old `codex exec` fallback with `CODEX_WIDGET_CODEX_RUNTIME=exec` before launch.

The default Codex approval policy is `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request`. When app-server asks for permission or more input, the widget shows a compact interaction card and sends the response back through the daemon.

The renderer keeps the visible chat timeline in localStorage, and the titlebar New chat button clears both the visible conversation and the daemon-side session/thread state. Response Branch starts a fresh daemon runtime session and sends the selected exchange as one-shot context on the next prompt, so branch conversations do not continue on hidden old app-server state. The daemon also retains recent response snapshots for reconnecting renderer clients. Mode tabs are backed by daemon-provided provider status so future DOM, Vision, and PTY providers can attach without changing the basic UI contract.

For resident use, the widget hides to tray from the titlebar close button and can be restored or quit from the tray menu. The Settings button exposes Start at login, provider status, and daemon runtime health. On Windows, Start at login writes the current executable to the current user's `Run` registry key.

Installed builds do not require the user to install Node.js just to run the widget daemon. The release build creates `dist/daemon-bundle/standalone.js`, copies the build machine's Node executable into `dist/node-runtime`, prepares native `node-pty` resources in `dist/pty-runtime`, and bundles them into the Tauri app resources. The native shell prefers those bundled resources and falls back to a system `node` command only when the bundled runtime is absent.

DOM mode can receive the current browser page through the local daemon endpoint:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4128/providers/dom/snapshot -ContentType application/json -Body '{"url":"https://example.com","title":"Example","selection":"selected text","text":"page text"}'
```

Vision mode can receive a screen snapshot through the same local daemon boundary:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4128/providers/screen/snapshot -ContentType application/json -Body '{"source":"windows-capture-helper","title":"Active desktop","description":"A settings dialog is open.","ocrText":"Visible screen text"}'
```

For browser testing, load the unpacked Chrome/Edge extension in [providers/browser-dom-extension](providers/browser-dom-extension), or use [docs/providers/dom-snapshot-bookmarklet.js](docs/providers/dom-snapshot-bookmarklet.js) as a fallback bookmarklet. The extension has an Options page for changing the local daemon snapshot URL when the widget is not on port `4128`; it only accepts local `127.0.0.1` or `localhost` snapshot URLs. It also supports an optional Chrome/Edge native messaging host in [providers/browser-native-host](providers/browser-native-host), trying that installed bridge before falling back to direct local HTTP. For screen capture, use the Vision-mode Capture action, run [providers/screen-capture-helper/capture-screen.ps1](providers/screen-capture-helper/capture-screen.ps1), or see [docs/providers/screen-snapshot-example.json](docs/providers/screen-snapshot-example.json) for the raw payload shape. Terminal mode executes explicit one-shot commands, such as `/run Get-ChildItem`, `$ pwd`, or a fenced shell block. It also supports a daemon-owned persistent node-pty/ConPTY session with `/pty start`, `/pty <command>`, `/pty resize 120x30`, `/pty write <input>`, `/pty key enter`, `/pty status`, and `/pty stop`; this keeps shell state, supports raw input, drains output after raw key/input writes, and renders terminal tool output in the Terminal tab's PTY viewport with direct PTY input controls. Destructive command patterns are blocked unless `CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE=1` is set.

The Capture action asks the daemon to run the Windows screen capture helper directly. The helper is bundled as a Tauri resource for installed builds. Override its path with `CODEX_WIDGET_SCREEN_CAPTURE_HELPER`, tune payload size with `CODEX_WIDGET_SCREEN_CAPTURE_MAX_WIDTH` and `CODEX_WIDGET_SCREEN_CAPTURE_JPEG_QUALITY`, or crop the virtual screen with `CODEX_WIDGET_SCREEN_CROP_X`, `CODEX_WIDGET_SCREEN_CROP_Y`, `CODEX_WIDGET_SCREEN_CROP_WIDTH`, and `CODEX_WIDGET_SCREEN_CROP_HEIGHT`.

Screen OCR is optional and local. Installed builds first use a bundled Tesseract runtime when one was available during build. At runtime, if `tesseract` is available on `PATH`, the helper uses it automatically. Bundled OCR auto-selects `eng+kor` when both `eng.traineddata` and `kor.traineddata` are present, falling back to whichever of those languages exists. OCR input is preprocessed as an upscaled PNG by default while the screen payload remains compressed JPEG; tune it with `CODEX_WIDGET_SCREEN_OCR_SCALE` and `CODEX_WIDGET_SCREEN_OCR_MAX_WIDTH`, or disable preprocessing with `CODEX_WIDGET_SCREEN_OCR_DISABLE_PREPROCESS=1`. Override language with `CODEX_WIDGET_SCREEN_OCR_LANGUAGE`, set `CODEX_WIDGET_SCREEN_OCR_COMMAND` to a full command template that prints text to stdout and uses `{image}` for the captured image path, disable OCR with `CODEX_WIDGET_SCREEN_OCR_DISABLE=1`, or cap text with `CODEX_WIDGET_SCREEN_OCR_MAX_CHARS`. The daemon computes a hash/change flag for each screen image so repeated captures can be distinguished from unchanged context.

For backend OAuth proxy experiments, point the daemon at an OAuth provider and agent proxy before launch:

```powershell
$env:CODEX_WIDGET_AUTH_MODE="pkce"
$env:CODEX_WIDGET_AUTH_BASE_URL="https://auth.example.com"
$env:CODEX_WIDGET_OAUTH_CLIENT_ID="codex-widget"
$env:CODEX_WIDGET_AGENT_PROXY_URL="https://auth.example.com/agent/stream"
npm run dev
```

`CODEX_WIDGET_AUTH_BASE_URL` derives `/oauth/authorize`, `/oauth/token`, and `/agent/stream` defaults. Set `CODEX_WIDGET_OAUTH_AUTHORIZE_URL`, `CODEX_WIDGET_OAUTH_TOKEN_URL`, or `CODEX_WIDGET_AGENT_PROXY_URL` explicitly when your backend uses different routes. The proxy receives `Authorization: Bearer <OAuth access token>` and a JSON body with `id`, `mode`, `input`, and `stream`.

The bundled dev auth proxy is only for local widget testing. Run `npm run dev:auth-proxy` or set `CODEX_WIDGET_DEV_AUTH_PROXY=1` before `npm run dev` when you explicitly want that mock OAuth/proxy path. It issues short-lived local development tokens and streams a deterministic proxy response.

For local development with an already-issued OAuth access token, put it in the gitignored `.env` file:

```powershell
CODEX_WIDGET_AGENT_PROXY_URL=http://127.0.0.1:8787/agent/stream
CODEX_WIDGET_AUTH_MODE=token
CODEX_WIDGET_OAUTH_ACCESS_TOKEN=...
```

You do not need to open `.env` manually. In token mode, pressing **Sign in** in the widget shows an inline token form, saves the token/proxy URL into the gitignored `.env`, and updates the running daemon immediately.

## Scripts

- `npm run dev`: start the Tauri desktop widget
- `npm run dev:services`: start renderer HMR, daemon TypeScript watch, and daemon restart loop without launching Tauri
- `npm run dev:auth-proxy`: start only the local development OAuth/proxy server on `127.0.0.1:8787`
- `npm run build`: build the Tauri desktop app
- `npm run build:web`: compile the daemon, create the bundled daemon entry, build the renderer, and prepare bundled Node/OCR/PTY runtime resources
- `npm run build:ocr-runtime`: prepare `dist/ocr-runtime`; set `CODEX_WIDGET_OCR_RUNTIME_DIR` or `CODEX_WIDGET_TESSERACT_EXE` to bundle a Tesseract runtime, or let the script find `tesseract` on `PATH`, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, or standard Windows install locations
- `npm run build:pty-runtime`: prepare `dist/pty-runtime` with the native `node-pty` runtime used by installed builds
- `npm run package:extension`: create `dist/providers/codex-widget-dom-extension-0.1.0.zip`
- `npm run smoke:all`: run the standard serial readiness gate without rebuilding daemon in parallel
- `npm run smoke:daemon-reconnect`: verify an active daemon response survives renderer WebSocket reconnect and replays a snapshot
- `npm run smoke:app-server`: run the daemon against a fake Codex app-server and verify resident thread context, approval interaction forwarding, streaming deltas, and rollback behavior
- `npm run smoke:all:live`: run the serial readiness gate plus the live Windows screen capture helper
- `npm run smoke:resident`: run the idle resident daemon health/resource smoke
- `npm run smoke:resident-soak`: run a short resident daemon soak with runtime samples, ping/pong health checks, and RSS growth limits
- `npm run smoke:release-resources`: verify the latest MSI/NSIS build scripts include the bundled daemon, Node runtime, PTY runtime, screen helper, and DOM extension resources
- `npm run smoke:release-launch`: launch the latest release exe hidden, verify its daemon WebSocket on `127.0.0.1:4128`, then clean up the process tree
- `npm run smoke:release-install`: run a Windows NSIS silent install, launch the installed app hidden, verify the bundled daemon, kill it to verify native restart supervision, kill the app process to verify daemon orphan cleanup, then silently uninstall and check cleanup
- `npm run smoke:release-msi-install`: run a Windows MSI silent install with a per-user test directory, launch the installed app hidden, verify the bundled daemon, silently uninstall, and check cleanup
- `npm run release:verify`: run the full live release gate (`smoke:all:live`, build, release resource/launch/NSIS/MSI install smokes) and print artifact sizes
- `npm run release:readiness`: audit the current release artifacts, browser-store package metadata, and latest soak report; reports manual blockers for browser store submission and true multi-hour soak unless confirmed through env flags
- `npm run release:soak`: build the release app and run a longer hidden release-exe soak with runtime samples, ping/pong checks, daemon process detection, process-tree working-set limits, and a JSON report under `dist/reports`
- `npm run smoke:release-soak`: run the same release-exe soak against an already-built release app; set `CODEX_WIDGET_RELEASE_SOAK_MS` and `CODEX_WIDGET_RELEASE_SOAK_REPORT` for multi-hour/manual evidence runs
- `npm run smoke:node-runtime`: verify the bundled Node runtime can run the bundled daemon without repository `node_modules`
- `npm run smoke:renderer-chat`: run a Playwright layout smoke for multi-turn chat, tables, prompt resizing, More-menu placement, and Terminal viewport direct input controls
- `npm run smoke:dom`: verify the local DOM snapshot provider ingress
- `npm run smoke:extension`: verify the unpacked browser DOM extension manifest/service worker
- `npm run smoke:browser-native-host`: verify the Chrome/Edge native messaging host framing and daemon POST path
- `npm run smoke:browser-store`: verify browser store listing, privacy, review notes, permission rationales, and package readiness
- `npm run smoke:ocr-runtime`: verify OCR runtime packaging, standard Windows install discovery, tessdata language manifesting, and daemon-side bundled OCR command resolution
- `npm run smoke:pty-runtime`: verify PTY runtime packaging and native `node-pty` loading
- `npm run smoke:screen`: verify the local screen snapshot provider ingress
- `npm run smoke:screen-capture:live`: verify the widget protocol can trigger a live screen capture through the daemon
- `npm run smoke:screen-helper`: verify the Windows screen capture helper syntax and required APIs
- `npm run smoke:screen-helper:ocr`: verify the screen helper OCR command hook in dry-run mode
- `npm run smoke:screen-helper:live`: run the Windows screen capture helper against a live daemon
- `npm run smoke:terminal`: verify explicit terminal command execution
- `npm run smoke:terminal-session`: verify the persistent `/pty` terminal session path, including the node-pty backend when available
- Production build output is written under `src-tauri/target/release/bundle/` as MSI and NSIS installer artifacts.
- `npm run smoke`: build and verify the daemon WebSocket stream
- `npm run lint`: TypeScript checks

## Architecture

```text
Tauri Widget
  - transparent frameless window
  - always on top
  - hidden from taskbar
  - tray menu
  - React speech bubble and controls

Local Daemon
  - WebSocket server
  - streaming agent runtime
  - event log
  - tool router

Future Tool Providers
  - store-packaged browser extension provider for active tab DOM
  - Playwright/CDP provider for controlled browser use
  - region-selection UI and image-diff thresholds on top of the native screen capture helper
  - richer full-screen key/mouse handling on top of the node-pty PTY viewport
```

The daemon is the session authority. The widget is a client, so browser pages, terminal views, and future desktop tools can attach to the same session without prompt-injecting an external CLI.
