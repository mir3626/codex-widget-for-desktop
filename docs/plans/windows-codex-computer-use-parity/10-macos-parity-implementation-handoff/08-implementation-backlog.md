# 08 - Implementation Backlog

## How To Work

Implement one vertical slice at a time:

1. Read the current files before patching.
2. Preserve unrelated worktree changes if `git status --short` shows any.
3. Add or strengthen smoke coverage.
4. Add dogfood evidence when behavior is user-visible.
5. Update this handoff and `.vibe/agent/*`.
6. Run focused verification and `npm run vibe:checkpoint`.

Do not broaden a slice just because adjacent code is visible.

## Phase 1 - Stabilize Current Interrupted Browser Chrome Dogfood

Status: completed on 2026-05-16 for fixture-bridge repeated dogfood,
real-extension local-fixture dogfood, and repeated public-site real-extension
download/print-to-PDF/tab-group/history/permission/multi-tab samples. Broader
Browser Chrome public dogfood remains Phase 4 work.

Goal:

- Finish repeated Browser Chrome dogfood for download verify and
  debugger.print_to_pdf.

Hot files:

- `scripts/collect-computer-use-browser-chrome-dogfood.mjs`
- `scripts/smoke-computer-use-browser-chrome-dogfood.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- `package.json`
- `scripts/smoke-all.mjs`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/*`

Acceptance:

- `dogfood:computer-use-browser-chrome` records repeated samples.
- Success criterion treats regular browser-extension session cancellation as
  cleanup reconciliation when no isolated surface exists.
- Evidence proves:
  - download resource role,
  - debugger PDF metadata,
  - one-time/high-risk behavior,
  - path/history redaction,
  - verifier/eval nodes,
  - p95 latency.
- Promotion gate includes Browser Chrome repeated dogfood as non-promoting if
  fixture bridge only, eligible only after real extension live evidence.

Verification:

```powershell
node --check scripts/collect-computer-use-browser-chrome-dogfood.mjs
node --check scripts/smoke-computer-use-browser-chrome-dogfood.mjs
npm run dogfood:computer-use-browser-chrome
npm run smoke:computer-use-browser-chrome-dogfood
npm run smoke:computer-use-promotion-gate
npm run gate:computer-use-promotion
npm run smoke:computer-use-promotion-gate-route
```

Implementation result:

- `collect-computer-use-browser-chrome-dogfood.mjs` now accepts regular browser
  extension session cancellation as cleanup reconciliation when no isolated
  `close_surface` rollback exists.
- The collector checks completed eval evidence through the current
  `browser_chrome_observation` step linked to the capability job id rather than
  the older `browser_chrome` step name.
- `browser_chrome_repeated_dogfood` is part of the promotion gate and remains
  non-promoting with reason
  `fixture_bridge_dogfood_needs_real_extension_live_gate_before_promotion`.
- `collect-computer-use-browser-chrome-live-extension-dogfood.mjs` launches a
  real Playwright Chromium profile with the unpacked Browser Bridge extension,
  configures the daemon bridge before commands, uses CDP download behavior so
  the Chrome downloads API writes into the approved smoke root, waits for
  `download.observe` to reach `complete` before `download.verify`, and passes
  the allowed tab id to fixed-command `debugger.print_to_pdf`.
- `browser_chrome_live_extension_dogfood` is part of the promotion gate and
  remains non-promoting with reason
  `real_extension_local_fixture_needs_public_site_repeated_gate_before_promotion`.
- `collect-computer-use-browser-chrome-public-extension-dogfood.mjs` launches
  the same real extension path against public unauthenticated targets
  (`example.com` and a W3C dummy PDF), runs two samples each for
  `download.start` + `download.verify` and fixed-command
  `debugger.print_to_pdf`, plus two bounded
  `tab_group.claim/update/release` samples on a dogfood-owned public tab, plus
  two one-time `history.search` samples on the fresh dogfood browser profile,
  plus two `permission.get/set/rollback` samples each for bounded camera,
  microphone, and location contentSettings on `example.com`, plus two multi-tab
  `tab_group.claim/update/release` samples over explicit dogfood-owned public
  tab ids, plus two `file_upload.inspect/set_files/clear` samples against a
  public unauthenticated file input without form submission, records public host
  plus URL hash metadata only, omits raw PDF bytes, keeps history output to
  host/count/path-redaction proof, keeps permission output to
  host/scoped-setting/type-matrix/rollback proof, keeps multi-tab output to
  tab-count/release-count proof, and keeps file-upload output to input-count,
  selected-basename, clear-status, and no-submit proof.
