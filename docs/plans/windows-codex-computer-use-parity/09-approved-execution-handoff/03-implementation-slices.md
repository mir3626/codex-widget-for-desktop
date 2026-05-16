# 03 - Ordered Implementation Slices

Status: executable backlog
Date: 2026-05-16

## How To Use This File

Implement one vertical slice at a time. For each slice:

1. Read the listed source files before patching.
2. Preserve existing behavior and dirty worktree changes.
3. Implement behind the existing safety boundaries.
4. Add or strengthen smoke coverage.
5. Update parity docs and `.vibe/agent/*`.
6. Run focused verification plus checkpoint.

Do not widen a slice just because adjacent code is visible.

## Slice 1 - Foreground Watch-Mode User-Input Abort Preflight

Status: implemented on 2026-05-16

### Problem

Phase 11 requires "User input aborts action." Current runtime blocks broad
visual desktop actions before native input because helper v2/watch-mode is not
available. That is safe, but it does not yet prove the explicit abort-on-user-
input preflight path.

Implementation update:

- `visual_desktop_action` now accepts optional `watchPreflight` metadata.
- Runtime normalizes it to `foreground-watch-preflight.v1`.
- `abortOnUserInputArmed` plus `userInputDetected` blocks with
  `foreground_watch_user_input_abort`.
- Active-window drift blocks with `foreground_watch_active_window_drift_abort`.
- Debug bundle, verifier, failure memory, smoke, and promotion gate all record
  the boundary while keeping `actualInputSent: false`.

### Goal

Add a non-executing preflight evaluator that can record and smoke-test:

- visible countdown armed,
- active-window assertion,
- process allowlist assertion,
- user idle state,
- user input detected,
- abort-on-user-input armed,
- active-window drift detected,
- signed helper v2 availability,
- effect verifier readiness,
- rollback proof readiness,
- and `actualInputSent: false`.

This must still block before native input. It must not enable foreground
desktop mutation.

### Candidate Files

- `src/shared/protocol/computerUse.ts`
- `src/daemon/computer-use/sessionRuntime.ts`
- `scripts/smoke-computer-use-native-watch-boundary.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- `docs/plans/windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md`
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
- `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`

### Suggested Protocol Shape

Extend visual desktop operations with optional preflight metadata:

```ts
| {
    kind: "visual_desktop_action";
    action: ComputerAction;
    watchPreflight?: Record<string, unknown>;
  }
```

Keep the field optional so all existing callers remain valid.

### Suggested Runtime Behavior

In `executeVisualDesktopWatchOperation`:

1. Read `operation.watchPreflight`.
2. Normalize booleans conservatively:
   - missing `signedHelperV2Available` defaults false,
   - missing `actualInputSent` defaults false,
   - missing user-idle proof must not imply safe execution.
3. Choose reason:
   - `foreground_watch_user_input_abort` when user input is detected and
     abort-on-user-input is armed,
   - `foreground_watch_active_window_drift_abort` when active-window drift is
     detected,
   - existing `foreground_watch_mode_v2_not_available` when no preflight abort
     applies and helper v2 is unavailable,
   - existing surface-required reason when the wrong surface is selected.
4. Record safety decision with `phase: "foreground_watch_preflight"` or preserve
   `foreground_watch_preconditions` while adding a nested preflight object.
5. Record observation metadata:
   - `source: "foreground_watch_preflight"` or existing boundary source with
     preflight details,
   - `actualInputSent: false`,
   - `userInputDetected`,
   - `activeWindowDriftDetected`,
   - `abortOnUserInputArmed`,
   - `signedHelperV2Available: false`.
6. Add verifier failure and failure-memory trigger for the specific abort
   reason.
7. Ensure no `desktop_action` capability job is enqueued.

### Smoke Expectations

Extend `scripts/smoke-computer-use-native-watch-boundary.mjs`:

- keep the existing `foreground_watch_mode_v2_not_available` blocked action,
- add a second `visual_desktop_action` with:
  - `watchPreflight.visibleCountdownArmed = true`,
  - `watchPreflight.activeWindowAsserted = true`,
  - `watchPreflight.processAllowed = true`,
  - `watchPreflight.abortOnUserInputArmed = true`,
  - `watchPreflight.userInputDetected = true`,
  - `watchPreflight.actualInputSent = false`,
  - `watchPreflight.signedHelperV2Available = false`.
- assert the result reason is `foreground_watch_user_input_abort`.
- assert debug bundle safety decision and observation include the preflight.
- assert `actualInputSent === false`.
- assert no `desktop_action` capability job exists.
- assert follow-up DAG verifier/eval/rollback/failure-memory nodes exist.

### Promotion Gate

Strengthen `windows_native_watch_boundary` gate:

- check source includes `foreground_watch_user_input_abort`,
- check smoke source includes that reason and `userInputDetected`,
- add metrics:
  - `userInputAbortGuardPresent`,
  - `userInputAbortSmokePresent`,
  - `actualInputStillBlocked`.

The gate remains passed but non-promoting.

### Verification

Run:

```powershell
node --check scripts/smoke-computer-use-native-watch-boundary.mjs
npm run build:daemon
npm run smoke:computer-use-native-watch-boundary
node --check scripts/gate-computer-use-promotion.mjs
node --check scripts/smoke-computer-use-promotion-gate-route.mjs
npm run smoke:computer-use-promotion-gate
npm run gate:computer-use-promotion
npm run smoke:computer-use-promotion-gate-route
npm run lint
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

