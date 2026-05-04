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
  - OpenAI Responses streaming or mock streaming fallback
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

## Authentication Boundary

The renderer never receives a long-lived OpenAI API key. Current MVP behavior is:

- renderer -> local daemon: local WebSocket, no OpenAI credential.
- daemon -> OpenAI Platform: API key only if `OPENAI_API_KEY` is set in the daemon environment.
- no key: daemon uses deterministic mock streaming for local UI development.

Future OAuth-ready architecture should put OAuth login and OpenAI API key storage behind a backend/proxy. The widget may use a short-lived local/backend-issued token, but it should not store long-lived platform credentials.

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
