## Iteration iter-21: Architecture Foundation Consolidation

Status: complete.

Carryover: Iteration 20 completed the Browser Interaction Transaction pipeline, and follow-up Browser Action dogfood stabilized native helper contracts, clarification choice cards, history latency, and public-site search flows. The remaining architecture issue was that feature handoffs had become the de facto system map. Iteration 21 consolidates the current architecture into sharded durable docs and starts extracting shared foundations so future Browser, Vision, Terminal, and Desktop control work converges on one capability platform.

### iter-21-sprint-01-current-architecture-shards-and-tombstones

Goal: create durable architecture shards and tombstone completed handoffs.

Expected scope: `docs/architecture/` system map, runtime boundaries, capability transaction, prepared context, safety policy, agent tool runtime, renderer boundary, semantic interface, testing/observability, and retired plan tombstone tracking.

Status: complete. Added sharded architecture docs under `docs/architecture/`, added `docs/plans/README.md`, and consolidated completed Browser Action/Semantic handoff content into architecture shards. The old `docs/plans/deprecated/` tombstone folder was later removed to reduce dead documentation weight.

### iter-21-sprint-02-shared-foundation-modules

Goal: add shared daemon foundations without destabilizing existing Browser Action behavior.

Expected scope: capability transaction timing/debug bundle types, prepared-context identity/lease types, shared safety decision kernel, agent-tool runtime boundary, Browser Action integration, and Semantic Interface prepared-context adapter.

Status: complete. Added `src/daemon/capability-transaction/`, `src/daemon/prepared-context/`, `src/daemon/safety/`, and `src/daemon/agent-tools/`. Browser Interaction Transactions now carry shared capability snapshots and timing events, Browser Perception contexts expose a shared prepared-context projection, Browser Action safety decisions embed a shared safety decision, prompt-driven Browser Action records simulated tool invocation metadata, and failed prompt transactions record a redacted debug bundle in runtime activity. Vision TaskCapsules and Terminal state now have shared prepared-context adapters, Terminal destructive command gating uses the shared safety kernel, and the surface-control stage model documents the path toward bounded desktop control.

### iter-21-sprint-03-renderer-boundary-and-test-policy

Goal: reduce renderer orchestration pressure and codify architecture verification.

Expected scope: one low-risk renderer extraction, live artifact ignore policy, architecture smoke script, QA doc update, and smoke-all inclusion.

Status: complete. Extracted derived runtime display state from `WidgetRuntime.tsx` into `useWidgetRuntimeDerivedState`, added ignored defaults for noisy Browser Action live artifacts, added `npm run smoke:architecture-foundations`, included it in `smoke:all`, and documented the new gate in `docs/context/qa.md`.