Also run UTF/mojibake scan for touched text files.

### Acceptance

- User-input abort is executable as a preflight boundary.
- No foreground native input is sent.
- Debug bundle explains the abort.
- Promotion gate verifies the boundary.
- Docs say helper v2 remains blocked.

## Slice 2 - Renderer Permission Profile UX Completion

Status: mostly implemented on 2026-05-16; live dogfood and deeper profile
policy audit remain continuous work

### Problem

Profiles and blocked-grant derivation exist, but the UX must become strong
enough for scoped YOLO/computer-use approval flows:

- view/select profiles,
- create one-time narrow profiles from blocked runs,
- show exact missing grants,
- explain risk class,
- show expiration/disable state,
- avoid accidental broad grants.

Implementation update:

- Blocked runs now show a draft one-time profile preview before attachment.
- The preview shows scope, max uses, credential policy, risk classes, browser
  grants, exact command count, and write-root count.
- Selected active profiles now show scope/mode/status, risk classes, browser
  grants, command/write counts, generated-code state, credential policy, use
  count, expiry, exact domain/command/write-root grant details, and
  Disable/Expire lifecycle actions.
- Computer Use now has a dedicated permission profile manager below the compact
  session controls. It lists all profiles while new sessions only select active
  profiles, supports safe one-time profile creation, edit/save through the
  profile route, Disable/Expire lifecycle actions, and renderer-side draft
  validation that blocks credential access and persistent high-risk grants.
- `smoke:renderer-computer-use-profile-draft` verifies the rendered draft,
  credential filtering, `credentialAccess: "never"`, session attachment,
  selected-profile details, exact grant values, and Disable lifecycle POST
  wiring. It also verifies the profile manager blocks an unsafe persistent
  credential/high-risk draft, creates a safe one-time profile, and keeps
  credential access denied.
- `renderer_permission_profile_ux` is tracked by the Computer Use promotion
  gate as a passed but non-promoting renderer safety UX gate.

Remaining work:

- repeated live profile-approval dogfood with real blocked runs,
- deeper daemon-side profile policy audit if the UI validator needs to become
  an enforced server-side policy.

### Candidate Files

- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `src/renderer/components/AutonomyToolsmithPanel.tsx`
- `src/renderer/styles/activity-capability.css`
- `src/daemon/server/http/routes/computerUseSessionRoutes.ts`
- `src/daemon/computer-use/sessionRuntime.ts`
- `src/shared/protocol/computerUse.ts`
- renderer smoke scripts.

