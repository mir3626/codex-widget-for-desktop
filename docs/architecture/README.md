# Current Architecture

This directory is the durable architecture map for Codex Widget for Desktop.
Sprint handoffs remain useful historical artifacts, but the current system shape
is defined here.

## Shards

- `runtime-boundaries.md` describes process, daemon, renderer, storage, and
  provider ownership.
- `capability-transaction.md` defines the shared observe/plan/act/verify
  transaction model that Browser Action, Vision Context, Terminal, and future
  desktop control should converge on.
- `prepared-context.md` defines the shared prepared-context and lease model used
  to avoid prompt-time stale snapshots.
- `safety-policy.md` defines the shared safety, approval, redaction, and audit
  boundary.
- `agent-tool-runtime.md` defines the boundary between natural-language prompts,
  daemon-simulated tools, and future app-server client tools.
- `semantic-interface.md` defines the source-agnostic semantic evidence and
  memory boundary.
- `surface-control.md` defines the long-term shared control model for Browser,
  Vision, Terminal, Workspace, and bounded Desktop automation.
- `research-performance-architecture.md` defines the implemented eval ledger,
  ASR deterministic decoder, perception graph, ROI cascade, structured failure
  memory, and capability DAG scheduler architecture.
- `../plans/scoped-autonomy-toolsmith-runtime-handoff.md` defines the
  permission-scoped Toolsmith path for missing capability detection, reviewed
  generated tool materialization, smoke-before-execute gating, and eval-backed
  artifact production.
- `renderer-boundary.md` defines the renderer's UI-only role and the remaining
  decomposition target.
- `testing-observability.md` defines test tiers, live evidence policy, timing,
  and debug bundle requirements.
- `open-blockers.md` records external-contract or asset-quality blockers that
  should not be silently treated as complete.
- `deprecated-plans.md` lists retired handoff tombstones that were removed after
  their current architecture content was consolidated.

## Current Direction

The product has moved from single feature implementation toward a local
capability platform. The common control loop is:

```text
User intent
-> prepared context lease
-> semantic evidence
-> finite candidate proposals
-> deterministic gate
-> clarification or approval when needed
-> late binding
-> typed execution
-> reobserve
-> expected-effect verification
-> redacted memory and audit feedback
```

Browser Action is the most complete implementation of this loop today. Vision
Context already has the prepared-context side through TaskCapsules. Terminal and
future Windows desktop control should use the same transaction, safety,
observability, and memory foundations instead of growing parallel ad hoc paths.
The research performance architecture is now the shared measurement and
calibration layer for those surfaces. Scoped autonomy builds on that substrate
by letting the daemon implement a missing workflow only inside a pre-granted
permission profile and only after the generated tool passes smoke tests.
