# 06 - Resume And Maintenance Playbook

Status: operational playbook
Date: 2026-05-16

## Restart Procedure

When resuming this track:

1. Confirm repo root:

```powershell
pwd
```

Expected:

```text
C:\Users\Tony\Workspace\codex-widget-for-desktop
```

2. Confirm initialization:

```powershell
Test-Path docs/context/product.md
Test-Path .vibe/agent/sprint-status.json
Get-Content .vibe/agent/sprint-status.json -TotalCount 20
```

3. Inspect worktree:

```powershell
git status --short
```

4. Read this handoff pack and the domain shard for the planned slice.

5. Read the exact files before editing.

6. Implement one narrow slice.

7. Run focused verification.

8. Update docs and `.vibe/agent/*`.

9. Run `npm run vibe:checkpoint`.

## Editing Rules

- Use `apply_patch` for manual file edits.
- Do not use destructive git commands.
- Do not revert unrelated dirty changes.
- Preserve Korean/UTF-8 text.
- Keep `.cs` files BOM encoded if touched.
- Prefer `rg` for search.
- Use `multi_tool_use.parallel` for independent reads.
- Do not push unless the user explicitly asks.

## Context Files To Maintain

After meaningful architecture, sync, push, release, or long-running
implementation work, update:

- `.vibe/agent/handoff.md`
- `.vibe/agent/session-log.md`

Then run:

```powershell
npm run vibe:checkpoint
```

Session-log entries should be concise and tagged, for example:

```text
2026-05-16T12:34:56.000Z [computer-use-parity] Added watch-mode user-input abort preflight handoff and smoke plan.
```

## UTF/Mojibake Scan

For touched text files, run a scan equivalent to:

```powershell
git diff --name-only | ForEach-Object {
  if (Test-Path $_ -PathType Leaf) { $_ }
}
```

Then check for mojibake markers and replacement/question-mark corruption in
string literals. Existing project guidance references:

- `docs/context/codex-execution.md`
- `docs/context/conventions.md`

If any `.cs` file is touched, check BOM starts with `efbbbf`.

## Documentation Update Rules

When completing a slice:

1. Add a latest-update section to
   `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`.
2. Update checklist status in
   `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`.
3. If the slice changes an architecture rule, update the relevant domain shard:
   - `01-contract-session-runtime.md`
   - `02-surfaces-permissions-safety.md`
   - `03-observation-perception-action.md`
   - `04-browser-tool-terminal-slices.md`
   - `05-windows-native-helper-watch-mode.md`
   - `06-eval-debug-ux-dogfood.md`
4. If the slice changes execution order or current state, update this
   `09-approved-execution-handoff` pack.

Avoid duplicating large prose in every file. Put architecture in domain shards,
operational status in `08`, and restart/slice details in `09`.

## Final Response Rules For Future Agents

After a slice, report:

- what changed,
- files touched,
- verification run,
- known warnings,
- next recommended slice.

Keep the response concise. Do not claim global completion unless the full
completion audit has passed.

## If A Slice Is Blocked

Do not force unsafe implementation. Record:

- blocked item,
- reason,
- required external dependency or product decision,
- code boundary that prevents unsafe execution,
- smoke/gate evidence if available,
- next safe slice.

Blockers that must remain explicit:

- official app-server custom client-tool contract,
- production signing certificate/service,
- unrestricted credential flows,
- unattended high-risk Windows mutation,
- authenticated browser profile/cookie access,
- signed helper v2 for foreground desktop/file picker,
- real VM/sandbox backend,
- GPU ASR validation,
- human microphone corpus benchmark.

## Push/Commit Policy

Only push when the user asks. If asked to push:

1. Run appropriate verification first unless the user explicitly says push
   without tests.
2. Summarize dirty files.
3. Commit with the requested message if provided.
4. Push the current branch.
5. Update `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md`.
6. Run checkpoint.

## Immediate Resume Prompt For Next Session

If a future session needs a short prompt to continue:

```text
Continue the Windows Codex Computer Use parity migration in
C:\Users\Tony\Workspace\codex-widget-for-desktop. Read
docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/README.md
and related shards first. Do not mark the global goal complete. Implement the
next narrow slice inside Renderer Permission Profile UX Completion: profile
management completion or profile lifecycle evidence, keeping high-risk
history/debugger/file-upload/native/OS grants one-time or explicitly blocked.
Read 07-current-status-ledger.md before editing. Update docs, run focused
smokes, lint, smoke:all, UTF checks, and npm run vibe:checkpoint.
```