### Required Behavior

- For a blocked run, aggregate missing grants from:
  - safety decisions,
  - DAG node `missingRequirements`,
  - awaiting capability jobs,
  - permission profile evaluator output.
- Show a compact "Approve narrower one-time profile" affordance.
- The generated profile must include only grants needed by the blocked run.
- It must expire or be one-time by default.
- It must not include credential grants.
- It must not convert browser history/debugger/file-upload into always-allow.
- It must show output roots and command allowlists exactly.

### Acceptance

- A blocked run can produce a narrower one-time profile draft.
- The draft is auditable before approval.
- Renderer smoke verifies blocked grant chips, profile draft, profile manager,
  unsafe draft blocking, safe one-time creation, lifecycle POST, and no
  credential grant.
- Daemon smoke verifies denied run becomes allowed only with exact grants.

## Slice 3 - Browser Chrome Deep Action Hardening

Priority: high, mostly implemented but needs repetition and UX polish

### Current State

`browser-chrome-deep-actions-handoff.md` is implemented materially:

- tab groups,
- bookmarks,
- downloads,
- history,
- debugger inspect/screenshot/print-to-PDF,
- browser permissions,
- file upload inspect/set/clear boundary,
- extension permissions.

Implementation update:

- Computer Use renderer now shows a dedicated Browser Chrome evidence section
  in the selected session debug surface.
- The section summarizes Browser Chrome capability jobs across downloads,
  history, debugger, permission mutation, and file upload, including command,
  status, risk, verifier label, redaction policy, and linked resource roles.
- Added `smoke:renderer-computer-use-browser-chrome-evidence`, which uses a
  fake daemon bundle to verify download artifact evidence, history/path
  redaction, fixed debugger command evidence, site permission evidence, and
  file-upload basename/path redaction.
- Added `browser_chrome_deep_action_evidence_ux` to the Computer Use promotion
  gate as a passed but non-promoting renderer evidence UX gate.
- The renderer Promotion gate section now expands
  `browser_chrome_public_extension_dogfood` into a public-extension proof panel
  with latest sample count, p95, public host count, profile-approval status,
  command-family coverage, permission types, and redaction proof.
- Added repeated Browser Chrome dogfood for `download.verify` and
  `debugger.print_to_pdf`.
- `dogfood:computer-use-browser-chrome` now records two repeated fixture-bridge
  samples for each command, including p95 latency, one-time/high-risk debugger
  approval, fixed-command PDF metadata, `download_verified_file` eval resource
  evidence, verifier/eval DAG nodes, redaction proof, and cleanup
  reconciliation.
- `browser_chrome_repeated_dogfood` is now tracked by the Computer Use
  promotion gate as passed but non-promoting because it is fixture-bridge
  evidence. Real extension live samples are still required for live promotion.
- Added real Browser Bridge extension local-fixture dogfood for
  `download.start` + `download.verify` and fixed-command
  `debugger.print_to_pdf`.
- `dogfood:computer-use-browser-chrome-live-extension` launches Chromium with
  the unpacked MV3 extension, configures the bridge against a daemon instance,
  executes Browser Chrome commands through `regular_browser_extension`, records
  download artifact evidence, PDF byte-length/hash evidence with raw bytes
  omitted, and appends a redacted live-extension sample ledger.
- `browser_chrome_live_extension_dogfood` is now tracked by the Computer Use
  promotion gate as passed but non-promoting. It proves real extension API
  execution on a local fixture, but public-site repeated samples are still
  required before browser-chrome promotion.
- Added repeated public-site real-extension Browser Chrome dogfood for:
  - `download.start` + `download.verify` against a public unauthenticated W3C
    PDF target, and
  - fixed-command `debugger.print_to_pdf` against `example.com`, and
  - bounded `tab_group.claim` + `tab_group.update` + `tab_group.release` on a
    dogfood-owned public tab, and
  - one-time high-risk `history.search` against a fresh dogfood-owned browser
    profile with URL path redaction, and
  - `permission.get` + one-time `permission.set` + rollback verification for
    bounded `example.com` camera, microphone, and location content settings,
    and
  - multi-tab `tab_group.claim` + `tab_group.update` +
    `tab_group.release` over two explicit dogfood-owned public tab ids, and
  - `file_upload.inspect` + `file_upload.set_files` +
    `file_upload.clear` against a public unauthenticated file input, without
    form submission, using only approved temp-file basenames in evidence.
