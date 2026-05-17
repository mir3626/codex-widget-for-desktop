# vibe-iterate Phase 0 - Load State

The Orchestrator reads:

- `docs/reports/project-report.html` (latest report)
- `.vibe/agent/handoff.md`
- `.vibe/agent/session-log.md`
- `docs/plans/project-milestones.md`
- `.vibe/agent/iteration-history.json`
- the previous iteration section in `docs/plans/archive/roadmaps/<iter-id>.md`
  when present, otherwise the previous section in `docs/plans/sprint-roadmap.md`

This state is Orchestrator input only; do not inject the full history into
Planner prompts.
