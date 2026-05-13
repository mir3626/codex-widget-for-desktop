## Rubric

Primary metric: dogfood friction incident count per sprint plus delivered product
feature count.

- Blocker: sprint friction incidents >= 3 or product delivery blocked
- Friction: sprint friction incidents 1-2, or repeated Orchestrator detours
- Polish: friction 0 but UX/docs improvement needed
- Structural: future maintenance risk or architectural drift

Use uncovered rules and harness-gap ledger state as secondary signals. If
`openHarnessGapCount > 0`, `uncoveredHarnessGaps.length > 0`, or
`deadlineHarnessGaps.length > 0`, include at least one finding connected to the
ledger state.
Use `pendingRiskRollups[]` to describe repeated open lightweight-audit risks as
one consolidated process signal. Persisted pendingRisk lifecycle statuses are
`open`, `acknowledged`, `accepted`, `deferred`, `closed-by-scope`, and
`resolved`; only `open` is blocking/actionable by default.

## Findings Format

Each finding is a Markdown heading followed by this YAML block and short
evidence bullets:

```yaml
- id: review-<slug>
  severity: blocker|friction|polish|structural
  priority: P0|P1|P2|P3
  proposal: one or two sentence summary
  estimated_loc: number
  proposed_sprint: next M-number or "backlog"
```
