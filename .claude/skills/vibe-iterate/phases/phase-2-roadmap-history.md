# vibe-iterate Phase 2 - Write Active Sprint Roadmap

The Orchestrator creates a new roadmap section from unfinished prior Sprints and
new iteration goals. Write the new current section to
`docs/plans/sprint-roadmap.md`:

```md
## Iteration iter-<N>
```

Never delete existing roadmap content unless it has first been archived under
`docs/plans/archive/roadmaps/<iter-id>.md`. The active roadmap file should hold
only the current iteration plus the current-sprint pointer block.

After Phase 3 sets `currentIteration`, run:

```bash
node .vibe/harness/scripts/vibe-roadmap-maintenance.mjs --mode start-check
```

The command is idempotent and checks for missing archive writes before compacting
`docs/plans/sprint-roadmap.md`.

# vibe-iterate Phase 3 - Update Iteration History

Append a record to `.vibe/agent/iteration-history.json` and set
`currentIteration` to the new id. Include `id`, `label`, `goal`, `startedAt`,
`plannedSprints[]`, carryover summary, and open risks or deferred items.
