# Vibe Iterate Phase Sharding Safety

This document defines the guardrails for splitting
`.claude/skills/vibe-iterate/SKILL.md` into phase shards.

## Goal

Reduce `/vibe-iterate` prompt size while preserving the iteration boundary
contract: load durable state only as Orchestrator input, run the differential
interview, append a new roadmap section, update iteration history, run normal
Sprint flow, and refresh the project report without replaying full history into
Planner.

## Safety Gate

Run this before and after any `vibe-iterate` sharding change:

```bash
npm run vibe:iterate-shard-audit
```

The same gate is wired into `vibe-preflight` when the shared `vibe-iterate`
skill is present, and CI runs it before build/test.

The gate validates:

- Phases 0 through 5 each exist exactly once and appear in order.
- Critical flow signals remain present, including project report, handoff,
  session log, milestone, iteration-history, roadmap inputs, the
  Orchestrator-input-only rule, `vibe-interview.mjs --mode iterate`, carryover
  handling, roadmap append behavior, `currentIteration`, Planner isolation,
  report regeneration, `--no-open`, user follow-up, and the context isolation
  guarantee.
- If phase shard files exist under `.claude/skills/vibe-iterate/phases/`, each
  file must be listed in the main skill shard block.
- Listed shard paths must be repository-root relative, stay under
  `.claude/skills/vibe-iterate/phases/`, and must not contain `..`.

## Required Shard Block

The current shard block keeps the high-level skill identity and context
isolation guarantee in the main file, then lists all execution phases in order:

```md
<!-- BEGIN:VIBE-ITERATE:PHASE-SHARDS -->
- `.claude/skills/vibe-iterate/phases/phase-0-load-state.md`
- `.claude/skills/vibe-iterate/phases/phase-1-differential-interview.md`
- `.claude/skills/vibe-iterate/phases/phase-2-roadmap-history.md`
- `.claude/skills/vibe-iterate/phases/phase-4-sprints-report.md`
<!-- END:VIBE-ITERATE:PHASE-SHARDS -->
```

## Wrapper Injection Contract

The Codex wrapper follows explicit `*SHARDS` marker blocks in injected Markdown.
A prompt that references `.codex/skills/vibe-iterate/SKILL.md` therefore
receives the Codex wrapper, shared `.claude` skill index, and all listed phase
shards. Ordinary Markdown links are not recursively followed, so every phase
shard must stay in the explicit block.

## Fail-Closed Rules

- Do not move Phase 0 state loading or Planner isolation rules into unlisted
  files.
- Do not duplicate required phase headings between the main skill and shards.
- Do not split Phase 2 and Phase 3 apart unless the audit is updated to
  preserve exact phase order across the new shard boundary.
- Do not widen wrapper injection to allow `..` paths. Use repository-root paths.
