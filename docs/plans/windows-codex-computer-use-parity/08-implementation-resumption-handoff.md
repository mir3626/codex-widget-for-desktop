# 08 - Implementation Resumption Handoff

Status: active resumption shard
Date: 2026-05-16

## Purpose

This shard exists so a future Codex session can resume the Windows Codex
Computer Use parity migration after context loss, compaction, or handoff by
reading durable files only.

Read this shard after:

1. `docs/plans/windows-codex-computer-use-parity-handoff.md`
2. `docs/plans/windows-codex-computer-use-parity/README.md`
3. `docs/plans/windows-codex-computer-use-parity/00-overview.md`
4. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/README.md`
5. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/07-current-status-ledger.md`
6. `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`

This shard is not a replacement for the design shards. It is the operational
handoff: current state, exact resume rules, current gaps, and the next safe
implementation order.

For the product-owner approved execution plan, detailed enough to resume after
context loss, read the sharded pack under
`docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/`.

## Product-Owner Decision

The product owner accepted the current direction:

- Use Codex macOS Computer Use behavior as the benchmarked UX target.
- Implement the Windows widget through daemon-owned Computer Session Runtime,
  explicit surfaces, structured evidence, permission gates, and modular
  adapters.
- When macOS behavior is superior to an existing widget path, redesign the
  widget path toward the stronger behavior unless a Windows safety/platform
  boundary prevents exact parity.
- If Windows cannot implement a macOS-style behavior exactly, implement the same
  user outcome through a bounded Windows-native equivalent.
- Preserve non-negotiable boundaries: approval, restricted pages, credential
  secrecy, local-only daemon security, destructive-action protections, raw
  screenshot/audio retention, generated-code sandboxing, and release signing.

## Resume Rules

Before editing:

1. Confirm initialization state:
   - `docs/context/product.md` exists and is project-owned.
   - `.vibe/agent/sprint-status.json` exists and project name is
     `codex-widget-for-desktop`.
2. Run `git status --short`.
3. Do not revert unrelated worktree changes if `git status --short` shows any.
4. Read the files you intend to edit; several large files already contain
   product-owner edits and multi-day generated changes.
5. Keep work in Codex Orchestrator maintenance mode unless a Sprint prompt with
   explicit `Files Generator may touch` scope is supplied.
6. Mark a global `/goal` complete only after the latest audit reports 0
   missing local requirements, the required verification boundary has passed,
   and the remaining guarded items are documented as external blockers rather
   than completed native execution.
7. Do not push unless the product owner asks for a push.

When changing behavior:

1. Make a narrow vertical slice.
2. Update this handoff/checklist if the slice changes architecture or state.
3. Run focused smokes for touched modules.
4. Run aggregate verification before claiming a stable boundary:
   - `npm run lint`
   - `npm run smoke:all`
   - `git diff --check`
   - strict UTF-8/mojibake scan for touched text files
   - `.cs` BOM check if `.cs` files are touched
   - `npm run vibe:checkpoint`

Known non-failing notes from current aggregate verification:

