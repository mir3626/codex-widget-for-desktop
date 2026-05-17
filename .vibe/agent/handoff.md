# Handoff

## Current State

Codex Widget for Desktop is a Tauri + React + Node daemon desktop widget. The
daemon listens on `127.0.0.1:4128`; the renderer is served by Vite in dev.

The latest completed product work is Browser Action real-use feedback
reliability through `iter-35`. Active sprint pointer is idle. Current active roadmap file is
compacted to the current iteration only; historical roadmaps live under
`docs/plans/archive/roadmaps/`.

## Latest Update: Browser Action Real-Use Feedback Reliability

Completed `$vibe-iterate` iteration `iter-35` after reviewing the latest direct
widget debug logs.

Applied:

- Manual debug feedback now records an `outcome`
  (`success`/`failure`/`partial`/`ux_issue`/`unknown`).
- Successful and UX-only manual debug notes no longer write negative Semantic
  Memory `avoid_target` corrections; wrong-target/failure notes still do.
- Prompt Browser Action eval metrics now include `requestId`, `messageId`,
  `actionSessionId`, and `transactionId`.
- `audit-real-use-widget-session.mjs` normalizes timezone-bearing `--since`
  values to UTC and correlates debug feedback to eval runs by request ids first,
  only falling back to prompt text when the prompt is unique.
- Browser Perception now requeues a fresh observe for side-effect requests when
  the extension returns a still-mutating context instead of handing that context
  to action execution.

Verification passed:

- `npm run build:daemon`
- `node scripts/audit-real-use-widget-session.mjs --self-test`
- `node scripts/smoke-semantic-memory.mjs`
- `node scripts/smoke-browser-perception.mjs stabilization`
- `node scripts/smoke-browser-action-real-use-regressions.mjs`
- `npm run lint`
- `git diff --check`
- Actual session audit with `--since 2026-05-18T02:55:59+09:00` now normalizes
  to `2026-05-17T17:55:59.000Z` and reports 26 messages / 10 manual debug
  entries instead of an empty range.

Remaining product follow-ups:

- The broad success/eval mismatch class still needs verifier finalization work
  for navigation cases where the browser visibly changed but observation proof
  was not captured.
- Multi-step prompts such as "Gmail open then spam folder" still need prompt
  decomposition beyond a single click target.
- OS/global-hotkey conflicts and background browser chrome actions remain
  separate Windows-control improvements.

## Previous Update: Harness Sync v1.7.18

Ran `$vibe-sync` from `vibe-doctor` `v1.7.17` to `v1.7.18`.

Applied:

- Added v1.7.18 roadmap maintenance support:
  `.vibe/harness/scripts/vibe-roadmap-maintenance.mjs`,
  `.vibe/harness/test/roadmap-maintenance.test.ts`, and migration
  `.vibe/harness/migrations/1.7.18.mjs`.
- Updated harness runtime/tests/docs/skills and package/config sync metadata to
  `harnessVersion` / `harnessVersionInstalled` `1.7.18`.
- Compacted `docs/plans/sprint-roadmap.md` to the current iteration and archived
  old iteration sections under `docs/plans/archive/roadmaps/`.
- Preserved downstream project overrides after forced sync conflicts:
  Codex remains the default Orchestrator/Planner/Generator/Evaluator contract,
  Windows `run-codex.cmd` remains documented, and template hygiene tests keep
  the initialized-downstream guard.

Backup:

- `.vibe/sync-backup/2026-05-17T18-01-59-625Z`

Verification passed:

- `npm run vibe:sync-audit`
- `npm run vibe:typecheck`
- `npm run vibe:self-test` (`440` pass, `1` skip)

`node .vibe/harness/scripts/vibe-preflight.mjs` was run before commit and only
failed `git.clean` because the sync diff was intentionally uncommitted at that
point; all other sync/audit/version checks were OK, with non-blocking warnings
for stale handoff state and missing planner prompt while the sprint pointer is
idle.

## Current Resume Point

Worktree should be clean after the iter-35 commit/push. Next useful work is the
remaining Browser Action verifier/decomposition/background-control follow-up
listed above.

## Product Boundaries

- Production signing and the official app-server client-tool contract remain
  external blockers.
- VM/RDP/Windows Sandbox backends, GPU ASR, and human microphone corpus
  validation remain deferred environment/user-input work.
- Unrestricted credential flows, unattended high-risk Windows mutation, and
  authenticated browser profile/cookie access remain blocked by policy.
- Credential implementation remains reference-only for vault handles and does
  not retrieve raw secrets from Windows Credential Manager or DPAPI.
