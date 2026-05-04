# Conventions

## Language and Runtime

- TypeScript is strict for renderer, daemon, and shared protocol code.
- Rust/Tauri code lives only under `src-tauri/**`.
- Node.js 24+ is assumed.
- Tauri uses the Windows MSVC toolchain; run `scripts/use-msvc-env.ps1` when a shell cannot find `link.exe`.

## Code Style

- Keep renderer UI state in React components unless there is a concrete need for a shared store.
- Keep daemon/renderer protocol changes in `src/shared/protocol.ts` first, then adapt both sides.
- Prefer structured daemon events over ad hoc text parsing.
- Keep provider implementations isolated by capability: browser, screen, terminal, agent.
- Do not put OpenAI credentials in renderer code or committed files.

## UI

- The desktop widget is the product surface. The Vite browser page is only a dev asset server.
- Preserve transparent/frameless/always-on-top/skip-taskbar behavior unless explicitly changing window strategy.
- Keep the generated mascot asset project-local under `src/renderer/assets/`.

## Git and Generated Files

- Commit `src-tauri/Cargo.lock`.
- Do not commit `src-tauri/target/`, `dist/`, `dist-renderer/`, `.env`, or local logs.
- Keep harness-owned files under `.vibe/harness/**`, `.claude/**`, and `.codex/**` synced from vibe-doctor.
