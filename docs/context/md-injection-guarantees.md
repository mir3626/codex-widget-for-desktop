# Markdown Injection Guarantees

This document lists what the Codex script wrapper can guarantee after the
wrapper injection diagnostics, skill sharding, and audit gates were added.

## Guaranteed By Script Wrapper

`run-codex.sh` guarantees Markdown injection only for stdin prompts. Use:

```bash
.vibe/harness/scripts/run-codex.sh --diagnose-md-injection -
```

or:

```bash
.vibe/harness/scripts/run-codex.sh --dry-run-md-injection -
```

The diagnostic mode does not invoke Codex. It emits JSON with each referenced
Markdown path, status, reason, and summary counts.

The wrapper can inject these path classes when they are referenced in stdin:

- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- `docs/context/*.md`
- `docs/guides/*.md`
- `docs/orchestration/*.md`
- `docs/plans/sprint-roadmap.md`
- `docs/release/README.md`
- `.vibe/agent/*.md`
- `.vibe/harness/sidecars/*.md`
- `.claude/agents/*.md`
- `.claude/skills/*.md`
- `.claude/templates/*.md`
- `.codex/skills/*.md`

The wrapper also follows explicit shard marker blocks in injected Markdown:

```md
<!-- BEGIN:*SHARDS -->
- `.claude/skills/example/sections/example.md`
<!-- END:*SHARDS -->
```

Only explicit `*SHARDS` marker blocks are recursive. Ordinary Markdown links
are not recursively injected.

## Guaranteed Skill Coverage

`npm run vibe:codex-wrapper-audit` verifies all Codex skill wrappers point to
repository-root shared runbooks and that transitive shard targets are present
and injectable.

Current wrapper target coverage:

| Skill | Guaranteed targets |
|---|---:|
| `goal-to-plan` | 2 |
| `maintain-context` | 2 |
| `self-qa` | 2 |
| `vibe-init` | 6 |
| `vibe-interview` | 6 |
| `vibe-iterate` | 6 |
| `vibe-review` | 6 |
| `vibe-sprint-mode` | 2 |
| `vibe-sync` | 2 |
| `write-report` | 2 |

Sharded skills have dedicated fail-closed audits:

- `npm run vibe:init-shard-audit`
- `npm run vibe:interview-shard-audit`
- `npm run vibe:iterate-shard-audit`
- `npm run vibe:review-shard-audit`

Boundary-sensitive skills have dedicated audits:

- `npm run vibe:sprint-mode-audit`
- `npm run vibe:sync-audit`

All of the above are wired into `vibe-preflight` and CI.

## Not Guaranteed By Script Wrapper

The wrapper intentionally does not guarantee injection for:

- Markdown paths passed only as argv text. Runtime Markdown injection applies
  to stdin prompts only; diagnostics mark argv references as
  `argv-not-injected`.
- Unsafe paths containing `..`, absolute paths, or Windows drive roots.
- Non-allowlisted Markdown paths.
- Ordinary Markdown links discovered inside injected files unless they are
  inside explicit `*SHARDS` marker blocks.
- Files loaded by a provider-native skill loader outside the wrapper path. For
  example, Codex's own skill loader may read `.codex/skills/*/SKILL.md`
  separately; wrapper injection diagnostics only describe wrapper-managed
  prompt augmentation.
- Runtime behavior that must remain synchronous. The wrapper only prepends
  Markdown context; it does not parallelize skill steps or alter execution
  ordering.

## Current Additional Improvements

These items are safe future improvements but are not required for the current
guarantee set:

- Extract the repeated `vibe-preflight` audit runner logic into a small helper
  so new audits need less boilerplate.
- Add a single `npm run vibe:audits` script that runs all wrapper, shard,
  permission, and sync boundary audits in CI order.
- Add a machine-readable committed snapshot of wrapper target counts if release
  notes need stable diffable injection coverage.
- Add optional diagnostic examples for downstream users showing exact
  `--diagnose-md-injection` prompts for each skill.
- Add skill-specific signal audits only if compact skills grow beyond simple
  two-target wrapper coverage.
