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
- `renderer-boundary.md` defines the renderer's UI-only role and the remaining
  decomposition target.
- `testing-observability.md` defines test tiers, live evidence policy, timing,
  and debug bundle requirements.
- `deprecated-plans.md` lists completed handoffs that were tombstoned after their
  current architecture content was consolidated.

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