- The public-extension collector also covers live profile approval before the
  command matrix: no-profile `regular_browser_extension` startup blocks with
  exact missing grants, a narrow one-time Browser Chrome profile is created and
  attached to the blocked run, attach/eval evidence is recorded, and the same
  profile is reused for the real extension commands.
- `browser_chrome_public_extension_dogfood` is part of the promotion gate as a
  promotable public-site repeated real-extension gate.

## Phase 2 - Computer Session Main Loop

Goal:

- Make Computer Session the main observe/plan/act/verify loop rather than a
  collection of direct operation routes.

Hot files:

- `src/daemon/computer-use/sessionRuntime.ts`
- `src/daemon/computer-use/effectVerifier.ts`
- `src/daemon/computer-use/surfaceManager.ts`
- `src/shared/protocol/computerUse.ts`
- `src/daemon/capability-dag/index.ts`
- `src/daemon/capability-runtime/runtime.ts`

Tasks:

- Add explicit session state machine.
- Extract observer fan-out helpers.
- Normalize action feedback for all adapters.
- Ensure every operation creates observe/action/verify/eval nodes.
- Add cancellation and cleanup reconciliation across surfaces.
- Keep backwards-compatible routes.

Acceptance:

- Browser Action, Browser Chrome, Toolsmith, terminal, screen observe, and
  native blocked boundaries all produce consistent debug bundle sections.

## Phase 3 - Permission Profile Enforcement

Goal:

- Make renderer UX and daemon policy converge.

Hot files:

- `src/daemon/scoped-autonomy/permissionProfile.ts`
- `src/daemon/computer-use/sessionRuntime.ts`
- `src/daemon/capability-runtime/safety.ts`
- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `src/renderer/components/AutonomyToolsmithPanel.tsx`

Tasks:

- Enforce deny rules before materialization, smoke, execution, and artifact
  persistence.
- Show exact blocked grants in renderer.
- Add one-time profile narrowing from blocked sessions.
- Ensure persistent high-risk grants remain blocked unless future policy says
  otherwise.

Acceptance:

- `smoke:computer-use-one-time-profile` and renderer profile smokes prove
  allowed only with exact grants.

## Phase 4 - Browser Action And Browser Chrome Promotion

Goal:

- Convert browser parity from fixture pass to repeated live proof.

Tasks:

- Expand live Browser Action recovery corpus.
- Add real-extension Browser Chrome live dogfood gates beside the now-complete
  repeated fixture-bridge gate. Local-fixture and first public-site
  real-extension download/PDF/tab-group/history/permission-matrix/multi-tab/
  file-upload/profile-approval evidence is now complete; next evidence should
  cover file-picker/native picker selection after signed helper v2, actual
  browser permission bubble native-click recovery after signed helper v2, or
  renderer polish for repeated dogfood outcomes. A blocked Computer Session
  `browser_permission_bubble_action` boundary now proves permission-bubble
  native-click recovery stops before input/mutation until helper v2 is signed
  and available.
- Add extension reload UX.
- Polish restricted-page state.
- Add renderer evidence for repeated dogfood outcomes.
- Current renderer evidence includes a public Browser Chrome proof panel for
  repeated public-extension sample count, p95, host coverage, profile approval,
  command-family coverage, permission matrix, and redaction proof. It also
  includes a native boundary proof panel for the non-promoting
  `windows_native_watch_boundary` gate, showing foreground input, file picker,
  permission popup, and signing guard state from daemon-owned metrics.

Verification:

```powershell
npm run smoke:browser-action
npm run smoke:computer-use-browser-parity
npm run smoke:computer-use-browser-chrome
npm run dogfood:computer-use-browser
npm run dogfood:computer-use-browser-live
npm run dogfood:computer-use-browser-chrome
npm run dogfood:computer-use-browser-chrome-live-extension
npm run smoke:computer-use-browser-chrome-live-extension-dogfood
npm run dogfood:computer-use-browser-chrome-public-extension
npm run smoke:computer-use-browser-chrome-public-extension-dogfood
```

## Phase 5 - Toolsmith Breadth

Goal:

- Let scoped YOLO fill missing capabilities under bounded profiles.

Status: repeated fixture breadth and first repeated live/local-live breadth
gates implemented on 2026-05-16. Broader generated ad hoc tools and
package-consuming live scenarios remain future promotion work.

Tasks:

- Add more generated ad hoc tool scenarios. Started:
  `dogfood:scoped-autonomy-self-implementation` now covers
  `web_research_to_pdf`, `terminal_generated_tool`, and
  `browser_download_verify`, plus a high-risk native workflow blocked before
  materialization.
