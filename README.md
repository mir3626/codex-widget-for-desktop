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

The renderer keeps the visible chat timeline in localStorage, and the titlebar New chat button clears both the visible conversation and the daemon-side session/thread state. Mode tabs are backed by daemon-provided provider status so future DOM, Vision, and PTY providers can attach without changing the basic UI contract.

For resident use, the widget hides to tray from the titlebar close button and can be restored or quit from the tray menu. The Settings button exposes Start at login, provider status, and daemon runtime health. On Windows, Start at login writes the current executable to the current user's `Run` registry key.

Installed builds do not require the user to install Node.js just to run the widget daemon. The release build creates `dist/daemon-bundle/standalone.js`, copies the build machine's Node executable into `dist/node-runtime`, and bundles both into the Tauri app resources. The native shell prefers those bundled resources and falls back to a system `node` command only when the bundled runtime is absent.

DOM mode can receive the current browser page through the local daemon endpoint:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4128/providers/dom/snapshot -ContentType application/json -Body '{"url":"https://example.com","title":"Example","selection":"selected text","text":"page text"}'
```

Vision mode can receive a screen snapshot through the same local daemon boundary:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4128/providers/screen/snapshot -ContentType application/json -Body '{"source":"windows-capture-helper","title":"Active desktop","description":"A settings dialog is open.","ocrText":"Visible screen text"}'
```

For browser testing, load the unpacked Chrome/Edge extension in [providers/browser-dom-extension](providers/browser-dom-extension), or use [docs/providers/dom-snapshot-bookmarklet.js](docs/providers/dom-snapshot-bookmarklet.js) as a fallback bookmarklet. The extension has an Options page for changing the local daemon snapshot URL when the widget is not on port `4128`; it only accepts local `127.0.0.1` or `localhost` snapshot URLs. For screen capture, use the Vision-mode Capture action, run [providers/screen-capture-helper/capture-screen.ps1](providers/screen-capture-helper/capture-screen.ps1), or see [docs/providers/screen-snapshot-example.json](docs/providers/screen-snapshot-example.json) for the raw payload shape. Terminal mode executes only explicit one-shot commands, such as `/run Get-ChildItem`, `$ pwd`, or a fenced shell block. It also supports a daemon-owned persistent command session with `/pty start`, `/pty <command>`, `/pty status`, and `/pty stop`; this keeps shell state between commands but is not yet a full raw ConPTY terminal. Destructive command patterns are blocked unless `CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE=1` is set.

The Capture action asks the daemon to run the Windows screen capture helper directly. The helper is bundled as a Tauri resource for installed builds. Override its path with `CODEX_WIDGET_SCREEN_CAPTURE_HELPER`, or tune payload size with `CODEX_WIDGET_SCREEN_CAPTURE_MAX_WIDTH` and `CODEX_WIDGET_SCREEN_CAPTURE_JPEG_QUALITY`.

Screen OCR is optional and local. If `tesseract` is available on `PATH`, the helper uses it automatically. Otherwise set `CODEX_WIDGET_SCREEN_OCR_COMMAND` to a command template that prints text to stdout and uses `{image}` for the captured JPEG path, for example `tesseract {image} stdout -l eng+kor`. Disable OCR with `CODEX_WIDGET_SCREEN_OCR_DISABLE=1`, or cap text with `CODEX_WIDGET_SCREEN_OCR_MAX_CHARS`.

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
- `npm run build:web`: compile the daemon, create the bundled daemon entry, build the renderer, and prepare the bundled Node runtime
- `npm run package:extension`: create `dist/providers/codex-widget-dom-extension-0.1.0.zip`
- `npm run smoke:all`: run the standard serial readiness gate without rebuilding daemon in parallel
- `npm run smoke:all:live`: run the serial readiness gate plus the live Windows screen capture helper
- `npm run smoke:resident`: run the idle resident daemon health/resource smoke
- `npm run smoke:resident-soak`: run a short resident daemon soak with runtime samples, ping/pong health checks, and RSS growth limits
- `npm run smoke:release-resources`: verify the latest MSI/NSIS build scripts include the bundled daemon, Node runtime, screen helper, and DOM extension resources
- `npm run smoke:release-launch`: launch the latest release exe hidden, verify its daemon WebSocket on `127.0.0.1:4128`, then clean up the process tree
- `npm run smoke:release-install`: run a Windows NSIS silent install, launch the installed app hidden, verify the bundled daemon, kill it to verify native restart supervision, then silently uninstall and check cleanup
- `npm run release:verify`: run the full live release gate (`smoke:all:live`, build, release resource/launch/install smokes) and print artifact sizes
- `npm run smoke:node-runtime`: verify the bundled Node runtime can run the bundled daemon without repository `node_modules`
- `npm run smoke:renderer-chat`: run a Playwright layout smoke for multi-turn chat, tables, prompt resizing, and More-menu placement
- `npm run smoke:dom`: verify the local DOM snapshot provider ingress
- `npm run smoke:extension`: verify the unpacked browser DOM extension manifest/service worker
- `npm run smoke:screen`: verify the local screen snapshot provider ingress
- `npm run smoke:screen-capture:live`: verify the widget protocol can trigger a live screen capture through the daemon
- `npm run smoke:screen-helper`: verify the Windows screen capture helper syntax and required APIs
- `npm run smoke:screen-helper:ocr`: verify the screen helper OCR command hook in dry-run mode
- `npm run smoke:screen-helper:live`: run the Windows screen capture helper against a live daemon
- `npm run smoke:terminal`: verify explicit terminal command execution
- `npm run smoke:terminal-session`: verify the persistent `/pty` terminal session path
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
  - OCR and direct image input on top of the native screen capture helper
  - true ConPTY/node-pty support for raw interactive terminal sessions
```

The daemon is the session authority. The widget is a client, so browser pages, terminal views, and future desktop tools can attach to the same session without prompt-injecting an external CLI.
