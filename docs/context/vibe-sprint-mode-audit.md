# Vibe Sprint Mode Permission Audit

This document defines the guardrails for `/vibe-sprint-mode` permission preset
maintenance.

## Goal

Keep autonomous Sprint permission presets useful without silently granting
destructive operations. `vibe-sprint-mode` is small enough to remain unsharded;
the risk is permission drift between the runbook, preset JSON, and runtime
merge logic.

## Safety Gate

Run this before and after any sprint-mode preset, runbook, or runtime change:

```bash
npm run vibe:sprint-mode-audit
```

The same gate is wired into `vibe-preflight` when sprint-mode artifacts are
present, and CI runs it before build/test.

The gate validates:

- The shared skill documents both preset files, wildcard semantics,
  `permissions.deny`, critical gated operations, `.claude/settings.local.json`
  only, the session-log decision tag, and the `on --tier extended`, `on --tier
  core`, and `off` commands.
- The runtime script loads both preset files, merges `permissions.deny`,
  removes deny rules on `off`, reports active deny counts in `status`, and
  validates `--tier`.
- Preset JSON files have string-array allow and deny rules with no duplicates.
- Core preset includes required scoped npm/node/run-codex/git allow signals.
- Extended preset includes required broad command families, agent rules,
  docs/state edit scopes, and approved WebFetch domains.
- Critical operations remain guarded by deny rules or by not being allowed:
  `npm publish`, force push, hard reset, clean, force branch delete, shell
  deletion, GitHub PR/release mutation, destructive git restore/checkout/rebase
  under broad git rules, sensitive writes, and broad `gh *`.

## Fail-Closed Rules

- Do not add `Bash(git *)` without explicit deny rules for restore, checkout
  path restore, rebase, hard reset, clean, force delete, and force push.
- Do not add `Bash(npm *)` without explicit `npm publish` denies.
- Do not add broad `Bash(gh *)`; keep `gh run` and `gh api` scoped.
- Do not add `Write/Edit` rules for `src/**`, `scripts/**`, `test/**`, `.env*`,
  `secrets/**`, or `config/credentials.json`.
- Do not edit `.claude/settings.json` from sprint-mode runtime. Only
  `.claude/settings.local.json` is runtime-owned.
