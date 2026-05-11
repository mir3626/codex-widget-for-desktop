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

Browser Action publishes this information to the renderer through
`browserAction.diagnostics` for non-completed prompt transactions. The event is
diagnostic-only: it may include timing summaries, redacted debug bundle metadata,
transaction/request ids, and plan status, but it must not persist full page
state or sensitive field values.

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

## Semantic Trace Corpus

`docs/dogfood/semantic-trace-corpus.jsonl` is the deterministic seed corpus for
Semantic Interface calibration. `npm run smoke:semantic-trace-corpus` verifies
that the corpus maps to golden trace cases, covers the suite, and keeps current
pass/fail metrics at the expected baseline. Real dogfood traces should be
reviewed and redacted before promotion into this corpus.
