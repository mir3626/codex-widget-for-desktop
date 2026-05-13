# vibe-iterate Phase 4 - Run Sprints Normally

Each Sprint follows the existing process: Planner prompt, Codex implementation,
verification, and standard Sprint completion.

Planner must not receive `.vibe/agent/iteration-history.json`. The Orchestrator
may prepend only a short prior-sprint header such as:

```md
This is iter-<N> sprint-NN.
```

# vibe-iterate Phase 5 - Refresh Project Report

After every Sprint in the iteration is complete, ensure the project report is
fresh. The final `vibe-sprint-complete` / `vibe-sprint-commit` path already
invokes the report generator when the current roadmap or iteration is complete,
so do not run the same command again just to satisfy this phase.

If the automatic report was skipped or the report is stale, run:

```bash
node .vibe/harness/scripts/vibe-project-report.mjs
```

The regenerated `docs/reports/project-report.html` should render the cumulative
iteration timeline and milestone progress. For a silent refresh when a browser
tab is already open, use `--no-open`.

# User Follow-Up

Point the user to the report's Iteration timeline and milestone progress. Keep
`.vibe/agent/handoff.md` focused on the current iteration only; prior iteration
state belongs in `.vibe/agent/iteration-history.json`.
