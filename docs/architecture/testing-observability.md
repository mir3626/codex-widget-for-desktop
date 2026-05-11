# Testing And Observability

## Test Tiers

- Fast: TypeScript checks and pure daemon unit/smoke tests that do not launch a
  browser.
- Capability: Browser Action, Vision Context, Terminal, Semantic Interface, and
  Semantic Memory focused smokes.
- Live dogfood: real browser/site/widget runs, opt-in and redacted.
- Release: installer, bundled daemon, extension packaging, and readiness gates.

## Live Artifact Policy

Live-run artifacts are useful for debugging but should not make `git status`
noisy by default. Default output belongs in ignored live-run paths. Curated
evidence should be promoted into tracked reports only after review.

## Debug Bundle

Every failed or ambiguous capability transaction should be exportable as one
redacted bundle containing:

- prompt/request
- transaction id
- context lease identity
- candidates and score breakdown
- gate decision
- safety decision
- approval/clarification decisions
- adapter command/ack/result events
- before/after context summaries
- expected-effect verification
- timing breakdown
- redaction summary

## Timing

Latency should be measured per stage:

- request received
- context wait
- planning
- clarification/approval wait
- adapter pickup
- execution
- reobserve
- verification
- assistant response completion

