# Codex Widget for Desktop

A floating Tauri desktop agent widget inspired by old resident office assistants. It stays out of the taskbar, lives in the tray, streams responses in real time from a local daemon, and is structured for future browser, DOM, screen-capture, and terminal tools.

## Stack

- Tauri for a transparent, always-on-top, skip-taskbar desktop widget and tray icon
- React + Vite for the widget UI
- Node/TypeScript daemon with WebSocket event streaming
- OpenAI Responses API streaming when `OPENAI_API_KEY` is set
- Mock streaming fallback when no API key is set

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

For live model responses, copy `.env.example` to `.env` or set environment variables before launch:

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_MODEL="gpt-5.2"
npm run dev
```

## Scripts

- `npm run dev`: start the Tauri desktop widget
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
