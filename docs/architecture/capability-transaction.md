# Capability Transaction Architecture

## Purpose

The widget needs one common execution model for Browser Action, Vision Context,
Terminal, and future Windows desktop control. Browser Action exposed the key
lesson: resolver-first prompt handling cannot cover universal natural-language
control. Every action-capable feature should instead use a request-scoped
transaction.

## Standard Flow

```text
request
-> acquire prepared context lease
-> frame intent
-> generate finite candidates
-> gate
-> clarify / approve / block / proceed
-> bind late against current context
-> execute typed action
-> reobserve
-> verify expected effect
-> publish redacted feedback
```

## Shared Terms

- Capability transaction: one request-scoped unit of work with timing,
  evidence, safety, execution, verification, and audit metadata.
- Context lease: revocable claim over a prepared context revision.
- Candidate proposal: finite possible action or interpretation grounded in
  current evidence.
- Gate decision: deterministic proceed, clarify, approve, abstain, or block.
- Late binding: resolving the selected proposal immediately before execution,
  after freshness and safety checks.
- Expected-effect verification: checking the intended effect, not merely that a
  new observation arrived.

## Browser Action Mapping

Browser Action currently maps to this model through:

- `BrowserInteractionTransaction`
- `BrowserViewContextLease`
- `IntentFrame`
- `CandidateStep`
- `PlanningGateDecision`
- `ExecutionBinding`
- `VerificationClaim`

These concepts should remain Browser-specific at the edge but use shared daemon
types/utilities for timing, redacted debug bundles, safety subject metadata,
context identity, and audit summaries.

## Future Surfaces

- Vision Context should expose TaskCapsule evidence as prepared visual context.
- Terminal should expose command/output state as prepared terminal context.
- Desktop control should expose a desktop UI graph as prepared desktop context.
- App-server tools should enter through the same transaction boundary instead of
  creating hidden side effects.

