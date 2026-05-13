# vibe-iterate Phase 2 - Append Sprint Roadmap

The Orchestrator creates a new roadmap section from unfinished prior Sprints and
new iteration goals. Append the section to `docs/plans/sprint-roadmap.md`:

```md
## Iteration iter-<N>
```

Never overwrite existing roadmap content. Prior iteration sections are the
project record.

# vibe-iterate Phase 3 - Update Iteration History

Append a record to `.vibe/agent/iteration-history.json` and set
`currentIteration` to the new id. Include `id`, `label`, `goal`, `startedAt`,
`plannedSprints[]`, carryover summary, and open risks or deferred items.
