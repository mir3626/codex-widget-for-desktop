# Vibe Review Section Sharding Safety

This document defines the guardrails for splitting
`.claude/skills/vibe-review/SKILL.md` into section shards.

## Goal

Reduce `/vibe-review` prompt size while preserving the exact review workflow:
input loading, rubric, automatic seeded checks, adapter-health blind-spot check,
and final report shape.

## Safety Gate

Run this before and after any `vibe-review` sharding change:

```bash
npm run vibe:review-shard-audit
```

The same gate is wired into `vibe-preflight` when the shared `vibe-review` skill
is present, and CI runs it before build/test.

The gate validates:

- `Protocol`, `Rubric`, `Findings Format`, `Automatic Checks`,
  `Adapter-Health Blind Spot`, and `Report Shape` each exist exactly once.
- Those headings appear in the required order.
- Critical review signals remain present, including the review input helper,
  partial-init exception, report path template, `detectOptInGaps()`,
  review-signal markers, pending restorations, bundle/browser smoke checks,
  harness-gap ledger state, pending risk rollups, wiring drift, adapter paths,
  and the `## Findings (severity desc)` report heading.
- If section shard files exist under `.claude/skills/vibe-review/sections/`,
  each file must be listed in the main skill shard block.
- Listed shard paths must be repository-root relative, stay under
  `.claude/skills/vibe-review/sections/`, and must not contain `..`.

## Required Shard Block

The current shard block keeps only the high-level skill identity in the main
file and lists all execution sections in review order:

```md
<!-- BEGIN:VIBE-REVIEW:SECTION-SHARDS -->
- `.claude/skills/vibe-review/sections/protocol.md`
- `.claude/skills/vibe-review/sections/rubric-and-findings.md`
- `.claude/skills/vibe-review/sections/automatic-checks.md`
- `.claude/skills/vibe-review/sections/report-shape.md`
<!-- END:VIBE-REVIEW:SECTION-SHARDS -->
```

## Wrapper Injection Contract

The Codex wrapper follows explicit `*SHARDS` marker blocks in injected Markdown.
A prompt that references `.codex/skills/vibe-review/SKILL.md` therefore receives
the Codex wrapper, shared `.claude` skill index, and all listed section shards.
Ordinary Markdown links are not recursively followed, so every section shard
must stay in the explicit block.

## Fail-Closed Rules

- Do not move review checks into unlisted files.
- Do not duplicate required headings between the main skill and shards.
- Do not rename `## Findings` in the report shape guidance; prior-review
  parsers accept only the documented heading forms.
- Do not widen wrapper injection to allow `..` paths. Use repository-root paths.
