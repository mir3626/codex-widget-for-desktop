# Codex Widget for Desktop

A floating desktop agent widget inspired by old resident office assistants. It stays out of the taskbar, lives in the tray, streams responses in real time from a local daemon, and is structured for future browser, DOM, screen-capture, and terminal tools.

## Stack

- Electron for a transparent, always-on-top, skip-taskbar desktop widget and tray icon
- React + Vite for the widget UI
- Node/TypeScript daemon with WebSocket event streaming
- OpenAI Responses API streaming when `OPENAI_API_KEY` is set
- Mock streaming fallback when no API key is set

## Run

```powershell
npm install
npm run dev
```

For live model responses, copy `.env.example` to `.env` or set environment variables before launch:

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_MODEL="gpt-5.2"
npm run dev
```

## Scripts

- `npm run dev`: start Vite and the Electron widget
- `npm run build`: compile Electron/daemon code and build the renderer
- `npm run smoke`: build and verify the daemon WebSocket stream
- `npm run lint`: TypeScript checks

## Architecture

```text
Electron Widget
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
