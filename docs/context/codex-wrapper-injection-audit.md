# Codex Wrapper Injection Audit

This document defines the guardrails for Codex skill wrapper Markdown
injection.

## Goal

Every `.codex/skills/*/SKILL.md` wrapper must inject the matching shared
`.claude/skills/*/SKILL.md` runbook through a repository-root path. If the
shared runbook has explicit `*SHARDS` marker blocks, those transitive shard
targets must also be repository-root relative, allowlisted by `run-codex.sh`,
and present in the checkout.

## Safety Gate

Run this before and after changing Codex skill wrappers or shared skill shard
markers:

```bash
npm run vibe:codex-wrapper-audit
```

The same gate is wired into `vibe-preflight` when skill directories are
present, and CI runs it before the skill-specific shard audits.

The gate validates:

- `.claude/skills/*/SKILL.md` and `.codex/skills/*/SKILL.md` have matching
  skill inventories.
- Every Codex wrapper has a `VIBE-CODEX:SHARDS` block listing the matching
  shared runbook.
- Wrapper paths do not use `../`, absolute paths, or legacy
  `../../../.claude/...` references.
- Transitive shard references declared in explicit `*SHARDS` blocks exist and
  are injectable by the same path allowlist used by `run-codex.sh`.
- Compact runbooks such as `goal-to-plan`, `maintain-context`, `self-qa`,
  `vibe-sprint-mode`, and `write-report` remain two-target injections:
  wrapper plus shared runbook.

## Runtime Diagnostic Coverage

`run-codex-wrapper.test.ts` also exercises the real
`run-codex.sh --diagnose-md-injection` path for:

- sharded skills: `vibe-init`, `vibe-interview`, `vibe-iterate`, `vibe-review`
- boundary-audited skills: `vibe-sync`
- compact skills: `goal-to-plan`, `maintain-context`, `self-qa`,
  `vibe-sprint-mode`, `write-report`

This keeps the static audit and the actual wrapper behavior aligned.

## Fail-Closed Rules

- Do not use relative parent traversal in Codex wrappers.
- Do not rely on ordinary Markdown links for transitive shard injection; only
  explicit `*SHARDS` marker blocks are followed.
- Do not add a new shared skill without adding the matching Codex wrapper and
  passing this audit.
