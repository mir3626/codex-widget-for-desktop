# Sidecar Agents

Sidecars are advisory-only review agents that run in fresh context after a
Generator produces a diff. They reduce Orchestrator blind spots without changing
the single-writer contract.

## Contract

- External sub-agent collections are reference material only. vibe-doctor
  sidecars must use this sealed-packet, wrapper-owned artifact contract instead
  of inheriting broad PR-reviewer prompts that read the whole repository or write
  review comments directly.
- Orchestrator remains the only writer for durable state:
  `.vibe/agent/handoff.md`, `.vibe/agent/session-log.md`,
  `.vibe/agent/sprint-status.json`, roadmap/report files, commits, tags, pushes,
  and user-facing decisions.
- Sidecars do not edit files and do not create artifacts directly.
- The wrapper sends a sealed input packet to the sidecar and accepts stdout JSON
  only.
- The wrapper validates sidecar stdout against the sidecar schema and writes
  non-durable artifacts under `.vibe/sidecars/artifacts/<sprintId>/`.
- The wrapper owns packet coverage and sealed-packet integrity. Reviewer stdout
  cannot change coverage counters, clear truncation flags, or override the
  packet hash.
- Sidecars receive redacted/omitted placeholders for sensitive paths. Untracked
  file contents are omitted by default, and non-text or unsafe-control content is
  still omitted when untracked content is explicitly included for local debugging.
- Sidecar `status: "fail"` is still advisory. It means "high-severity finding
  reported"; the Orchestrator decides rework, escalation, or rejection.
- `timeout`, non-zero exit, parse failure, schema mismatch, or semantic status
  mismatch is recorded as `unavailable` or `error`, never as pass.

## Current Sidecar

### `diff-reviewer`

Provider adapters:

- `.codex/agents/diff-reviewer.toml`
- `.claude/agents/diff-reviewer.md`

Canonical prompt:

- `.vibe/harness/sidecars/diff-reviewer.md`

Wrapper:

```bash
npm run vibe:sidecar-run -- diff-reviewer --sprint-id <sprint-id>
```

Useful options:

- `--provider claude|codex|auto` (default: `auto`, from `.vibe/config.json.orchestrator`)
- `--prompt-file docs/prompts/<sprint>.md`
- `--importance critical` (uses `xhigh`; default effort is `high`)
- `--effort high|xhigh`
- `--timeout-ms 120000`
- `--input-file <packet.json>` (hash is recomputed before execution)
- `--include-untracked-content` (local debugging only; default omits untracked
  contents)

`--input-file` packets are immutable sealed inputs. The wrapper rejects saved or
hand-edited packets when `inputHash` no longer matches the packet body. Regenerate
the packet instead of editing it in place.

Artifacts are intentionally ignored by git:

```text
.vibe/sidecars/artifacts/<sprint-id>/diff-reviewer.json
```

## First-Sprint Operating Rule

Sidecar execution is manual only. `vibe-sprint-complete`, `vibe-sprint-commit`,
preflight, dashboard, and `/vibe-review` do not invoke or consume sidecar
artifacts in the foundation release.

The Orchestrator may cite accepted sidecar findings in durable state, but only
after explicit triage. The wrapper must not append to handoff or session-log.

## Follow-Up Backlog

Future sidecar work is intentionally gated by dogfood:

- `wiring-reviewer`: review script/docs/path/provider/context-pointer wiring
  only. Start as gated shadow after `diff-reviewer` proves stable.
- `test-auditor`: check test intent and missing regression coverage without
  running commands.
- `evidence-reviewer`: inspect screenshot/playthrough/semantic acceptance
  evidence for experiential or workflow-agent features.
- Command sidecars: run tests/audits with isolated outputs. Deferred until
  artifact-only sidecars prove useful.
- Report/handoff draft sidecars: deferred because they pressure durable state
  ownership.
- Write-capable sidecars and parallel Generator lanes: deferred until the
  separate lane/worktree model exists.
- `/vibe-review` sidecar rollup: deferred until at least three dogfood runs have
  stable artifact schema and useful signal.

Dogfood gate before adding any new sidecar:

- no direct sidecar writes
- no stale artifact reuse
- visible timeout/error handling
- accepted findings tracked by Orchestrator triage
- false-positive rate and triage burden remain acceptable