- Improve smoke failure parse/revise loop. Started: the dogfood forces an
  initial web/PDF smoke failure, revises source, activates only after smoke
  passes, and records the revision/provenance path.
- Add dependency policy evidence. Started: `dependency_prepare` and
  `smoke:scoped-autonomy-npm-dependency-prepare` cover isolated npm
  lock/provenance when exact package-install grants exist. Dependency prepare
  now also redacts absolute `file:` package paths from tool-run output and eval
  evidence, and the smoke asserts no absolute path leaks. The same smoke now
  proves package-consuming execution: Toolsmith performs isolated npm install,
  records installed package provenance, passes the dependency workspace only via
  `CODEX_WIDGET_TOOL_DEPENDENCY_ROOT`, imports the prepared package from the
  generated tool entrypoint, writes a blob-backed artifact, and records
  `toolsmith_execute` evidence without leaking the dependency workspace path.
  Repeated package-consuming dogfood is also started:
  `dogfood:scoped-autonomy-npm-dependency` records two local npm dependency
  prepare/execute/rerun scenarios, appends
  `docs/reports/assets/scoped-autonomy-npm-dependency-runs.jsonl`, and the
  promotion gate tracks `scoped_autonomy_npm_dependency_dogfood` as passed but
  non-promoting. External registry package install remains future work until
  package allowlist, provenance review, and lockfile policy exist. The first
  allowlist boundary is now implemented: autonomy profiles carry
  `packageAllowlist` with a default `file:*` policy, external registry packages
  require exact `npm:name@version` grants, and missing grants block before
  install. Future work is reviewed external package promotion, not broad
  `packageInstall: true` access. Dependency prepare now also emits
  `toolsmith-dependency-policy-review.v1`, dogfood/promotion gates require that
  review evidence, and the renderer Toolsmith panel surfaces package policy
  status.
- Add generated browser_download_verify or local conversion slices as needed.
  Started: `local_document_conversion.v1` now materializes a dedicated
  Markdown/text-to-PDF converter under the daemon runtime workspace, passes
  smoke before activation, executes only inside scoped profile grants, skips
  web crawl/extract DAG nodes, records source-content hash plus Markdown/PDF
  blob resources, and participates in fixture breadth rerun/p95 evidence.
- Add rerun stability promotion gates. Started:
  `scoped_autonomy_self_implementation_breadth` verifies matched scalar and
  artifact rerun comparisons for all four generated tool classes. It also
  reads `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`
  and verifies two execute/rerun samples per class, p95 latency samples, and
  sample path redaction. It remains non-promoting until repeated live
  generated-tool samples exist.
- Add repeated live generated-tool breadth. Started:
  `scoped_autonomy_generated_tool_live_breadth` reads
  `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-runs.jsonl`
  and verifies two execute samples per class, matched reruns, p95 latency,
  official OpenAI web source-quality/hash calibration, real Node command
  proof, public browser-backed download verification, and path redaction. This
  gate is eligible for generated-tool promotion review, but it is still the
  first live breadth set rather than broad generated-tool coverage.

Verification:

```powershell
npm run smoke:scoped-autonomy-self-implementation
npm run smoke:scoped-autonomy-npm-dependency-prepare
npm run smoke:computer-use-toolsmith-artifact
npm run dogfood:scoped-autonomy-self-implementation
npm run dogfood:scoped-autonomy-generated-tool-live-breadth
npm run smoke:scoped-autonomy-generated-tool-live-breadth
npm run dogfood:computer-use-toolsmith-live
npm run dogfood:scoped-autonomy-web-research-live
npm run gate:computer-use-promotion
```

## Phase 6 - Perception Graph And ROI Cascade

Goal:

- Make screen/DOM/UIA/OCR evidence a unified target substrate.

Tasks:

- Add graph merge for DOM/UIA/OCR/screen observations.
- Persist ROI resources and cascade stage timings.
- Add dirty-region early exits.
- Gate high-risk actions on actionable current evidence.
- Add renderer/debug graph export.

Verification:

```powershell
npm run smoke:research-performance-architecture
npm run smoke:vision-context
npm run smoke:computer-use-debug-bundle
```

## Phase 7 - Native Helper v2 Decision And Boundary

Goal:

- Move from blocked native boundaries to signed, bounded helper v2 workflows
  only when signing and guards are real.

Tasks:

