## Termination

- Hard terminate when `ambiguity <= 0.2`.
- Hard terminate when `roundNumber > maxRounds`.
- Soft terminate when all required dimensions have coverage `>= 0.8` and `ambiguity <= 0.3`.
- Termination opens a `phase: "consensus"` gate first. The interview is not complete until `--consensus` returns `phase: "done"`.

## Consensus Check

- Treat the consensus prompt as the last Phase 3 gate before context shard creation.
- Do not ask a vague "is this okay?" question. Present the structured agent understanding, unresolved dimensions, deferred fields, and any user corrections.
- `revise` keeps the active session open, appends the user's correction, and emits another consensus packet. User corrections override conflicting dimension summary content in the final seed.
- `defer` is allowed when the user intentionally proceeds with unresolved items; the final seed records `approved_with_deferred_items`.
- `proxy-unconfirmed` is allowed for PO-proxy finalization; downstream review/reporting should treat it as not human-approved.
