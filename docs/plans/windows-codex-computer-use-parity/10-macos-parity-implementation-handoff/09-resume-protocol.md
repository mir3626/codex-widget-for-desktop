# 09 - Resume Protocol

## First Rule

Do not restart from scratch. This repo already contains extensive Computer Use
foundation code, dogfood artifacts, and handoff shards.

For the shortest context-loss restart path, read
`docs/plans/windows-codex-computer-use-parity/README.md` before this file. It
summarizes the current stable boundary, verification ladder, external
blockers, and shard map.

## Mandatory Startup Checks

Run or inspect:

```powershell
git status --short
Get-Content docs/context/product.md -TotalCount 40
Get-Content .vibe/agent/sprint-status.json -TotalCount 40
```

If `docs/context/product.md` is missing or `.vibe/agent/sprint-status.json`
does not name `codex-widget-for-desktop`, stop and run the proper `vibe-init`
workflow. Do not do product work in an uninitialized clone.

## Dirty Worktree Rule

The worktree may be intentionally dirty. Never revert unrelated changes.

Before editing a file:

```powershell
git diff -- <path>
Get-Content <path> -TotalCount 200
```

Work with user/generated changes. Only ask when conflicting changes make the
task impossible.

## Latest Completed Slice Warning

At the time this handoff was first written, the likely next implementation
slice was Browser Chrome repeated dogfood. That fixture-bridge slice is now
completed and promotion-gate tracked. A later slice added real Browser Bridge
extension local-fixture dogfood, and the latest slice added repeated
public-site real-extension dogfood for download verification, fixed
print-to-PDF, bounded tab group claim/update/release, one-time redacted history
search, and bounded permission get/set/rollback on a fresh dogfood browser
profile, plus multi-tab tab-group claim/update/release over explicit
dogfood-owned public tab ids, plus file-upload inspect/set/clear on a public
unauthenticated file input without submitting the form. The permission dogfood
now covers camera, microphone, and location contentSettings with rollback. The
same collector also proves live profile approval by blocking no-profile
Browser Chrome startup with exact missing grants, attaching a narrow one-time
profile, and reusing that profile for the public extension commands.

Relevant files may already exist:

- `scripts/collect-computer-use-browser-chrome-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-dogfood.mjs`
- `docs/dogfood/computer-use-browser-chrome-dogfood-2026-05-16.json`
- `docs/reports/computer-use-browser-chrome-dogfood-2026-05-16.md`
- `docs/reports/assets/computer-use-browser-chrome-dogfood-2026-05-16/evidence.json`
- `docs/reports/assets/computer-use-browser-chrome-dogfood-runs.jsonl`
- `scripts/collect-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `docs/dogfood/computer-use-browser-chrome-live-extension-2026-05-16.json`
- `docs/reports/computer-use-browser-chrome-live-extension-2026-05-16.md`
- `docs/reports/assets/computer-use-browser-chrome-live-extension-2026-05-16/evidence.json`
- `docs/reports/assets/computer-use-browser-chrome-live-extension-runs.jsonl`
- `scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `docs/dogfood/computer-use-browser-chrome-public-extension-2026-05-16.json`
- `docs/reports/computer-use-browser-chrome-public-extension-2026-05-16.md`
- `docs/reports/assets/computer-use-browser-chrome-public-extension-2026-05-16/evidence.json`
- `docs/reports/assets/computer-use-browser-chrome-public-extension-runs.jsonl`

Resolved issue:

- The collector previously marked otherwise valid samples as failed because it
  expected a `close_surface` rollback action and an older `browser_chrome` eval
  step kind.
- Regular browser-extension Browser Chrome sessions now reconcile cleanup by
  session cancellation when no isolated surface exists.
- Eval proof now accepts the current `browser_chrome_observation` step linked
  to the capability job id.

Next browser-chrome work should collect real extension live samples, not repeat
the fixture-bridge proof unless it regresses. The local-fixture real-extension
collector is now the baseline for actual extension execution, and the
public-extension collector is the baseline for promotion-grade public-site
download/print-to-PDF/tab-group/history/permission-matrix/multi-tab/file-upload/
profile-approval evidence. Next Browser Chrome work should move to
file-picker/native picker selection after signed helper v2, browser permission
bubble recovery, or release-signing readiness. The renderer already has a
public-extension proof panel for repeated sample count, p95, host coverage,
profile approval, command-family coverage, permission matrix, and redaction
proof. Do not change
verifier/action logic just to fix collector outcomes unless evidence shows the
underlying operation actually failed.

Release-signing readiness has an additional hardened preflight slice:
`npm run sign:browser-native-desktop-helper` writes a redacted
`browser-native-desktop-helper-signing.v1` report with helper hash/provenance,
signature status, signing method metadata, and no certificate password or
absolute local path leakage. `CODEX_WIDGET_SIGNING_DRY_RUN=1` exercises that
path without mutating the helper. The smoke
`npm run smoke:browser-native-desktop-helper:signing-readiness` proves
development-mode deferral and strict-mode blocking when no Authenticode
certificate or CI signing service is configured. This still does not complete
the external production signing blocker.

Native browser permission-bubble recovery also has an explicit blocked
Computer Session boundary now. Use `browser_permission_bubble_action` for the
native-click route; it must fail with
`browser_permission_bubble_helper_v2_not_available`, `actualInputSent: false`,
`nativePopupClick: false`, and `permissionChanged: false` until signed
watch-mode helper v2 exists. The smoke
`npm run smoke:computer-use-native-watch-boundary` and the
`windows_native_watch_boundary` promotion gate verify the debug-bundle,
eval/verifier, rollback, and failure-memory evidence for this non-promoting
boundary.

