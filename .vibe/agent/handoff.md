# Handoff

## Current State

Codex Widget for Desktop is a Tauri + React + Node daemon desktop widget. The
daemon listens on `127.0.0.1:4128`; the renderer is served by Vite in dev.

The latest completed product work is the Computer Use parity improvement batch
through `iter-34`. Active sprint pointer is idle. Current active roadmap file is
compacted to the current iteration only; historical roadmaps live under
`docs/plans/archive/roadmaps/`.

## Latest Update: Harness Sync v1.7.18

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

Commit and push the v1.7.18 sync after final checkpoint, encoding checks, and a
clean-worktree preflight rerun.

## Product Boundaries

- Production signing and the official app-server client-tool contract remain
  external blockers.
- VM/RDP/Windows Sandbox backends, GPU ASR, and human microphone corpus
  validation remain deferred environment/user-input work.
- Unrestricted credential flows, unattended high-risk Windows mutation, and
  authenticated browser profile/cookie access remain blocked by policy.
- Credential implementation remains reference-only for vault handles and does
  not retrieve raw secrets from Windows Credential Manager or DPAPI.