- Choose Rust/.NET/PowerShell helper v2 implementation path.
- Add signed-helper capability discovery.
  - Started: the Rust helper `status` emits
    `browser-native-desktop-helper-capability-manifest.v2`, and daemon
    diagnostics propagate supported current-v1 commands plus helper-v2 guarded
    commands through `helperCapabilities`/`helperV2Boundary`.
  - Still blocked: real helper-v2 foreground input, file-picker selection, and
    browser permission-popup native clicks require signing, countdown/input
    collision guards, and release-gate proof before any input is enabled.
- Harden foreground watch preflight before helper-v2 execution.
  - Started: `ForegroundWatchPreflightState` is now shared protocol, and the
    runtime/smoke/gate cover target identity, surface lock, timeout guard,
    user-input abort, and active-window drift abort before native input.
  - Started: Rust helper `watch_preflight` now returns observe-only helper-side
    evidence for active browser-window identity, process allowlist,
    active-window drift, and Win32 last-input idle state; daemon status exposes
    this as `helperWatchPreflight`/`helperSideWatchPreflightPresent`.
  - Started: `watch_preflight` can run bounded dry-run monitoring with
    `watchPreflight.monitorMs`, sampling last-input tick changes and focused
    process drift without sending input; daemon status exposes
    `helperSideContinuousMonitorPresent`.
  - Started: release readiness now has an automated
    `browser-native-helper-contract` check backed by
    `browser-native-desktop-helper-contract-readiness.v1`. It probes the built
    helper for manifest v2, observe-only watch preflight, helper-side guard
    schema, bounded monitor samples, and no native input before signing/manual
    gates can pass.
  - Started: Rust helper exposes `foreground_watch_execute` only as a disabled
    helper-v2 executor contract. It names the signing gate, required
    preconditions, and `actualInputSent: false`, giving future executor wiring
    a testable command shape without enabling foreground input.
  - Started: Computer Session `visual_desktop_action` blocked evidence now
    includes the same shared `foregroundWatchExecutor` state in DAG output,
    safety, observation, rollback metadata, and verifier records.
  - Still blocked: continuous helper-side mouse drift, keyboard focus drift,
    real countdown/execution monitoring, and foreground input cancellation must
    be implemented inside signed helper v2 before enabling execution.
- Implement read-only UIA observe first.
- Implement file picker and permission bubble only after guards.
- Keep broad Windows settings mutation blocked.

Verification:

```powershell
npm run smoke:computer-use-native-watch-boundary
npm run smoke:computer-use-windows-settings
npm run release:readiness
```

## Phase 8 - Renderer Computer Use Control Surface

Goal:

- Make the widget usable as the operator console for Computer Use.

Status: active, materially implemented. The panel now exposes session/surface/
profile state, blocked-grant one-time profile creation, approval previews,
Browser Chrome/Toolsmith/native proof panels, debug bundle copy/save,
artifacts, rollback controls, verifier/failure-memory sections, and latest
dogfood/report/evidence links. Remaining work is polish and any new evidence
families introduced by later native/helper-v2 or generated-tool slices.

Tasks:

- Show active session state, surface, profile, DAG, gaps, approvals, evidence,
  artifacts, rollback, and debug bundle.
- Add debug bundle copy/save. Implemented.
- Add profile manager and narrow one-time approval polish.
- Add recent failed transactions and dogfood links. Failure-memory,
  verifier-audit, rollback, and latest dogfood/report/evidence links are now
  visible in the Computer Use panel through daemon-owned debug/eval routes.
- Avoid hiding high-risk actions behind generic "continue".

Verification:

```powershell
npm run build:renderer
npm run smoke:renderer-computer-use-live-refresh
npm run smoke:renderer-computer-use-profile-draft
npm run smoke:renderer-computer-use-browser-chrome-evidence
npm run smoke:renderer-chat
```

## Phase 9 - Release Hardening

Goal:

- Ensure parity features cannot be accidentally released as production-ready
  without signing/store/evidence gates.

Tasks:

- Keep unsigned helper v1/v2 dev-only.
- Update browser store packet for expanded permissions.
- Gate release readiness on signing and high-risk dogfood.
- Add installer smoke checks for bundled helper signatures when available.

Verification:

```powershell
npm run release:readiness
npm run smoke:browser-store-readiness
npm run smoke:all
```

## Phase 10 - Final Completion Audit

Only after all phases:

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
npm run smoke:renderer-computer-use-profile-draft
npm run smoke:renderer-computer-use-browser-chrome-evidence
npm run smoke:renderer-autonomy-rerun-history
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

Known acceptable warnings must be documented, not ignored.