The renderer Computer Use promotion section now has two dedicated proof panels:
public Browser Chrome extension proof and native boundary proof. The native
panel renders daemon-owned `windows_native_watch_boundary` metrics for
foreground input, native file picker, browser permission popup, and signing
guard status. Keep future UX changes tied to daemon gate metrics instead of
inferring hidden runtime state in the renderer.

Native helper status now has a machine-readable helper-v2 capability manifest.
The Rust helper emits
`browser-native-desktop-helper-capability-manifest.v2` from `status`, and the
daemon native adapter propagates it under `helperCapabilities` plus
`helperV2Boundary`. Treat this as discovery/evidence only: the manifest keeps
foreground desktop watch, native file picker, and browser permission-popup
native-click execution blocked with `nativeInputEnabled: false` until signed
helper v2 is implemented and release-signed.

Foreground watch preflight is also a shared protocol contract now. Read
`ForegroundWatchPreflightState` in `src/shared/protocol/computerUse.ts` before
changing watch-mode code. The runtime and smoke must keep target identity,
surface lock, timeout, user-input abort, and active-window drift checks visible
in DAG/eval/debug evidence, and must keep `actualInputSent: false` for every
blocked preflight.

The renderer native boundary proof panel also shows the preflight contract and
drift-abort proof. Keep that panel driven by daemon promotion-gate metrics
(`foregroundPreflightContractPresent`, `activeWindowDriftSmokePresent`) rather
than by renderer inference.

Rust helper status diagnostics now include an observe-only helper-side
`watch_preflight` path. It uses UIA active-window/process identity plus Win32
last-input age and returns `foreground-watch-preflight.v1` evidence through
daemon `helperWatchPreflight`. This is still not signed helper v2 continuous
monitoring; do not promote foreground input from this evidence alone.

`watch_preflight` can optionally run bounded dry-run monitoring when passed
`watchPreflight.monitorMs`. The daemon status path uses a short dry run and
surfaces `helperSideContinuousMonitorPresent`. This proves monitoring evidence
plumbing only; real countdown/execution monitoring still belongs in signed
helper v2.

Release readiness now also probes the built helper contract before evaluating
the separate signing/manual gate. The helper contract probe writes
`browser-native-desktop-helper-contract-readiness.v1` evidence for manifest v2,
watch preflight schema, helper-side guard schema, bounded monitor samples,
disabled `foreground_watch_execute` executor proof, and
`actualInputSent: false`; `npm run release:readiness` surfaces it as
`browser-native-helper-contract`. The disabled executor contract is not a
promotion signal; it proves the future command shape remains off until signed
helper v2 and release gates exist. Computer Session blocked foreground actions
also emit the same `foregroundWatchExecutor` state in DAG/debug-bundle
evidence, so session-runtime evidence and helper-release evidence can be
compared directly.

Use `npm run audit:computer-use-parity` before any attempted completion claim.
It generates a prompt-to-artifact checklist for the handoff files, protocol and
runtime surfaces, perception/action evidence, Browser/Toolsmith/Terminal
slices, native watch boundaries, eval/debug UX, promotion gates, and verification
commands. The report is evidence-oriented: `guarded` means an intentionally
non-promoting safety boundary is present, not that native execution is complete.

Implementation caveats from the real-extension collector:

- Attach WebSocket `open`/`error` listeners immediately after socket creation.
  Browser launch is slow enough that late listeners can miss the `open` event.
- Use `Browser.setDownloadBehavior` through CDP so extension
  `chrome.downloads.download()` writes into the approved smoke output root.
- Wait for `download.observe` to report `complete` before `download.verify`;
  Chrome can briefly report `in_progress` after bytes are fully received.
- After extension popup refreshes, bring the target page back to front and pass
  the allowed `activeTab.tabId` into fixed-command debugger operations.

## Documentation Update Rules

After a meaningful slice, update:

- the relevant domain shard in `docs/plans/windows-codex-computer-use-parity/`,
- `09-approved-execution-handoff/07-current-status-ledger.md`,
- this `10-macos-parity-implementation-handoff` pack if the architecture or
  backlog changes,
- `.vibe/agent/handoff.md`,
- `.vibe/agent/session-log.md`.

Then run:

```powershell
npm run vibe:checkpoint
```

## Encoding Rules

Before final response for code/doc edits:

- Verify touched files are UTF-8.
- Scan touched files for mojibake.
- If any `.cs` file is touched, verify BOM starts with `efbbbf`.

Known `git diff --check` CRLF warnings may appear for already-dirty files:

- `.vibe/agent/session-log.md`
- `src/daemon/server.ts`
- `src/daemon/storage/storage.ts`

Treat those as non-failing only if no new whitespace error is introduced.

## Safe Verification Ladder

For docs-only changes:

```powershell
git diff --check
npm run vibe:checkpoint
```

For daemon Computer Use changes:

```powershell
npm run build:daemon
npm run smoke:computer-use-session
npm run smoke:computer-use-session-http
npm run smoke:computer-use-debug-bundle
npm run smoke:computer-use-promotion-gate
```

For renderer Computer Use changes:

```powershell
npm run build:renderer
npm run smoke:renderer-computer-use-live-refresh
npm run smoke:renderer-computer-use-profile-draft
npm run smoke:renderer-computer-use-browser-chrome-evidence
npm run smoke:renderer-chat
```

For full boundary:

```powershell
npm run lint
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

## External Blockers

Keep these as blockers:

- official app-server custom client-tool contract,
- production signing certificate/service,
- unrestricted credential flows,
- authenticated browser profile/cookie access as generic substrate,
- signed helper v2 for foreground native input and native file picker,
- real VM/sandbox backend,
- GPU ASR validation,
- human microphone ASR corpus benchmark.

Do not mark any of these complete because a mock, fixture, or blocked boundary
smoke exists.
