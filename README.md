# Codex Widget for Desktop

A floating Tauri desktop agent widget inspired by old resident office assistants. It stays out of the taskbar, lives in the tray, streams responses in real time from a local daemon, and is structured for future browser, DOM, screen-capture, and terminal tools.

## Stack

- Tauri for a transparent, always-on-top, skip-taskbar desktop widget and tray icon
- React + Vite for the widget UI
- Node/TypeScript daemon with WebSocket event streaming
- OpenAI/ChatGPT account sign-in through the local Codex CLI
- Codex CLI-backed live responses after sign-in
- Optional OAuth Bearer-token proxy streaming for backend experiments
- Mock streaming fallback when no live auth path is available

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

Widget prompts are intentionally not executed from this repository. The daemon starts `codex exec` from the user home directory with `danger-full-access`, so ordinary desktop file tasks can still search, create, edit, move, or delete requested user files without treating the widget source tree as the active project or paying the Windows home-directory sandbox setup cost. Override the root with `CODEX_WIDGET_CODEX_WORKDIR`, add extra writable roots with `CODEX_WIDGET_CODEX_ADD_DIRS`, or set `CODEX_WIDGET_CODEX_SANDBOX=workspace-write|danger-full-access` before launch when a different local-file boundary is needed.

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
- `npm run build:web`: compile the daemon and build the renderer without invoking Cargo
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
  - browser extension provider for active tab DOM
  - Playwright/CDP provider for controlled browser use
  - screen capture provider for vision/computer-use loops
  - PTY provider for terminal sessions
```

The daemon is the session authority. The widget is a client, so browser pages, terminal views, and future desktop tools can attach to the same session without prompt-injecting an external CLI.