- The same public-extension collector now starts with a live profile-approval
  proof: a no-profile `regular_browser_extension` session blocks with exact
  `browser_automation` and `risk_class` missing grants, a narrow one-time
  Browser Chrome profile is created and attached to that blocked run, and the
  attached profile is then reused for the repeated public extension commands.
- `dogfood:computer-use-browser-chrome-public-extension` records two repeated
  samples per command family through the real unpacked Browser Bridge
  extension, stores only public host and URL hash metadata, omits raw PDF
  bytes, stores download artifact proof through `download_verified_file`,
  keeps history output to host/count/redaction metadata, stores permission
  evidence as host/scoped-setting/type-matrix/rollback proof, stores multi-tab
  grouping as tab-count/release-count proof, stores file-upload evidence as
  input-count, selected-basename, clear-status, and no-submit proof, records
  profile approval as missing-grant type evidence plus attach/eval proof, and
  appends a public-extension sample ledger.
- `browser_chrome_public_extension_dogfood` is now tracked by the Computer Use
  promotion gate as a promotable public-site repeated real-extension gate.

### Remaining Work

- Broader public-site Browser Chrome dogfood beyond the first repeated
  download/print-to-PDF/tab-group/history/permission/multi-tab/file-upload
  promotion gate:
  - browser permission bubble recovery once signed helper v2 can observe and
    abort native chrome interactions,
  - file-picker/native picker selection once signed native helper v2 exists.
- Renderer presentation for:
  - repeated live download evidence,
  - repeated live print-to-PDF evidence,
  - richer debugger attach risk wording,
  - richer site permission mutation rollback guidance.
- Promotion gate quality:
  - repeated sample count,
  - p95,
  - verifier proof rate,
  - redaction audit.
- Extension reload UX and restricted-page handling polish.

### Candidate Files

