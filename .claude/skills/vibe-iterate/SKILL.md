---
name: vibe-iterate
description: Start the next project iteration after the initial Sprint roadmap is complete.
---

# vibe-iterate

Use this skill after the first Sprint roadmap is complete and the user wants to
continue the project into another iteration. The goal is to inherit prior
context through durable files while keeping each Planner call fresh-context.

## Purpose

`/vibe-iterate` creates the next iteration from the latest handoff,
`project-report.html`, and `iteration-history.json`. It carries forward open
work, accepted decisions, and new user goals without replaying old context into
Planner.

## Phase Shards

Follow these shards in order. The main file is intentionally an index plus the
context isolation guarantee so Codex wrapper injection can load the full
iteration workflow transitively.

<!-- BEGIN:VIBE-ITERATE:PHASE-SHARDS -->
- `.claude/skills/vibe-iterate/phases/phase-0-load-state.md`
- `.claude/skills/vibe-iterate/phases/phase-1-differential-interview.md`
- `.claude/skills/vibe-iterate/phases/phase-2-roadmap-history.md`
- `.claude/skills/vibe-iterate/phases/phase-4-sprints-report.md`
<!-- END:VIBE-ITERATE:PHASE-SHARDS -->

## Context Isolation Guarantee

Planner remains fresh-context per Sprint. Iteration state crosses boundaries
only through `.vibe/agent/iteration-history.json`,
`docs/reports/project-report.html`, `docs/plans/sprint-roadmap.md`, and short
Orchestrator-authored prior-sprint summaries.
