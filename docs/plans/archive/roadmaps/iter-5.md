## Iteration iter-5: Runtime Rebinding And Provider History Closure

Carryover: Iteration 4 closed the visible dogfooding polish set and added widget context, artifact previews, Vision/voice controls, PTY popout affordances, and mascot persona context. The remaining feasible backlog is now concentrated in durable runtime/session correctness, provider history visibility, Vision resource tuning, and a completion audit that distinguishes shipped work from deferred external release tasks.

### iter-5-sprint-01-durable-app-server-thread-rebinding

Goal: preserve the hidden Codex app-server thread association per durable widget session so switching, restoring, or reopening sessions does not bleed context across tabs or silently lose the current app-server conversation.

Dependencies: daemon SQLite storage, `runtime_threads` table, `CodexAppServerBridge`, session create/open/branch/reset flows, fake app-server smoke.

Expected scope: storage read/write helpers for runtime thread metadata, bridge thread get/set/reset helpers, daemon session-aware thread binding before app-server turns, stale-thread retry/clear behavior where practical, and smoke coverage proving two widget sessions keep distinct app-server threads.

Status: implemented. The storage layer now exposes runtime thread read/write/clear helpers over the existing `runtime_threads` table. The daemon binds the session's persisted Codex app-server thread before regeneration or a new app-server turn, persists the active thread after the turn, and clears/errors the record when no usable thread remains. `CodexAppServerBridge` now exposes get/set thread helpers and retries once with a fresh thread when rollback or turn start reports a stale/unknown thread. Storage and fake app-server smokes verify thread persistence and two durable widget sessions rebinding to separate app-server threads.

### iter-5-sprint-02-provider-snapshot-history-ui

Goal: expose provider snapshot history in the widget so DOM, Vision, PTY, runtime, and stream context are visible as product state rather than hidden daemon internals.

Dependencies: provider snapshot storage, activity log, renderer provider modes, artifact/activity detail surfaces.

Expected scope: daemon protocol snapshot for recent provider records, renderer history popover or panel from provider/status/activity surfaces, clear timestamps/source/summary metadata, safe redaction for large image or credential-like fields, and smoke coverage for provider history rendering.

Status: implemented. Provider snapshots are now durable ledger state. DOM and Vision snapshot ingress record redacted provider history rows in SQLite and broadcast refreshed ledger snapshots; terminal provider starts record lightweight PTY/Terminal history rows. `LedgerSnapshot` now carries `providerSnapshots`, and the Activity detail popover shows a Provider history section with timestamp, provider label, title, and summary. Storage, DOM, Vision, renderer, and full smoke gates verify persistence, redaction, and UI rendering.

### iter-5-sprint-03-vision-resource-and-retention-tuning

Goal: tighten Vision recording and Agent screen-sharing resource behavior before more dogfooding.

Dependencies: Vision popup, `vision_streams` storage, screen snapshot ingress, local stream controls, resident smoke/resource checks.

Expected scope: visible cadence/duration/resource defaults, stream stop cleanup audit, bounded metadata retention, optional stream snapshot throttling diagnostics, and verification that Agent screen sharing remains metadata-only unless a recording is explicitly requested.

Status: implemented. Agent screen sharing now drops overlapping frame ticks while a previous frame upload is still pending and reports skipped frames alongside sent/failed counts. Vision cleanup now finalizes stream ids to prevent duplicate stop messages when tracks end during local cleanup, and provider completion/error/stopped events clear guard timers, frame timers, video elements, and media tracks. Recording and Agent-share start messages carry actual duration, byte, frame width, JPEG quality, and overlap-policy metadata; daemon guardrail activity records preserve those effective values for later dogfooding resource analysis. Daemon and renderer smokes verify guardrail diagnostics and the updated Vision protocol details.

### iter-5-sprint-04-completion-audit-and-readiness-update

Goal: audit all user-listed residual work against implemented, deferred, and not-feasible-without-dogfooding categories, refresh durable context/report files, and only then close the active goal if no feasible in-scope work remains.

Dependencies: sprints 01-03, project report generator, milestone and handoff files.

Expected scope: update milestones, iteration history, handoff, session log, project report, run the relevant smoke gates, record remaining deferred items with reasons and resume conditions, and perform a final completion audit before marking the active goal complete.

Status: implemented. Iteration 5 completed the remaining feasible non-dogfood backlog. The durable app-server thread, provider history, and Vision resource work are implemented and smoke-covered; roadmap, milestones, iteration history, handoff, session log, and project report state now distinguish shipped work from deferred follow-up. Remaining follow-up is dogfood-dependent long-run Vision CPU/memory tuning, live Codex app-server protocol validation across CLI/app-server restarts, and browser store account submission after dogfooding.