- Unsigned browser-native helper is allowed in development mode.
- A Windows temp cleanup deferred retry can appear in `smoke:all`.
- `git diff --check` may emit existing CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`.

## Current Implementation Snapshot

The parity migration has moved beyond design-only state. The large Computer Use
runtime implementation and its dogfood/report artifacts were committed to
`main` on 2026-05-16. Still run `git status --short` before editing because
later sessions may introduce unrelated local changes.

Implemented or materially started:

- Shared `ComputerAction` and Computer Session protocol in
  `src/shared/protocol/computerUse.ts`.
- `ComputerSessionRuntime` in `src/daemon/computer-use/sessionRuntime.ts`.
- `ExecutionSurfaceManager` in `src/daemon/computer-use/surfaceManager.ts`.
- HTTP routes under
  `src/daemon/server/http/routes/computerUseSessionRoutes.ts`.
- Renderer Computer Use panel in
  `src/renderer/components/ComputerUseSessionsPanel.tsx`.
- Renderer live refresh path for Computer Use: `WidgetRuntime` increments a
  refresh signal on `computer.session.*`, `capability.job`, `capability.jobs`,
  and `capability.resource` daemon events; Activity details passes that signal
  into `ComputerUseSessionsPanel`, which debounces quiet session-list refreshes
  and refetches the selected debug bundle after the refresh settles.
- Browser Action prompt and structured operation execution through Computer
  Session.
- Isolated Playwright browser lifecycle for session-scoped Browser Action.
- Browser Chrome deep-action commands through Computer Session:
  tab groups, bookmarks, downloads, history, debugger, file upload preflight,
  and site permissions.
- Terminal operations through Computer Session with profile-gated command
  execution, declared artifact capture, output-root create/modify/delete delta
  manifests, path-redacted artifact evidence, and explicit confirmed-delete
  rollback for generated artifacts. Terminal preapproval blocks unquoted shell
  control operators before allow-prefix evaluation so one allowed command cannot
  smuggle a chained second command. Terminal debug-bundle output is sanitized to
  bounded length/hash/preview metadata with stdout/stderr truncation flags and
  helper byte-limit evidence; raw stdout/stderr and raw truncation internals are
  not exported.
- Scoped autonomy Toolsmith execution through Computer Session, including
  web research to Markdown/PDF artifact mirroring.
- Autonomy Toolsmith renderer stability and rerun evidence, including
  historical rerun comparison rows for matched/changed scalar and artifact
  outcomes.
- Scoped autonomy self-implementation repeated fixture sample ledger:
  `dogfood:scoped-autonomy-self-implementation` now appends redacted
  execute/rerun latency samples for `web_research_to_pdf`,
  `terminal_generated_tool`, and `browser_download_verify` to
  `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`; the
  promotion gate exposes class coverage, p95, rerun artifact matches, and path
  redaction while remaining non-promoting until live generated-tool breadth is
  collected.
- Scoped autonomy generated-tool live breadth:
  `dogfood:scoped-autonomy-generated-tool-live-breadth` now runs two
  execute/rerun samples each for `web_research_to_pdf`,
  `terminal_generated_tool`, and `browser_download_verify`, writes dated
  evidence under
  `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-2026-05-16/`,
  appends redacted rows to
  `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-runs.jsonl`,
  and exposes the promotable gate
  `scoped_autonomy_generated_tool_live_breadth`.
- Session debug bundle with observations, perception graphs, eval resources,
  action feedback, rollback actions, failure memory, verifier audit, sources,
  artifacts, and freshness summaries.
- Browser Action target evidence backed by shared perception graph arbitration.
- Screen observe perception graphs and ROI/tile-cache evidence.
- Native browser-window helper UIA graph evidence.
- Foreground visual desktop action boundary that blocks broad desktop mutation
  until helper v2/watch-mode preconditions exist.
- Helper-v2-only native commands now fail closed with explicit disabled
  contracts before signing gates. `foreground_watch_execute` returns the
  disabled foreground executor contract, while `capture_screenshot`,
  `file_picker_select`, `browser_permission_popup_click`,
  `clipboard_set_scoped`, and `menu_command` return
  `browser-native-desktop-helper-v2-disabled-command.v1` with no input, no
  local path disclosure, no permission mutation, no screenshot capture, no
  clipboard content logging, and the shared `browser-native-helper-signing`
  release gate.
- Native file picker boundary via `native_file_picker_action`, blocked before
  local path disclosure or native input until signed helper v2 and explicit
  file-selection foreground guards exist.
- Future VM/sandbox boundary for `future_vm_session`, blocked before VM
  creation, network bridge, host mutation, clipboard/file sync, or raw
  screenshot retention until a real backend/isolation/lifecycle policy exists.
- Session-level effect verifier and recovery records.
- Rollback action route for safe/generated artifacts with user-artifact deletion
  still behind explicit confirmation flags.
- Browser native helper release-readiness diagnostics and release signing gate.
- Live scoped autonomy and Computer Session Toolsmith OpenAI docs
  research-to-PDF dogfood evidence.

Current uncommitted evidence and reports include 2026-05-16 dogfood assets under:

- `docs/dogfood/computer-use-process-validation-30-2026-05-16.json`
- `docs/dogfood/scoped-autonomy-web-research-live-2026-05-16.json`
- `docs/dogfood/computer-use-toolsmith-live-2026-05-16.json`
- `docs/dogfood/computer-use-browser-prompt-dogfood-2026-05-16.json`
- `docs/reports/assets/computer-use-process-validation-30-2026-05-16/`
- `docs/reports/assets/scoped-autonomy-web-research-live-2026-05-16/`
- `docs/reports/assets/computer-use-toolsmith-live-2026-05-16/`
- `docs/reports/assets/computer-use-browser-prompt-dogfood-2026-05-16/`
- `docs/reports/assets/scoped-autonomy-self-implementation-2026-05-16/`
- `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`
- `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-2026-05-16/`
- `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-runs.jsonl`

## Current Source Hotspots

If resuming implementation, these are the primary code surfaces:

| Area | Files |
|---|---|
| Shared protocol | `src/shared/protocol/computerUse.ts`, `src/shared/protocol.ts`, `src/shared/protocol/server.ts`, `src/shared/protocol/researchArchitecture.ts` |
| Session runtime | `src/daemon/computer-use/sessionRuntime.ts`, `src/daemon/computer-use/surfaceManager.ts`, `src/daemon/computer-use/effectVerifier.ts` |
| HTTP API | `src/daemon/server.ts`, `src/daemon/server/http/context.ts`, `src/daemon/server/http/routes.ts`, `src/daemon/server/http/routes/computerUseSessionRoutes.ts`, `src/daemon/server/http/routes/computerUseEvalRoutes.ts` |
| Browser Action bridge | `src/daemon/server/browser-action/*`, `src/daemon/browser-action/*`, `providers/browser-dom-extension/bridge/browser-chrome.js`, `providers/browser-dom-extension/manifest.json` |
| Browser Chrome commands | `src/daemon/browser-chrome/commandBridge.ts`, `src/daemon/capability-runtime/safety.ts`, `src/daemon/capability-runtime/runtime.ts`, `src/daemon/capability-runtime/verification.ts` |
| Perception/eval | `src/daemon/perception-graph/index.ts`, `src/daemon/computer-use-eval/index.ts`, `src/daemon/computer-use-eval/verifierAudit.ts`, `src/daemon/storage/*` |
| Toolsmith | `src/daemon/scoped-autonomy/toolsmithRuntime.ts`, scoped autonomy routes under `src/daemon/server/http/routes.ts` and context wiring |
| Renderer | `src/renderer/components/ActivityLog.tsx`, `src/renderer/components/ComputerUseSessionsPanel.tsx`, `src/renderer/components/AutonomyToolsmithPanel.tsx`, `src/renderer/styles/activity-capability.css` |
| Smokes/dogfood | `scripts/smoke-computer-use-*.mjs`, `scripts/collect-computer-use-*.mjs`, `scripts/collect-scoped-autonomy-*.mjs`, `scripts/smoke-all.mjs` |

## Architecture Contract To Preserve

The session loop must remain:

```text
user request
  -> permission/profile check
  -> surface selection
  -> observe through one or more safe adapters
  -> perception graph / evidence graph
  -> plan normalized action or structured operation
  -> approval gate where needed
  -> execute via adapter/capability job
  -> post-observe / feedback
  -> effect verifier
  -> rollback/recovery/failure memory/eval ledger
  -> completed, blocked, failed, cancelled, or manual takeover
```

Structured fast paths are allowed and preferred when safer than visual control,
but they must still produce user-visible or artifact-visible evidence. A
structured path cannot silently skip observation, verification, safety decision,
or eval ledger records.

## Surface Policy

Default surface order for practical Computer Use:

1. `isolated_browser`
   - Use for public web tasks, search, navigation, extraction, form fill without
     user profile dependency.
   - Preferred for Browser Action parity because it is bounded and reproducible.
2. `tool_workspace`
   - Use for research-to-PDF, document conversion, generated helper tools, and
     local artifacts.
   - Must record generated source hashes, commands, artifacts, and rollback.
3. `pty_workspace`
   - Use for safe local commands when the permission profile grants the command
     prefix and output roots.
   - Must redact terminal output in debug bundles.
4. `regular_browser_extension`
   - Use only when the task explicitly needs the user's active browser context.
   - Requires stronger grants for history, debugger, file upload, downloads, and
     current-profile mutation.
5. `foreground_desktop_watch`
   - Block broad mutation until helper v2 preconditions exist.
   - May observe/explain or run narrow signed helper workflows only.
6. `future_vm_session`
   - Reserved for broader Windows app workflows that need stronger isolation.
   - Current runtime blocks this surface before VM creation or host mutation
     with `future_vm_session_backend_not_available`.

## Adapter Preference Policy

For browser and app targets:

1. DOM/selector evidence.
2. Playwright locator/CDP in isolated browser.
3. Extension injected DOM on granted current browser tabs.
4. Browser Chrome API where the target is a browser chrome feature.
5. Native browser-window UIA helper for bounded browser chrome fallback.
6. Screen/OCR/Vision evidence for read-only grounding.
7. Visual coordinate input only when watch-mode or VM preconditions are met.

Do not let non-actionable visual evidence authorize side effects. OCR/screenshot
nodes may explain a read-only target, but side-effect/high-risk actions require
current actionable DOM, UIA, native, or approved watch-mode evidence.

## Browser Chrome Deep Actions State

Current command families:

- `tab_group.*`
- `bookmark.*`
- `download.*`
- `history.*`
- `debugger.*`
- `file_upload.*`
- `permission.get`
- `permission.set`

Important boundaries:

- History remains one-time high-risk. No always-allow policy.
- Debugger remains high-risk. Fixed commands only; no arbitrary CDP/eval from
  user input.
- Site permission mutation uses Chrome `contentSettings`, not blind coordinate
  clicks on permission bubbles.
- File upload can inspect and debugger-set explicit approved files, but native
  picker workflow remains helper-v2 work.
- Download verification can hash a file only when the scoped profile grants the
  declared file root.

## Toolsmith And Scoped YOLO State

Scoped autonomy/Toolsmith is the preferred answer when a user request can be
fulfilled more reliably by generating or materializing a bounded local tool than
by visual UI control.

Current useful slice:

- Web research to Markdown/PDF with allowed-domain live fetch and Playwright
  fallback capture when official docs block daemon-side HTTP.
- Local Markdown/text-to-PDF conversion through `local_document_conversion.v1`.
  This is intentionally not a web-research alias: `gapDetector` classifies
  conversion-only requests, Toolsmith materializes a dedicated runtime
  converter, and the DAG skips crawl/extract/source-verify nodes while still
  recording draft/render/store/verify tool runs, source-content hash evidence,
  blob-backed Markdown/PDF resources, and rerun comparison.
- Parent Computer Session mirrors child artifacts and source/citation evidence.
- Renderer shows Sources and Artifacts.
- Rollback for generated/temp artifacts is represented and partly executable.

Still required before calling this complete:

- Package install isolation and provenance for allowed generated tools.
- Rerun comparison and stability estimates for generated tools are implemented
  for current Toolsmith reruns, including artifact-aware comparison and
  renderer-visible historical rows. Fixture breadth dogfood now covers
  `web_research_to_pdf`, `local_document_conversion`,
  `terminal_generated_tool`, and `browser_download_verify`; repeated live
  generated-tool dogfood is still required before promotion.
- More than one live run per promoted vertical slice.
- Source quality review gate rather than accepting one successful fetch.

## Native Windows Helper And Watch-Mode State

Current native helper is not a broad desktop-control helper.

Current implemented meaning:

- `native_browser_window_action` = bounded browser-window/UIA helper path.
- `visual_desktop_action` = future true foreground desktop action path.

Current hard block for broad foreground visual mutation:

- no signed helper v2
- no visible countdown
- no active-window lease/assertion
- no process allowlist
- no user-idle guard
- no abort-on-user-input
- no pre/post screenshot evidence policy
- no effect-verification/rollback proof

Release readiness now treats unsigned native helpers and PowerShell fallback
helpers as development-only. Do not weaken this for convenience.

## Promotion And Dogfood Policy

Do not promote a Computer Use slice based on:

- one live success
- fixture-only success
- model confidence
- raw OCR/ASR accuracy
- average latency while p95 regresses
- retries hiding flakiness
- inconclusive verifier output

Promote only when one of these is demonstrated without safety regression:

- task success improves without p95 regression
- p95 improves without task-success regression
- proof rate improves
- unsafe rejection does not regress
- clarification rate drops without unsafe-action increase
- recovery success improves on known failure corpus
- verifier false-positive/false-negative audit improves

Current evidence snapshot:

- 30-case process validation fixture evidence exists for 2026-05-16 and passes
  fixture readiness, but fixture success alone cannot promote live behavior.
  The latest refreshed matrix records 21 passed, 9 blocked, 0 needs-follow-up,
  and 0 unexpected failures. It now treats Codex research-to-PDF, browser PDF
  download verification, and complex-chart VLM fallback as implemented fixture
  paths with blob-backed eval resources rather than as missing features.
- Scoped autonomy live OpenAI research-to-PDF has archived 2026-05-14 baseline
  evidence and current 2026-05-16 evidence plus repeated redacted samples in
  `docs/reports/assets/scoped-autonomy-web-research-live-runs.jsonl`.
- Parent Computer Session Toolsmith live OpenAI research-to-PDF has repeated
  redacted samples in
  `docs/reports/assets/computer-use-toolsmith-live-runs.jsonl`.
- Parent Computer Session Browser Action prompt live dogfood has repeated
  public-site samples in
  `docs/reports/assets/computer-use-browser-prompt-live-runs.jsonl`.
- Both live paths now record accepted source-quality review and p95 samples, but
  source evidence remains browser-fallback-only.
- Browser fallback transport is now calibrated through repeated stable text
  hashes and lengths in the redacted sample ledgers, so both live paths are
  eligible for promotion review even when daemon-side HTTP fetch is blocked by
  the target site.

Promotion gate status:

- `scripts/gate-computer-use-promotion.mjs` is wired through
  `gate:computer-use-promotion`.
- `smoke:computer-use-promotion-gate` dry-runs the gate.
- `scripts/smoke-all.mjs` includes the dry-run gate.
- The latest written evidence is
  `docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json`.
- The latest report is
  `docs/reports/computer-use-promotion-gate-2026-05-16.md`.
- Current overall status is `promotable` for the live research-to-PDF slices.
  The fixture gate passes readiness but remains non-promoting by design.
- `browser_action_semantic_live_corpus` is also promotable. It is backed by
  `docs/dogfood/browser-action-semantic-live-corpus.jsonl` plus reviewed live
  Browser Action reports, and covers read, filter/tab activation, browser
  history navigation, search form submit, and representative content selection
  across widget UI and isolated modes.
- `browser_action_recovery_live_corpus` is also promotable. It is backed by
  `docs/dogfood/browser-action-recovery-live-corpus.jsonl`, links reviewed
  failure rows to later passing recovery rows, and covers `permission_missing`,
  `wrong_effect`, and `latency_regression` across widget UI and isolated
  dogfood without storing raw page content.
- `browser_bridge_restricted_reload_boundary` is passed but non-promoting. It
  verifies the `browser.restricted.extensions.reload` fixture remains blocked
  by design, `reloadRequired`/`permission_needed`/`restricted` bridge states
  are covered by smoke, the extension popup exposes the user-gesture
  `Reload bridge` path through `chrome.runtime.reload()`, renderer Browser
  Action UI shows recovery guidance, and restricted pages are still blocked
  before injected Browser Action commands.
- `computer_session_browser_prompt_live` is also promotable. It is backed by
  `docs/reports/assets/computer-use-browser-prompt-live-runs.jsonl` plus the
  dated evidence/report and covers read, search form submit, representative
  link selection, and navigation across public `example.com`, `wikipedia.org`,
  and `iana.org` surfaces through the parent Computer Session prompt route.
- `windows_native_watch_boundary` is passed but non-promoting. It proves the
  current Windows foreground desktop release guard is intact: read-only desktop
  observe works, unsupported native mutations are blocked by design, high-risk
  Windows mutation is rejected, unsigned helper signing remains deferred, the
  native watch boundary smoke is wired into `smoke:all`, and blocked foreground
  visual actions record `actualInputSent: false` before helper execution. The
  gate now also checks that native file picker attempts are blocked before
  local path disclosure and that the native boundary smoke covers
  `native_file_picker_action`.
- `windows_settings_reversible_dogfood_boundary` is passed but non-promoting.
  It proves the Windows settings dogfood progression now includes read-only
  registry observation, bounded app-owned reversible registry mutation,
  exact-profile grants, runtime guard evidence, terminal observation evidence,
  and broad settings mutation rejection.
- Daemon exposes the latest gate through `GET /computer-use/eval/promotion-gate`.
- Renderer Computer Use panel shows the Promotion gate summary and recent gate
  rows. The panel labels promotable gates as `eligible` and passed
  non-promoting gates as `guarded`, and it shows enough rows to include the
  Browser Action semantic corpus and Windows native watch release guard.

## Next Implementation Order

Use this order unless the product owner explicitly reprioritizes:

1. Promotion gate hardening.
   - Make promotion policy machine-checkable.
   - Finish or verify `scripts/gate-computer-use-promotion.mjs`.
   - Wire package scripts and `smoke:all`.
   - Record blocked live promotion until repeated live traces exist.
   - Current status: implemented and wired; continue by improving evidence
     quality and live trace repetition rather than weakening the gate.
2. Live trace repetition.
   - Run multiple live scoped autonomy and parent Computer Session
     research-to-PDF dogfoods.
   - Record p50/p95 latency samples, valid source counts, fallback usage, and
     source-quality review. Latest scripts now record these fields.
   - Current status: repeated sample recording and browser fallback calibration
     are implemented for research-to-PDF. Continue with the next live dogfood
     category rather than widening this slice further.
3. Full Toolsmith self-implementation breadth.
   - Extend from reviewed web research template toward generated bounded tools.
   - Add package install isolation, manifest provenance, rerun comparison, and
     inactive failed-tool retention.
   - Current status: self-implementation iteration, failed inactive specs,
     rerun comparison, rollback, debug bundle export, terminal/download
     templates, and staged web research execution are implemented. The
     `dependency_prepare` node now records a real Toolsmith tool run/eval step,
     manifest dependency provenance, optional system dependency notes, and
     isolated npm lock/provenance behavior behind `package_install` plus `npm`
     command grants. `dogfood:scoped-autonomy-self-implementation` now records
     redacted fixture evidence for web/PDF, local document conversion,
     terminal generated tools, browser download verification, high-risk native
     blocking, and matched scalar/artifact rerun stability; the promotion gate
     tracks it as `scoped_autonomy_self_implementation_breadth`, passed but
     non-promoting. `dogfood:scoped-autonomy-generated-tool-live-breadth` now
     adds repeated live/local-live evidence for those four generated classes,
     including approved local Markdown source-file conversion. Continue by
     adding real package-consuming generated tool dogfood only when a use case
     requires it.
4. Browser Action live dogfood corpus.
   - Convert real browser traces into redacted semantic/live corpus records.
   - Calibrate target selection and recovery from repeated live failures.
   - Current status: semantic success corpus and recovery corpus are both
     represented in the promotion gate and eligible for review. Continue by
     adding more live failure/recovery pairs, especially restricted-page,
     reload-required, and permission-popup recovery cases.
- Direct parent Computer Session browser prompt dogfood is now also covered
     as a fixture-backed, non-promoting readiness slice. The new
     `dogfood:computer-use-browser` runner sends Korean user-like prompts
     through `/computer-use/sessions/:id/browser-action-prompt` and records
     prompt-run, DAG/eval/verifier, DOM observation, side-effect perception
     graph, action feedback, and isolated-browser cleanup evidence. It still
     has a separate public-site live prompt corpus through
     `dogfood:computer-use-browser-live`, which is eligible for promotion
     review after repeated sample rows across public hosts.
5. Renderer UX polish.
   - Make Computer Use panel show promotion gate state, live evidence gaps,
     blocked grants, source quality, and rollback consequences.
   - Keep high-risk approvals explicit and narrow.
   - Current status: promotion gate rows distinguish eligible vs guarded
     non-promoting slices. Blocked grant chips include requirement reasons and
     overflow counts, and one-time profile derivation now also reads DAG-node
     `missingRequirements`, not only safety decisions and awaiting jobs.
     Blocked runs now show a draft one-time profile preview before attachment,
     including scope, max uses, credential policy, risk classes, browser
     grants, exact command count, and write-root count.
     Selected active profiles now show profile details and lifecycle actions:
     scope/mode/status, risk classes, browser grant summary, command/write
     counts, generated-code state, credential policy, use count, expiry, and
     exact domain/command/write-root grant details. Disable/Expire buttons are
     backed by the existing profile update route.
     Artifact/source-quality details now show compact quality/proof metrics:
     direct vs browser-fallback source counts, total source characters,
     blob-backed artifact proof count, text/PDF counts, and missing blob proof.
     Autonomy Toolsmith now also summarizes selected-run stability, rerun
     comparison state, dependency provenance count/source mix, artifact contract
     count, and rollback impact without requiring users to open raw JSON.
     Reruns now store `toolsmith-rerun-comparison.v1` with scalar and artifact
     fingerprint comparison, record a dedicated eval step, and surface artifact
     delta count in the Toolsmith stability card. Historical rerun comparison
     rows are now visible in the Autonomy Toolsmith panel, showing
     matched/changed scalar/artifact verdicts, changed/missing/added counts,
     artifact totals, elapsed timing, and redacted rerun ids.
6. Native helper v2 design/implementation.
   - Keep broad desktop mutation blocked while building signed, bounded
     workflow-specific helper paths.
   - Start with browser chrome permission bubbles and file picker, not arbitrary
     Windows settings mutation.
7. Windows app/settings dogfood.
   - Add read-only first, reversible second, mutation-blocked third.
   - Do not enable unattended high-risk OS mutation without signing, rollback,
     active-window guard, and user approval proof.
   - Current status: `smoke:computer-use-windows-settings` covers read-only
     registry observation, a bounded reversible app-owned HKCU registry
     set/query/delete path, and a blocked broad settings mutation. The
     reversible path is exact-command and profile gated; broad Windows settings
     mutation remains blocked.
8. Future VM/sandbox surface.
   - Runtime boundary and smoke coverage are implemented.
   - Actual backend remains blocked until local Windows isolation and lifecycle
     management are proven.

## Latest Update: Computer Session Browser Prompt Dogfood

Implemented direct parent Computer Session browser prompt dogfood:

- Added `scripts/collect-computer-use-browser-dogfood.mjs` and package script
  `dogfood:computer-use-browser`.
- Added `scripts/smoke-computer-use-browser-dogfood.mjs` and package script
  `smoke:computer-use-browser-dogfood`.
- The runner starts the daemon, creates isolated-browser Computer Sessions, and
  sends user-like Korean prompts through
  `/computer-use/sessions/:id/browser-action-prompt`.
- Current fixture-backed scenarios cover read current page, search form fill
  and submit, representative content selection through a two-step click chain,
  and navigation to a target URL.
- Evidence is written to:
  - `docs/dogfood/computer-use-browser-prompt-dogfood-2026-05-16.json`
  - `docs/reports/computer-use-browser-prompt-dogfood-2026-05-16.md`
  - `docs/reports/assets/computer-use-browser-prompt-dogfood-2026-05-16/evidence.json`
  - `docs/reports/assets/computer-use-browser-prompt-dogfood-runs.jsonl`
- `scripts/gate-computer-use-promotion.mjs` now includes
  `computer_session_browser_prompt_dogfood`. It passes when the direct prompt
  route has prompt-run, DAG/eval/verifier, DOM observation, side-effect
  perception graph, action feedback, cleanup, redaction, and latency evidence.
- This gate is intentionally non-promoting:
  `promotionClass: fixture_gate_passed_live_gate_required`. A public-site live
  Computer Session browser prompt corpus is still required before promoting
  public browser behavior.
- The renderer Promotion gate section now renders all gate rows instead of
  truncating at six, so the added prompt dogfood gate and release guard can both
  be inspected.
- Final verification for this slice passed `npm run dogfood:computer-use-browser`,
  `npm run smoke:computer-use-browser-dogfood`,
  `npm run gate:computer-use-promotion`,
  `npm run smoke:computer-use-promotion-gate-route`,
  `npm run smoke:computer-use-promotion-gate`,
  `npm run build:renderer`, `npm run smoke:renderer-chat`, `npm run lint`,
  and `npm run smoke:all`. `git diff --check` returned only existing CRLF
  normalization warnings, UTF/mojibake scan passed, and no `.cs` files were
  touched.

## Latest Update: Computer Session Browser Prompt Live Corpus

Implemented repeated public-site live dogfood for the parent Computer Session
browser prompt route:

- Added `scripts/collect-computer-use-browser-live-dogfood.mjs` and package
  script `dogfood:computer-use-browser-live`.
- Added `scripts/smoke-computer-use-browser-live-dogfood.mjs` and package
  script `smoke:computer-use-browser-live-dogfood`.
- The live runner creates isolated-browser Computer Sessions and sends
  user-like prompts through `/computer-use/sessions/:id/browser-action-prompt`
  against public URLs:
  - `https://example.com/` for read-current-page
  - `https://www.wikipedia.org/` for search form fill/submit
  - `https://example.com/` -> `https://www.iana.org/help/example-domains` for
    representative link selection
  - `https://www.iana.org/domains/reserved` for navigation
- Evidence is written to:
  - `docs/dogfood/computer-use-browser-prompt-live-2026-05-16.json`
  - `docs/reports/computer-use-browser-prompt-live-2026-05-16.md`
  - `docs/reports/assets/computer-use-browser-prompt-live-2026-05-16/evidence.json`
  - `docs/reports/assets/computer-use-browser-prompt-live-runs.jsonl`
- The runner has been executed twice on 2026-05-16, producing 8 redacted live
  sample rows. The sample ledger records public host, action types, URL hash,
  prompt-run status, DAG/eval/verifier evidence counts, DOM observation counts,
  side-effect perception graph counts, action feedback counts, cleanup proof,
  and latency without raw DOM/screenshots/credentials.
- `scripts/gate-computer-use-promotion.mjs` now includes
  `computer_session_browser_prompt_live`. It is promotable only when there are
  repeated live samples, required intent coverage, `example.com`/
  `wikipedia.org`/`iana.org` host coverage, direct prompt-route evidence,
  completed prompt runs, DAG/eval/verifier evidence, DOM/graph/action-feedback
  evidence, cleanup proof, public URL metadata only, redaction, and p95 latency
  samples.
- This closes the previously open “direct public-site live Computer Session
  browser prompt dogfood” gap. Further work should add more live failure and
  recovery cases rather than weakening the current gate.
- Verification passed `node --check` for the new/gate scripts, two runs of
  `npm run dogfood:computer-use-browser-live`,
  `npm run smoke:computer-use-browser-live-dogfood`,
  `npm run gate:computer-use-promotion`,
  `npm run smoke:computer-use-promotion-gate-route`,
  `npm run smoke:computer-use-promotion-gate`, `npm run lint`, and final
  `npm run smoke:all`.

## Latest Update: Toolsmith NPM Dependency Prepare Smoke

Added isolated npm dependency-preparation coverage for generated Toolsmith
tools:

- Added `ScopedAutonomyRuntime.prepareToolDependencies(...)` so the dependency
  preparation step can be invoked and verified directly, using the same private
  permission and provenance path as the executable autonomy DAG.
- Added `scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs` and package
  script `smoke:scoped-autonomy-npm-dependency-prepare`.
- Added the smoke to `scripts/smoke-all.mjs`.
- The smoke creates a generated-tool manifest with a local `file:` npm fixture.
  This avoids a package-registry/network dependency while still exercising npm,
  `package.json`, and `package-lock.json` generation.
- The smoke first runs with a profile that grants the workspace and `npm`
  command but not `package_install`. Expected result: dependency preparation is
  `blocked`, the missing grant names `package_install`, and no npm lockfile is
  created.
- The smoke then runs with a profile that grants `package_install`, `npm`,
  workspace write, and `side_effect`. Expected result: dependency preparation is
  `completed`, `packageInstallPerformed` is true, `package.json` and
  `package-lock.json` exist only under the generated tool runtime workspace,
  lockfile hashes are recorded, and the eval step records grant usage plus
  lockfile provenance.
- During this work the smoke exposed a Windows runtime bug: `spawnSync("npm",
  { shell:false })` and direct `spawnSync("npm.cmd", ...)` are not reliable in
  the current Node/Windows environment. Toolsmith now invokes npm through
  `cmd.exe /d /s /c npm.cmd ...` on Windows while preserving a no-shell `npm`
  spawn on non-Windows platforms.
- Focused verification passed:
  - `node --check scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
  - `node --check scripts/smoke-all.mjs`
  - `npm run build:daemon`
  - `npm run smoke:scoped-autonomy-npm-dependency-prepare`
  - `npm run smoke:scoped-autonomy-self-implementation`
  - `npm run lint`

## Latest Update: Windows Settings Read-Only Smoke

Added a real Windows settings read-only Computer Session smoke and hardened an
existing HTTP smoke race:

- Added `scripts/smoke-computer-use-windows-settings.mjs` and package script
  `smoke:computer-use-windows-settings`; the smoke is included in
  `smoke:all`.
- The smoke creates a scoped autonomy profile that permits `reg query` only,
  starts a `pty_workspace` Computer Session, and executes
  `reg query HKCU\Environment` through the terminal capability path.
- It verifies the read path creates a completed terminal capability job,
  records a `terminal_permission_profile` allow safety decision, adds a
  terminal observation to the debug bundle, and redacts raw stdout/stderr from
  capability job output while keeping bounded preview/hash metadata.
- It then attempts a registry mutation command:
  `reg add HKCU\Environment /v CODEX_WIDGET_BLOCKED_SMOKE /t REG_SZ /d blocked /f`.
  The expected behavior is no capability job creation, a failed action DAG
  node, exact missing command/risk requirements, and
  `terminal_command_destructive_boundary` in safety/DAG evidence.
- The smoke intentionally uses `HKCU\Environment` instead of registry keys with
  spaces. This avoids Windows `cmd.exe /d /s /c` quote-handling ambiguity in the
  terminal helper while still exercising a real Windows registry settings read.
- During aggregate verification, `smoke:computer-use-session-http` exposed an
  intermittent race where prompt-run completion could be observed just before
  Browser Action follow-up `:verification`/`:eval_ledger` nodes were visible in
  the debug bundle. The smoke now waits for those follow-up nodes with a short
  polling window instead of asserting immediately.

Verification passed `node --check` for the Windows settings and session HTTP
smokes, `npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-windows-settings`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained existing CRLF
normalization warnings, the unsigned browser-native helper development
allowance, and one Windows temp cleanup deferred retry.

## Latest Update: Active Job Cancellation Smoke

Strengthened Phase 2 cancellation coverage for Computer Session runtime:

- `smoke:computer-use-session` now registers a cancellable `screen_observe`
  smoke handler that waits for the runtime abort signal.
- The smoke starts a second Computer Session, launches the long-running
  `screen_observe` operation with a short wait window, cancels the session, and
  verifies the active capability job observes the abort signal and reaches
  `cancelled`.
- The same smoke verifies `ComputerSessionRuntime.cancel()` records a completed
  `cancel_capability_job` rollback action, the cancelled job appears in the
  debug bundle, and the session DAG run is marked `cancelled`.
- This covers the explicit Phase 2 requirement that session cancellation
  propagate to active capability jobs rather than only changing the session
  state.

Focused verification passed `node --check scripts/smoke-computer-use-session.mjs`
and `npm run smoke:computer-use-session`.

## Latest Update: Browser Profile Surface Gate

Enforced the Phase 3 rule that current browser profile access requires an
explicit scoped grant:

- `ComputerSessionRuntime.start()` now evaluates selected surfaces that set
  `requiresUserProfileAccess`.
- `regular_browser_extension` startup requires a scoped autonomy profile that
  grants `browser_automation` and `high_risk`. Without those grants, the
  session is blocked before local DAG progression.
- Blocked startup records:
  - a `surface_permission_profile` safety decision
  - a failed `permission_check` DAG node with exact missing requirements
  - a blocked `surface_permission_profile` eval step
  - failed eval/DAG run status
- `smoke:computer-use-session` now verifies both paths: missing profile blocks
  `regular_browser_extension`; an explicit browser automation plus high-risk
  profile permits startup.
- `smoke:computer-use-browser-chrome` now grants `high_risk` in its one-time
  profile so Browser Chrome parity continues through an explicit profile access
  grant.

Focused verification passed `npm run build:daemon`,
`node --check scripts/smoke-computer-use-session.mjs`,
`node --check scripts/smoke-computer-use-browser-chrome.mjs`,
`npm run smoke:computer-use-session`, and
`npm run smoke:computer-use-browser-chrome`.

## Latest Update: Daemon-Scoped DAG Runtime

Promoted the Computer Session DAG runtime to daemon startup wiring:

- `startDaemon()` now creates one process-level `CapabilityDagRuntime` next to
  the daemon `CapabilityRuntime`.
- The daemon injects that DAG runtime into `ComputerSessionRuntime`, so daemon
  Computer Sessions share the process-level scheduler/storage integration
  instead of relying on the runtime's constructor fallback.
- The constructor fallback remains for direct smoke/unit construction.

Focused verification passed `npm run build:daemon` and
`npm run smoke:computer-use-session-http`.

## Latest Update: Session-Level Cross-Source Target Graph Set

Expanded Browser Action target evidence from a single-current-graph view into
an explicit session graph set:

- Browser Action pre-action target evidence now calls arbitration with a
  deduplicated graph set containing the current Browser Action graph,
  perception graphs linked from prior session observations, and recent stored
  session graphs.
- `computer-session-target-evidence.v1` now embeds
  `computer-session-target-graph-set.v1` under arbitration metadata. It records
  graph count, source count, source breakdown, current graph id, whether the
  current graph was included, and observation-linked graph count.
- Arbitration metadata also records candidate-source summaries with graph
  source, candidate count, allowed count, evidence sources, and evidence
  classes.
- This keeps the safety rule intact: OCR/screenshot evidence can contribute to
  candidate ranking/explanation, but side-effect actions still require an
  actionable structured DOM/UIA target.
- Renderer target evidence previews now show graph/source counts, so users can
  see when target grounding used a multi-source graph set without opening raw
  JSON.
- `smoke:computer-use-session` now records a synthetic screen/OCR graph and a
  matching Browser Action DOM target, then verifies the target evidence includes
  both `computer_session_screen_observation` and
  `computer_session_browser_action_pre_action` source breakdown/candidate
  evidence.

Focused verification passed `node --check scripts/smoke-computer-use-session.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-session`,
`npm run smoke:computer-use-browser-parity`, and
`npm run smoke:research-performance-architecture`.

## Latest Update: Native File Picker Boundary

Added a non-executing native file picker operation boundary:

- `ComputerStructuredOperation` includes `native_file_picker_action`.
- `ComputerSessionRuntime` routes it to a blocker, not to `desktop_action`.
- The blocker requires signed file-picker helper v2, one-time file-selection
  approval, approved path/root grant, active picker-window proof,
  active-window assertion, abort-on-user-input, and redacted path retention.
- Until those exist, the action node fails with
  `native_file_picker_helper_v2_not_available`, `actualInputSent: false`,
  `localFilePathDisclosed: false`, and `selectedFileCount: 0`.
- Debug bundles include:
  - failed approval/action/verification/eval DAG nodes
  - `native_file_picker_preconditions` safety decision
  - `native_file_picker_blocked` eval step
  - `native_file_picker_boundary` file observation
  - failed verifier result
  - skipped rollback action with `no_file_was_selected`
  - structured failure memory with
    `native_file_picker_helper_v2_unavailable`
- `smoke:computer-use-native-watch-boundary` now verifies both broad
  foreground visual input blocking and native file picker blocking. It asserts
  neither path creates a `desktop_action` capability job.

Focused verification passed `node --check scripts/smoke-computer-use-native-watch-boundary.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-native-watch-boundary`,
`npm run lint`, final `npm run smoke:all`, `node --check scripts/gate-computer-use-promotion.mjs`,
`npm run smoke:computer-use-promotion-gate`, and
`npm run smoke:computer-use-promotion-gate-route`. The first aggregate attempt
hit a transient `smoke:computer-use-session-http` FK failure; the focused HTTP
smoke passed immediately afterward and the next aggregate run passed.

## Latest Update: Future VM Sandbox Boundary

Added a non-executing boundary for `future_vm_session`:

- `future_vm_session` now requires VM-specific grants from surface selection:
  `vm.session_backend`, `vm.network_isolation`, `vm.lifecycle_cleanup`, and
  `vm.artifact_sync_policy`.
- `ComputerSessionRuntime.start()` blocks requested `future_vm_session` before
  VM creation, network bridge, host mutation, clipboard/file sync, or raw
  screenshot retention.
- The blocker records `future_vm_session_backend_not_available`,
  `vmCreated: false`, `hostMutationAllowed: false`, missing preconditions,
  failed/skipped DAG nodes, `future_vm_session_blocked` eval step,
  `future_vm_session_boundary` observation, failed verifier, skipped rollback,
  and structured failure memory.
- Added `smoke:computer-use-vm-sandbox-boundary` and wired it into
  `smoke:all`.
- Added `future_vm_sandbox_boundary` to the promotion gate as passed but
  non-promoting. It verifies the runtime boundary and smoke coverage while
  keeping the actual VM/sandbox backend explicitly blocked.

Focused verification passed `node --check scripts/smoke-computer-use-vm-sandbox-boundary.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-vm-sandbox-boundary`,
`node --check scripts/gate-computer-use-promotion.mjs`, and
`npm run smoke:computer-use-promotion-gate`. Follow-up verification passed
`npm run smoke:computer-use-surface-manager`,
`npm run smoke:computer-use-promotion-gate-route`, `npm run lint`, and final
`npm run smoke:all`.

## Latest Update: Dedicated Debug Bundle Smoke

Replaced the `smoke:computer-use-debug-bundle` proxy alias with a dedicated
debug-bundle smoke:

- Added `scripts/smoke-computer-use-debug-bundle.mjs`.
- The smoke starts a `future_vm_session` boundary case, fetches
  `/computer-use/sessions/:id/debug-bundle`, and verifies the route exports
  the full `computer-session-debug-bundle.v1` structure.
- It checks session/eval/DAG status, redaction policy, top-level arrays,
  freshness summary, failed setup/eval DAG nodes, safety decisions,
  `future_vm_session_boundary` observation, skipped rollback, verifier failure,
  and failure memory.
- `smoke:all` now runs this dedicated smoke instead of relying on
  `smoke:computer-use-session-http` as a proxy.

Focused verification passed `node --check scripts/smoke-computer-use-debug-bundle.mjs`
and `npm run smoke:computer-use-debug-bundle`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`.

## Latest Update: Renderer Computer Use Live Refresh

Added live renderer refresh for long-running Computer Use sessions:

- `WidgetRuntime` now increments `computerUseRefreshSignal` when daemon events
  indicate Computer Use state or linked capability evidence changed:
  `computer.session.*`, `capability.job`, `capability.jobs`, and
  `capability.resource`.
- `WidgetRuntimeView` and `ActivityLog` pass the signal into
  `ComputerUseSessionsPanel`.
- `ComputerUseSessionsPanel` debounces the signal, runs a quiet refresh of
  surfaces/sessions/profiles/promotion-gate state, and refetches the selected
  debug bundle after the quiet refresh updates. Manual refresh/loading behavior
  remains unchanged.
- The panel now shows a compact Live metric for the last event-driven refresh.
- Added `scripts/smoke-renderer-computer-use-live-refresh.mjs`, an HTTP+WS fake
  daemon renderer smoke that proves a `computer.session.state` event updates the
  session selector and selected debug-bundle DAG rows without manual refresh.
- Added `smoke:renderer-computer-use-live-refresh` and wired the focused smoke
  into `smoke:all`.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-live-refresh.mjs`,
`npm run smoke:renderer-computer-use-live-refresh`, `npm run build:renderer`,
`npm run smoke:renderer-chat`, and `npm run lint`. Follow-up verification
passed final `npm run smoke:all`.

## Latest Update: Browser Bridge Restricted Reload Gate

Added a dedicated promotion/readiness gate for Browser Bridge restricted-page
and reload-required handling:

- `scripts/gate-computer-use-promotion.mjs` now emits
  `browser_bridge_restricted_reload_boundary`.
- The gate is passed but non-promoting. It verifies the
  `browser.restricted.extensions.reload` 30-case fixture is blocked by design,
  `smoke:browser-bridge` covers `reloadRequired`, `permission_needed`, and
  `restricted` statuses, `smoke:extension` plus popup source expose
  `Reload bridge` through `chrome.runtime.reload()`, renderer Browser Action UI
  contains reload/restricted recovery guidance, and injected extension commands
  retain the restricted-page bypass guard.
- `scripts/smoke-computer-use-promotion-gate-route.mjs` now asserts the new
  gate is exposed through `GET /computer-use/eval/promotion-gate`.
- Regenerated
  `docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json`
  and `docs/reports/computer-use-promotion-gate-2026-05-16.md`.

Focused verification passed `node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run smoke:computer-use-promotion-gate`, `npm run gate:computer-use-promotion`,
`npm run smoke:computer-use-promotion-gate-route`, `npm run smoke:browser-bridge`,
and `npm run smoke:extension`. Follow-up verification passed final
`npm run smoke:all`.

## Latest Update: Windows Settings Reversible Dogfood

Added a bounded reversible Windows app/settings dogfood slice:

- Terminal operations now recognize a narrow
  `reversibleWindowsSetting.scope = "hkcu_app_registry"` descriptor.
- The only currently allowed reversible mutation root is
  `HKCU\Software\CodexWidgetComputerUseSmoke`; commands must exactly match the
  generated `reg add` or `reg delete` form, use a safe value name/data pattern,
  and carry the descriptor.
- Even for that bounded path, execution still requires a scoped autonomy
  profile with exact command allowlist, `osMutation`, and the `high_risk` risk
  class. Unmarked `reg add/delete` commands remain hard-blocked by
  `terminal_command_destructive_boundary`.
- `smoke:computer-use-windows-settings` now verifies the full progression:
  read-only `reg query`, blocked broad `HKCU\Environment` mutation, reversible
  app-owned registry `set`, readback proof, rollback `delete`, absence proof,
  safety-decision evidence, and terminal-observation metadata.
- This is not promotion of broad Windows settings mutation. It only proves the
  reversible workflow shape using an app-owned smoke key while signed helper
  v2, active-window guard, and product rollback policy remain blockers for real
  settings.

Focused verification passed `node --check scripts/smoke-computer-use-windows-settings.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-windows-settings`,
`node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run smoke:computer-use-promotion-gate`,
`npm run gate:computer-use-promotion`, and
`npm run smoke:computer-use-promotion-gate-route`. Follow-up verification
passed `npm run lint` and final `npm run smoke:all`.

## Latest Update: Autonomy Toolsmith Rerun History UX

Added historical rerun comparison browsing to the renderer Autonomy Toolsmith
panel:

- `src/renderer/components/AutonomyToolsmithPanel.tsx` now summarizes every
  `mode: "rerun"` tool run that contains `toolsmith-rerun-comparison.v1`
  output into compact rows.
- The rows show `matched` or `changed`, scalar match state, artifact match
  state, changed/missing/added artifact counts, artifact totals, elapsed time,
  and a redacted rerun id. This lets users compare more than the latest rerun
  without opening raw Toolsmith JSON.
- `src/renderer/styles/activity-capability.css` adds compact stable layout for
  the rerun history block inside Activity details.
- Added `scripts/smoke-renderer-autonomy-rerun-history.mjs` and package script
  `smoke:renderer-autonomy-rerun-history`. The smoke uses a fake
  HTTP+WebSocket daemon, returns two rerun comparisons, and verifies Activity
  details renders the history rows plus latest artifact-delta summary.
- `scripts/smoke-all.mjs` includes the new renderer smoke.

Focused verification passed `node --check scripts/smoke-renderer-autonomy-rerun-history.mjs`,
`npm run smoke:renderer-autonomy-rerun-history`, `npm run build:renderer`, and
`npm run smoke:renderer-chat`. Follow-up verification passed `npm run lint` and
final `npm run smoke:all`.

## Latest Update: Approved Execution Handoff Shards

The product owner reviewed the briefing and approved proceeding with the current
Windows Codex Computer Use parity direction. Because the implementation volume
is large, a sharded execution handoff was added under:

- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/README.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/01-target-boundaries.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/02-current-inventory.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/03-implementation-slices.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/04-runtime-contracts.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/05-verification-dogfood-promotion.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/06-resume-maintenance.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/07-current-status-ledger.md`

This pack records the accepted target, non-negotiable safety boundaries,
current implementation inventory, source hotspots, exact next implementation
slices, runtime contracts, verification/dogfood gates, restart rules, and a
resume-critical status ledger with the latest stable boundary.

The first recommended implementation slice from this pack, foreground
watch-mode user-input abort preflight, has now been implemented as a blocked
preflight/evidence path with `actualInputSent: false`; it does not enable
native foreground input or claim helper v2 completion. The next recommended
slice is Renderer Permission Profile UX Completion.

## Latest Update: Foreground Watch User-Input Abort Preflight

Implemented the Phase 11 user-input abort boundary for broad visual desktop
actions without enabling native foreground input:

- `ComputerStructuredOperation.visual_desktop_action` now accepts optional
  `watchPreflight` metadata.
- `ComputerSessionRuntime` normalizes the metadata to
  `foreground-watch-preflight.v1` and records it in DAG output, safety
  decision, observation metadata, rollback metadata, and verifier result.
- `abortOnUserInputArmed` plus `userInputDetected` blocks with
  `foreground_watch_user_input_abort` before native input.
- Active-window drift blocks with
  `foreground_watch_active_window_drift_abort` before native input.
- The original helper-v2 unavailable path still blocks with
  `foreground_watch_mode_v2_not_available`.
- Every path keeps `actualInputSent: false` and does not create a
  `desktop_action` capability job.
- `scripts/smoke-computer-use-native-watch-boundary.mjs` now covers the
  user-input abort path and verifies DAG/eval/verifier/safety/observation/
  failure-memory evidence.
- `scripts/gate-computer-use-promotion.mjs` now verifies the
  `foreground_watch_user_input_abort` guard and smoke evidence as part of the
  passed but non-promoting `windows_native_watch_boundary` release guard.

Focused verification passed `node --check scripts/smoke-computer-use-native-watch-boundary.mjs`,
`node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-native-watch-boundary`,
`npm run smoke:computer-use-promotion-gate`,
`npm run gate:computer-use-promotion`, and
`npm run smoke:computer-use-promotion-gate-route`.

## Latest Update: Renderer One-Time Profile Draft Preview

Implemented the first Renderer Permission Profile UX completion slice:

- `ComputerUseSessionsPanel` now shows a draft one-time profile preview for
  blocked runs before the user attaches it.
- The preview names one-time scope, max use count, credential policy, risk
  classes, browser grants, exact command count, and write-root count.
- The generated profile path still derives grants only from missing
  requirements, safety decisions, DAG nodes, and awaiting jobs.
- Credential requirements remain filtered from generated grants, and the
  profile payload keeps `credentialAccess: "never"`.
- Added `scripts/smoke-renderer-computer-use-profile-draft.mjs`,
  `smoke:renderer-computer-use-profile-draft`, and `smoke:all` coverage. The
  smoke runs a fake daemon, renders the blocked-run draft, clicks `One-time`,
  and verifies the POSTed profile is one-time, browser-scoped, high-risk, and
  credential-denied before attaching it to the session. The same smoke now
  selects an existing persistent profile, verifies its detail card, and checks
  exact domain/command/write-root grant details plus Disable lifecycle POST
  wiring.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-profile-draft.mjs`,
`node --check scripts/smoke-all.mjs`, `npm run build:renderer`, and
`npm run smoke:renderer-computer-use-profile-draft`.

## Latest Update: Renderer Permission Profile Manager And Gate

Completed the next Renderer Permission Profile UX slice:

- `ComputerUseSessionsPanel` now fetches all autonomy permission profiles for
  management while keeping new Computer Use sessions limited to active profile
  selection.
- Added a permission profile manager with all-profile selection, safe one-time
  draft creation, edit/save through the daemon profile route, Disable/Expire
  lifecycle actions, and a JSON editor.
- Added renderer-side profile draft validation that blocks credential access,
  credential risk class, persistent high-risk/package/OS grants, and broad
  persistent browser automation without exact domains before POST.
- Extended `smoke:renderer-computer-use-profile-draft` to verify unsafe
  persistent credential/high-risk drafts are blocked, safe managed one-time
  profiles are created with `credentialAccess: "never"`, selected active
  profile details still render, and lifecycle Disable POST wiring still works.
- Added `renderer_permission_profile_ux` to the Computer Use promotion gate as
  a passed but non-promoting renderer safety UX gate, and updated the promotion
  gate route smoke to assert it.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-profile-draft.mjs`,
`npm run build:renderer`, `npm run smoke:renderer-computer-use-profile-draft`,
`node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run smoke:computer-use-promotion-gate`,
`npm run gate:computer-use-promotion`, and
`npm run smoke:computer-use-promotion-gate-route`.

## Latest Update: Renderer Browser Chrome Evidence UX

Started the Browser Chrome Deep Action Hardening slice with renderer evidence
surface coverage:

- `ComputerUseSessionsPanel` now collects Browser Chrome capability jobs and
  linked observations/resources into a Browser Chrome evidence section.
- Rows summarize command, status, risk class, verifier label, redaction summary,
  and resource roles.
- Download verification shows approved artifact evidence such as
  `download_verified_file` with basename-only local path redaction.
- History, debugger, permission, and file-upload rows show redaction/minimized
  output summaries rather than raw browser-private content or full local paths.
- Added `smoke:renderer-computer-use-browser-chrome-evidence` and wired it into
  `smoke:all`.
- Added `browser_chrome_deep_action_evidence_ux` to the Computer Use promotion
  gate as a passed but non-promoting renderer evidence UX gate, and updated the
  promotion route smoke to assert it.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`,
`npm run build:renderer`,
`npm run smoke:renderer-computer-use-browser-chrome-evidence`,
`node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run smoke:computer-use-promotion-gate`,
`npm run gate:computer-use-promotion`, and
`npm run smoke:computer-use-promotion-gate-route`.

## Focused Verification Map

Use the narrow command first, then aggregate.

| Change area | Focused verification |
|---|---|
| Protocol/action adapter | `npm run smoke:computer-use-action-adapter` |
| Session runtime/DAG | `npm run smoke:computer-use-session`, `npm run smoke:computer-use-session-http` |
| Surface selection | `npm run smoke:computer-use-surface-manager` |
| Isolated browser | `npm run smoke:computer-use-isolated-browser`, `npm run smoke:computer-use-browser-parity`, `npm run dogfood:computer-use-browser`, `npm run smoke:computer-use-browser-dogfood` |
| Browser Chrome commands | `npm run smoke:browser-chrome-capability`, `npm run smoke:computer-use-browser-chrome` |
| Browser Action adapter | `npm run smoke:browser-action`, `npm run smoke:browser-action:playwright`, `npm run smoke:browser-action:cdp` |
| Native helper / VM boundary | `npm run smoke:browser-action:native`, `npm run smoke:computer-use-native-watch-boundary`, `npm run smoke:computer-use-vm-sandbox-boundary`, `npm run smoke:browser-native-desktop-helper:signature` |
| Terminal | `npm run smoke:computer-use-terminal-parity`, `npm run smoke:computer-use-windows-settings` |
| Toolsmith/artifacts | `npm run smoke:computer-use-toolsmith-artifact`, `npm run smoke:scoped-autonomy-npm-dependency-prepare`, `npm run dogfood:scoped-autonomy-web-research-live`, `npm run dogfood:computer-use-toolsmith-live` |
| Perception graph/ROI | `npm run smoke:research-performance-architecture`, `npm run smoke:computer-use-session` |
| Effect verifier | `npm run smoke:computer-use-effect-verifier`, `npm run smoke:computer-use-verifier-audit` |
| Renderer UX | `npm run build:renderer`, `npm run smoke:renderer-chat`, `npm run smoke:renderer-autonomy-rerun-history` |
| Renderer Computer Use live refresh | `npm run smoke:renderer-computer-use-live-refresh` |
| Promotion gate | `npm run gate:computer-use-promotion`, `npm run smoke:computer-use-promotion-gate`, `npm run smoke:computer-use-promotion-gate-route` |
| Release readiness | `npm run release:readiness`, `node --check scripts/release-readiness.mjs` |

Always finish stable boundaries with:

```text
npm run lint
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

## External Blockers To Keep Explicit

These are not complete and must not be treated as done:

- Official app-server custom client-tool contract.
- Production Authenticode signing certificate or CI signing service.
- Unrestricted credential flows.
- Unattended high-risk Windows mutation.
- Authenticated browser profile/cookie access as a generic automation target.
- Native helper v2 for broad foreground desktop watch-mode.
- Native file picker helper. A non-executing Computer Session boundary now
  exists and is covered by `smoke:computer-use-native-watch-boundary`, but the
  actual signed picker helper remains blocked.
- VM/sandbox session backend. A non-executing `future_vm_session` boundary now
  exists and is covered by `smoke:computer-use-vm-sandbox-boundary`, but the
  actual VM/sandbox backend remains blocked.
- GPU ASR validation.
- Human microphone ASR corpus benchmark.

## Completion Definition For This Parity Track

The parity track is complete only when:

- Computer Session Runtime is the main pipeline for browser/tool/terminal/screen
  computer-use requests.
- Every executed action has before/after or artifact/terminal evidence.
- Target selection can explain its choice through perception graph evidence.
- High-risk action approval shows exact grants and does not collapse into a
  generic continue button.
- Browser Chrome deep actions are represented through bounded commands,
  redacted evidence, and one-time gates where required.
- Toolsmith can generate/materialize bounded tools, smoke them, activate only
  after passing, run the task, record artifacts, and rollback.
- Terminal fast paths record command, profile grant, output hash/preview, and
  output-root artifacts without leaking secrets.
- Screen/OCR/Vision observe paths use ROI/delta/cascade early exits and record
  latency.
- Failure memory calibrates future behavior without becoming proof.
- Promotion gates reject one-off live successes and fixture-only successes.
- Release readiness refuses unsigned helper paths in production mode.
- 30-case dogfood plus repeated live traces show no task-success/p95/safety
  regression.
