## Iteration iter-23: Post-Priority Hardening

Status: complete.

Carryover: After iter-22, the user requested the remaining work in this order: renderer decomposition, live trace/corpus loop, Browser Bridge reload UX, Browser Action debug bundle export, newly discovered verification-noise fixes, and remaining feasible/BLOCKED items.

### iter-23-sprint-01-renderer-decomposition

Goal: reduce `useChatSessionController` responsibility before further feature work.

Status: complete. Assistant stream/typewriter state moved into `useAssistantMessageStream`, and action-menu/session-trash dismissal now reuses `useDismissableOverlay`.

### iter-23-sprint-02-live-semantic-corpus

Goal: make reviewed live Browser Action dogfood evidence part of the deterministic semantic feedback loop.

Status: complete. Added `docs/dogfood/browser-action-semantic-live-corpus.jsonl` and `npm run smoke:browser-action:semantic-live-corpus`, covering public widget-UI and isolated live reports across read, filter activation, history navigation, search form fill/submit, and representative content selection.

### iter-23-sprint-03-extension-reload-and-debug-export

Goal: reduce live-test friction after extension changes and make Browser Action failures exportable.

Status: complete. The Browser Bridge popup now exposes `Reload bridge` when stale extension code is detected, and Browser Action summary blocks can copy/download JSON diagnostics from the renderer.

### iter-23-sprint-04-verification-noise-and-blocker-records

Goal: close the new verification-noise findings and record remaining true blockers precisely.

Status: complete. Vite vendor chunking removes the renderer chunk-size warning, `smoke:all` suppresses Node SQLite experimental warning noise, smoke temp cleanup schedules deferred retries after EPERM, app-server client-tool BLOCKED status is encoded in `src/daemon/agent-tools/appServerClientTool.ts`, `docs/architecture/open-blockers.md` records remaining external blockers, Vision ASR sidecar execution is implemented behind `CODEX_WIDGET_ASR_SIDECAR_COMMAND`, and restricted-page recovery text is clearer.
