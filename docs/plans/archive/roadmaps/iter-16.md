## Iteration iter-16: Semantic Interface View Graph and Memory Completion

Carryover: Iteration 15 made semantic target selection reusable, but live dogfood exposed two follow-up requirements: browser observations need View Graph evidence instead of flat element lists only, and repeated ambiguity/correction should become local redacted Semantic Memory rather than ephemeral failures. Iteration 16 follows `docs/plans/semantic-interface-handoff.md` and `docs/plans/semantic-memory-handoff.md`.

### iter-16-sprint-01-request-scoped-observe-and-long-poll

Goal: ensure every prompt/direct Browser Action starts from a fresh observation for that request.

Dependencies: Browser Bridge extension command channel, daemon Browser Action prompt path, provider DOM snapshot registry.

Expected scope: `/browser-action/extension/wait` long-poll endpoint, `observe_now` command, request id/active tab metadata, daemon wait path before prompt resolution, alarm-poll fallback, cancel/timeout behavior, and stale snapshot recovery messages.

Status: complete. Existing fresh-observe wait paths remain in place, and the Browser observation model now carries view identity/revision metadata used by Semantic Interface and Semantic Memory scope matching.

### iter-16-sprint-02-view-identity-spa-stability

Goal: distinguish current view changes inside the same tab/document, especially React/Vue/Next SPA route and hydration changes.

Dependencies: extension content script, Browser observation schema, Semantic Interface stale/source warning model.

Expected scope: observation identity fields, document/navigation id where available, `viewRevision`, `domRevision`, `mutationQuietMs`, route/history hooks, mutation observer, visible text digest, interactive element digest, and action-time expected view validation.

Status: complete. `BrowserViewIdentity` now records route, view revision, DOM/text/interactive digests, and mutation quiet metadata where observations provide it, with deterministic fallback hashing for tests and non-extension sources.

### iter-16-sprint-03-view-graph-schema-and-region-segmentation

Goal: represent the browser page as a semantic view graph instead of only a flat element list.

Dependencies: structured Browser Bridge observations, `src/daemon/semantic-interface`, Browser Action target resolver.

Expected scope: optional `viewGraph` on Browser observations, `ViewNode`/`ViewEdge` schema, region segmentation for header/nav/sidebar/main/modal/form/list/table, labels/same_group/filters/submits/navigates_to edge inference, and privacy-safe redaction.

Status: complete. `BrowserObservation.viewGraph` plus fallback graph construction now emits surface/region/control nodes and contains/filter/navigate edges. Semantic Interface receives view node ids, region roles, view revisions, and graph relations.

### iter-16-sprint-04-semantic-view-graph-resolution-and-dogfood

Goal: use View Graph features inside Semantic Interface and prove the live Browser Action path on dynamic pages.

Dependencies: sprints 01-03, semantic ranker/trace, Browser Action stale reobserve/retry, dogfood scripts.

Expected scope: View Graph adapter for Semantic Interface, ranking features for region/group/affordance/focus/continuity, execute-time semantic re-resolve, redacted trace explanations, dogfood report for SPA/dynamic-page prompt-driven actions, and full Browser Action/Bridge verification.

Status: complete. Semantic Interface ranker traces now include typed evidence packets, basis-point scores, candidate-generation trace, pairwise margin, and target fingerprints. `npm run smoke:semantic-interface`, `npm run smoke:browser-action`, and Browser Bridge smokes cover regression paths.

### iter-16-sprint-05-semantic-memory-storage-redaction

Goal: implement local Semantic Memory storage without turning memory into prompt-only heuristics or unsafe permissions.

Dependencies: Semantic Interface evidence packets, daemon SQLite storage, redacted trace policy.

Expected scope: memory types, redaction/hash helpers, SQLite migration, unresolved-case records, feedback events, graph weights, report/reset APIs, and secret-exclusion tests.

Status: complete. Added `src/daemon/semantic-interface/memory/`, migration `semantic_memory`, daemon `/semantic-memory/*` endpoints, and redaction coverage in `npm run smoke:semantic-memory`.

### iter-16-sprint-06-memory-readsets-and-ranker-integration

Goal: feed memory into Semantic Interface as immutable typed evidence, not as a mutable store lookup or one opaque scalar.

Dependencies: Sprint 05 memory store, Semantic Interface replay/ranker.

Expected scope: `MemoryReadSet`, result/query hashes, exclusions, typed memory axes, deterministic replay integration, and Browser Action live target-resolution read-set plumbing.

Status: complete. `replaySemanticDecision` accepts `memoryReadSet`, Browser Action live resolution reads scoped memory when enabled, and ranker scoring consumes separate memory axes for phrase, role, region, action, scope, and avoid-target evidence.

### iter-16-sprint-07-user-control-and-dogfood-evidence

Goal: provide user-visible controls and committed evidence for Semantic Memory behavior.

Dependencies: Sprints 05-06, renderer Settings panel, report generator.

Expected scope: enable/disable setting, report counts, clear-all control, dogfood evidence script/report, and durable context updates.

Status: complete. Renderer Settings exposes Semantic Memory enable/disable, report counts, refresh, and clear-all. `npm run dogfood:semantic-memory` writes `docs/reports/semantic-memory-dogfood-evidence-2026-05-09.md` plus redacted JSON support data.
