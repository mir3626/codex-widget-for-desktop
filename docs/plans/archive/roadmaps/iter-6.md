## Iteration iter-6: Renderer Architecture Refactor

Carryover: Dogfooding and source review exposed that the renderer frontend had grown into one oversized `App.tsx` and one oversized `styles.css`, making future feature work risky. This iteration keeps runtime behavior unchanged and focuses on maintainability boundaries.

### iter-6-sprint-01-renderer-structure-refactor

Goal: split the renderer into reusable UI components, shared hooks, utilities, constants/types, and scoped CSS partials without changing the widget's daemon protocol or visible behavior.

Dependencies: current renderer chat/session/Vision/PTY UI, shared protocol types, existing renderer smoke coverage.

Expected scope: App orchestration remains in `App.tsx`; presentational/feature UI moves into `src/renderer/components`; shared floating behavior moves to `src/renderer/hooks`; chat/storage/speech/terminal/Vision helpers move to `src/renderer/utils`; constants and local renderer types move to `config.ts`/`types.ts`; CSS becomes an import manifest over scoped partials.

Status: implemented. `App.tsx` dropped from 4,959 to 2,612 lines and now primarily owns state, daemon WebSocket effects, native shell handlers, and high-level routing. Renderer UI is split across titlebar/system strip, mode tabs, settings, session strip/trash, conversation, prompt/model controls, activity log, terminal, Vision, artifacts, markdown, floating tooltip, and interaction components. CSS is now grouped under `src/renderer/styles` by shell, status/sessions, chat, artifacts/interactions, terminal, settings/Vision, composer/activity/mascot, animations, and base tokens. Verification passed `npm run lint`, `npm run build:renderer`, `npm run smoke:renderer-chat`, `git diff --check`, strict UTF-8 decoding for renderer files, and mojibake scan.
