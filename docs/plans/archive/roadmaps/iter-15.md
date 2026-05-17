## Iteration iter-15: Semantic Interface

Carryover: Iteration 14 made Browser Action prompt target extraction and actionable ranking materially better, but the logic still lives inside Browser Action. Iteration 15 follows `docs/plans/semantic-interface-handoff.md` and extracts a reusable daemon-side semantic decision boundary: normalized observations plus typed intent frames become evidence-backed hypotheses, deterministic ranking, pure safety verdicts, redacted traces, and feature-owned executable command proposals. The iteration keeps Browser Action live behavior unchanged until shadow/advisory evidence is available, then gates only low-risk Browser Action families through semantic decisions.

### iter-15-sprint-01-type-surface-golden-traces

Goal: establish the `src/daemon/semantic-interface/` module boundary with frozen v1 types, deterministic ranker, transition grammar, operating profiles, trace/replay, Browser Action adapter conversion, and a golden trace smoke.

Dependencies: `docs/plans/semantic-interface-handoff.md`, iter-14 Browser Action observations/resolver fixtures, existing TypeScript daemon build.

Expected scope: `types.ts`, `index.ts`, `ontology.ts`, `observation.ts`, `intentFrame.ts`, `hypothesis.ts`, `ranker.ts`, `safetyPredicate.ts`, `trace.ts`, `replay.ts`, `transitionGrammar.ts`, `operatingProfile.ts`, `adapters/browserActionAdapter.ts`, fixture/assertion helpers, `scripts/smoke-semantic-interface.mjs`, and `npm run smoke:semantic-interface`. Include the `개념글` ambiguity case plus duplicate-label, i18n-alias, and stale/source-mismatch fixtures.

Status: complete. Added the `src/daemon/semantic-interface/` module with v1 type contracts, ontology/version constants, deterministic hypothesis/ranking, transition grammar, operating profiles, pure safety predicates, redacted trace/replay, Browser Action adapter, fixtures/assertions, and `npm run smoke:semantic-interface`. The smoke covers the `개념글` ambiguity case, duplicate-label abstention, stale snapshot warning, redaction, replay determinism, and initial adversarial classes.

### iter-15-sprint-02-browser-action-shadow-and-redacted-traces

Goal: run semantic decisions beside prompt-driven Browser Action without changing live execution.

Dependencies: Sprint 01 semantic core, Browser Action prompt planning, Activity/report-safe trace projection.

Expected scope: bridge existing Browser Action prompt plans/observations into `IntentFrame` and `SemanticSnapshot`, produce advisory semantic traces for prompt-driven attempts, project `RedactedTraceRecord` for durable sinks, surface stale/source/adapter/redaction warnings, and expand adversarial fixtures to ARIA/visible mismatch, offscreen/occluded, dynamic-id churn, shadow DOM, and nested form scope.

Status: complete. Browser Action target resolution now runs a Semantic Interface advisory beside the existing lexical resolver when an observation is available. Redacted semantic trace metadata is attached to Browser Action safety/audit metadata, while exact/selector/focused/bbox behavior and the existing executor remain feature-owned. The golden suite now covers ARIA/visible mismatch, offscreen/occluded, dynamic-id churn, shadow DOM, and nested form scope.

### iter-15-sprint-03-vision-read-locate-conformance

Goal: prove `semantic-interface` is not Browser-only by converting Vision Context observations/capsule evidence into shared semantic snapshots and read/locate hypotheses.

Dependencies: Sprint 01 replay harness, `src/daemon/vision-context/` TaskCapsule/evidence structures.

Expected scope: `adapters/visionContextAdapter.ts`, Vision fixture replay, shared typed/untyped eval assertions for read/locate, and no core type/ranker changes required by Vision.

Status: complete. Added `adapters/visionContextAdapter.ts` plus Vision fixtures so TaskCapsule evidence converts into shared semantic snapshots and read/locate hypotheses without core type or ranker changes. `npm run smoke:semantic-interface` verifies Vision read/locate conformance.

### iter-15-sprint-04-low-risk-browser-live-gate-and-completion

Goal: selectively use semantic decisions for low-risk Browser Action flows while preserving rollback/advisory mode and closing the production semantic-interface criteria.

Dependencies: Sprints 01-03, Browser Action plan/session manager, safety policy, verification commands.

Expected scope: feature flag or mode gate, live semantic selection for read/locate/filter/local navigation only, revalidation before side-effect execution, fallback to advisory/current resolver, trace/audit evidence, docs for adapter/predicate/trace debugging, roadmap/history/session-log/project-report updates, full verification, and precise `BLOCKED` records only for out-of-scope production constraints.

Status: complete. Low-risk Browser Action target selection is gated through Semantic Interface when it clears operating-profile evidence and margin requirements; otherwise Browser Action falls back to the previous resolver/clarification path. The `개념글` fixture queues a safe extension command instead of false clarification, risky actions remain under existing Browser Action safety, and `npm run dogfood:semantic-interface` writes `docs/reports/semantic-interface-dogfood-evidence-2026-05-08.md`.
