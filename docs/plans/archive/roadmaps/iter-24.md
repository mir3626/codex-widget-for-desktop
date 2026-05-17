## Iteration iter-24: Browser Action Reliability Foundation

Status: complete.

Carryover: Iteration 23 closed the prior hardening set, but live Browser Action dogfood still showed architecture-level reliability gaps: inconsistent history navigation, verification false positives, prompt feedback misclassified as executable actions, non-representative content selection, numeric-reference ambiguity, slow prompt-to-action latency, and too much manual live-test diagnosis. `docs/plans/browser-action-reliability-foundation-handoff.md` was the authority for this completed iteration.

### iter-24-sprint-01-runtime-verification-and-intent-hardening

Goal: address the highest-impact live regressions before expanding the broader reliability foundation.

Expected scope: extension default/stale reload visibility, history-navigation retry/source-mismatch behavior, navigate verification false positives, Browser Action feedback prompt abstention, history-command precedence over generic content-open prompts, numeric content identifier groundwork, and focused regression smokes.

Status: complete. Runtime/default-state, history navigation, verification, intent parsing, representative content, numeric content-id, live-harness dry-run, and focused regression smoke coverage are implemented.

### iter-24-sprint-02-live-harness-and-perception-scheduler

Goal: reduce manual Browser Action dogfood friction and start moving current-page understanding ahead of user prompts.

Expected scope: live widget/browser test harness improvements, prompt/action timing capture, active-tab dirty/freshness diagnostics, prepared context scheduling improvements, and artifacts that classify perception/intent/candidate/adapter/verification failures.

Status: complete. Live harness dry-run and isolated live dogfood coverage are in place, and Browser Perception now has background active-tab observe scheduling from heartbeat/poll/WebSocket status, foreground observe priority, in-flight background dedupe, no-waiter result ingestion, and bridge smoke coverage proving the scheduler contract.

### iter-24-sprint-03-semantic-memory-ux-tool-contract-and-boundaries

Goal: complete the remaining foundation workstreams after runtime reliability is stable enough to measure.

Expected scope: Semantic Interface v2 evidence integration, Semantic Memory advisory feedback loop, Browser Action UX simplification, app-server/simulated tool contract hardening, module-boundary cleanup, architecture docs, dogfood reports, and completion audit.

Status: complete. Semantic Memory now contributes bounded advisory candidate-ranking evidence, Browser Action tool results normalize into the shared agent-tool result contract, raw internal receipts are replaced by user-facing Browser Action summaries, official app-server client-tool integration remains explicitly BLOCKED on a stable external contract, and architecture source-size regression checks are covered by `smoke:architecture-foundations`. Completion evidence is recorded in `docs/reports/browser-action-reliability-completion-audit-2026-05-11.md`.
