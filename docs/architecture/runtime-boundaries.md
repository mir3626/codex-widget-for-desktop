# Runtime Boundaries

## Processes

- Tauri owns the native resident window, tray behavior, supervision, and bundled
  daemon launch.
- The React renderer owns interaction surfaces only: chat, mode controls,
  settings, approval cards, diagnostics, and direct action controls.
- The Node daemon owns product state, provider orchestration, Codex app-server
  integration, capability execution, safety decisions, audit records, and
  storage.
- Browser extensions, native hosts, Playwright, CDP, screen capture, OCR,
  terminal PTY, and future desktop helpers are adapters. They emit normalized
  observations/results and do not render final prompts.

## State Ownership

- Durable sessions, messages, runtime threads, artifacts, activity, policies,
  preferences, provider snapshots, Vision streams, and Semantic Memory are
  daemon-owned.
- Renderer local storage is allowed only for UI continuity and migration
  fallback. It must not become source-of-truth for runtime state.
- Secret material must not be persisted in renderer storage, activity logs,
  reports, Semantic Memory, debug bundles, or provider snapshots.

## Protocol Ownership

- `src/shared/protocol/` is the explicit renderer-daemon contract.
- Protocol additions should be feature-owned and discriminated by message type.
- Renderer interactions should stay generic enough that Browser, Vision,
  Terminal, and future Desktop approvals can share cards without leaking
  feature-specific execution semantics into React components.

## Provider Boundary

Providers and adapters may:

- observe the current surface
- execute typed low-level actions when authorized
- report status, availability, diagnostics, and result evidence

Providers and adapters must not:

- decide user intent
- bypass daemon safety policy
- persist raw sensitive state
- produce final assistant/chat prose
- silently convert unsupported actions into no-ops

