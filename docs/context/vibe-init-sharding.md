# Vibe Init Phase Sharding Safety

This document defines the required guardrails before `.claude/skills/vibe-init/SKILL.md`
is split into phase shards.

## Goal

Reduce `vibe-init` runbook size without making initialization lossy. The sharded
form must preserve the exact Phase 1 -> Phase 4 execution order and every
machine-critical branch currently carried by the monolithic skill.

## Safety Gate

Run this before and after any `vibe-init` sharding change:

```bash
npm run vibe:init-shard-audit
```

The same gate is also wired into `vibe-preflight` when the shared `vibe-init`
skill is present, and CI runs it as an explicit step before build/test.

The gate validates:

- `Phase 1`, `Phase 2`, `Phase 3`, `Phase 4`, and `중요 규칙` each exist exactly once.
- Every required Step heading exists exactly once and appears in order:
  `Step 1-0`, `Step 1-0-agent`, `Step 1-1`, `Step 2-1`, `Step 2-2`,
  `Step 2-3`, `Step 3-0` through `Step 3-5`, and `Step 4-0` through `Step 4-1`.
- Critical signals remain present, including agent-mode early stop,
  human/agent bootstrap commands, Phase 3 no-skip, consensus, review-signal
  markers, test/lint marker blocks, utility opt-in logging, roadmap logging,
  phase0 seal, sprint-mode preset, `AGENTS.md`, `.vibe/config.local.json`, and
  `docs/orchestration/providers.md`.
- If phase shard files exist under `.claude/skills/vibe-init/phases/`, each file
  must be listed in the main skill shard block.
- Listed shard paths must be repository-root relative, stay under
  `.claude/skills/vibe-init/phases/`, and must not contain `..`.

## Required Shard Block

The current shard block keeps Phase 1 in the main skill because Step 1-0 decides
whether the session continues locally or delegates to a fresh agent session.
Phase 2 through Phase 4 and the global rules are split out:

```md
<!-- BEGIN:VIBE-INIT:PHASE-SHARDS -->
- `.claude/skills/vibe-init/phases/phase-2-providers.md`
- `.claude/skills/vibe-init/phases/phase-3-interview.md`
- `.claude/skills/vibe-init/phases/phase-4-complete.md`
- `.claude/skills/vibe-init/phases/rules.md`
<!-- END:VIBE-INIT:PHASE-SHARDS -->
```

If more phases are split later, the main skill must include every shard in the
same explicit block:

```md
<!-- BEGIN:VIBE-INIT:PHASE-SHARDS -->
- `.claude/skills/vibe-init/phases/phase-1-doctor.md`
- `.claude/skills/vibe-init/phases/phase-2-providers.md`
- `.claude/skills/vibe-init/phases/phase-3-interview.md`
- `.claude/skills/vibe-init/phases/phase-4-complete.md`
- `.claude/skills/vibe-init/phases/rules.md`
<!-- END:VIBE-INIT:PHASE-SHARDS -->
```

The exact file names can differ, but the paths must be repository-root relative
and listed in execution order.

## Wrapper Injection Contract

The Codex wrapper auto-injects explicitly referenced `.claude/skills/**/*.md`
paths when they appear in stdin prompts. It also follows explicit `*SHARDS`
marker blocks in injected Markdown, so a prompt that references the main
`vibe-init` skill can still receive phase shards listed in the main skill shard
block. Ordinary Markdown links are not recursively followed. Therefore, the main
`vibe-init` skill must list every phase shard path explicitly. Do not rely on
directory discovery, glob text, or relative `../` paths in the runbook.

## Fail-Closed Rules

- Do not split Phase 3 until the audit passes on a branch with all shard paths
  listed.
- Do not move Step 1-0 or Step 1-0-agent into an optional shard; they are the
  mode gate and must be part of the mandatory execution path.
- Do not allow duplicate Step headings between the main skill and shards.
- Do not add unlisted files under `.claude/skills/vibe-init/phases/`; the audit
  treats them as process drift.
- Do not widen wrapper injection to allow `..` paths. Use repository-root paths.

## Recommended Migration Sequence

1. Add the shard block to the main skill while leaving the monolith intact.
2. Create empty or draft phase shard files and run the audit to confirm unlisted
   shard detection works.
3. Move one phase at a time, starting with Phase 4 or Phase 2. Avoid Phase 3 first.
4. After each move, run `npm run vibe:init-shard-audit`, wrapper MD injection
   diagnostic, `npm run vibe:typecheck`, and focused skill tests.
5. Only after all phase shards pass should the main skill be reduced to an index.
