# 07 - Current Status Ledger

Status: resume-critical ledger
Date: 2026-05-16
Branch: `main`

## Purpose

This shard is the fastest state-recovery ledger for future Codex sessions. If
chat context is lost, read this file after the `README.md` and before editing
code. It records what is already implemented, what is partially implemented,
what is still blocked, which files are hot, and which command set proved the
latest stable boundary.

This file is intentionally redundant with the domain shards. Prefer this file
for "where do I resume?" and the other shards for "why is the architecture this
way?"

## Current Global State

The Windows Codex Computer Use parity track is implemented to the current
local boundary with explicit guarded external blockers. The latest audit
reports `implemented_with_guarded_boundaries` with 61 passed requirements, 7
guarded native/release boundaries, 0 blocked requirements, and 0 missing
requirements.

The global implementation goal can be treated as locally satisfied only when
the latest verification boundary still passes:

- `npm run lint`
- `npm run smoke:all`
- `npm run gate:computer-use-promotion`
- `npm run audit:computer-use-parity`
- `git diff --check`
- strict UTF-8/mojibake scan for touched text files

Guarded boundaries must remain guarded and must not be reclassified as
completed native execution. Do not implement foreground native input, native
file picker selection, browser permission popup clicks, production release
signing, unrestricted credential flow, authenticated browser profile/cookie
default access, or real VM/RDP/sandbox execution unless the required external
preconditions are supplied.

Remaining future work is evidence hardening and external unblock work, not a
known local implementation gap:

- collect more live Browser Chrome and Browser Action calibration evidence,
- expand generated-tool package provenance after external package policy is
  approved,
- implement signed helper v2 only after production signing/preflight
  requirements exist,
- connect official app-server custom client tools only after the contract is
  available,
- validate GPU ASR and human microphone ASR corpus when explicitly resumed.

The detailed macOS Computer Use user-outcome parity implementation map now
lives in:

- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/README.md`

When resuming broad parity implementation after reading this ledger, read that
`10` pack before patching architecture, browser, native, Toolsmith, safety, or
promotion-gate code.

The implementation and evidence artifacts were pushed to `main` on 2026-05-16.
Run `git status --short` before editing and do not revert unrelated local
changes if any are present.

## Latest Stable Boundary

The latest verified boundary is:

- foreground watch-mode user-input abort preflight,
- renderer blocked-run one-time profile draft preview,
- renderer selected-profile detail/lifecycle controls,
- renderer selected-profile exact grant detail list.
- renderer permission profile manager with safe one-time create/edit validation
  and lifecycle promotion-gate evidence.
- renderer Browser Chrome evidence section for download/history/debugger/
  permission/file-upload rows with redaction and resource summaries.
- repeated Browser Chrome fixture-bridge dogfood for `download.verify` and
  `debugger.print_to_pdf`, wired into the promotion gate as non-promoting
  evidence pending real extension live samples.
- real Browser Bridge extension local-fixture dogfood for `download.start` +
  `download.verify` and fixed-command `debugger.print_to_pdf`, wired into the
  promotion gate as non-promoting evidence pending public-site repeated samples.
- repeated public-site real-extension dogfood for `download.start` +
  `download.verify` against a public W3C PDF, fixed-command
  `debugger.print_to_pdf` against `example.com`, and bounded
  `tab_group.claim/update/release` on a dogfood-owned public tab, plus
  one-time high-risk `history.search` on a fresh dogfood-owned browser profile
  with URL path redaction, plus `permission.get/set/rollback` for bounded
  `example.com` camera, microphone, and location content settings, plus
  multi-tab tab-group
  claim/update/release over two explicit dogfood-owned public tab ids, wired
  into the promotion gate as promotable Browser Chrome public-site evidence.
- repeated public-site real-extension file-upload dogfood for
  `file_upload.inspect`, `file_upload.set_files`, and `file_upload.clear`
  against a public unauthenticated file input, without submitting the form,
  with basename-only file evidence, clear-status proof, and public URL hash
  metadata.
- repeated public-site real-extension profile approval proof: no-profile
  `regular_browser_extension` startup blocks with exact browser-automation and
  high-risk missing grants, a narrow one-time profile is attached to the
  blocked run with eval proof, and that profile is reused for the public
  extension command matrix.
- native helper v2 capability discovery without native input expansion: the
  Rust helper status emits
  `browser-native-desktop-helper-capability-manifest.v2`, daemon diagnostics
  propagate supported v1 browser-window commands and helper-v2-only guarded
  commands, and `helperV2Boundary` keeps native foreground/file-picker/
  permission-popup input disabled.
- foreground watch preflight contract hardening: `ForegroundWatchPreflightState`
  is shared protocol, covers target identity, surface lock, timeout guard,
  active-window drift abort, and user-input abort, and remains blocked before
  any native input.
- helper-side observe-only watch preflight: Rust helper supports
  `watch_preflight`, uses Win32 last-input evidence and UIA active-window
  identity/process checks, returns `foreground-watch-preflight.v1` plus
  `browser-native-desktop-helper-watch-preflight-guards.v1`, and daemon status
  surfaces it as `helperWatchPreflight` without enabling native input.
- helper-side dry-run monitor: `watch_preflight` accepts bounded
  `watchPreflight.monitorMs`, samples last-input tick changes and focused
  process drift, records sample count/abort reason, and daemon status exposes
  `helperSideContinuousMonitorPresent` while keeping `actualInputSent: false`.
- disabled foreground watch executor contract: Rust helper accepts
  `foreground_watch_execute` only as a non-executing helper-v2 contract. It
  returns `browser-native-desktop-helper-foreground-watch-executor.v1` with
  `enabled: false`, `supported: false`, `dryRunOnly: true`,
  `signedHelperV2Available: false`, release gate
  `browser-native-helper-signing`, full precondition list, and
  `actualInputSent: false`. Promotion gate metrics now surface
  `foregroundWatchExecutorDisabledPresent` and the renderer Native boundary
  proof panel displays `Executor: disabled`. Computer Session visual desktop
  blocked outputs, safety decisions, observations, rollback metadata, and
  verifier results also carry this shared `foregroundWatchExecutor` state.
- helper-v2 disabled command contracts: Rust helper now accepts selected
  helper-v2-only commands as explicit non-executing contracts instead of vague
  unsupported errors. `capture_screenshot`, `file_picker_select`,
  `browser_permission_popup_click`, `clipboard_set_scoped`, and `menu_command`
  return `browser-native-desktop-helper-v2-disabled-command.v1` with
  `enabled: false`, `supported: false`, `dryRunOnly: true`,
  `actualInputSent: false`, `signedHelperV2Available: false`, and
  `releaseGate: browser-native-helper-signing`. Command-specific evidence
  proves no path disclosure/file selection, no permission popup click/mutation,
  no screenshot capture/raw storage, no clipboard content logging/mutation, and
  no menu command dispatch before helper-v2 signing. Daemon native adapter
  status diagnostics now also probe a bounded subset of these contracts and
  expose `helperV2DisabledContracts` plus
  `helperV2Boundary.disabledCommandContractsPresent` so live status can prove
  fail-closed helper-v2 behavior without relying only on release reports.
- release helper contract readiness: `npm run release:readiness` now records
  `browser-native-helper-contract` plus an embedded
  `browser-native-desktop-helper-contract-readiness.v1` report. The automated
  gate probes the built helper for manifest v2, observe-only
  `foreground-watch-preflight.v1`, helper-side guard schema, bounded dry-run
  monitor samples, disabled foreground executor proof, helper-v2 disabled
  command contracts, and
  `actualInputSent: false` before the separate `browser-native-helper-signing`
  manual/deferred gate is evaluated. The release-readiness report now records
  repo-relative paths or `<repo>` placeholders in check details.
- Toolsmith self-implementation breadth gate: `dogfood:scoped-autonomy-self-implementation`
  now records redacted fixture evidence for `web_research_to_pdf`,
  `local_document_conversion`, `terminal_generated_tool`, and
  `browser_download_verify`, including smoke activation, source revision after
  an intentional smoke failure, matched scalar/artifact rerun comparisons for
  all four generated classes, and a high-risk `native_windows_workflow` request
  blocked before materialization. `local_document_conversion.v1` is a dedicated
  Markdown/text-to-PDF template that skips crawl/extract/source-verify DAG
  nodes and records source-content hash plus Markdown/PDF blob resources.
  The same collector now appends redacted execute/rerun sample rows to
  `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`; the
  promotion gate verifies two samples per generated class, p95 latency samples,
  sample path redaction, and repeated rerun artifact stability.
  The promotion gate tracks this as
  `scoped_autonomy_self_implementation_breadth`, passed but non-promoting
  because the repeated breadth evidence is still fixture-backed. Repeated live
  generated-tool breadth is still required before promotion.
- Toolsmith generated-tool live breadth gate:
  `dogfood:scoped-autonomy-generated-tool-live-breadth` now runs two
  live/local-live execute samples each for `web_research_to_pdf`,
  `local_document_conversion`, `terminal_generated_tool`, and
  `browser_download_verify`. The evidence lives in
  `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-2026-05-16/`
  plus `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-runs.jsonl`.
  The promotion gate tracks this as
  `scoped_autonomy_generated_tool_live_breadth`, passed and promotable for
  generated-tool promotion review. It verifies web OpenAI source-quality and
  browser-fallback hash calibration, approved local Markdown source-file
  conversion, real Node command proof, public browser-backed download
  verification, matched reruns/artifacts, p95 latency, and path redaction.
- Toolsmith dependency-prepare redaction hardening: npm dependency preparation
  redacts absolute `file:` package paths from tool-run output and eval ledger
  evidence. `smoke:scoped-autonomy-npm-dependency-prepare` now asserts blocked
  and allowed package-install flows do not leak absolute local package paths.
- Toolsmith npm dependency execution proof: dependency preparation now performs
  an isolated `npm install` under the generated tool runtime workspace, records
  installed package `package.json` hash evidence, passes only
  `CODEX_WIDGET_TOOL_DEPENDENCY_ROOT` into the generated Node entrypoint, and
  `smoke:scoped-autonomy-npm-dependency-prepare` proves the generated tool can
  import the prepared local package, write an artifact, record a
  `toolsmith_execute` eval step, and avoid absolute dependency-workspace path
  leaks.
- Toolsmith npm dependency dogfood gate:
  `dogfood:scoped-autonomy-npm-dependency` now records two repeated
  package-consuming generated-tool scenarios using a local file npm package
  fixture. The evidence proves isolated npm install, installed package
  provenance, generated-tool import via `CODEX_WIDGET_TOOL_DEPENDENCY_ROOT`,
  blob-backed artifact storage, `toolsmith_dependency_prepare` and
  `toolsmith_execute` eval proof, matched rerun stability, p95 samples, and no
  absolute path leaks. The promotion gate tracks
  `scoped_autonomy_npm_dependency_dogfood` as passed but non-promoting until
  external package allowlist/provenance policy exists.
- Toolsmith external npm package allowlist policy: autonomy permission grants
  now include `packageAllowlist`, defaulting to local `file:*` dependencies.
  Registry npm dependencies add an exact `package_install` requirement like
  `npm:name@version` and are blocked before `npm install` unless the selected
  profile includes a matching package allowlist entry. The npm dependency smoke
  proves the blocked-before-install path and exact allowlist permission match.
- Toolsmith dependency policy review evidence:
  `toolsmith_dependency_prepare` output now includes
  `toolsmith-dependency-policy-review.v1`, covering package classification,
  exact allowlist requirement, install isolation flags (`ignore-scripts`,
  `no-audit`, `no-fund`, no shell), lockfile/package provenance status, review
  outcome, and promotion boundary. The npm dependency dogfood gate requires the
  policy review metric, and the renderer Toolsmith panel shows a "Package
  policy" card with local/external counts and provenance state.
- Operator dogfood report links: the daemon now exposes
  `GET /computer-use/eval/dogfood-reports` plus a bounded
  `dogfood-reports/content` route for repo-relative Markdown/JSON/JSONL/TXT
  reports under `docs/reports/**` and `docs/dogfood/**`. The Renderer Computer
  Use panel shows a "Dogfood reports" section with latest report/evidence/
  dogfood links, while traversal, absolute paths, and unsupported extensions
  are rejected.
- Terminal artifact delta manifest:
  Computer Session terminal output-root tracking now records
  `computer-session-terminal-artifact-delta.v1` manifests with
  create/modify/delete counts, basename-only entries, relative-path hashes,
  artifact hashes, omitted counts, and rollback-candidate counts. Changed
  bounded files are still stored as blob-backed `terminal_diff_artifact`
  resources, the manifest is stored as `terminal_output_root_delta_manifest`,
  and created-file deletion stays behind explicit user-artifact rollback
  confirmation with write-root and hash rechecks. Modified/deleted files are
  evidence-only and are not automatically restored. Terminal command
  preapproval also blocks unquoted shell control operators before allow-prefix
  evaluation, preventing chained-command bypasses like `echo ok & node -v`.
- Terminal bounded-output proof:
  Computer Session debug bundles no longer export raw terminal stdout/stderr or
  raw helper truncation internals. Terminal capability-job output is summarized
  as length, SHA-256, credential-redacted preview, stdout/stderr truncation
  booleans, helper byte limits, and
  `terminal_helper_bounded_output` resource-limit evidence. The terminal parity
  smoke exercises a large stdout command and proves the exported length is
  capped at the helper limit while raw output is absent.
- 30-case process validation refresh:
  `dogfood:computer-use-process-30` now reflects the current PDF/artifact and
  download-verification implementation instead of older blocked placeholders,
  and now includes a metadata-only Vision VLM fallback fixture path. The
  refreshed 2026-05-16 report records 21 passed, 9 blocked,
  0 needs-follow-up, 0 unexpected failures, 43 eval runs, 11 perception graphs,
  16 eval resources, task success rate 0.786, proof rate 0.405, and p95 latency
  108 ms. The Codex research-to-PDF user scenario now runs through a bounded
  Toolsmith `web_research_to_pdf` fixture path with Markdown/PDF
  `user_saved` artifacts linked as eval resources, the browser PDF download
  scenario records basename/hash-only `download_verified_file` evidence through
  Browser Chrome `download.verify`, and the complex chart scenario records
  `vlm_fallback_summary` without storing raw screenshot bytes.

This boundary proves:

- `visual_desktop_action.watchPreflight` can record a blocked preflight.
- User input or active-window drift aborts before native foreground input.
- `actualInputSent` remains `false`.
- No `desktop_action` capability job is created by blocked watch/file-picker
  paths.
- Blocked Computer Use runs can show a narrow one-time profile draft in the
  renderer.
- The one-time profile path keeps `credentialAccess: "never"`.
- Selected permission profiles expose exact grants before lifecycle changes.
- Disable/Expire actions use daemon profile update routes.
- Profile manager lists all profiles, while new sessions select only active
  profiles.
- Unsafe persistent credential/high-risk drafts are blocked before POST.
- Safe managed one-time profile creation is smoke-covered.
- The promotion gate tracks `renderer_permission_profile_ux`.
- Browser Chrome deep-action evidence is visible in the renderer through
  daemon-owned capability jobs/observations/resources.
- The renderer Promotion gate section also expands the public real-extension
  Browser Chrome gate with repeated sample count, p95 latency, public host
  count, profile approval, command-family coverage, camera/microphone/location
  permission matrix, and redaction proof.
- The promotion gate tracks `browser_chrome_deep_action_evidence_ux`.
- Browser Chrome repeated dogfood records four latest successful samples, p95
  latency, `download_verified_file` resource evidence, debugger PDF metadata,
  verifier/eval DAG nodes, redaction proof, and cleanup reconciliation.
- The promotion gate tracks `browser_chrome_repeated_dogfood` as passed but
  non-promoting fixture-bridge evidence.
- Browser Chrome live-extension dogfood launches real Chromium with the unpacked
  Browser Bridge extension, configures the daemon bridge, forces the Chrome
  download directory to the approved smoke root, executes `download.start`,
  observes completion before `download.verify`, targets debugger print-to-PDF
  at the allowed fixture tab id, records p95 latency, `download_verified_file`
  resource evidence, PDF hash/byte-length evidence, verifier/eval DAG nodes,
  redaction proof, and cleanup reconciliation.
- The promotion gate tracks `browser_chrome_live_extension_dogfood` as passed
  but non-promoting local-fixture real-extension evidence.
- Browser Chrome public-extension dogfood records eighteen latest successful
  public-site samples, public host coverage for `example.com`, `www.w3.org`,
  and `the-internet.herokuapp.com`,
  URL-hash-only metadata, p95 latency, `download_verified_file` resource
  evidence, PDF hash/byte-length evidence with raw bytes omitted, tab group
  claim/update/release proof, one-time fresh-profile history search proof,
  bounded permission setting rollback proof for camera/microphone/location via
  Chrome contentSettings, multi-tab group release proof, file-upload
  inspect/set/clear no-submit proof, live profile-approval missing-grant and
  attach/eval proof, verifier/eval DAG nodes, redaction proof, and cleanup
  reconciliation.
- The promotion gate tracks `browser_chrome_public_extension_dogfood` as a
  passed promotable public-site repeated real-extension gate.
- Native helper status can now be inspected as a command manifest instead of a
  vague capability list. Current v1 browser-window commands and signed-helper-
  v2-only commands are separated in daemon diagnostics, with
  `nativeInputEnabled: false` and no guarded command input sent.
- Foreground watch-mode preflight can now be inspected as a typed shared
  contract. The native-watch smoke proves missing identity/lock/timeout guards
  are reported and active-window drift aborts with no `desktop_action` job.
- The helper itself can now produce observe-only watch-preflight evidence for
  active window/process/last-input state. The default preflight is a
  single-sample observation and does not make foreground input promotable.
- The helper can also run a short dry-run monitor for last-input changes and
  active-window drift. This is still not the signed helper v2 execution monitor
  and does not make foreground input promotable.
- Renderer native boundary proof now surfaces the preflight contract and
  active-window drift abort proof alongside foreground input, native file
  picker, permission popup, and signing guard state.
- Renderer dogfood links let the operator open current promotion, Browser
  Chrome, Browser Action, Toolsmith, and parity audit reports without needing
  raw local paths.
- Toolsmith npm dependency evidence can be inspected without exposing the
  temporary local package fixture path, and smoke coverage now proves the
  generated tool can consume the prepared dependency without exposing the
  isolated dependency workspace.
- Repeated local npm dependency dogfood now proves the package-consuming
  generated-tool path through prepare/execute/rerun/eval/resource evidence; it
  deliberately does not promote external registry package installation.
- External npm registry dependencies are no longer covered by a broad
  `packageInstall: true`; they require exact `packageAllowlist` entries and
  block before installation when missing.
- Dependency policy review is visible in daemon tool-run/eval output and the
  renderer Toolsmith panel, so package install decisions are inspectable
  without exposing raw workspace paths.
- The 30-case user-like process validation report no longer lists
  research-to-PDF, browser PDF download verification, or complex-chart VLM
  fallback as unimplemented. Those scenarios are fixture-backed successes with
  explicit eval resources; live browser/OS/VLM promotion remains governed by
  the separate repeated live gates.

This boundary does **not** prove:

- signed helper v2,
- real foreground native input,
- native file picker selection,
- production signing readiness,
- unrestricted browser profile access,
- or broad Windows settings mutation.

## Recently Changed Files

Recent implementation touched at least:

- `src/shared/protocol/computerUse.ts`
- `src/daemon/computer-use/sessionRuntime.ts`
- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `src/renderer/styles/activity-capability.css`
- `scripts/smoke-computer-use-native-watch-boundary.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- `scripts/smoke-renderer-computer-use-profile-draft.mjs`
- `scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `src/daemon/server/http/routes/computerUseEvalRoutes.ts`
- `src/daemon/scoped-autonomy/toolsmithRuntime.ts`
- `scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
- `providers/browser-native-desktop-helper-rs/src/main.rs`
- `providers/browser-native-desktop-helper-rs/Cargo.toml`
- `providers/browser-native-desktop-helper-rs/Cargo.lock`
- `src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts`
- `src/daemon/browser-action/adapters/nativeDesktopAdapter.ts`
- `scripts/smoke-browser-action-native.mjs`
- `scripts/smoke-browser-native-desktop-helper-native.mjs`
- `scripts/smoke-computer-use-native-watch-boundary.mjs`
- `scripts/audit-windows-codex-computer-use-parity.mjs`
- `scripts/collect-computer-use-browser-chrome-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-dogfood.mjs`
- `scripts/collect-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/`
- `package.json`
- `scripts/smoke-all.mjs`
- Windows parity handoff shards under
  `docs/plans/windows-codex-computer-use-parity/`
- `.vibe/agent/handoff.md`
- `.vibe/agent/session-log.md`

Before changing any of these files again, re-read the current contents because
the worktree may contain additional user or generated changes.

## Implemented / Started / Blocked Matrix

| Area | State | Resume Notes |
|---|---|---|
| Computer Session protocol | implemented foundation | Extend via `src/shared/protocol/computerUse.ts`; keep optional fields backward compatible. |
| Computer Session runtime | implemented foundation, very large | Prefer narrow helper extraction only when a slice proves it with smoke coverage. |
| Execution surfaces | implemented foundation | Current surfaces: isolated browser, regular browser extension, tool workspace, PTY workspace, foreground watch, future VM. |
| Capability DAG | implemented foundation | Continue migrating behavior into explicit DAG nodes with timings/resources/failure class. |
| Eval ledger | implemented foundation | New slices must link eval steps/resources to debug bundle and promotion evidence. |
| Perception graph | implemented foundation | Browser target evidence already uses graph sets; high-risk actions still need current actionable proof. |
| Browser Action prompt path | implemented and dogfooded | Needs more repeated live traces and recovery calibration before broad promotion confidence. |
| Browser Chrome deep actions | materially implemented with renderer evidence UX, repeated fixture-bridge dogfood, real-extension local-fixture dogfood, public-site repeated real-extension download/PDF/tab-group/history/permission-matrix/multi-tab/file-upload dogfood, and explicit blocked permission-bubble native-click boundary | Needs actual browser permission-bubble native click and native file-picker selection after signed helper v2, plus richer rollback/risk wording. |
| Toolsmith scoped autonomy | implemented useful vertical plus repeated fixture/live breadth gates and dependency-prepare/execution dogfood | Web/PDF, terminal generated tools, browser download verification, high-risk native blocking, p95 sample ledgers, rerun stability, package-install redaction, smoke-level package-consuming execution, and repeated local npm dependency dogfood are covered; external registry package-install policy remains future work. |
| Terminal parity | implemented safe command path plus output-root delta manifest and bounded-output proof | Continue exact-command grants; create/modify/delete effects now have path-redacted manifests, blob-backed changed-file resources, explicit confirmed-delete rollback for generated artifacts, shell-chaining bypass protection before allow-prefix approval, and debug-bundle stdout/stderr metadata with truncation/byte-limit evidence instead of raw output. |
| Windows settings dogfood | narrow reversible app-owned path implemented | Broad OS/settings mutation remains blocked. |
| Native browser-window helper | bounded browser-window path exists with v2 capability discovery manifest and disabled helper-v2 command contracts | Do not treat as general desktop automation; manifest and direct helper probes prove guarded helper-v2 commands remain disabled with no input/path/permission/screenshot/clipboard side effects until signed helper v2 exists. |
| Foreground watch-mode | blocked preflight implemented | Real native input waits for signed helper v2 and guards. |
| Native file picker | blocked boundary implemented | Real picker selection waits for signed helper v2 and file-selection policy. |
| Future VM/sandbox | blocked boundary implemented | Real backend deferred until isolation/lifecycle/network/artifact policy exists. |
| Renderer Computer Use panel | profile management, repeated Browser Chrome dogfood proof UX, Toolsmith repeated fixture/live breadth proof UX, native boundary proof UX, debug bundle copy/save, rollback controls, and dogfood report links implemented | Next safe work is native-helper-gated flows after signing/helper-v2 decisions, broader generated ad hoc/package-consuming Toolsmith scenarios, or additional blocked-boundary evidence polish. |
| Renderer Toolsmith panel | implemented useful summaries | Continue artifact/rerun/dependency UX only with smoke coverage. |
| Release signing | diagnostics/gates and signing preflight evidence implemented | Production signing certificate/service remains blocker. |

## Immediate Next Slice

Recommended next slice:

Signed helper v2 design/implementation prep or broader Browser Chrome public
dogfood that does not require native input. The new helper manifest makes the
next native slice mechanically visible, but real browser permission-bubble
native clicks and native file-picker selection still require signed helper v2.

Safe implementation order for the next Browser Chrome public slice:

1. Reuse the public-extension collector shape rather than fixture bridge.
2. Pick public, unauthenticated, non-credential scenarios with stable URLs.
3. Add only one risk family at a time:
   - browser permission bubble recovery after signed helper v2 exists,
   - native file-picker selection after signed helper v2 exists.
4. Keep local-fixture, public-site, and blocked-boundary evidence classes
   separate in the promotion gate.
5. Promote only after repeated success, p95 evidence, verifier/eval proof,
   redaction proof, and cleanup reconciliation are present.

Do not broaden this into native helper v2 in the same patch unless the user
explicitly redirects.

## Next Slice Acceptance

The next Browser Chrome live dogfood slice should satisfy all relevant points
below:

- Evidence is redacted and linked to the action/debug bundle.
- High-risk commands remain one-time/explicit.
- Download/file-upload local path evidence stays basename-only unless a future
  stronger grant exists.
- Debugger commands remain fixed-command only, with no arbitrary CDP/eval.
- Smoke tests assert actual payloads and renderer/gate evidence, not only
  static text.
- Renderer does not infer hidden runtime state; it renders daemon-owned state.

## Verification Last Known Good

The latest stable boundary passed:

```powershell
node --check scripts/smoke-computer-use-native-watch-boundary.mjs
node --check scripts/smoke-computer-use-terminal-parity.mjs
node --check scripts/lib/browser-native-desktop-helper-contract.mjs
node --check scripts/smoke-browser-native-desktop-helper-native.mjs
node --check scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs
node --check scripts/audit-windows-codex-computer-use-parity.mjs
node --check scripts/gate-computer-use-promotion.mjs
node --check scripts/smoke-computer-use-promotion-gate-route.mjs
npm run build:daemon
npm run build:browser-native-desktop-helper
npm run smoke:browser-native-desktop-helper-native
npm run smoke:browser-native-desktop-helper:signing-readiness
npm run release:readiness
npm run smoke:computer-use-terminal-parity
npm run smoke:computer-use-session-http
npm run smoke:computer-use-native-watch-boundary
npm run audit:computer-use-parity
npm run smoke:computer-use-promotion-gate
npm run gate:computer-use-promotion
npm run smoke:computer-use-promotion-gate-route
node --check scripts/smoke-renderer-computer-use-profile-draft.mjs
npm run build:renderer
npm run smoke:renderer-computer-use-profile-draft
npm run smoke:renderer-computer-use-browser-chrome-evidence
npm run dogfood:scoped-autonomy-self-implementation
npm run dogfood:computer-use-browser-chrome
npm run smoke:computer-use-browser-chrome-dogfood
npm run dogfood:computer-use-browser-chrome-live-extension
npm run smoke:computer-use-browser-chrome-live-extension-dogfood
npm run dogfood:computer-use-browser-chrome-public-extension
npm run smoke:computer-use-browser-chrome-public-extension-dogfood
npm run smoke:renderer-chat
node --check scripts/gate-computer-use-promotion.mjs
node --check scripts/smoke-computer-use-promotion-gate-route.mjs
npm run smoke:computer-use-promotion-gate
npm run gate:computer-use-promotion
npm run smoke:computer-use-promotion-gate-route
npm run audit:computer-use-parity
npm run lint
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

Known non-failing notes:

- `git diff --check` can emit CRLF normalization warnings for these files:
  - `.vibe/agent/session-log.md`
  - `src/daemon/server.ts`
  - `src/daemon/storage/storage.ts`
- `smoke:all` can print unsigned browser-native helper development allowance.
- `smoke:all` can print one Windows temp cleanup deferred retry.
- No `.cs` files were touched in the latest slices.
- Signing preflight evidence is covered by
  `npm run smoke:browser-native-desktop-helper:signing-readiness`; it proves
  strict release mode still blocks without an Authenticode certificate/service
  and that generated signing reports redact secrets and absolute local paths.
- Browser permission-bubble native click is covered as a blocked boundary by
  `npm run smoke:computer-use-native-watch-boundary` and
  `windows_native_watch_boundary`. It proves `browser_permission_bubble_action`
  stops before native input, records `nativePopupClick: false`, and does not
  mutate browser permission state.
- Renderer Browser Chrome evidence smoke now also verifies a "Native boundary
  proof" panel that summarizes foreground input, native file picker, browser
  permission popup, signing guard, preflight contract, and active-window drift
  abort state directly from daemon promotion-gate metrics.
- Computer Session debug bundle export reconciles completed capability jobs
  back into linked DAG action/follow-up nodes before returning the bundle,
  hardening aggregate smoke and debug/export views against timing races.
- `npm run audit:computer-use-parity` now generates a prompt-to-artifact
  checklist report at
  `docs/reports/windows-codex-computer-use-parity-audit-2026-05-16.md` with
  structured evidence under
  `docs/reports/assets/windows-codex-computer-use-parity-audit-2026-05-16/evidence.json`.
  The latest audit status is `implemented_with_guarded_boundaries` with
  passed=61, guarded=7, missing=0. The audit includes the native helper-v2
  capability manifest, foreground watch preflight contract, disabled foreground
  executor contract, helper contract release-readiness, and shared Computer
  Session `foregroundWatchExecutor` evidence checks. It also includes the
  `scoped_autonomy_self_implementation_breadth` fixture gate; guarded items are
  the intentionally non-promoting native/release boundaries.

## Required Verification For Next Renderer Profile Slice

At minimum run:

```powershell
node --check scripts/smoke-renderer-computer-use-profile-draft.mjs
npm run build:renderer
npm run smoke:renderer-computer-use-profile-draft
npm run smoke:renderer-chat
npm run lint
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

If daemon profile routes or runtime permission behavior change, also run:

```powershell
npm run build:daemon
npm run smoke:computer-use-one-time-profile
npm run smoke:computer-use-session
npm run smoke:computer-use-session-http
```

Always run a UTF/mojibake scan for touched text files. If `.cs` files are
touched, verify BOM starts with `efbbbf`.

## Do Not Regress These Invariants

- Restricted pages are never bypassed.
- Credential/cookie/token data is never exposed through approval convenience.
- Browser history/debugger/file-upload grants remain high-risk and explicit.
- Local file paths remain redacted unless an approved output root or future
  explicit file evidence grant exists.
- Generated tools are not activated until smoke passes.
- Failed generated tools remain inactive but inspectable.
- Foreground native input remains blocked until signed helper v2 exists.
- User input abort and active-window drift abort happen before native input.
- Memory may rank candidates but cannot prove current UI state.
- Promotion gates do not accept one-off live success.
- Renderer shows daemon-owned evidence; it does not invent permission state.

## Open External Blockers

Keep these as blockers, not TODOs to force through:

- Official app-server custom client-tool contract.
- Production Authenticode signing certificate or signing service.
- Unrestricted credential flows.
- Authenticated browser profile/cookie access as generic automation substrate.
- Signed helper v2 for native watch-mode and native file picker.
- Real VM/sandbox backend.
- GPU ASR validation.
- Human microphone ASR corpus benchmark.

## How To Update This Ledger

After every meaningful slice:

1. Move the "Latest Stable Boundary" forward.
2. Add newly touched files.
3. Update the matrix row state.
4. Replace "Immediate Next Slice" if the next safe slice changed.
5. Replace or append the verification commands that actually passed.
6. Keep blockers explicit.
7. Update `.vibe/agent/handoff.md`.
8. Add one concise `.vibe/agent/session-log.md` entry.
9. Run `npm run vibe:checkpoint`.
