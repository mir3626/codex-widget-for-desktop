# Vibe Sync Boundary Audit

This document defines the guardrails for `/vibe-sync` manifest and runtime
changes.

## Goal

Keep harness updates distributable without letting sync overwrite
project-owned source, context, provider settings, runtime state, product
scripts, or local CI customizations.

## Safety Gate

Run this before and after any sync manifest, sync runtime, or `/vibe-sync`
runbook change:

```bash
npm run vibe:sync-audit
```

The same gate is wired into `vibe-preflight` when sync artifacts are present,
and CI runs it before build/test.

The gate validates:

- `.claude/skills/vibe-sync/SKILL.md` still documents dry-run-first operation,
  conflict explanation, post-sync harness-only typecheck, bootstrap preflight,
  backups, flags, legacy bootstrap, upstream ref behavior, and ownership
  boundaries.
- `.vibe/harness/src/commands/sync.ts` still contains the initialization guard,
  upstream fallback, floating caret ref handling, harness-only typecheck
  selection, bootstrap preflight, backup, migration, conflict approval, and
  `--no-verify` pathways.
- `.vibe/sync-manifest.json` keeps harness runtime under `.vibe/harness/**`,
  keeps root source directories project-owned, keeps `package.json` product
  scripts/dependencies project-owned, keeps `.vibe/config.json` local provider
  and upstream fields project-owned, and uses hybrid strategies for root config
  files.
- Migration scripts stay under `.vibe/harness/migrations/`.

## Fail-Closed Rules

- Do not add `src/**`, `test/**`, `app/**`, `components/**`, `lib/**`, or
  broad `scripts/**` to `files.harness`; the only root `scripts/` exception is
  `scripts/vibe-sync-bootstrap.mjs`.
- Do not move project runtime state under `.vibe/agent/**` into harness
  ownership. Only shared rules, `.vibe/agent/README.md`, and schema files are
  harness-owned.
- Do not add root `README.md` as a full harness-owned entry. Root Markdown
  files need marker-based hybrid handling or should be left untouched.
- Do not let `package.json` harness keys include product scripts such as
  `scripts.test`, `scripts.build`, `scripts.typecheck`, `scripts.test:ui`, or
  dependency blocks.
- Do not replace the post-sync harness-only typecheck with a product-wide
  `tsc --noEmit` path when `.vibe/harness/tsconfig.harness.json` exists.
