## Iteration iter-22: P0/P1 Priority Closure

Status: complete.

Carryover: Iteration 21 consolidated the architecture, but the highest-priority operational follow-ups remained open: Browser Bridge extension reload detection, Browser Action timing/debug visibility, shared prepared-context migration for non-browser surfaces, renderer decomposition, clarification target preview, and a deterministic semantic trace corpus.

### iter-22-sprint-01-browser-bridge-reload-diagnostics

Goal: make stale unpacked Browser Bridge code visible before live retesting.

Expected scope: extension build/source hash metadata, daemon expected hash calculation, reload-required status, widget/popup visibility, and package compatibility preservation.

Status: complete. Browser Bridge status now carries extension build id, source hash, runtime id, daemon expected build/hash, and `reloadRequired`. The daemon computes the expected source hash from manifest/service-worker/bridge/popup/options files and marks the bridge stale when the installed unpacked extension has not been reloaded.

### iter-22-sprint-02-browser-action-observability-and-clarification-preview

Goal: make Browser Action failures faster to inspect and ambiguous target choices easier to understand.

Expected scope: renderer-visible diagnostics event, timing/debug summary, redacted clarification target preview, and focused renderer smoke coverage.

Status: complete. Browser Action now broadcasts `browserAction.diagnostics` with timing summaries and redacted debug-bundle metadata for non-completed prompt transactions. Clarification choices can include redacted bbox previews, and the renderer displays compact target overlays without storing full page state.

### iter-22-sprint-03-shared-context-renderer-and-semantic-corpus

Goal: close the remaining P1 foundation work without broad product churn.

Expected scope: screen prepared-context adapter, WidgetRuntime prompt submission extraction, semantic trace corpus, semantic trace metric summary, and smoke coverage.

Status: complete. Screen snapshots now project into shared prepared contexts alongside Vision TaskCapsules and Terminal state. `WidgetRuntime` prompt submission behavior moved into `usePromptSubmission`. Added `docs/dogfood/semantic-trace-corpus.jsonl`, metric summarization, and `npm run smoke:semantic-trace-corpus`.
