## Iteration iter-20: Browser Interaction Transaction

Status: complete.

Carryover: Iteration 19 completed Browser Perception, but live Browser Action dogfood still shows that resolver-first prompt handling is not enough for universal natural-language browser control. This iteration follows `docs/plans/browser-interaction-transaction-handoff.md` and records that Browser Action must move from direct prompt-to-resolver execution to a request-scoped transaction with fresh view leases, finite candidates, clarification, stepwise binding, and expected-effect verification.

### iter-20-sprint-01-transaction-and-lease-foundation

Goal: add the request-scoped Browser Interaction Transaction type surface and lease helpers without replacing existing Browser Action sessions or Browser Perception internals.

Expected scope: `BrowserInteractionTransaction`, `BrowserViewContextLease`, lease validity/revocation helpers, transaction manager, per-active-tab concurrency/cancel model, and smoke coverage for lease validity and stale candidate invalidation.

Status: complete. Added `src/daemon/browser-action/interaction/` with transaction and lease type surfaces, lease freshness/compatibility helpers, a transaction manager, and active-tab supersession semantics. The new core smoke verifies generated lease ids, lease-scoped candidates, and transaction ownership.

### iter-20-sprint-02-intent-candidate-and-planning-gate

Goal: convert prompt/direct Browser Action requests into finite candidate steps before target grounding.

Expected scope: reuse/adapt Semantic Interface `IntentFrame`, generate `CandidateStep`/`CandidateActionProposal` from Browser View Graph v2 affordances, add deterministic proceed/clarify/approval/block gate decisions, preserve exact safe shortcuts, and add Korean/locale labels plus expected effects.

Status: complete. Added `IntentFrame` construction from Browser Action requests, finite `CandidateStep` generation from the current element graph/View Graph evidence, Korean labels, expected-effect contracts, and a deterministic planning gate that clarifies ambiguous side-effect candidates instead of falling through to generic resolver failure.

### iter-20-sprint-03-prompt-direct-and-clarification-integration

Goal: route prompt-driven, direct UI, and clarification-resume Browser Action paths through the same transaction pipeline.

Expected scope: update prompt runner, prompt plan/tool boundaries, direct action command handling, and clarification resume so selected candidates are rebound against a fresh before-step lease rather than a stale latest DOM snapshot.

Status: complete. Prompt runner, direct UI command handling, prompt plan continuation, and clarification resume now pass transaction and lease metadata through the Browser Action execution path. Clarification resume reacquires fresh Browser Perception context before executing the selected candidate instead of blindly using the latest DOM snapshot.

### iter-20-sprint-04-stepwise-binding-and-verification

Goal: make resolver a late execution-binding/revalidation component and verify expected effects after every action.

Expected scope: execution binding metadata, before-step revalidation, after-step reobserve, effect-specific verification for route/list/content/field/select/focus/scroll/history/no-submit cases, and failure behavior when an observation refresh does not prove the intended effect.

Status: complete. Browser Action execution now prefers the transaction lease observation, records transaction metadata on results, keeps resolver use as late grounding/revalidation, and verifies expected route/query/content/field/selection/focus/scroll/history/no-submit effects. The transaction verification smoke proves a wrong click can fail even when an observation refresh succeeds.

### iter-20-sprint-05-memory-feedback-dogfood-and-completion

Goal: publish redacted transaction feedback, prove the new transaction behavior with smokes and dogfood, and refresh durable context.

Expected scope: Semantic Memory advisory feedback, transaction diagnostics, smokes for clarification, verification, concurrency/cancel, memory advisory limits, updated Browser Action dogfood evidence, project report refresh, checkpoint, and live daemon/widget restart.

Status: complete. Transaction feedback is published to Semantic Memory as redacted advisory evidence, new package scripts cover transaction core/clarification/verification/concurrency smokes, Browser Action dogfood evidence was refreshed for 2026-05-10, and durable context/report/checkpoint updates were prepared for iter-20 closure.
