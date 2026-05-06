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

## Requirement Intent And Consensus

- Do not satisfy visual or UX requirements with proxy implementations that only pass automated checks. Smoke tests are evidence, not the definition of product acceptance.
- Treat ambiguous experiential words such as "moving", "native-like", "social-login-like", or "web-session-like" as intent-bearing requirements, not literal implementation hints.
- Before implementing when intent is unclear, run a short consensus step: restate the inferred intent, propose concrete acceptance criteria, list viable implementation options with tradeoffs, state the validation method, and wait for the user's direction when the choice affects product semantics.
- For mascot motion specifically, static-image transforms or sprite sheets generated from one unchanged pose do not satisfy "moving mascot" unless the user explicitly accepts that compromise. The default bar is authored motion with meaningful pose, expression, or state changes, delivered through real animation frames, APNG/GIF/WebM/Lottie, or equivalent assets.

## Git and Generated Files

- Commit `src-tauri/Cargo.lock`.
- Do not commit `src-tauri/target/`, `dist/`, `dist-renderer/`, `.env`, or local logs.
- Keep harness-owned files under `.vibe/harness/**`, `.claude/**`, and `.codex/**` synced from vibe-doctor.