- `src/daemon/browser-chrome/commandBridge.ts`
- `providers/browser-dom-extension/bridge/browser-chrome.js`
- `providers/browser-dom-extension/manifest.json`
- `src/daemon/capability-runtime/safety.ts`
- `src/daemon/capability-runtime/verification.ts`
- `scripts/smoke-browser-chrome-capability.mjs`
- `scripts/smoke-computer-use-browser-chrome.mjs`
- `scripts/collect-computer-use-browser-chrome-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-dogfood.mjs`
- `scripts/collect-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- renderer Computer Use panel files.

### Acceptance

- Each high-risk command requires one-time approval.
- Evidence is redacted and source-linked.
- Download/file path evidence exposes basename only unless a future explicit
  stronger grant exists.
- Debugger does not expose arbitrary CDP execution.
- Browser permission set uses bounded origin patterns and verifier result.
- Renderer evidence smoke verifies download/history/debugger/permission/file
  upload rows with redaction summaries.
- Repeated dogfood smoke and promotion gate verify sample count, p95, download
  resource proof, debugger fixed-command proof, redaction, verifier/eval nodes,
  and cleanup reconciliation without promoting fixture-only evidence.
- Real-extension local-fixture smoke and promotion gate verify actual extension
  command polling, Chrome downloads API execution, debugger print-to-PDF,
  basename/path redaction, raw PDF omission, verifier/eval nodes, and cleanup
  reconciliation without promoting local-fixture evidence as public-site proof.
- Public-site real-extension smoke and promotion gate verify repeated sample
  count, public host coverage, URL-hash-only public metadata, download resource
  proof, fixed debugger proof, tab group claim/update/release proof, p95
  latency, verifier/eval nodes, redaction, and cleanup reconciliation.

## Slice 4 - Toolsmith Self-Implementation Breadth

Priority: high after permission UX

### Current State

Foundation exists:

- permission profiles,
- gap detector,
- reviewed web research to PDF template,
- generated tool manifests,
- smoke execution,
- rerun comparison,
- rollback,
- dependency prepare with isolated npm provenance,
- renderer Toolsmith stability/rerun/dependency/artifact summaries.
- repeated fixture breadth gate for `web_research_to_pdf`,
  `local_document_conversion`, `terminal_generated_tool`, and
  `browser_download_verify`; the collector appends redacted execute/rerun rows to
  `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`, and
  the promotion gate requires class coverage, per-class repeated samples, p95
  latency samples, path redaction, and matched rerun/artifact comparisons.
- repeated live/local-live generated-tool breadth gate for the same four
  classes. `dogfood:scoped-autonomy-generated-tool-live-breadth` writes dated
  evidence plus
  `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-runs.jsonl`;
  the promotion gate requires two execute samples per class, source-quality
  evidence for official OpenAI web/PDF, approved local Markdown conversion
  proof, real Node command proof, public download verification proof, p95
  samples, matched reruns, and redaction.

### Remaining Work

- Real generated ad hoc tool use cases beyond reviewed templates.
- Package-consuming generated tool dogfood when there is a meaningful scenario.
- Stronger failure revision loop:
  - parse smoke failure,
  - patch generated workspace,
  - retry within budget,
  - inactive failed specs remain inspectable.
- Broader generated ad hoc tool variety beyond the first live breadth set.
  Current live breadth is eligible for generated-tool promotion review, but it
  covers one representative scenario per class.

### Candidate Files

- `src/daemon/scoped-autonomy/toolsmithRuntime.ts`
- `src/daemon/computer-use/sessionRuntime.ts`
- `scripts/smoke-scoped-autonomy-self-implementation.mjs`
- `scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
- `scripts/collect-computer-use-toolsmith-live-dogfood.mjs`
- `scripts/collect-scoped-autonomy-web-research-live-dogfood.mjs`
- `src/renderer/components/AutonomyToolsmithPanel.tsx`

### Acceptance

- A missing capability can be classified, materialized, smoke-tested, activated,
  run, rerun, and rolled back.
- Failed generated tools remain inactive but inspectable.
- Commands/files/network/dependency actions are recorded.
- Rerun comparison can show matched/changed artifacts.
- Promotion gate can show repeated fixture sample count and p95 without
  treating it as live promotion evidence.
- Promotion gate can also show the first live generated-tool breadth slice as
  eligible only when web, terminal, and download verifier classes have repeated
  successful execute samples plus rerun and redaction proof.

## Slice 5 - Live Browser Dogfood Corpus Expansion

Priority: high, continuous

### Goal

Move from fixture success to repeated live trace evidence.

### Required Corpus Categories

- public documentation search and extraction,
- restricted page / unsupported extension page,
- extension reload required,
- browser permission/site setting,
- download observe/verify,
- debugger print-to-PDF,
- file upload blocked/approved preflight,
- target ambiguity and recovery,
- Korean prompt phrasing,
- repeated success on the same scenario.

### Candidate Files

- `docs/dogfood/browser-action-recovery-live-corpus.jsonl`
- `docs/dogfood/semantic-trace-corpus.jsonl` if present/created.
- `scripts/collect-computer-use-browser-live-dogfood.mjs`
- `scripts/collect-computer-use-browser-dogfood.mjs`
- `scripts/smoke-browser-action-recovery-live-corpus.mjs`
- `scripts/gate-computer-use-promotion.mjs`

### Acceptance

- Records are redacted.
- Each row includes scenario, prompt, surface, action trace, verification,
  failure class, recovery path, latency, and artifact/source evidence.
- Promotion gate requires repeated samples, not one success.

## Slice 6 - Native Helper v2 Design And Bounded Implementation

Priority: medium/high, only after preflight boundaries

### Goal

Move from blocked boundaries to signed, bounded workflow helpers without
opening arbitrary foreground automation.

### First Workflows

1. Browser permission bubble handling.
2. Native file picker selection with explicit file grants.
3. Browser chrome fallback when extension/CDP cannot reach a target.

Do not start with arbitrary Windows settings mutation.

### Required Helper v2 Contract

- signed helper provenance,
- command allowlist,
- active-window assertion,
- process allowlist,
- visible countdown,
- abort-on-user-input,
- target bbox/label proof,
- effect verifier,
- rollback proof when possible,
- no credential fields,
- no restricted-page bypass,
- debug bundle resources.

### Acceptance

- Unsigned helper remains development-only.
- Release gate blocks production promotion until signing exists.
- Each helper command has smoke coverage for allowed and blocked paths.

## Slice 7 - Windows App/Settings Dogfood

Priority: medium, progress carefully

### Current State

Implemented:

- read-only registry observation,
- bounded reversible app-owned HKCU registry set/query/delete,
- broad Windows settings mutation blocked.

### Next Work

- Add more read-only Windows app workflows:
  - app/window observation,
  - Settings page presence,
  - installed app/version query where privacy-safe.
- Add reversible dogfood only in app-owned sandbox keys or temp fixtures.
- Keep real OS settings mutation blocked.

### Acceptance

- Read-only evidence is redacted.
- Reversible mutations have exact command allowlist and rollback proof.
- Broad mutation stays blocked by promotion gate.

## Slice 8 - Future VM/Sandbox Surface

Priority: deferred

### Current State

Runtime boundary and smoke coverage exist. Actual backend is blocked.

### Do Not Implement Until

- local Windows isolation backend is selected,
- lifecycle and cleanup are proven,
- network bridge policy exists,
- host file/clipboard sync policy exists,
- raw screenshot retention policy exists,
- eval/debug evidence shape exists.

## Slice 9 - Release Signing Hardening

Priority: release-critical

### Current State

Release readiness diagnostics and deferred signing gates exist.

### Remaining Work

- Production certificate/service decision.
- Signed native helper provenance.
- Extension store permission justification hardening.
- Installer/release smoke that verifies bundled daemon/helper signatures.

### Acceptance

- Release readiness cannot be green while helper signing is missing.
- Development unsigned allowance is explicit and never production-promoting.

## Slice 10 - Final Architecture Completion Audit

Priority: only after all slices are implemented

### Required Audit

Check every item in:

- `07-migration-checklist.md`
- this execution handoff,
- promotion gate report,
- open blockers in `08-implementation-resumption-handoff.md`.

### Verification

Run full suite:

```powershell
npm run lint
npm run build:daemon
npm run build:web
npm run smoke:research-performance-architecture
npm run smoke:scoped-autonomy-toolsmith
npm run smoke:scoped-autonomy-self-implementation
npm run smoke:scoped-autonomy-npm-dependency-prepare
npm run smoke:capability-runtime
npm run smoke:browser-action
npm run smoke:vision-context
npm run smoke:computer-use-action-adapter
npm run smoke:computer-use-surface-manager
npm run smoke:computer-use-session
npm run smoke:computer-use-session-http
npm run smoke:computer-use-isolated-browser
npm run smoke:computer-use-browser-parity
npm run smoke:computer-use-browser-chrome
npm run smoke:computer-use-terminal-parity
npm run smoke:computer-use-toolsmith-artifact
npm run smoke:computer-use-windows-settings
npm run smoke:computer-use-native-watch-boundary
npm run smoke:computer-use-vm-sandbox-boundary
npm run smoke:computer-use-debug-bundle
npm run smoke:computer-use-one-time-profile
npm run smoke:computer-use-effect-verifier
npm run smoke:computer-use-verifier-audit
npm run smoke:computer-use-promotion-gate
npm run smoke:computer-use-promotion-gate-route
npm run smoke:renderer-computer-use-live-refresh
npm run smoke:renderer-autonomy-rerun-history
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

Run dogfood commands where live network/browser availability permits.
