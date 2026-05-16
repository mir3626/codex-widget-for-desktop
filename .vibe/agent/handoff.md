# Handoff

## Current State

The project is a Tauri + React + Node daemon desktop widget. The native widget launches, Vite serves renderer assets during dev, and the daemon listens on `127.0.0.1:4128`.

## Latest Update: Docs Cleanup And Evidence Archive

Cleaned up non-harness docs after the Windows Codex Computer Use parity push.

Changed:

- Updated current-state docs that still described the pushed parity work as an
  intentionally dirty worktree:
  - `docs/plans/windows-codex-computer-use-parity/README.md`
  - `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`
  - `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/07-current-status-ledger.md`
  - `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/08-implementation-backlog.md`
- Updated Toolsmith/current architecture docs from the old schema-v5
  `web_research_to_pdf`-only description to the current schema-v7 Computer
  Session and generated-tool breadth state:
  - `docs/architecture/research-performance-architecture.md`
  - `docs/architecture/open-blockers.md`
  - `docs/context/architecture.md`
  - `docs/context/qa.md`
  - `docs/plans/scoped-autonomy-self-implementation-handoff.md`
- Archived superseded 2026-05-14 dogfood/report/evidence files under
  `docs/archive/2026-05-14-superseded-evidence/`.
- Deleted the old `docs/plans/deprecated/` tombstone folder after its content
  had already been consolidated into `docs/architecture/`.
- Updated references in `docs/architecture/deprecated-plans.md`,
  `docs/architecture/README.md`, `docs/plans/README.md`,
  `docs/plans/browser-action-reliability-foundation-handoff.md`, and
  `docs/plans/sprint-roadmap.md` so the removed deprecated folder is no longer
  treated as an active location.

Interpretation:

- Archived JSON files are not random test leftovers. They are historical
  dogfood/eval outputs: scenario catalogs, evidence ledgers, generated artifact
  metadata, command/output summaries, and report backing data.
- Current evidence should use the 2026-05-16 dogfood/report files and the
  parity audit/promotion gate, not the archived 2026-05-14 files.
- The archived files may still contain historical absolute local paths from the
  original run; treat them as audit history, not current redaction examples.

## Latest Update: Dirty Worktree Review Hardening Handoff

The current dirty worktree implements the Windows Codex Computer Use parity
track to the local guarded boundary, but the review found several hardening
items that should be addressed before push/release. Do not revert unrelated
dirty files; continue from the existing worktree and fix the listed risks.

Review baseline before this handoff:

- Dirty worktree size at review time: 174 changed/untracked entries.
- Tracked diff at review time: 70 files, about 12,483 insertions and 200
  deletions.
- Prior verification had passed: `npm run lint`, `npm run smoke:all`,
  `npm run gate:computer-use-promotion`, `npm run audit:computer-use-parity`,
  `git diff --check` with known CRLF normalization warnings, UTF scan clean,
  and no `.cs` files touched.
- Latest parity audit remained `implemented_with_guarded_boundaries`,
  `passed=61`, `guarded=7`, `blocked=0`, `missing=0`.
- Latest 30-case process validation remained `passed=21`, `blocked=9`,
  `needsFollowup=0`, `unexpectedFailures=0`.

Resume-critical findings and implementation order:

1. Harden daemon local trust boundary.
   - Files to start with:
     - `src/daemon/server/http.ts`
     - `src/daemon/server/http/routes/browserBridgeRoutes.ts`
     - `src/daemon/server/http/routes/computerUseSessionRoutes.ts`
     - `src/daemon/server/ws/capabilityMessages.ts`
     - `src/daemon/capability-runtime/safety.ts`
   - Issue: global `Access-Control-Allow-Origin: *` and unauthenticated
     Browser Bridge, Computer Use session, rollback/debug bundle, and capability
     WS surfaces are now too open for high-risk browser chrome/debugger/tool
     workflows.
   - Required fix: add a daemon session token or bridge nonce and require it on
     `/computer-use/*`, `/browser-action/extension/*`, and capability WS
     messages. Restrict CORS to trusted renderer/Tauri and extension origins.
     Strip or ignore externally supplied `requireApproval: false`; replace it
     with an internal preapproval proof object that cannot be client-forged.
   - Tests to add/update: unauth cross-origin HTTP requests fail; extension
     poll/result/ack without nonce fails; raw capability WS start cannot bypass
     approval by setting `requireApproval:false`.

2. Sandbox Toolsmith generated tools.
   - File to start with: `src/daemon/scoped-autonomy/toolsmithRuntime.ts`.
   - Issue: generated tools currently spawn via `process.execPath` while
     inheriting the full daemon `process.env` and parent cwd.
   - Required fix: run tools with a scrubbed environment allowlist, set `cwd` to
     the generated-tool runtime workspace, and block access to repo cwd or
     unapproved paths. Prefer Node permission flags when available or a bounded
     runner wrapper if needed. Never pass API keys, OAuth tokens, browser
     profile secrets, or unrelated daemon env into generated code.
   - Tests to add/update: generated tool cannot read `OPENAI_API_KEY` or other
     secret env vars, cannot write repo cwd, and cannot read outside approved
     input/output roots.

3. Sanitize Browser Chrome debugger output before persistence/debug export.
   - Files to start with:
     - `providers/browser-dom-extension/bridge/browser-chrome.js`
     - `src/daemon/capabilities/registerCapabilities.ts`
     - `src/daemon/capability-runtime/runtime.ts`
     - `src/daemon/computer-use/sessionRuntime.ts`
   - Issue: debugger actions can return `bodyTextPreview`, screenshot
     `dataUrl`, and PDF `dataBase64`; capability output and Computer Use debug
     bundles can persist these raw values.
   - Required fix: remove raw page text/binary values from persisted outputs.
     Use hashes, lengths, redacted previews, or blob-backed resources with
     retention metadata. Add a Browser Chrome output sanitizer and apply it to
     capability job output and debug bundles.
   - Tests to add/update: persisted capability output and debug bundle contain
     no `dataUrl`, no `dataBase64`, and no raw `bodyTextPreview`.

4. Bound browser permission mutation and record rollback proof.
   - File to start with:
     `providers/browser-dom-extension/bridge/browser-chrome.js`.
   - Issue: content setting mutation accepts broad patterns such as
     `https://*/*` and verifies post-state without capturing the previous
     setting as rollback evidence.
   - Required fix: default allowed pattern must match the approved origin
     exactly, for example `${new URL(primaryUrl).origin}/*`. Reject wildcard
     patterns unless a future explicit high-risk wildcard grant exists. Capture
     `previousSetting` before mutation and emit rollback command/evidence.
   - Tests to add/update: wildcard pattern blocks; origin-scoped pattern
     passes; rollback restores previous setting and records proof.

5. Fail closed on malformed Browser Chrome commands.
   - Files to start with:
     - `src/daemon/browser-chrome/commandBridge.ts`
     - `src/daemon/capability-runtime/safety.ts`
   - Issue: missing/unknown commands degrade to `bookmark.list`, which can hide
     planner/runtime bugs and read bookmark data for the wrong request.
   - Required fix: unknown or missing command must return an explicit invalid
     command error. Safety evaluation must not treat malformed browser_chrome
     input as read-only.
   - Tests to add/update: unsupported command and missing command fail/blocked
     with no bookmark list result.

6. Move high-risk extension permissions out of required manifest permissions
   where Chrome supports optional permissions.
   - File to start with: `providers/browser-dom-extension/manifest.json`.
   - Issue: `bookmarks`, `contentSettings`, `debugger`, `downloads`, `history`,
     and `tabGroups` are required at install time. Daemon-side approval limits
     command execution, but required extension permissions widen install-time
     blast radius and store review risk.
   - Required fix: move high-risk permissions supported by Chrome to
     `optional_permissions`, request them per bounded run/profile, and surface
     missing permission UX in popup/widget.
   - Tests to add/update: browser store readiness audit fails required
     high-risk permissions unless explicitly justified.

7. Redact local absolute paths from new report ledgers.
   - Files to inspect:
     - `docs/reports/assets/*-runs.jsonl`
     - `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/06-resume-maintenance.md`
     - `.vibe/agent/handoff.md`
   - Issue: new report JSONL files include local `C:/Users/...` paths. This
     conflicts with repo-relative/redacted evidence policy.
   - Required fix: update collectors to store repo-relative paths using
     `path.relative(repoRoot, value).replace(/\\/g, "/")`, regenerate affected
     JSONL/report assets, and add an audit check for `C:\Users` and `C:/Users`
     in new report assets. Old deprecated docs can be handled as a separate
     cleanup if needed.

Recommended verification after the hardening fixes:

- `npm run build:daemon`
- `npm run build:renderer`
- `npm run lint`
- Focused smokes for each changed boundary, including new unauth/nonce,
  generated-tool sandbox, browser_chrome sanitizer, permission rollback, and
  invalid-command smokes.
- `npm run smoke:browser-extension`
- `npm run smoke:browser-store-readiness`
- `npm run smoke:scoped-autonomy-self-implementation`
- `npm run smoke:computer-use-session`
- `npm run smoke:computer-use-debug-bundle`
- `npm run smoke:all`
- `npm run gate:computer-use-promotion`
- `npm run audit:computer-use-parity`
- `git diff --check`
- UTF-8/mojibake scan for touched files.
- `.cs` BOM check only if `.cs` files are touched.

Do not mark these hardening items as complete merely because existing parity
tests pass. Existing tests prove feature breadth; the review findings are
trust-boundary and retention-policy issues that need explicit negative tests.

## Latest Update: Parity Closure Status Ledger Sync

Synchronized the context-loss handoff status after the final process validation
refresh. The resume-critical ledger now states that Windows Codex Computer Use
parity is implemented to the current local boundary with explicit guarded
external blockers, rather than an open local implementation gap.

Changed:

- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/07-current-status-ledger.md`
- `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`

Closure interpretation:

- Latest audit remains `implemented_with_guarded_boundaries`, with `passed=61`,
  `guarded=7`, `blocked=0`, and `missing=0`.
- The global implementation goal can be considered locally satisfied only while
  the verification boundary still passes and guarded items remain documented as
  external blockers.
- Guarded native/release items are not completed native execution:
  foreground input, native file picker selection, browser permission popup
  native clicks, production signing, unrestricted credential flow,
  authenticated browser profile/cookie default access, real VM/RDP/sandbox
  backend, GPU ASR validation, and human microphone ASR corpus benchmark remain
  explicit future work.

## Latest Update: Process Validation PDF/Download/VLM Refresh

Continued the Windows Codex Computer Use parity implementation by refreshing
the 30-case user-like process validation matrix against the current
Toolsmith/PDF, Browser Chrome download-verification, and metadata-only Vision
VLM fallback capabilities.

Changed:

- `scripts/collect-computer-use-process-validation-30.mjs`
- `docs/dogfood/computer-use-process-validation-30-2026-05-16.json`
- `docs/reports/computer-use-process-validation-30-2026-05-16.md`
- `docs/reports/assets/computer-use-process-validation-30-2026-05-16/evidence.json`
- `docs/reports/computer-use-promotion-gate-2026-05-16.md`
- `docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json`
- `docs/reports/windows-codex-computer-use-parity-audit-2026-05-16.md`
- `docs/reports/assets/windows-codex-computer-use-parity-audit-2026-05-16/evidence.json`
- Windows parity checklist/status/resumption shards.

Behavior:

- The `browser.google.codex-cli.install.save-pdf` scenario is no longer a
  stale blocked placeholder. It now executes a bounded Toolsmith
  `web_research_to_pdf` fixture path, records source URL hashes, writes
  Markdown/PDF capability resources, links them into the eval ledger as
  `user_saved` artifacts, and verifies the artifact contract.
- The `browser.download.pdf.verify-file` scenario now executes Browser Chrome
  `download.verify`, stores a `download_verified_file` capability resource, and
  links basename/hash-only file proof into the eval ledger.
- The `vision.complex-chart.vlm-fallback` scenario now records a
  confidence-gated cascade fallback, invokes a bounded metadata-only
  `vision_vlm_fallback` capability, stores `vlm_fallback_summary` evidence, and
  avoids raw screenshot retention.
- The refreshed 30-case report now records `passed=21`, `blocked=9`,
  `needsFollowup=0`, `unexpectedFailures=0`, task success rate `0.786`, proof
  rate `0.405`, p95 latency `108 ms`, and p95 perception latency `40 ms`.
- `gate:computer-use-promotion` still passes as `promotable`; fixture success
  remains non-promoting without the existing repeated live gates.
- `audit:computer-use-parity` remains `implemented_with_guarded_boundaries`
  with `passed=61`, `guarded=7`, `missing=0`.

Focused verification passed:

- `node --check scripts/collect-computer-use-process-validation-30.mjs`
- `npm run dogfood:computer-use-process-30`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run audit:computer-use-parity`
- `npm run lint`
- `npm run smoke:all` (rerun with a longer timeout; final run passed after the
  VLM fallback fixture refresh)
- `git diff --check` with only known CRLF normalization warnings
- UTF/mojibake scan over 263 dirty/new text files: bad UTF-8 0, mojibake 0
- `.cs` touched files: 0

Next safe work: continue with additional live Browser Action recovery
calibration or signed-helper-v2 design prep. Native permission-popup clicks,
native file picker selection, and foreground input remain blocked until signed
helper v2 exists.

## Latest Update: Toolsmith Local Document Conversion Slice

Continued the Windows Codex Computer Use parity implementation through the
Toolsmith document-conversion slice.

Changed:

- `src/daemon/scoped-autonomy/gapDetector.ts`
- `src/daemon/scoped-autonomy/capabilityInventory.ts`
- `src/daemon/scoped-autonomy/toolsmithRuntime.ts`
- `scripts/smoke-scoped-autonomy-self-implementation.mjs`
- `scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/audit-windows-codex-computer-use-parity.mjs`
- Windows parity checklist/status/resumption shards.

Behavior:

- `local_document_conversion.v1` is now a dedicated Toolsmith template for
  supplied Markdown/text-to-PDF conversion, rather than an alias of
  `web_research_to_pdf`.
- The gap detector classifies conversion-only requests as
  `local_document_conversion` when no web research/crawl intent is present.
- The generated converter materializes under the daemon runtime workspace,
  passes smoke before activation, reads only inline Markdown or explicitly
  granted local source paths, and writes `report.md` plus `report.pdf`.
- The scoped autonomy DAG now chooses capability-specific execution stages.
  Local conversion skips `crawl_or_observe`, `extract`, and `verify_sources`,
  then runs `draft_markdown`, `render_pdf`, `store_artifact`, and
  `verify_artifact` with normal permission/eval/resource recording.
- Tool output records source SHA-256, Markdown/PDF artifacts, blob-backed eval
  resources, and `toolsmith-rerun-comparison.v1` stability evidence.
- `dogfood:scoped-autonomy-self-implementation` now includes
  `local_document_conversion` alongside `web_research_to_pdf`,
  `terminal_generated_tool`, and `browser_download_verify`; the promotion gate
  requires all four fixture generated-tool classes for
  `scoped_autonomy_self_implementation_breadth`.
- `dogfood:scoped-autonomy-generated-tool-live-breadth` now also includes two
  `local_document_conversion` local-live runs against approved Markdown source
  files. The live breadth gate requires all four generated-tool classes,
  `local_document_conversion_live_verified`, sixteen latest execute/rerun
  samples, and eight successful scenarios.

Focused verification passed:

- `node --check scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-self-implementation.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `npm run build:daemon`
- `npm run smoke:scoped-autonomy-self-implementation`
- `npm run dogfood:scoped-autonomy-self-implementation`
- `npm run dogfood:scoped-autonomy-generated-tool-live-breadth`
- `npm run smoke:scoped-autonomy-generated-tool-live-breadth`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run audit:computer-use-parity` (`implemented_with_guarded_boundaries`,
  passed=61, guarded=7, missing=0)
- `npm run lint`
- `npm run smoke:all`
- `git diff --check` with only the known CRLF normalization warnings
- UTF/mojibake scan over 264 dirty/new text files: bad UTF-8 0, mojibake 0
- `.cs` touched files: 0

Next safe work: continue with the next guarded parity slice. Toolsmith
generated-tool breadth now covers web/PDF, local document conversion, terminal,
and download verification in both fixture and live/local-live evidence. Broader
ad hoc tool variety and external package promotion still need separate use-case
driven dogfood.

## Latest Update: Helper V2 Disabled Command Contracts

Continued the Windows Codex Computer Use parity implementation through signed
helper v2 preparation without enabling native input.

Changed:

- `providers/browser-native-desktop-helper-rs/src/main.rs`
- `src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts`
- `scripts/lib/browser-native-desktop-helper-contract.mjs`
- `scripts/smoke-browser-native-desktop-helper-native.mjs`
- `scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs`
- `scripts/release-readiness.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- Windows parity native/helper handoff shards.

Behavior:

- The Rust helper now accepts selected helper-v2-only commands as explicit
  disabled contracts instead of vague unsupported errors:
  `capture_screenshot`, `file_picker_select`,
  `browser_permission_popup_click`, `clipboard_set_scoped`, and
  `menu_command`.
- Those commands return
  `browser-native-desktop-helper-v2-disabled-command.v1` with
  `enabled=false`, `supported=false`, `dryRunOnly=true`,
  `actualInputSent=false`, `signedHelperV2Available=false`, and
  `releaseGate=browser-native-helper-signing`.
- Command-specific evidence proves no local path disclosure/file selection, no
  permission popup native click/mutation, no screenshot capture/raw storage, no
  clipboard content logging/mutation, and no menu command dispatch.
- Release readiness now probes these disabled helper-v2 contracts and reports
  `disabledV2Commands=5` under `browser-native-helper-contract`.
- Daemon native adapter status diagnostics now probe a bounded helper-v2
  disabled-command subset and expose `helperV2DisabledContracts` plus
  `helperV2Boundary.disabledCommandContractsPresent`, so live adapter status
  shows the same fail-closed boundary as release readiness.
- The Computer Use promotion gate now requires
  `helper_v2_disabled_command_contracts_present` under
  `windows_native_watch_boundary`.
- The renderer Native boundary proof panel now shows `Helper v2: disabled (5)`.

Focused verification passed:

- `node --check scripts/lib/browser-native-desktop-helper-contract.mjs`
- `node --check scripts/smoke-browser-native-desktop-helper-native.mjs`
- `node --check scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper-native`
- `npm run smoke:browser-native-desktop-helper:signing-readiness`
- `npm run release:readiness` (status remains deferred only for manual gates)
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run audit:computer-use-parity` (`implemented_with_guarded_boundaries`,
  passed=60, guarded=7, missing=0)

Native foreground input, native file picker selection, permission popup native
clicking, and production helper signing remain guarded blockers.

## Latest Update: Terminal Bounded Output And Parity Audit Refresh

Continued the Windows Codex Computer Use parity implementation through the
terminal safety/evidence slice.

Changed:

- `src/daemon/computer-use/sessionRuntime.ts`
- `scripts/smoke-computer-use-terminal-parity.mjs`
- `scripts/audit-windows-codex-computer-use-parity.mjs`
- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- Windows parity checklist/status/resumption shards.

Behavior:

- Terminal Computer Session debug bundles export bounded output metadata only:
  stdout/stderr length, SHA-256, credential-redacted preview, truncation flags,
  helper byte limits, and `terminal_helper_bounded_output` resource-limit
  evidence.
- Raw terminal stdout/stderr and raw helper truncation internals are removed
  from debug-bundle capability-job output.
- Terminal output-root delta manifests remain path-redacted and blob-backed,
  with created-file rollback candidates behind explicit delete confirmation.
- Terminal permission evaluation blocks unquoted shell control operators before
  command allow-prefix approval, preventing chained-command bypasses.
- The renderer Computer Use panel shows a compact "Terminal artifact deltas"
  proof section with create/modify/delete counts, rollback-candidate count,
  resource roles, and sanitized rollback-path status.

Verification passed:

- `node --check scripts/smoke-computer-use-terminal-parity.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-terminal-parity`
- `npm run smoke:computer-use-session-http`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run lint`
- `npm run audit:computer-use-parity` (`implemented_with_guarded_boundaries`,
  passed=59, guarded=6, missing=0)
- `npm run smoke:all`
- `git diff --check` with only the known CRLF normalization warnings

Known non-failing output remains the unsigned browser-native helper development
allowance and occasional Windows temp cleanup deferred retry. No `.cs` files
were touched.

## Latest Update: Toolsmith Self-Implementation Breadth Gate

Continued the Windows Codex Computer Use parity implementation through the
Toolsmith breadth slice.

Changed:

- `scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- `scripts/audit-windows-codex-computer-use-parity.mjs`
- Windows parity handoff/checklist shards.

Behavior:

- `dogfood:scoped-autonomy-self-implementation` now emits
  `scoped-autonomy-self-implementation-dogfood.v1` evidence for three
  generated tool classes: `web_research_to_pdf`,
  `terminal_generated_tool`, and `browser_download_verify`.
- The dogfood forces an initial web/PDF smoke failure, proves source revision,
  activates generated tools only after smoke passes, and verifies a high-risk
  `native_windows_workflow` request remains blocked before materialization.
- All three generated tool classes now run rerun stability checks and record
  matched `toolsmith-rerun-comparison.v1` scalar/artifact evidence.
- Dogfood evidence is redacted to repo-relative or `<redacted>` paths and
  asserts zero absolute local path leaks before writing reports.
- `gate:computer-use-promotion` now includes
  `scoped_autonomy_self_implementation_breadth` as a passed but non-promoting
  fixture breadth gate. It still requires repeated live generated-tool samples
  before promotion.
- The promotion gate route smoke and parity audit now assert this new gate.
- The Computer Use Promotion gate renderer now has a dedicated "Toolsmith
  breadth proof" panel showing scenario count, generated class count, rerun
  match count, path redaction, high-risk native blocking, and fixture-only
  promotion guard.

Focused verification passed:

- `node --check scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:scoped-autonomy-self-implementation`
- `npm run smoke:scoped-autonomy-self-implementation`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run audit:computer-use-parity` (`implemented_with_guarded_boundaries`,
  passed=46, guarded=6, missing=0)
- `npm run smoke:all`
- `git diff --check` with only the known CRLF normalization warnings
- UTF-8/mojibake scan over 215 text files: bad UTF-8 0, suspicious
  question-mark string literal hits 0
- `.cs` touched files: 0
- absolute path scan over
  `docs/reports/assets/scoped-autonomy-self-implementation-2026-05-16/evidence.json`

## Latest Update: Parity Handoff Root Index And Shared Executor Evidence

Continued the Windows Codex Computer Use parity implementation and hardened the
handoff path for context-loss recovery.

Changed:

- Added `docs/plans/windows-codex-computer-use-parity/README.md` as the root
  index shard for the full parity migration.
- Updated the top-level parity handoff, overview, approved execution pack,
  macOS parity pack, resumption shard, status ledger, and plans README to point
  future agents at the new index first.
- Kept the latest native helper/session runtime invariant explicit:
  Rust helper, release-readiness probe, promotion gate, renderer proof, and
  Computer Session blocked `visual_desktop_action` evidence must all expose the
  same disabled `foregroundWatchExecutor` contract with
  `actualInputSent: false`.
- Updated the current status ledger to record the latest audit state:
  `implemented_with_guarded_boundaries`, passed=44, guarded=6, missing=0.

Verification passed:

- `node --check scripts/smoke-computer-use-native-watch-boundary.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-native-watch-boundary`
- `npm run audit:computer-use-parity`
- `npm run gate:computer-use-promotion`
- `npm run smoke:all`
- `git diff --check` with only the known CRLF normalization warnings
- UTF-8/mojibake scan over 204 modified/untracked text files: bad UTF-8 0,
  suspicious question-mark string literal hits 0
- `.cs` touched files: 0

Next safe work remains bounded Browser Chrome public dogfood, broader
Toolsmith generated-tool breadth, or signed helper v2 preparation without
enabling foreground input until signing/watch-mode/release gates are real.

## Latest Update: Renderer Browser Chrome Evidence UX

Continued the Windows Codex Computer Use parity implementation through the
Browser Chrome Deep Action Hardening slice.

Changed:

- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- `package.json`
- `scripts/smoke-all.mjs`
- Windows parity handoff/checklist shards.

Behavior:

- Computer Use Activity details now include a Browser Chrome evidence section.
- The section summarizes Browser Chrome capability jobs and linked observations
  with command, status, risk class, verifier label, redaction summary, and
  resource roles.
- Download verification exposes `download_verified_file` evidence with
  basename-only local path redaction.
- History, debugger, permission, and file-upload rows expose minimized/redacted
  proof instead of raw browser-private content or full local paths.
- Added `smoke:renderer-computer-use-browser-chrome-evidence` and wired it into
  `smoke:all`.
- Added `browser_chrome_deep_action_evidence_ux` to
  `gate:computer-use-promotion` as a passed but non-promoting renderer evidence
  UX gate; route smoke asserts it.

Focused verification passed:

- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`

## Latest Update: Native Helper Contract Release Readiness

Added an automated release-readiness probe for the built Rust browser native
desktop helper:

- New `scripts/lib/browser-native-desktop-helper-contract.mjs` runs the built
  helper with `status`, default `watch_preflight`, and monitored
  `watch_preflight` requests.
- The probe writes
  `browser-native-desktop-helper-contract-readiness.v1` evidence with helper
  basename/hash, manifest schema, supported current-v1 commands, blocked
  helper-v2 commands, watch-preflight schema, helper-side guard schema,
  monitor sample count/parameters, and `actualInputSent: false`.
- `release-readiness.mjs` now embeds that redacted contract report and adds a
  `browser-native-helper-contract` automated check before the separate
  `browser-native-helper-signing` manual/deferred gate.
- `release-readiness.mjs` also redacts its own check details with repo-relative
  paths or `<repo>` placeholders; the latest generated
  `dist/reports/release-readiness-latest.json` contains no `C:\Users` or
  `C:/Users` absolute workspace paths.
- `smoke-browser-native-desktop-helper-signing-readiness.mjs` now verifies the
  contract probe, including no absolute repository path in the helper contract
  report, before exercising the signing dry-run deferral/strict-block cases.
- `audit:computer-use-parity` now includes
  `native:helper-contract-release-readiness`; latest audit reports
  `implemented_with_guarded_boundaries`, passed=44, guarded=6, missing=0.

Verification passed:

- `node --check scripts/lib/browser-native-desktop-helper-contract.mjs`
- `node --check scripts/release-readiness.mjs`
- `node --check scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs`
- `npm run build:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper:signing-readiness`
- `npm run audit:computer-use-parity`
- `npm run build`
- `npm run release:readiness` (default status: `deferred`; all automated
  checks pass)
- `node scripts/release-readiness.mjs --require-manual-gates` fails as
  expected on `browser-native-helper-signing` and `browser-store-submission`
- `Select-String dist/reports/release-readiness-latest.json` for `C:\Users` /
  `C:/Users` returned no matches after the final default readiness run
- `npm run lint`
- `git diff --check` (only existing CRLF warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`)
- `npm run smoke:all`

Remaining external release blockers are unchanged: production Authenticode
certificate/CI signing service and actual browser-store submission. Unsigned
native helpers remain development-only.

## Latest Update: Disabled Foreground Watch Executor Contract

Added a non-executing helper-v2 command shape for future foreground watch
execution without enabling native input:

- Rust helper now accepts `foreground_watch_execute` and always returns
  `ok: false` with
  `browser-native-desktop-helper-foreground-watch-executor.v1` metadata.
- The response records `enabled: false`, `supported: false`, `dryRunOnly:
  true`, `signedHelperV2Available: false`, `releaseGate:
  browser-native-helper-signing`, required preconditions, and
  `actualInputSent: false`.
- The capability manifest lists `foreground_watch_execute` as a helper-v2
  command with `supported: false` and
  `disabled_until_signed_helper_v2_and_release_gate`.
- The release helper contract probe now calls this disabled command and records
  `foregroundWatchExecutor` evidence in
  `browser-native-desktop-helper-contract-readiness.v1`.
- `npm run release:readiness` summarizes the proof with
  `executorEnabled=false` while keeping the separate signing/manual gate
  deferred.
- `gate:computer-use-promotion` now requires
  `foreground_watch_executor_disabled_contract_present` and
  `native_helper_release_readiness_paths_redacted` for
  `windows_native_watch_boundary`.
- `ComputerUseSessionsPanel` surfaces this in the Native boundary proof panel
  as `Executor: disabled`, covered by
  `smoke:renderer-computer-use-browser-chrome-evidence`.

Focused verification passed:

- `cargo fmt --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml --check`
- `cargo check --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml`
- `npm run build:daemon`
- `npm run build:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper-native`
- `npm run smoke:browser-native-desktop-helper:signing-readiness`
- `npm run release:readiness`
- `Select-String dist/reports/release-readiness-latest.json` for `C:\Users` /
  `C:/Users` returned no matches
- `npm run smoke:browser-action:native`
- `npm run lint`
- `npm run audit:computer-use-parity`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run smoke:all`

This is still not foreground native input support. It is a disabled-by-default
contract and release evidence path for future signed helper v2 work.

## Latest Update: Helper-Side Observe-Only Watch Preflight

Added the first helper-side watch-mode preflight evidence path without enabling
native input:

- Rust helper command set now includes `watch_preflight`.
- The helper uses UIA focused-window/process evidence plus Win32
  `GetLastInputInfo` age to produce `foreground-watch-preflight.v1` metadata.
- The helper also emits
  `browser-native-desktop-helper-watch-preflight-guards.v1` with active-window,
  target identity, process allowlist, and last-input evidence.
- The default command is single-sample observe-only:
  `actualInputSent: false`, `continuousMonitoring: false`, and foreground
  input remains blocked.
- `watch_preflight` also accepts bounded dry-run monitor options through
  `watchPreflight.monitorMs`; it samples last-input tick changes and focused
  process drift, records sample count/abort reason, and still sends no input.
- The native helper capability manifest lists `watch_preflight` as
  `current_v1_observe_only`.
- Daemon native adapter status runs the helper preflight and exposes it as
  `helperWatchPreflight`, plus
  `helperV2Boundary.helperSideWatchPreflightPresent` and
  `helperSideContinuousMonitorPresent`.
- Parity audit now requires `watch_preflight`, `helperSideGuards`, and
  `helperSideWatchPreflightPresent` markers inside the native helper-v2
  manifest check.

Focused verification passed:

- `cargo check --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml`
- `npm run build:daemon`
- `npm run smoke:browser-native-desktop-helper-native`
- `npm run smoke:browser-action:native`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run audit:computer-use-parity`
- `npm run lint`
- `npm run smoke:all`

This still does not satisfy signed helper v2. Continuous countdown/execution
monitoring, mouse drift, keyboard focus drift, input cancellation, and
Authenticode signing remain blockers before real foreground input can be
enabled.

## Latest Update: Native Helper v2 Capability Manifest

Added machine-readable native helper capability discovery without enabling any
new native input:

- Rust helper `status` now emits
  `browser-native-desktop-helper-capability-manifest.v2` in metadata.
- The manifest separates current v1 browser-window commands from
  signed-helper-v2-only commands.
- Current v1 commands include status/UIA observe/read/click/type/select/check/
  scroll/navigate/back/forward/reload/hotkey.
- Guarded helper-v2 commands remain `supported: false` with
  `blocked_until_signed_helper_v2`; this includes screenshot capture,
  foreground movement/drag/key input, scoped clipboard, native file-picker
  selection, menu command execution, and browser permission-popup native click.
- Daemon native adapter diagnostics now parse and expose the manifest under
  `helperCapabilities`, plus `helperV2Boundary` with
  `nativeInputEnabled: false` and
  `actualInputSentForGuardedCommands: false`.

Focused verification passed:

- `node --check scripts/smoke-browser-action-native.mjs`
- `node --check scripts/smoke-browser-native-desktop-helper-native.mjs`
- `cargo check --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml`
- `npm run build:daemon`
- `npm run build:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper-native`
- `npm run smoke:browser-action:native`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run audit:computer-use-parity` (`passed=42`, `guarded=4`,
  `missing=0`)

Next native slice should still not implement foreground/file-picker/permission
popup input until signed helper v2, countdown/input-collision guards, and
release-gate proof exist.

## Latest Update: Foreground Watch Preflight Contract

Hardened the signed-helper-v2 preflight boundary without enabling native input:

- Added shared `ForegroundWatchPreflightState` and
  `ForegroundWatchPreflightInput` types in
  `src/shared/protocol/computerUse.ts`.
- `visual_desktop_action.watchPreflight` now uses the shared protocol contract
  instead of a plain `Record<string, unknown>`.
- Runtime preconditions now include target identity assertion, surface lock,
  and timeout guard in addition to one-time approval, visible countdown,
  active-window assertion, process allowlist, idle/user-input guard,
  before/after evidence, verifier/rollback proof, and signed helper v2.
- Native-watch smoke now proves missing identity/lock/timeout guards are
  reported and active-window drift aborts with
  `foreground_watch_active_window_drift_abort` before any `desktop_action` job
  or native input.
- Promotion gate now reports
  `foreground_watch_preflight_contract_present`,
  `foreground_watch_active_window_drift_abort_guard_present`, and
  `foreground_watch_active_window_drift_abort_smoke_present`.
- Parity audit now checks the preflight contract and reports
  `passed=43`, `guarded=6`, `missing=0`.
- Renderer native boundary proof now shows `Preflight typed` and
  `Drift proved` from daemon promotion-gate metrics.

Focused verification passed:

- `node --check scripts/smoke-computer-use-native-watch-boundary.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-native-watch-boundary`
- `npm run gate:computer-use-promotion`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run audit:computer-use-parity`
- `npm run smoke:computer-use-promotion-gate-route`
- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`

## Latest Update: Computer Session DAG Reconciliation

Hardened Computer Session debug bundle export against aggregate timing races:

- `exportDebugBundle` now reconciles completed/failed/cancelled/expired
  capability jobs back into their linked DAG action node before returning the
  bundle.
- The reconciliation reads `dagRunId` and `dagNodeId` from capability job input
  metadata, updates a still-running DAG action node to the final job status,
  and idempotently creates verification/eval follow-up nodes.
- This preserves the existing capability mirror path but makes debug/export
  surfaces robust when the job has reached a final state before the DAG view is
  caught up.

Focused verification passed:

- `npm run build:daemon`
- `npm run smoke:computer-use-session-http`

## Latest Update: Windows Computer Use Parity Audit

Added an automated prompt-to-artifact audit for the Windows Codex Computer Use
parity handoff:

- New command: `npm run audit:computer-use-parity`.
- New script:
  `scripts/audit-windows-codex-computer-use-parity.mjs`.
- The audit verifies required handoff docs, protocol/session runtime markers,
  surface/permission safety, perception/action evidence, Browser Chrome,
  Toolsmith, Terminal, native watch boundaries, eval/debug UX, promotion gates,
  and registered verification commands.
- It runs the Computer Use promotion gate in dry-run JSON mode and maps gate
  reasons to guarded native/release boundaries.
- Latest generated report:
  `docs/reports/windows-codex-computer-use-parity-audit-2026-05-16.md`.
- Latest generated evidence:
  `docs/reports/assets/windows-codex-computer-use-parity-audit-2026-05-16/evidence.json`.
- Latest result: `implemented_with_guarded_boundaries`, passed=41, guarded=4,
  missing=0.

Focused verification passed:

- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run audit:computer-use-parity`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run smoke:computer-use-promotion-gate`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Aggregate verification passed after this slice with `npm run lint` and
`npm run smoke:all`. Known non-failing output remained the unsigned helper
development allowance and one Windows temp cleanup deferred retry.

Next recommended slice:

- Repeated Browser Chrome live dogfood for download verify and debugger
  print-to-PDF, or live profile-approval dogfood.

## Latest Update: Renderer Permission Profile Manager

Continued the Windows Codex Computer Use parity implementation through the
Renderer Permission Profile UX slice.

Changed:

- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `src/renderer/styles/activity-capability.css`
- `scripts/smoke-renderer-computer-use-profile-draft.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- Windows parity handoff/checklist shards.

Behavior:

- Computer Use now fetches all autonomy permission profiles for management but
  keeps new-session profile selection limited to active profiles.
- Added a permission profile manager with all-profile selection, safe one-time
  draft creation, JSON edit/save through the daemon profile route, and
  Disable/Expire lifecycle actions.
- Renderer validation blocks credential access, credential risk class,
  persistent high-risk/package/OS grants, and broad persistent browser
  automation without exact domains before POST.
- `smoke:renderer-computer-use-profile-draft` now verifies unsafe persistent
  credential/high-risk draft blocking, safe one-time manager creation with
  `credentialAccess: "never"`, selected active profile detail rendering, exact
  grant values, and lifecycle Disable POST wiring.
- `scripts/gate-computer-use-promotion.mjs` now emits
  `renderer_permission_profile_ux` as a passed but non-promoting renderer
  safety UX gate; the promotion route smoke asserts it.

Focused verification passed:

- `node --check scripts/smoke-renderer-computer-use-profile-draft.mjs`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-profile-draft`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run smoke:computer-use-promotion-gate`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Aggregate verification passed after this slice with `npm run lint` and
`npm run smoke:all`. Known non-failing output remained the unsigned helper
development allowance and one Windows temp cleanup deferred retry.

Next recommended slice:

- Browser Chrome deep-action evidence UX or live profile-approval dogfood.

## Latest Update: Computer Use Parity Status Ledger

The Windows Codex Computer Use parity execution handoff now includes a
resume-critical status ledger:

- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/07-current-status-ledger.md`

Use it after the `09-approved-execution-handoff/README.md` when context is lost.
It records the latest stable boundary, implemented/started/blocked matrix,
recently touched files, next safe slice, verification command set, non-failing
warnings, and invariants that must not regress.

Current next recommended slice remains:

- `Continue Renderer Permission Profile UX Completion`

Do not mark the global parity goal complete. The latest stable boundary covers
foreground watch-mode user-input abort preflight and renderer permission profile
draft/detail/lifecycle UX, but signed helper v2, native foreground input, native
file picker selection, production signing, and broad Windows mutation remain
blocked.

## Latest Update: Computer Use Parity Resumption Shard

The product owner accepted the current Windows Codex Computer Use parity
direction and asked for a durable handoff that can survive context loss.

Added:

- `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`

Updated:

- `docs/plans/windows-codex-computer-use-parity-handoff.md`
- `docs/plans/windows-codex-computer-use-parity/00-overview.md`
- `docs/plans/windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md`
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
- `docs/plans/README.md`

Resume order after compaction or a new session:

1. Read `docs/plans/windows-codex-computer-use-parity-handoff.md`.
2. Read `docs/plans/windows-codex-computer-use-parity/00-overview.md`.
3. Read `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`.
4. Read `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`.
5. Inspect `git status --short` and the exact files to edit before making
   changes.

Important current state:

- The parity worktree is intentionally dirty and contains multi-day
  implementation work. Do not revert unrelated files.
- Broad foreground Windows mutation remains blocked until signed helper v2,
  watch-mode guards, effect verification, and rollback proof exist.
- One-off live OpenAI research-to-PDF successes and fixture-only 30-case
  evidence are not promotion proof. The Computer Use promotion gate is now
  wired through `gate:computer-use-promotion`,
  `smoke:computer-use-promotion-gate`, and `smoke:all`; current written gate
  evidence is `docs/reports/computer-use-promotion-gate-2026-05-16.md` and it
  marks scoped-autonomy and parent Computer Session research-to-PDF live slices
  as eligible for promotion review. Repeated live samples and p95 measurements
  are now recorded in
  `docs/reports/assets/scoped-autonomy-web-research-live-runs.jsonl` and
  `docs/reports/assets/computer-use-toolsmith-live-runs.jsonl`; browser fallback
  transport is calibrated by repeated stable text hashes without storing raw
  browser text in the sample ledgers. The gate also includes
  `browser_action_semantic_live_corpus`, validating reviewed Browser Action live
  corpus/report rows across read, filter/tab, history, search, and content
  selection intents. The latest gate is exposed through
  `GET /computer-use/eval/promotion-gate` and shown in the renderer Computer Use
  panel. It also includes `windows_native_watch_boundary` as a passed but
  non-promoting safety boundary: read-only desktop observe and high-risk
  rejection are covered, unsupported native workflow cases stay blocked by
  design, the unsigned-helper release signing gate remains deferred, the native
  watch boundary smoke is in `smoke:all`, and foreground visual actions record
  `actualInputSent: false` before any native helper input.
- Toolsmith `dependency_prepare` is now a real autonomy tool run/eval step for
  generated tools. It records manifest dependency provenance, optional system
  dependency notes, and isolated runtime workspace evidence. npm dependency
  preparation is guarded by `package_install`, `npm` command, and runtime
  workspace write grants, using `--package-lock-only --ignore-scripts`; pip
  dependency preparation remains blocked until a virtualenv policy exists.
- Renderer Computer Use promotion gate rows now distinguish `eligible`
  promotable gates from `guarded` passed-but-non-promoting release/safety
  guards, and show enough rows to include Browser Action semantic corpus plus
  Windows native watch boundary status.
- Browser Action recovery evidence is now first-class in promotion gating:
  `docs/dogfood/browser-action-recovery-live-corpus.jsonl` links reviewed
  failure rows to later passing rows across `permission_missing`,
  `wrong_effect`, and `latency_regression`; `smoke:browser-action:recovery-live-corpus`
  and the `browser_action_recovery_live_corpus` gate validate row linkage,
  source coverage, recovery evidence tags, calibration-impact tags, redaction,
  and latency samples.
- Renderer blocked-grant UX now derives one-time profile requirements from
  DAG-node `missingRequirements` in addition to safety decisions, surface
  grants, and awaiting capability jobs. Grant chips carry requirement reasons
  in hover text and show overflow counts.

## Latest Update: Windows Codex Computer Use Parity Handoff

Recorded the accepted direction for implementing Codex macOS Computer Use style
behavior on Windows without assuming unpublished macOS internals.

Added:

- `docs/plans/windows-codex-computer-use-parity-handoff.md` as the index.
- `docs/plans/windows-codex-computer-use-parity/00-overview.md` for product
  target, current repo reality, non-goals, and implementation map.
- `docs/plans/windows-codex-computer-use-parity/01-contract-session-runtime.md`
  for normalized computer actions, OpenAI action schema adaptation, and the new
  daemon-owned `ComputerSessionRuntime`.
- `docs/plans/windows-codex-computer-use-parity/02-surfaces-permissions-safety.md`
  for explicit execution surfaces, permission checkpoints, risk classes,
  restricted-page handling, credentials, file, and network policy.
- `docs/plans/windows-codex-computer-use-parity/03-observation-perception-action.md`
  for screenshot feedback, perception graph evidence, ROI cascade execution,
  target grounding, action routing, verification, and failure memory.
- `docs/plans/windows-codex-computer-use-parity/04-browser-tool-terminal-slices.md`
  for isolated browser, Browser Chrome, Toolsmith, Terminal, research-to-PDF,
  download, file-upload, and document-conversion vertical slices.
- `docs/plans/windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md`
  for native helper scope correction, `desktop_action` split, foreground
  watch-mode, input collision guards, signing, and future VM/Sandbox route.
- `docs/plans/windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md`
  for eval ledger, debug bundle, renderer UX, 30-case dogfood corpus, and
  promotion gates.
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
  for phased implementation and acceptance tests.

Key architecture decision:

- Build behavior parity around a new `ComputerSessionRuntime`, an explicit
  `ExecutionSurfaceManager`, normalized `ComputerAction` adapters, and an
  observation/action/verification loop.
- Ship browser/tool/terminal parity before broad Windows foreground desktop
  control.
- Treat native Windows foreground control as bounded watch-mode until signed
  helper v2 and rollback/effect proof exist.
- Keep Browser Action, Browser Chrome, Toolsmith, Terminal, Vision/OCR,
  Capability Runtime, Capability DAG, eval ledger, and failure memory as
  backend modules under the session runtime.

Next implementation slice: protocol and skeleton session runtime, then real
`browser_action` capability handler registration and isolated-browser session
vertical.

## Latest Update: Windows Codex Computer Use Parity Phase 1/2 Foundation

Implemented the first concrete slice from the parity handoff.

Added:

- `src/shared/protocol/computerUse.ts` with normalized `ComputerAction`,
  OpenAI single-action/batched-action/widget-native adapter, session events,
  execution surface types, risk classes, and debug bundle types.
- `src/daemon/computer-use/sessionRuntime.ts` and
  `src/daemon/computer-use/surfaceManager.ts`.
- Daemon HTTP routes in
  `src/daemon/server/http/routes/computerUseSessionRoutes.ts`.
- `ComputerSessionRuntime` startup wiring in `src/daemon/server.ts`.
- Browser Action registered capability handler foundation in
  `src/daemon/capabilities/registerCapabilities.ts`.
- Capability-backed session operation execution and HTTP route:
  `POST /computer-use/sessions/:id/operations`.
- Smoke scripts and package commands:
  - `smoke:computer-use-action-adapter`
  - `smoke:computer-use-surface-manager`
  - `smoke:computer-use-session`
  - `smoke:computer-use-session-http`

Behavior:

- Computer sessions can be created through daemon HTTP.
- The runtime selects an execution surface, creates an eval run, creates and
  completes a skeleton DAG, records a skeleton observation, finalizes the eval
  run as partial success, and exports a redacted debug bundle.
- Session operations can enqueue capability-backed DAG action/observe nodes and
  wait for fast/read-only jobs to settle.
- Read-only Browser Action capability jobs can complete through the registered
  handler. Side-effect Browser Action jobs now fail with explicit
  `browser_action_executor_not_bound` until the Computer Session executor route
  is bound.

Follow-up implementation in the same slice:

- Bound the daemon HTTP Computer Session operation path to the existing
  `BrowserActionSessionManager`.
- Browser Action approval, queued extension command, and immediate-result paths
  now reuse the existing Browser Action capability mirror from Computer Session
  operations.
- Browser Action capability mirror carries `dagRunId`/`dagNodeId` for
  Computer Session operations and updates the linked DAG node when the extension
  result completes.
- `smoke:computer-use-session-http` now posts a DOM snapshot, queues a safe
  Browser Action click through `/computer-use/sessions/:id/operations`, polls
  the Browser Bridge command, posts the extension result, and verifies the
  capability job and DAG node complete.
- Added `POST /computer-use/sessions/:id/browser-action-prompt`, which uses the
  existing deterministic `planBrowserActionFromPrompt` planner and executes the
  first planned step through the Computer Session Browser Action operation
  path. The HTTP smoke now verifies prompt-planned click execution through the
  Browser Bridge and linked DAG node completion.

Verification passed:

- `npm run lint`
- `npm run build:web`
- `npm run smoke:capability-runtime`
- `npm run smoke:browser-action` (passed on rerun after one timeout flake)
- `npm run smoke:computer-use-action-adapter`
- `npm run smoke:computer-use-surface-manager`
- `npm run smoke:computer-use-session`
- `npm run smoke:computer-use-session-http`
- `npm run smoke:all`

Next implementation slice: implement multi-step Browser Action prompt
continuation under Computer Session and start the isolated-browser session
vertical.

## Latest Update: Harness Sync To v1.7.17

Branch `main` is synced to vibe-doctor harness `v1.7.17` and pushed to `origin/main` as commit `cfbbfb9`.

Completed:

- Ran `/vibe-sync` dry-run and confirmed upstream range `^v1.7.16` resolved to `v1.7.17`.
- Backed up the three local conflict files under `.runtime/vibe-sync-manual-merge/local-conflicts-1.7.17/`, then ran `npm run vibe:sync -- --force`.
- Reapplied downstream project contracts after forced sync:
  - `docs/context/orchestration.md` keeps Codex as the default Orchestrator, Planner, Generator, and Evaluator path.
  - `docs/orchestration/providers.md` keeps Codex wrapper usage as the default and forbids raw `codex exec` for Korean Windows safety.
  - `.vibe/harness/test/template-hygiene.test.ts` skips upstream template placeholder assertions when the checkout is an initialized downstream project, while keeping the dashboard/report template split assertion active.

New harness capabilities now available from `v1.7.17`:

- Codex wrapper Markdown injection diagnostics and `vibe:codex-wrapper-audit`.
- Sharded `/vibe-init`, `/vibe-interview`, `/vibe-iterate`, and `/vibe-review` runbooks with dedicated audit scripts.
- Sprint-mode and sync boundary audits.
- Dashboard and project-report render templates split into `.vibe/harness/scripts/lib/*`.
- Updated troubleshooting, upgrade, sync, and injection guarantee docs.

Verification passed:

- `npm run vibe:typecheck`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- `node --import tsx --test .vibe/harness/test/template-hygiene.test.ts`
- `npm test` (`436` tests, `435` pass, `1` skip, `0` fail)
- `git diff --check`
- strict UTF-8 decode over tracked and untracked changes
- quoted-question mojibake scan over tracked and untracked changes
- touched `.cs` check: no `.cs` files touched

Next: goal prompt generation remains paused by product-owner request. If resumed, incorporate the `v1.7.17` sharded skill/audit changes into the prompt.

## Latest Update: Research-Driven Performance Architecture Handoff

Recorded the macro-architecture direction for the next major performance and accuracy phase.

Decision:

- Paper-backed methods take priority over existing implementation shape when they conflict, except for safety, credential, restricted-page, consent, and retention boundaries.
- The daemon remains the local control plane, but should evolve into a scientific execution engine for scenario setup, multimodal evidence collection, cascade scheduling, verification, failure calibration, and metric promotion.
- Subsystem metrics are subordinate to end-to-end task success, p50/p95 latency, clarification rate, proof quality, and recovery quality.

Added:

- `docs/plans/research-driven-performance-architecture-handoff.md`, covering the proposed architecture and process mandates from ASR contextual bias/WFST decoding, GUI grounding/perception graphs, ROI/delta OCR cascades, ReAct/Reflexion-style bounded loops, OSWorld/WebArena-style eval ledgers, early-exit scheduling, and capability DAG migration.
- `docs/plans/README.md` now links the new handoff.

Recommended next slice: implement the unified computer-use eval ledger and scenario/result schema first, then add ASR command-slot metric fields. This creates the measuring instrument before changing target selection, ASR decoding, or Vision pipelines.

## Latest Update: Local ASR Persistent Worker Baseline

Continued the CPU-first ASR plan after GPU validation was deferred.

Implemented:

- Added persistent JSONL worker mode to `scripts/asr-sidecar-faster-whisper.py --worker`, keeping one Python process and one loaded `WhisperModel` alive across requests while preserving the existing single-shot sidecar contract.
- Added `--persistent` to `scripts/benchmark-asr-candidates.mjs`, including `workerMode`, `coldStart`, `workerPid`, transcript diagnostics, and manifest duration handling.
- Added `scripts/prepare-asr-human-corpus.mjs` plus `npm run asr:human-corpus` to scaffold ignored local human microphone corpus files under `.runtime/asr/human-mic-corpus/`.
- Added `scripts/smoke-asr-persistent-worker.mjs`, `npm run smoke:asr-persistent-worker`, and included it in `smoke:all`.
- Wrote `docs/reports/local-asr-persistent-worker-cpu-benchmark-2026-05-14.md`.

Result:

- Real `faster-whisper-large-v3-turbo-cpu` persistent benchmark on the existing five SAPI samples passed with normalized similarity 1.00.
- First cold request was 22.65s, including 7.92s model load.
- Warm persistent requests averaged 12.52s, min 11.04s, max 13.95s.
- `npm run asr:human-corpus` created the local ignored corpus scaffold. Raw microphone WAV recording and the follow-up human-corpus persistent benchmark are deferred by the 2026-05-14 product-owner decision.

Verification passed JS syntax checks, Python py_compile, `npm run build:daemon`, `npm run smoke:asr-persistent-worker`, `npm run smoke:asr-runtime-candidates`, `npm run smoke:asr-sidecar`, `npm run lint`, `npm run smoke:vision-context`, final `npm run smoke:all`, `git diff --check`, strict UTF-8 decoding, quoted-question mojibake scan, and `npm run vibe:checkpoint`. `git diff --check` emitted only the existing CRLF normalization warning for `.vibe/agent/session-log.md`; `smoke:all` emitted one standard Windows temp cleanup deferred retry.

Next ASR step: no local ASR benchmark is immediately active. Keep `faster-whisper-large-v3-turbo-cpu` plus persistent worker mode as the current default evidence. Human microphone corpus recording/benchmark and GPU validation are both deferred until explicitly resumed.

## Latest Update: Local ASR GPU Deferred

Recorded the product-owner decision to defer local ASR GPU validation.

Decision:

- Keep `faster-whisper-large-v3-turbo-cpu` as the current ASR dogfood default.
- Do not install CUDA/cuDNN DLLs or rerun `faster-whisper` CUDA candidates in the current loop.
- Keep GPU candidates implemented as dormant benchmark options for a later explicit GPU pass.

Updated:

- `docs/plans/local-asr-runtime-selection.md` now marks GPU enablement as deferred and keeps the CUDA commands as a future reactivation checklist.
- `docs/reports/local-asr-cpu-benchmark-2026-05-13.md` now makes human microphone CPU corpus collection and persistent-worker latency the next ASR steps.

Next ASR step: collect human Korean microphone command WAVs on the CPU default, then measure a persistent ASR worker/service path so latency excludes process spawn and model load. GPU DLL installation/testing is deferred until explicitly resumed.

## Latest Update: Local ASR CPU Dogfood Baseline

Executed the next ASR plan after adding runtime candidates.

Completed:

- Added `.runtime/` to `.gitignore` and created local venv `.runtime/asr/faster-whisper`.
- Installed `faster-whisper` into the ignored local venv.
- Added reusable `npm run asr:tts-samples` via `scripts/generate-asr-tts-samples.ps1`; the script generates five Korean command WAV fixtures using Windows SAPI `Microsoft Heami Desktop - Korean`.
- Improved `scripts/benchmark-asr-candidates.mjs` to support manifest-based corpus benchmarking, UTF-8 BOM manifests, and slot-aware normalization for punctuation plus `리액트 라우터 돔` / `react-router-dom`.
- Downloaded/cache-tested `large-v3-turbo` and `large-v3` under `.runtime/asr/models/faster-whisper`.
- Ran CPU comparison across five generated Korean command samples and wrote `docs/reports/local-asr-cpu-benchmark-2026-05-13.md`.
- Probed the GPU candidate on local RTX 3060 Ti; wiring reached CUDA runtime but failed because `cublas64_12.dll` is not installed or not on `PATH`.

Result:

- `faster-whisper-large-v3-turbo-cpu`: average 14.25s per sidecar request, normalized similarity 1.00.
- `faster-whisper-large-v3-cpu`: average 20.41s per sidecar request, normalized similarity 1.00.
- Recommendation remains `large-v3-turbo-cpu` as the first default. `large-v3-cpu` stays as accuracy baseline.

Verification passed JS syntax checks, Python py_compile, `npm run asr:tts-samples`, `npm run smoke:asr-runtime-candidates`, `npm run lint`, `npm run smoke:asr-sidecar`, `npm run smoke:vision-context`, final `npm run smoke:all`, `git diff --check`, and strict UTF-8/mojibake scans.

Next ASR step: replace synthetic SAPI samples with human microphone Korean command WAVs and measure persistent-worker latency. CUDA 12/cuDNN 9 DLL installation and GPU retesting are deferred until explicitly resumed.

## Latest Update: Local ASR Runtime Candidate Implementation

Implemented the CPU-first local ASR selection path requested after the GPT-Realtime-2/free-tier review.

Implemented:

- Added concrete ASR candidate profiles in `scripts/asr-runtime-candidates.mjs` for `faster-whisper` CPU/GPU, `whisper.cpp`, and Vosk.
- Added `scripts/asr-sidecar-faster-whisper.py` with CPU default (`large-v3-turbo`, `int8`) and GPU-ready settings (`cuda`, `int8_float16`) behind environment variables.
- Added `scripts/asr-sidecar-whisper-cpp.mjs` for `whisper-cli` plus ggml model paths, including JSON-output parsing and stdout fallback.
- Added `scripts/asr-sidecar-vosk.py` for the tiny Korean Vosk fallback path.
- Added `npm run asr:candidates`, `npm run asr:benchmark`, and `npm run smoke:asr-runtime-candidates`.
- Added `docs/plans/local-asr-runtime-selection.md` with CPU-only setup, GPU enablement, whisper.cpp/Vosk fallback commands, and acceptance criteria based on workflow success rather than raw WER.
- Updated product/blocker docs to reflect that runtime candidates are implemented, while final default selection remains dogfood-owned.

Verification passed syntax checks for all new JS/Python scripts, `npm run asr:candidates -- --cpu-only`, `npm run smoke:asr-runtime-candidates`, `npm run smoke:asr-sidecar`, `npm run smoke:vision-context`, `npm run lint`, final `npm run smoke:all`, `git diff --check`, and strict UTF-8/mojibake scans. The current machine has Python 3.12.1, but `faster_whisper` and `vosk` are not installed yet, so real model inference was not run; CPU-only fixture dispatch and benchmark wiring are verified.

Next ASR dogfood step: install `faster-whisper` into `.runtime\asr\faster-whisper`, collect a small Korean command WAV set, then run `npm run asr:benchmark -- --candidate faster-whisper-large-v3-turbo-cpu,faster-whisper-large-v3-cpu --audio <sample.wav> --expected <text> --json`.

## Latest Update: Non-BLOCKED Browser Action And Vision Follow-ups

Continued the post-cleanup follow-up queue and kept externally blocked items out of scope.

Implemented:

- Pushed prior unused-code cleanup as `0444668` (`Remove confirmed unused code`) before starting the new slice.
- Promoted reviewed live Browser Action traces into `docs/dogfood/semantic-trace-corpus.jsonl` as redacted calibration rows for read, search-submit, history navigation, and representative-content selection.
- Strengthened `smoke:semantic-trace-corpus` so fixture rows still cover every golden trace while live rows must carry redaction markers, report/scenario/run IDs, semantic evidence tags, and required intent-class coverage.
- Added Browser Action renderer debug bundle export: diagnostics history, recent failed transactions, copy/download actions, and a compact export covering bridge/adapters/latest diagnostics/recent transaction summaries.
- Extracted Browser/Vision mode menu overlay behavior from `WidgetRuntime.tsx` into `useWidgetModeMenus`.
- Clarified Browser Bridge `reloadRequired` UX so widget menus/panels point users to the extension popup `Reload bridge` button; `smoke:browser-action:direct-menu` now covers that state.
- Clarified restricted-page recovery copy without implying bypass: use a normal http/https tab, or native-helper diagnostics only for approved browser chrome, permission prompt, or file picker recovery.
- Added `npm run smoke:asr-sidecar` and included it in `smoke:all`; it verifies the ASR sidecar stdin/stdout JSON contract, transcript normalization, invalid JSON, nonzero exit, and timeout behavior without selecting a production ASR model.

Verification passed `npm run lint`, `npm run smoke:browser-action:renderer`, `npm run smoke:browser-action:direct-menu`, `npm run smoke:extension`, `npm run smoke:semantic-trace-corpus`, `npm run smoke:browser-action:semantic-live-corpus`, `npm run smoke:vision-context`, `npm run smoke:asr-sidecar`, `npm run smoke:browser-bridge`, `npm run smoke:architecture-foundations`, Browser native helper focused smokes including signature-readiness, final `npm run smoke:all`, `git diff --check`, and strict UTF-8/mojibake scans for touched files. The native helper remains unsigned in development; release enforcement is still blocked on an Authenticode certificate or CI signing service.

Remaining blockers: official app-server client-tool contract, production helper signing secret/certificate, and selecting/installing the first real local ASR runtime/model. Reload the unpacked Browser Bridge extension once before manual live browser retesting so Chrome/Edge uses current popup/service-worker code.

## Latest Update: Browser Action Clarification Choice Cards

Continued non-manual Browser Action work by closing the remaining ranked-choice UX gap where daemon clarification text was richer but the widget still showed it as a plain text input.

Implemented:

- `RuntimeInteraction` now supports optional structured `choices[]`.
- Browser Action target clarification interactions include candidate choice metadata derived from the same daemon summaries used in chat text: label, region/position, link/nearby text, and confidence detail.
- `InteractionCard` renders input choices as selectable cards; clicking a candidate submits the underlying `choice` answer immediately, so the user no longer has to read a long paragraph and type the candidate number manually.
- Renderer styling keeps candidate cards compact and readable inside the chat surface without turning the Browser Action UI into a large dashboard.
- `npm run smoke:browser-action:renderer` now verifies that a Browser target clarification choice card renders and submits `interaction.respond` with the selected target.

Verification passed `npm run lint`, `npm run smoke:browser-action:renderer`, and `npm run smoke:browser-action:transaction-clarification`.

## Latest Update: Browser Action Native Helper Contract

Continued the Browser Action 1-8 workstream closure after the history-latency push. The remaining feasible non-manual development item was the Windows native desktop fallback boundary: the adapter previously exposed browser-window diagnostics and a precise UI Automation `BLOCKED` record, but had no executable helper contract to attach a future scoped helper.

Implemented:

- `src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts` defines `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER`, a typed JSON helper protocol for native fallback `status`/`observe`/`execute` requests, helper path diagnostics, script/executable dispatch, timeout handling, invalid JSON handling, and normalized metadata.
- `nativeDesktopAdapter` now reports helper availability in adapter diagnostics, uses a configured helper for observe/execute when present, converts helper snapshots into `BrowserObservation`, and still returns a clear `BLOCKED` error when no helper is configured.
- `npm run smoke:browser-action:native` now creates a mock helper executable and proves the configured-helper observe/execute path without requiring live Windows UI Automation testing.
- Browser Action handoff docs now distinguish the implemented helper contract from the still-blocked live signed UIA/native-input helper.

Verification passed `npm run build:daemon`, `node --check scripts/smoke-browser-action-native.mjs`, and `npm run smoke:browser-action:native`.

## Latest Update: Browser Action History Command Latency Fix

Automated live regression after the previous candidate-clarity push found one remaining isolated failure: `local-back-fast-path` moved the target browser back to `/forum`, but the daemon prompt never completed before the 8s scenario timeout.

Root cause: Browser Bridge history actions already waited for the changed page observation inside `executeTabNavigationAction()`, then the outer command-first result path called `readPostActionSnapshot()` a second time using the already-changed snapshot as the fallback. For `back`/`forward`, that second wait required another changed observation that would never occur, adding about 6s and occasionally timing out before the daemon received the result.

Implemented fixes:

- `providers/browser-dom-extension/bridge/action-channel.js` now reuses `result.after` immediately for tab-navigation actions that already performed post-navigation observation.
- `scripts/browser-action-live-runner.mjs` now avoids classifying `"permission":"allowed"` artifacts as permission failures and records final URL/text/screenshot even when a scenario times out.
- Headed isolated live evidence `browser-action-back-fast-regression-20260511` passed `local-back-fast-path` in 357ms.
- Full headed isolated live evidence `browser-action-post-fix-regression-20260511` passed 8/8 scenarios; `back` was 381ms/1177ms and `forward` was 366ms.

Verification passed `npm run dogfood:browser-action:live -- --scenario local-back-fast-path --run-id browser-action-back-fast-regression-20260511`, `npm run dogfood:browser-action:live -- --run-id browser-action-post-fix-regression-20260511`, `npm run smoke:extension`, `npm run smoke:browser-bridge`, and `npm run smoke:browser-action`.

## Latest Update: Browser Action Candidate Clarity And Forward Regression

Follow-up hardening after manual Browser Action testing on 2026-05-11 addressed three live risks:

- View Graph v2 content-list selection now excludes pinned/notice/announcement/admin-style rows from representative content candidates instead of merely downranking them. This prevents vague requests such as "interesting post" from repeatedly opening a fixed notice row when normal article rows exist.
- Browser Action clarification output now renders candidates as readable multi-line summaries with localized role names and explicit selection aliases such as `1` or `첫번째`. Clarification resume accepts Korean/English ordinal words including `첫번째`, `두번째`, `first`, and `second`.
- The live Browser Action runner can now set up browser history with `setupHistoryBack`, enabling deterministic forward-history testing. Added `local-forward-single-step`; headed live dogfood `browser-action-forward-regression-20260511` passed in 6616ms. Headless extension execution remains unavailable because the Manifest V3 service worker is not started in that path.

Verification passed `npm run build:daemon`, syntax checks for the changed smoke/runner scripts, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-view-graph-v2`, JSONL scenario parsing, and headed `npm run dogfood:browser-action:live -- --scenario local-forward-single-step --run-id browser-action-forward-regression-20260511`.

## Latest Update: Browser Action Deterministic Back And Ordinal Content

Manual DB/log review on 2026-05-11 found two separate Browser Action failures:

- `뒤로가기` sometimes acted in the browser but returned a stale widget answer because the Browser Bridge accepted the pre-navigation snapshot once `readyState=complete` was observed.
- Repeating `4번글 눌러줘` was nondeterministic because the intent resolver collapsed the request to `대표 글`, candidate metadata allowed representative-content ties to proceed, and late target resolution could choose a different element than the selected transaction candidate.

Implemented fixes:

- Browser Bridge tab navigation actions now wait for changed URL/route/view-revision evidence for `navigate`/`back`/`forward`; unchanged back/forward observations return a failed execution instead of a stale success.
- Browser Action verification now fails `back`/`forward` when the observed page does not change.
- Content-open intent parsing preserves ordinal requests such as `4번글`, `첫번째 글`, and `맨 윗 글` as `N번째 글`.
- Candidate generation has an ordinal content-list path that filters utility/count/category links, preserves content order, and binds the requested item number to a concrete candidate.
- Execution now uses the transaction-selected candidate as the action target for non-exact element actions, so the resolver revalidates rather than silently choosing a different representative element.
- Regression coverage was added for ordinal content intent/candidate selection, utility vote-link exclusion, and stale back verification.

Verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action:fresh-context`, `npm run smoke:browser-interaction-transaction`, `npm run smoke:browser-action:transaction-verification`, `npm run smoke:browser-view-graph-v2`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, and `npm run smoke:dom`.

Runtime was restarted after daemon/extension-bridge changes. Renderer is listening on `127.0.0.1:5173` with PID `101396`, daemon is healthy on `127.0.0.1:4128` with PID `112748`, and widget PID is `117036`.

Manual follow-up: reload the unpacked Browser Bridge extension before live browser retesting so Chrome/Edge uses the updated bridge `action-channel.js`.

## Latest Update: Browser Action Back Lease And Clarification UX

Manual widget testing on 2026-05-11 showed `뒤로가기` succeeded only 1/4 times and ambiguous target clarification candidates were hard to distinguish.

- Root cause for `뒤로가기`: the prompt was correctly classified as `back`, but `executeAction` treated `settling_ready` active-tab leases as invalid for all non-read side effects. Targetless browser-history actions do not need element grounding, so they now use `isBrowserViewContextLeaseUsableForAction()` and can proceed from a non-stale active-tab lease even while page understanding is settling.
- Stale/expired lease failures are no longer reported as generic target clarification. They fail with a freshness-specific message so the chat answer does not say the target was ambiguous when the real issue is page-understanding freshness.
- Target clarification responses now render richer candidate lines with role, visible label, region/landmark, approximate screen position, link path, nearby text, and element confidence. Users can answer with a number, visible label, region, or position hint.
- Clarification candidate matching now accepts the enriched summary and simple position/region hints such as `상단`, `본문`, `왼쪽`, or `nav`.
- Focused regression coverage was added for targetless `back` from a settling active-tab lease and enriched clarification candidate output.

Verification passed `npm run build:daemon`, `npm run smoke:browser-action`, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-interaction-transaction`, `npm run lint`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action:fresh-context`, `npm run smoke:semantic-interface`, UTF-8/mojibake scan for touched files, and `npm run build:web`.

## Latest Update: Browser Action Search Clarification Continuation

Public-site widget-UI dogfood is now green for the DCInside, FMKorea, Naver, and Google Browser Action matrix.

- Clarification resume now preserves the original prompt `BrowserActionPlan`, completed results, and step id, so selecting a clarified search field continues the remaining submit/search step instead of ending after the `type` action.
- Search intent parsing now separates the field target from the submit button target. Prompts such as `검색창에 '브라우저 액션 테스트' 입력하고 검색 버튼 눌러줘` produce `searchbox: 검색 -> button: 검색`, while branded labels such as `Google 검색 버튼` are preserved as `button: google 검색`.
- Candidate scoring now gives explicit requested-role evidence (`searchbox`, `button`, `link`) to the intended role and penalizes mismatches, reducing broad page/link competition for typed search flows.
- Late execution no longer lets an ambiguous pre-semantic candidate gate force confidence down when Semantic Interface has already selected the same browser element with high confidence.
- Browser safety now treats explicit search-submit buttons as safe search/navigation activations while keeping generic submit/payment/delete/send/upload/download/auth buttons protected.
- Focused smoke coverage was added for search intent/candidate gating and search-submit safety.

Latest public-site run: `docs/reports/browser-action-live-report-browser-action-public-sites-search-final-20260511.md`.

Result: 8 passed / 0 failed.

Verification passed `npm run lint`, `npm run smoke:browser-action`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-interaction-transaction`, and live widget-UI public-site dogfood. The Google-focused rerun `docs/reports/browser-action-live-report-browser-action-google-search-safe-submit-20260511.md` also passed after safe search-submit handling.

Runtime was restarted after daemon-side changes. Renderer is listening on `127.0.0.1:5173` with PID `91084`, daemon is healthy on `127.0.0.1:4128` with PID `104280`, and widget PID is `99348`.

## Latest Update: Browser Action Public-Site Widget UI Dogfood

Public-site Browser Action dogfood now has a reusable scenario file and runner support for isolated all-sites extension permission testing.

- Added `docs/dogfood/browser-action-public-sites-smoke.jsonl` with widget-UI prompts for DCInside, FMKorea, Naver, and Google.
- `scripts/browser-action-live-runner.mjs` now supports `--grant-all-site-permission`. The runner copies the unpacked extension into a temp directory, injects `http://*/*` and `https://*/*` host permissions into that temporary manifest, enables Browser Bridge `allowAllSites` for the temporary profile, and leaves the checked-in extension manifest unchanged.
- The widget-UI runner can now answer clarification input cards via `clarificationChoice` before continuing approval handling.
- Active-tab matching in the runner now tolerates same-origin/same-path URLs with browser-added query strings when the scenario expected URL had no query, which fixed Google `?zx=...` active-tab validation.
- Browser Action intent classification no longer treats direct filter/navigation clicks such as `개념글 눌러줘` as representative content-open requests. This fixed the public DCInside concept-tab scenario without adding site-specific rules.

Latest public-site run: `docs/reports/browser-action-live-report-browser-action-public-sites-live3-20260511.md`.

Result: 6 passed / 2 failed.

- Passed: DCInside read, DCInside concept click, FMKorea read, FMKorea back, Naver read, Google read.
- Failed: Naver search and Google search. Both failures reached clarification, selected the search combobox, and typed the requested query successfully, but clarification resume completed only that clarified `type` step and did not continue the original multi-step plan to submit/search. This is a real Browser Interaction Transaction follow-up: clarification resume needs to preserve and continue remaining candidate steps and emit a final user-facing completion after extension-backed clarified commands.

Verification for this change passed `node --check scripts/browser-action-live-runner.mjs`, `npm run lint`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action`, `git diff --check`, and mojibake scan.

Runtime was restarted after the daemon-side intent change. Renderer is listening on `127.0.0.1:5173` with PID `113488`, daemon is healthy on `127.0.0.1:4128` with PID `106840`, and widget PID is `115152`.

## Latest Update: Browser Bridge Observe Wake-Up

Follow-up live widget log review found one remaining Browser Action failure after the previous latency fix: connected/allowed Browser Bridge prompts could still time out waiting for a fresh active-tab observation because the extension WebSocket wake-up handler ignored `browser_perception_waiting` / `observe_queued` events. The handler now wakes command polling for fresh observe commands, prompt action commands (`plan_paused_for_extension`), approval/direct queued commands, and clarification-resume queued commands. Concurrent wake-ups are coalesced instead of dropped while a poll is already running.

`npm run smoke:browser-perception:extension-command` now exercises WebSocket command delivery for `observe_now` instead of the HTTP long-poll fallback. Focused verification passed `node --check` for the changed extension/smoke scripts, `npm run build:daemon`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, `npm run lint`, `npm run smoke`, `npm run smoke:browser-action`, and `npm run dogfood:browser-action:live -- --run-id browser-action-wakeup-final-20260511`. The final live report passed all seven isolated scenarios: current-page read 128ms, back 192/198ms, approval prime 337ms, grouped Always Allow passed, and reuse 204ms.

Manual follow-up: reload the unpacked Browser Bridge extension before retesting the installed browser extension, because `providers/browser-dom-extension/service-worker.js` changed.

## Latest Update: Browser Action Command Ack and Live Latency

Follow-up live-runner work addressed the latest Browser Action dogfood issues: slow/inconsistent `뒤로가기`, repeated approval prompts, and approval-result responses ending at the approval receipt.

- Extension action commands are now acked through `/browser-action/extension/action-ack` as soon as the Browser Bridge receives them.
- Daemon Browser Action commands are no longer destructively removed on poll response alone; they remain redeliverable until extension ack/result, which prevents Manifest V3 long-poll abort/response-loss races and avoids duplicate back/forward execution after ack.
- Browser Action command polling now prioritizes queued action commands over perception observe commands once the prompt has already planned an action.
- Prompt approvals now persist `always_allow` Browser Action policy labels and asynchronously update the original prompt message with the final action result after approval execution.
- The live runner now measures prompt-to-result latency separately from test setup, captures post-approval final messages, and includes a `local-back-single-step` scenario to prove `뒤로가기` executes once.
- Browser Bridge refresh now checks pending Browser Action commands before auto-observe so browser default actions and post-approval commands are not delayed behind snapshot work.
- Real-browser live-runner artifacts now redact active-tab answer/event/page strings by default; real-mode reports keep status, latency, IDs, and diagnostics without persisting the user's page content.

Latest focused verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action:fresh-context`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, repeated `npm run dogfood:browser-action:live`, and `npm run dogfood:browser-action:live:real -- --scenario real-active-read`. Latest isolated live-runner report: `docs/reports/browser-action-live-report-browser-action-final-regression2-20260511.md` with prompt latencies around read 123ms, back 186-195ms, normal navigate reuse 183ms, and approval navigate 2803ms. Latest real-mode read report: `docs/reports/browser-action-live-report-browser-action-real-read-redacted2-20260511.md` passed in 556ms with redacted artifacts. The live daemon was restarted; `/storage/health` is ok on `127.0.0.1:4128` with daemon PID `60440`.

Manual follow-up: reload the unpacked Browser Bridge extension before retesting the installed browser extension, because extension bridge files changed.

## Latest Update: Browser Action Live Test Fixes

After live widget testing exposed Browser Action regressions, the prompt path has been tightened without adding site-specific rules.

- Extension-backed prompt commands now fail and remove their queued command if the Browser Bridge does not pick them up within the prompt wait window. This prevents stale commands from executing later against a new prompt/session.
- Representative content selection now rejects survey/notice/admin/event/guide/policy style rows in View Graph content-list representatives, transaction candidates, and semantic content target resolution.
- URL-less navigation requests such as fuzzy gallery/site names no longer turn into arbitrary current-page link clicks. Unknown destinations route to safe search navigation instead of misusing the active page.
- Candidate-gate ambiguity now overrides late resolver confidence for side-effect text targets, while exact element bindings still execute normally.
- Prompt responses now summarize completed browser actions in user-facing text instead of exposing raw `plan/steps/latest result` receipts; failures localize extension timeout, source-change, and target-resolution reasons.
- Chat markdown links now normalize `www.*` external URLs and prevent widget-internal navigation before opening them through the external URL bridge.
- Prompt command wait was reduced from 60s to 40s to improve worst-case response latency while still allowing one long-poll cycle plus browser action execution.

Verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-interaction-transaction`, Browser Perception focused smokes, `npm run smoke:browser-bridge`, `npm run smoke:extension`, `npm run smoke:dom`, `npm run smoke:semantic-interface`, `npm run smoke:semantic-memory`, and mojibake scan. Live daemon/widget were restarted; daemon PID is `78340`, widget PID is `105248`, Vite remains on `127.0.0.1:5173`, and `/storage/health` returned ok.

Manual follow-up: reload the unpacked Browser Bridge extension before retesting if Chrome/Edge still has an older service worker loaded.

## Latest Update: Browser Action Live Test Automation

Added Browser Action live dogfood automation so manual prompt testing no longer requires hand-copying logs for every failure.

- Added `scripts/browser-action-live-runner.mjs`.
- Added npm scripts:
  - `npm run dogfood:browser-action:live`
  - `npm run dogfood:browser-action:live:real`
- Added scenario/docs files:
  - `docs/dogfood/browser-action-live-scenarios.jsonl`
  - `docs/dogfood/browser-action-live-testing.md`
- `isolated` mode starts a temporary daemon, launches a dedicated Chromium profile with the unpacked Browser Bridge extension, configures the extension daemon URL, opens a local fixture page, sends widget-style Browser mode prompts over the daemon websocket, auto-responds to safe approvals, and writes failure packets with daemon events, bridge status, screenshots, and result JSON.
- `real` mode connects to the live daemon and installed Browser Bridge extension for the currently active user browser tab. This mode is for observing real browser progress; do not touch the active tab/window while a scenario is running.
- Default isolated scenarios now cover representative content opening and current-page read behavior.
- A live isolated run passed both default scenarios and wrote `docs/reports/browser-action-live-report-browser-action-live-final-20260510.md` plus assets under `docs/reports/assets/browser-action-live/browser-action-live-final-20260510/`.
- The live runner exposed one real Browser Action issue: representative-content requests with multiple valid content items were clarified too aggressively. `planningGate` now permits a top `content_list_representative` candidate when the user explicitly asks for representative/any/interesting content, while keeping non-representative ambiguous side-effect actions gated.

Verification passed `npm run lint`, `npm run build:web`, `npm run smoke:browser-action`, `npm run smoke:browser-interaction-transaction`, `npm run smoke:extension`, `node --check scripts/browser-action-live-runner.mjs`, `npm run dogfood:browser-action:live -- --dry-run`, and the headed isolated live runner. The live daemon/widget were restarted again after the daemon change; daemon PID is `105696`, widget PID is `66116`, and `/storage/health` returned ok.

## Latest Update: Browser Interaction Transaction

Iteration `iter-20` completed `docs/plans/browser-interaction-transaction-handoff.md`.

- Browser Action's resolver-first prompt path is now treated as insufficient for universal natural-language control; prompt/direct/clarification paths route through request-scoped `BrowserInteractionTransaction` metadata.
- Added `src/daemon/browser-action/interaction/` with transaction/lease types, fresh/stable lease helpers, intent frame construction, finite candidate generation from current browser evidence, deterministic planning gates, transaction management, expected-effect verification helpers, and Semantic Memory feedback publishing.
- Prompt runner, direct UI command handling, prompt plan continuation, and clarification resume now carry transaction ids, lease ids, candidate ids, view revisions, and graph digests into execution.
- Clarification resume reacquires fresh Browser Perception context before acting; it no longer blindly resumes against whichever DOM snapshot is latest.
- `resultVerifier` now checks expected effects so wrong clicks can fail even when an action returns a refreshed observation.
- Added `npm run smoke:browser-interaction-transaction`, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-action:transaction-verification`, and `npm run smoke:browser-action:transaction-concurrency`.
- Dogfood report: `docs/reports/browser-action-dogfood-evidence-2026-05-10.md`.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting because extension service-worker/bridge files changed.

## Current Readiness Snapshot

- 2026-05-06T07:22:23.060+09:00 strict `node scripts/release-readiness.mjs --require-manual-gates` re-check passed all automated release, resource, store-packet, and two-hour soak gates except the external browser-store submission gate.
- 2026-05-06T08:56:59.660+09:00 product owner deferred actual Chrome Web Store / Microsoft Edge Add-ons dashboard submission until after dogfooding; the release-channel readiness objective closed with that task deferred.
- 2026-05-06T12:27:12.372+09:00 a new active goal was registered: all follow-up work should proceed through `/vibe-iterate`, with Iteration `iter-3` focused on daemon-owned SQLite state, recoverable sessions/tabs/trash, artifact history, activity logs, Vision recording/streaming, and extensible theme/mascot/module foundations.
- 2026-05-06T13:37:00.000+09:00 `iter-3-sprint-03-artifact-activity-ledger` completed: daemon-owned artifact/activity ledger APIs, blob-backed tool-output and file-change artifact records, chat and trash artifact viewers, activity detail UI, and storage/daemon/renderer smoke coverage are in place. Next active sprint is `iter-3-sprint-04-vision-streaming-and-ux-foundation`.
- 2026-05-06T14:07:59.836+09:00 `iter-3-sprint-04-vision-streaming-and-ux-foundation` completed: Vision popup actions, WebM recording metadata/blob preservation, metadata-only Agent screen stream with low-frequency frame delivery to the daemon Vision snapshot endpoint, guardrails, and status-aware mascot hooks are implemented. The planned Iteration 3 sprint set is complete.
- 2026-05-06T14:44:38.519+09:00 product owner clarified that the `/goal` directive means repeated `/vibe-iterate` execution until the categorized dogfooding backlog is actually closed, not stopping after Iteration 3. Durable state now treats Iteration 4 as active; the external goal tool was prematurely marked complete and cannot be reverted from the available API.
- 2026-05-06T14:58:00.000+09:00 `iter-4-sprint-01-ui-polish-and-tab-interactions` completed: resize hit areas, minimum-width model/reason controls, 12px user bubbles, active session tab polish, branch-to-new-session toast, and model/reason session-switch pulse are implemented with renderer smoke coverage.
- 2026-05-06T15:12:00.000+09:00 `iter-4-sprint-02-widget-context-agent-awareness` completed: each Agent turn now receives a daemon-owned widget capability context covering current mode, model/reasoning, sanitized auth, provider statuses, controls, Vision/DOM/PTY use cases, and safety boundaries across app-server, exec, and OAuth proxy paths.
- 2026-05-06T15:19:22.339+09:00 `iter-4-sprint-03-artifact-rendering-and-version-browser` completed: artifact files now include file type icons, bounded text/image previews, current-version metadata, version accordions, and versioned open requests reused by both chat and trash artifact viewers.
- 2026-05-06T15:34:46.947+09:00 `iter-4-sprint-04-vision-voice-interactive-loop` completed: Vision tools now separate snapshot/WebM recording/Agent share, persist cadence and duration controls, retain consent/retention metadata in daemon stream records, dismiss on outside click/Escape, and expose a Web Speech API voice prompt input boundary.
- 2026-05-06T15:43:32.772+09:00 `iter-4-sprint-05-pty-popup-and-mascot-persona` completed: PTY now has an inline use-case/connection guide, a terminal-focused popout entry point on the same daemon port, and Default Dog mascot persona/tone is injected into Agent widget context. The Iteration 4 planned sprint set is complete.
- 2026-05-06T16:04:18.953+09:00 Iteration `iter-5` started to close the remaining feasible backlog: durable app-server thread rebinding, provider snapshot history UI, Vision resource tuning, and final completion audit.
- 2026-05-06T16:22:00.000+09:00 `iter-5-sprint-01-durable-app-server-thread-rebinding` completed: the daemon now persists and rebinds Codex app-server thread ids per durable session, retries stale thread ids safely, and smoke coverage verifies separate internal sessions keep separate app-server threads.
- 2026-05-06T16:38:00.000+09:00 `iter-5-sprint-02-provider-snapshot-history-ui` completed: DOM, Vision, and Terminal provider snapshots are now stored as redacted ledger history and rendered in the Activity detail popover.
- 2026-05-06T16:52:00.000+09:00 `iter-5-sprint-03-vision-resource-and-retention-tuning` completed: Agent screen share now drops overlapping frame ticks, reports skipped frames, avoids duplicate stop messages, cleans up media/frame resources on terminal provider states, and records effective guardrail metadata.
- 2026-05-06T16:53:00.000+09:00 `iter-5-sprint-04-completion-audit-and-readiness-update` completed: roadmap, milestones, iteration history, handoff, session log, and project report state now classify all remaining work. The active vibe-iterate goal has no further feasible non-dogfood implementation backlog.
- 2026-05-06T21:59:00.000+09:00 smoke-test storage isolation was corrected after dogfooding exposed `smoke test` tabs in the real widget DB. Daemon/release smoke scripts now run with temp app-data paths, the real DB was backed up, smoke sessions/artifacts were removed, and `npm run smoke:all` passed without re-polluting the widget DB.
- 2026-05-06T22:18:28.179+09:00 dogfood UI polish follow-up completed: Vision menu alignment, Settings capture behavior, right resize/scrollbar hitboxes, trash restore layout/icon tooltip, titlebar New chat removal, Activity popover/one-line strip, and voice/send button sizing were corrected.
- 2026-05-06T22:38:17.042+09:00 floating popup placement was hardened: More, Vision, Trash, and Activity popups now render through viewport-aware fixed portals, More prefers the top-right direction from its trigger with overflow fallback, and `data-tooltip` tooltips use the same floating placement path.
- 2026-05-06T23:19:17.596+09:00 renderer architecture refactor completed: `App.tsx` was reduced from 4,959 to 2,612 lines, renderer UI moved into feature components, shared UI behavior moved into hooks/utils, and `styles.css` became a scoped CSS import manifest.
- 2026-05-06T23:39:18.331+09:00 dogfood UI motion polish completed technically: trash artifact count now owns the file icon, Activity footer height was reduced to 52px, and the mascot was changed from transform-only bounce to a generated 9-frame sprite sheet from the current PNG.
- 2026-05-07T00:12:14.390+09:00 product-owner correction recorded: the generated sprite sheet is not accepted as "moving mascot" work because it derives from one static pose and only satisfies an automated-condition proxy. Future ambiguous UX requests require a consensus step before implementation, and mascot motion must be reworked with real authored pose/expression/state motion.
- 2026-05-07T00:25:39.389+09:00 `/vibe-sync` advanced the harness from v1.7.4 to v1.7.7. Non-interactive sync failed without approval, so the two conflicted files were manually compared against upstream: `docs/context/orchestration.md` kept this project's Codex role contract while accepting the new Phase 3 consensus requirement, and `docs/orchestration/providers.md` kept the Windows/Codex provider contract while acknowledging configurable role assignment. GitHub CI was corrected to use `npm run build:web` and project-owned `typecheck`/`test` scripts.
- 2026-05-07T00:31:30.893+09:00 GitHub CI follow-up fixed the Ubuntu `build:web` failure caused by missing `node-pty/prebuilds/linux-x64`: non-Windows PTY runtime preparation now writes an unavailable manifest when the package lacks the prebuild, while Windows/release strictness still fails on missing PTY prebuilds.
- 2026-05-07T03:43:58.638+09:00 mascot motion rework was corrected from key-pose/proxy animation to true sequential source sheets: `$imagegen` produced idle/working/Vision/offline frame sheets, `scripts/build-mascot-assets.py` extracts 30 ordered character components per status, normalizes them to a shared bottom-center anchor, removes chroma/aura fringe, and emits 30fps WebP sprite grids plus a JSON manifest. `MascotSprite` now plays one discrete frame at a time with no transform wobble, crossfade layers, randomized pattern jumps, or normal-state drop-shadow.
- 2026-05-07T06:37:23.227+09:00 mascot jitter stabilization follow-up completed after dogfood feedback: the asset builder now computes a warm-fur lower-body anchor plus alpha-area metric per frame, then normalizes each frame to a shared body anchor and near-constant apparent size. This specifically addresses residual "rattling" from per-frame component center/scale drift while keeping the single-layer no-aura playback path.
- 2026-05-07T09:15:52.785+09:00 temporary dogfood FPS tuning control added: the system strip exposes a compact persisted `6-30fps` mascot playback slider so product-owner testing can compare slower frame rates without regenerating sprite assets. `MascotSprite` reads the FPS through a ref so slider changes do not restart the current frame loop.
- 2026-05-07T09:47:23.116+09:00 the temporary mascot FPS dogfood slider now supports `1-30fps`; missing storage falls back to 30fps, while explicitly saved low values under 6fps are preserved for comparison.
- 2026-05-07T20:34:31.614+09:00 app-server approval handling was hardened for dogfood browser-open failures: PowerShell `Start-Process` URL requests now map to external URL approvals and canonical PowerShell execution permissions, with smoke coverage for Google browser open and saved PowerShell allow reuse.
- 2026-05-07T20:41:36.402+09:00 follow-up fixed the real CLI command shape: quoted absolute `pwsh.exe` paths are now recognized as PowerShell, existing exact-command saved allows are honored as legacy fallback, and smoke covers the quoted full-path Google open command.
- 2026-05-07T21:25:07.309+09:00 follow-up corrected the actual app-server approval response protocol from `decision: "approve"` to `decision: "accept"`, which was why browser-open permissions were recorded as allowed in the widget but still surfaced as rejected in the assistant answer. Orphaned probe app-server processes were cleaned up and the daemon was restarted on `127.0.0.1:4128`.
- 2026-05-07T22:20:17.844+09:00 Iteration `iter-8` completed the Vision Context Interface MVP from `docs/plans/vision-context-interface-handoff.md`: daemon-side TaskCapsule/capture/resolver/retention modules, transcription MVP boundary, screen/browser/terminal observation adapters, shared `visionContext.*` protocol, renderer Share-with-Agent integration, app-server `localImage` override support, and smoke coverage for capsule generation, raw media deletion, resolver cases, lexicon correction, destructive clarification, and fake app-server localImage delivery.
- 2026-05-07T22:33:11.196+09:00 `/vibe-review` wrote `docs/reports/review-0-2026-05-07.md`. Findings focus on harness review reliability: escaped-pipe parsing in the gap ledger, Findings heading/parser contract drift, context-audit observability before any prompt reduction, semantic acceptance evidence for agent-context features, and a project-decisions JSONL warning cleanup.
- 2026-05-07T23:15:09.588+09:00 downstream dogfood verification synced the harness to vibe-doctor `v1.7.8` and wrote `docs/reports/review-0-2026-05-07-v1.7.8-dogfood.md`. The previous parser/input regressions are verified fixed; remaining notes are report-only context-audit observability and Vision Context semantic dogfood evidence.
- 2026-05-07T23:25:13.064+09:00 first Vision Context semantic dogfood evidence collected in `docs/reports/vision-context-dogfood-evidence-2026-05-07.md`: the real v1.7.8 residual review section was converted through daemon `visionContext.*`, raw media was deleted, one screenshot was passed as `localImage`, and the app-server task decision correctly held semantic acceptance instead of marking it complete. This is evidence-collected, not final semantic acceptance.
- 2026-05-08T00:13:57.067+09:00 planned the Browser Action Interface in `docs/plans/browser-action-interface-handoff.md`. The plan scopes a daemon-side browser actuator module for observe-plan-act-verify loops, typed browser actions, target resolution, safety policy, extension/native/CDP/Playwright adapters, renderer approval, audit logging, and future computer-use integration.
- 2026-05-08T01:20:00.000+09:00 Iteration `iter-9` implemented the Browser Action Interface MVP: `src/daemon/browser-action` core module, structured extension observations, typed extension action execution, shared `browserAction.*` protocol, daemon extension poll/result endpoints, renderer progress/result logging, existing approval UI reuse, app-server widget-context visibility, and smoke coverage for resolver/safety/approval/extension-result/audit paths.
- 2026-05-08T02:25:00.000+09:00 Iteration `iter-10` upgraded Browser Action from iter-9 MVP to production adapter/evaluate scope: adapter registry/status diagnostics, direct adapter execution, stale reobserve/retry, Playwright controlled-browser adapter, CDP remote-debugging adapter, Windows native desktop diagnostics boundary, explicit full_control_dev evaluate approval/credential safeguards, and real semantic dogfood evidence at `docs/reports/browser-action-dogfood-evidence-2026-05-08.md`.
- 2026-05-08T02:25:00.000+09:00 Browser Action production verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, Browser Action core/Playwright/CDP/evaluate/native smokes, extension/native-host/DOM/app-server smokes, `npm run dogfood:browser-action`, `cargo check --manifest-path src-tauri/Cargo.toml`, UTF-8/mojibake checks, `git diff --check`, and `npm run vibe:checkpoint`.
- 2026-05-08T02:42:00.000+09:00 Added `docs/plans/browser-action-end-to-end-control-handoff.md` as the next Browser Action handoff. It scopes prompt-driven Agent tool integration, renderer UX, extension stability, managed browser/CDP operation, multi-step plans, browser-specific permission policy, Windows UI Automation fallback, and real dogfood matrix.
- 2026-05-08T02:54:17.473+09:00 `/vibe-sync` advanced the harness to vibe-doctor `v1.7.9` and dogfooded the new manual `diff-reviewer` sidecar. Vanilla v1.7.9 failed Codex provider execution on Windows (`spawnSync codex ENOENT`), then downstream dogfood accepted hardening for Codex shim resolution, sealed-packet hash/coverage/status validation, `--cwd` path handling, artifact-root bounds, and secret-safe diff collection. Latest sidecar artifact `dogfood-sidecar-v179-codex-final6` is `advisory` with only a stale-reference note that was corrected after the run; report: `docs/reports/review-0-2026-05-08-v1.7.9-sidecar-dogfood.md`.
- 2026-05-08T03:34:01.932+09:00 `/vibe-sync` advanced the harness from `v1.7.9` to `v1.7.11`. Forced conflict sync was used for the known sidecar/Codex-doc files, then this downstream's Codex Orchestrator/provider contract was re-applied. Verification passed `npm run vibe:typecheck`, bootstrap preflight, `npm run vibe:gen-schemas -- --check`, and focused schema/sidecar tests.
- 2026-05-08T03:44:19.794+09:00 `/vibe-sync` advanced the harness from `v1.7.11` to `v1.7.12`. Dry-run found the two known downstream Codex orchestration doc conflicts, so forced sync was followed by re-applying the local Codex Orchestrator/provider contract. Verification passed `npm run vibe:typecheck`, bootstrap preflight, and `npm run vibe:gen-schemas -- --check`.
- 2026-05-08T04:10:24.000+09:00 Iteration `iter-11` completed the Browser Action end-to-end control layer from `docs/plans/browser-action-end-to-end-control-handoff.md`: widget browser prompts now enter a deterministic daemon Browser Action tool simulation, multi-step plans execute with safety/policy/approval/extension pauses, browser-specific policies are persisted, the renderer exposes a Browser Action panel, extension commands carry expected source/expiry metadata, and E2E dogfood evidence is recorded in `docs/reports/browser-action-e2e-dogfood-evidence-2026-05-08.md`.
- 2026-05-08T04:10:24.000+09:00 Browser Action E2E verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, all Browser Action core/Playwright/CDP/evaluate/native/E2E/renderer smokes, extension/native-host/DOM/app-server smokes, `npm run dogfood:browser-action`, `npm run dogfood:browser-action:e2e`, `cargo check --manifest-path src-tauri/Cargo.toml`, strict UTF-8/mojibake checks, `git diff --check`, and `npm run vibe:checkpoint`.
- 2026-05-08T09:09:48.942+09:00 Iteration `iter-12` completed the Browser Action control surface from `docs/plans/browser-action-control-surface-handoff.md`: a Vision-like Browser Action popup is anchored to the Browser mode button, direct UI commands use shared `browserAction.command`, daemon command handling converts direct requests into `BrowserActionPlan` execution through safety/approval/adapter/verify/audit paths, and prompt classification keeps informational Browser Action questions in normal Agent context.
- 2026-05-08T09:09:48.942+09:00 Browser Action control-surface verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, Browser Action core/Playwright/CDP/evaluate/native/E2E/renderer/direct-menu/prompt-classification smokes, extension/native-host/DOM/app-server smokes, `npm run dogfood:browser-action`, `npm run dogfood:browser-action:e2e`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `cargo check --no-default-features` through the MSVC environment.
- 2026-05-08T10:27:23.258+09:00 Iteration `iter-13` completed the Browser Extension Bridge UX refactor from `docs/plans/browser-extension-bridge-handoff.md`: the extension icon now opens a Browser Bridge popup/settings surface instead of sending a snapshot, badge states show OFF/IDLE/RUN/ASK/ERR, daemon base URL and bridge settings are configurable, heartbeat/status reaches daemon and widget, approved-site auto-observe plus command polling removes the manual snapshot step, and missing-permission/restricted-page recovery states are explicit.
- 2026-05-08T10:27:23.258+09:00 Browser Extension Bridge verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:all`, Browser Action core/Playwright/CDP/evaluate/native/E2E/renderer/direct-menu/prompt-classification smokes, extension/browser-bridge/native-host/DOM/app-server smokes, browser store readiness, `npm run dogfood:browser-bridge`, `npm run dogfood:browser-action:e2e`, and MSVC `cargo check --no-default-features`.
- 2026-05-08T12:50:38.055+09:00 Browser Bridge service-worker refactor completed without behavior changes: page-injected DOM snapshot/action functions moved to `providers/browser-dom-extension/bridge/injected-dom.js`, `service-worker.js` dropped from 1428 to 737 lines, and extension smoke now validates bridge modules plus package inclusion. Reload the unpacked extension to pick up the module split.
- 2026-05-08T17:57:17.977+09:00 Added `docs/plans/semantic-interface-handoff.md` as the authoritative handoff for a reusable Semantic Interface: a deterministic observation-to-hypothesis decision boundary with evidence, intent frames, ranker/safety predicate contracts, trace/replay, Browser Action shadow migration, and Vision read/locate conformance.
- 2026-05-08T23:05:00.000+09:00 Iteration `iter-15` completed the Semantic Interface from `docs/plans/semantic-interface-handoff.md`: `src/daemon/semantic-interface/` now owns v1 semantic types, ontology/versioning, intent frames, deterministic hypotheses/ranking, transition grammar, operating profiles, pure safety predicates, trace/replay, redacted trace projection, generic alias lexicon, Browser Action and Vision adapters, typed/untyped/adversarial golden trace harness, Browser Action low-risk live gate metadata, and `docs/reports/semantic-interface-dogfood-evidence-2026-05-08.md`.
- 2026-05-09T02:55:00.000+09:00 Iteration `iter-16` completed Semantic Interface refinement plus Semantic Memory: typed evidence packets and ranker traces, Browser View Graph identity/node/edge mapping, local redacted Semantic Memory storage/read sets, live Browser Action memory integration, renderer Settings controls, `npm run smoke:semantic-memory`, and `docs/reports/semantic-memory-dogfood-evidence-2026-05-09.md`.
- Current dev widget run is live after clearing port `5173`: Vite is listening on `127.0.0.1:5173`, daemon/app-server on `127.0.0.1:4128`, and startup logs are under `dist/logs/widget-dev-20260506-071947.*.log`.
- Browser store submission runbook is source-controlled at `docs/release/browser-store-submission.md`; deferral is recorded in `docs/release/deferred-gates.json`. Use the runbook after dogfooding to clear the deferred public-release gate and then rerun strict readiness.

## Branch And Harness

- Branch: `main`
- Harness: vibe-doctor `v1.7.12`
- Upstream ref: `^v1.7.12`
- Orchestrator: `codex`
- Sprint roles: planner `codex`, generator `codex`, evaluator `codex`
- Sprint mode: `extended` enabled in `.claude/settings.local.json`

## Active Iteration

- Current iteration: `iter-20` (`Browser Interaction Transaction`) complete; Browser Action prompt/direct/clarification paths now use request-scoped transactions, fresh Browser Perception leases, finite View Graph candidates, deterministic gates, late grounding, expected-effect verification, and advisory Semantic Memory feedback.
- Next queued Browser Action follow-up: reload the unpacked Browser Bridge extension and dogfood live sites against the transaction path, especially ambiguous Korean action prompts, multi-step content-list actions, tab-switch behavior, and ranked-choice clarification presentation.
- Remaining precise blockers/future consumers: first-class Codex app-server custom Browser Action tools require a stable custom-tool/client-tool contract; executable Windows browser chrome/restricted-page fallback requires a scoped UI Automation/native input helper; Terminal/Workspace/Screen/OCR/UIA Semantic Interface adapters are future consumers beyond iter-16. Dedicated ranked-choice clarification card UX can still be refined on top of the transaction candidate/clarification model.
- Planned sprints:
  - `iter-13-sprint-01-extension-popup-options-and-settings` (complete)
  - `iter-13-sprint-02-badge-heartbeat-and-daemon-status` (complete)
  - `iter-13-sprint-03-command-first-extension-channel-and-permission-flow` (complete)
  - `iter-13-sprint-04-widget-simplification-smokes-and-dogfood` (complete)
- Iteration 3 status: complete as a foundation iteration only. It does not satisfy the product-wide `/goal`; it delivered SQLite storage, durable session tabs/trash, artifact/activity ledger, and Vision recording/streaming foundations.
- Architecture boundary: daemon owns sessions, messages, app-server runtime metadata, provider snapshots, artifacts, activity logs, and durable preferences. Renderer remains UI/interaction focused.
- Storage boundary: SQLite stores metadata and structured state; large screenshots, recordings, generated files, and before/after snapshots live in an app-data blob store referenced by hash/path metadata. OAuth/Codex credentials must not be stored in SQLite.
- Completed storage foundation: `src/daemon/storage/*` provides SQLite path resolution, schema migrations, WAL/foreign-key setup, health checks, app settings with a no-secret guard, activity logging, and seeded built-in mascot/theme metadata. `runtime.status` includes lightweight storage diagnostics, and `GET /storage/health` runs explicit integrity checks.
- Completed session tabs/trash slice: the daemon emits `session.snapshot`, persists sessions/messages in SQLite, supports session create/open/trash/restore/branch commands, and the renderer now shows internal session tabs plus a restorable trash popover. Branch creates a new durable session seeded with the selected pair. New chat creates a new session rather than overwriting the prior conversation. Per-session model/reasoning/mode values restore when switching sessions.
- Completed artifact/activity ledger slice: the daemon records tool output and app-server file-change events into SQLite artifact/activity metadata, stores generated output and before/after/diff snapshots in the file-backed blob store, exposes `ledger.snapshot`, `ledger.refresh`, and `artifact.open`, and the renderer reuses the artifact accordion from both the active chat timeline and session trash popover. Activity now has a one-line footer summary plus a detail popover backed by daemon records.
- Completed Vision streaming/UX slice: Vision mode has a popup menu for snapshot capture, WebM recording, and Agent screen streaming. Recording uses browser display capture/MediaRecorder and stores completion metadata in daemon `vision_streams` plus the WebM in the blob store. Agent stream keeps a non-recording display-capture session, stores metadata only, and sends low-frequency JPEG frames to `/providers/screen/snapshot` so Agent turns can consume live screen context without creating a video artifact. Recording/streaming guardrails include size limits, two-minute auto-stop, 1 fps stream cadence, and retention metadata. The mascot reflects offline/working/recording/streaming states.
- Completed Sprint 01 focus: visible dogfooding UI polish, resize hit areas, Reason select overlap at minimum width, user bubble radius, More action top-right alignment audit, branch-to-session toast, Chrome-like internal tab behavior, per-session model/reason change affordance, and taste-skill review.
- Completed Sprint 02 focus: daemon-owned widget capability/context snapshot and safe Agent prompt-context injection so Agent mode can answer questions about widget UI controls, modes, PTY/Vision/DOM capabilities, settings, and limitations without exposing credentials or unrelated repo history.
- Completed Sprint 03 focus: richer artifact rendering and version browser in chat and trash, including file type icons, bounded text/image previews, current-version metadata, version accordions, versioned open flows, and Python-generated output handling through the existing blob-backed artifact path.
- Completed Sprint 04 focus: Vision/voice interactive-loop foundations: clearer screen recording vs Agent screen-share choices, stream cadence/resource controls, stronger consent/stop affordances, metadata-only Agent sharing, and a scoped voice prompt input boundary.
- Completed Sprint 05 focus: PTY popup and mascot persona: PTY use cases/history are visible in the terminal surface, a terminal-focused popout entry point exists, direct terminal behavior is preserved, and Default Dog mascot persona/tone hooks are included in Agent widget context.
- Completed Iteration 5 Sprint 01 focus: persisted runtime thread rows, per-session app-server bridge rebinding before turns/regeneration, stale-thread retry/clear behavior, and smoke coverage for separate internal session threads.
- Completed Iteration 5 Sprint 02 focus: provider snapshots are persisted as redacted ledger rows and rendered from the Activity detail popover across DOM, Vision, and Terminal providers.
- Completed Iteration 5 Sprint 03 focus: Vision stream resource cleanup, frame-overlap throttling, skipped-frame diagnostics, duplicate-stop prevention, and effective guardrail metadata are implemented.
- Completed Iteration 5 Sprint 04 focus: final completion audit and readiness update. Remaining follow-up is dogfood-dependent long-run screen-share CPU/memory tuning, live app-server protocol validation across CLI/app-server restarts, and deferred browser store account submission after dogfooding.
- Completed Iteration 6 Sprint 01 focus: renderer frontend structure refactor. `App.tsx` now owns orchestration and side effects while UI surfaces live under `src/renderer/components`, shared behavior under `hooks` and `utils`, renderer constants/types in `config.ts`/`types.ts`, and CSS partials under `src/renderer/styles`.
- Completed Iteration 7 Sprint 01 focus: trash artifact row alignment and compact Activity footer height are accepted. The frame-based mascot sprite animation using `src/renderer/assets/mascot-motion-sprite.png` was rejected as a proxy implementation; the replacement now uses status-specific sequential source sheets, component-extracted 30fps WebP sprite grids, single-layer playback, fixed lower-body anchoring, alpha-area scale stabilization, and no drop-shadow/crossfade/transform-wobble aura, with dogfood acceptance still pending.
- Completed Iteration 8 focus: the Vision Context Interface now sits behind Agent screen sharing. The daemon can start/event/stop/cancel Vision Context sessions, collect timeline/provider observations, build TaskCapsules, render capsule markdown, convert to app-server `UserInput[]` with selected `localImage` evidence, delete raw video/audio temp files after processing, and send the result into the current Codex app-server thread. The transcription MVP includes mock ASR, sidecar boundary, lexicon correction, action-slot confidence, and clarification policy.
- Vision Context semantic acceptance state: first dogfood evidence exists at `docs/reports/vision-context-dogfood-evidence-2026-05-07.md`; do not mark semantic acceptance complete until stronger live UI/live-model before-after evidence is collected or the product owner explicitly accepts this deterministic protocol artifact as sufficient.
- Completed Iteration 9 focus: Browser Action now owns a typed, auditable browser actuator interface. The daemon can start/observe/execute/cancel Browser Action sessions, normalize active-tab DOM snapshots into structured observations with stable element ids, resolve exact/role-text/focused/bbox/ambiguous/low-confidence targets, enforce allow/confirm/block/clarify safety policy, queue typed commands for the extension, accept extension before/after results, verify outcomes, and record Activity audit rows without persisting sensitive page state.
- Browser Action deferred state: CDP, Playwright, and `full_control_dev` evaluate are implemented for the production interface scope. The remaining future boundary is executable Windows UI Automation/browser-chrome control through a scoped helper.
- Completed Iteration 16 focus: Semantic Interface evidence packets and Semantic Memory. Browser observations now carry View Graph identity/node/edge data into Semantic Interface; ranker traces include candidate-generation provenance, pairwise margins, and target fingerprints; Semantic Memory persists only redacted local graph edges/unresolved cases/feedback events, exposes daemon report/read/reset/settings endpoints, contributes immutable read sets to ranking, records Browser Action unresolved target cases, and surfaces Settings enable/report/clear controls.

## Recent Work

- Migrated from Electron to Tauri.
- Verified Windows MSVC/Rust/WebView2 prerequisites.
- Added generated mascot icon resources for Tauri.
- Installed vibe-doctor v1.7.2 project context, provider memory, and harness files so future work can run through sprints.
- Configured Codex provider for Windows via `.\.vibe\harness\scripts\run-codex.cmd`.
- Ran `/vibe-sync` against upstream `v1.7.2`; used `--force` because the non-interactive sync path found harness files without sync history. Backup: `.vibe/sync-backup/2026-05-04T04-37-12-648Z`.
- Sync established ignored `.vibe/sync-hashes.json`, updated `.vibe/config.json` to `^v1.7.2`, appended harness ignore defaults, and added VS Code/CI harness files.
- Updated the project orchestration contract so Codex is the main Orchestrator and all sprint roles default to `codex`.
- Ran `/vibe-sync` to upstream `v1.7.4` after reviewing conflicts in `docs/context/orchestration.md` and `docs/orchestration/providers.md`. Backup: `.vibe/sync-backup/2026-05-04T15-54-12-729Z`.
- Re-applied this downstream project's Codex Orchestrator/Planner/Generator/Evaluator and Windows `run-codex.cmd` provider contract after sync while keeping the new v1.7.4 visual/experience evidence requirements for frontend/game/dashboard Sprint QA.
- Enabled `/vibe-sprint-mode` extended tier for phase-level delegation permissions.
- Replaced the widget's direct OpenAI API key path with daemon-owned OAuth PKCE login and Bearer-token agent proxy streaming.
- Removed the `openai` npm dependency from this client and updated README/context docs to describe the OAuth proxy contract.
- Added development hot services: `npm run dev` now starts `scripts/dev-hot.mjs`, which runs Vite HMR, daemon TypeScript watch, and daemon restart-on-build-change. Tauri dev skips its own daemon spawn unless `CODEX_WIDGET_DEV_SPAWN_DAEMON=1`.
- Added gitignored `.env` support for local OAuth token mode: `CODEX_WIDGET_AUTH_MODE=token`, `CODEX_WIDGET_OAUTH_ACCESS_TOKEN`, and `CODEX_WIDGET_AGENT_PROXY_URL`.
- Changed token-mode Sign in UX so the widget opens an inline token form, saves the OAuth access token/proxy URL into gitignored `.env`, and updates the running daemon without requiring users to edit env files manually.
- Switched the default local auth config back to PKCE/social-login mode and changed OAuth authorize links to open through the OS default browser via a Tauri command instead of WebView popup behavior.
- Added `scripts/dev-auth-proxy.mjs`, a local development OAuth/proxy server on `127.0.0.1:8787`, and wired `npm run dev`/`scripts/dev-hot.mjs` to start it automatically so Sign in can complete locally without manual token entry.
- Corrected the default Sign in flow to use Codex CLI OpenAI/ChatGPT authentication instead of the mock OAuth proxy: `CODEX_WIDGET_AUTH_MODE=codex`, Sign in runs `codex login` when needed, and authenticated prompts run through `codex exec --json`.
- Changed the dev auth proxy to opt-in only via `CODEX_WIDGET_DEV_AUTH_PROXY=1` or `npm run dev:auth-proxy`; it is no longer part of the default widget auth workflow.
- Codex-mode Sign out only disconnects the widget session; it does not run global `codex logout` or remove the user's Codex CLI credentials.
- Applied `taste-skill` frontend cleanup: the renderer now uses a Windows-style single panel with titlebar, system strip, mode tabs, structured conversation messages, token form labels, activity log, composer, and a smaller companion mascot zone.
- Fixed the renderer/Tauri UI mismatch after native testing: window size is now widget-scale (`360x480` config, observed about `374x488` including shadow), taskbar/shadow are enabled, titlebar has Pin/Minimize/Maximize/Close controls, and drag regions are restricted to the titlebar grip/identity so Sign in and the prompt input receive clicks.
- Removed local response evaluation/feedback controls from assistant messages. Response actions now expose copy, regenerate, and a top-right More menu with local branch and browser speech read-aloud actions; streaming markdown links and raw URLs are revealed as whole tokens to avoid visible markdown reflow.
- Switched the default Codex-mode runtime from per-request `codex exec` to a daemon-supervised background `codex app-server` JSON-RPC bridge. The daemon now starts the app-server child process, keeps one `threadId` alive, sends prompts as `turn/start`, maps `item/agentMessage/delta` to widget stream events, interrupts turns on cancel, and terminates the child process on shutdown/sign-out. `CODEX_WIDGET_CODEX_RUNTIME=exec` remains the explicit fallback.
- Pushed checkpoint commit `d066dd5` to `origin/main` with message `CHECKPOINT BEFORE BIG PATCH`.
- Started `/vibe-iterate` Iteration `iter-2` (`Resident Runtime Expansion`) and added milestone/report state for runtime protocol, provider shell, and resident desktop ops.
- Added first-class renderer-daemon runtime interactions: app-server approval/user-input server requests now emit `interaction.required`, render compact approval/input cards in the widget, and return `interaction.respond` to the daemon instead of being silently declined.
- Added `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request` as the default app-server approval policy, with `never` still available for trusted automation experiments.
- Added app-server runtime diagnostics: `runtime.status` now includes start count, last started/exited timestamps, and latest error; the Settings panel surfaces start count and latest error.
- Added visible chat timeline persistence across renderer reloads plus a titlebar New chat control that clears local chat state and resets daemon proxy/app-server session state.
- Added daemon-owned provider status events for Agent, DOM, Vision, and PTY modes so the mode tabs now have a reusable capability/status contract before real providers are implemented.
- Added resident desktop operations: runtime health events, Settings panel, Windows start-at-login toggle, skip-taskbar native config, hide-to-tray close behavior, and a strengthened smoke gate for provider/runtime events.
- Added `npm run smoke:resident` for idle daemon health and RSS budget checks.
- Fixed production bundling by adding `icons/icon.ico` to the Tauri bundle icon list; `npm run build` now produces release exe, MSI, and NSIS installer artifacts.
- Added `npm run smoke:all` and `npm run smoke:all:live` as serial readiness gates so provider smokes do not race by rebuilding `dist` in parallel.
- Added `npm run smoke:app-server` and included it in `smoke:all`; the smoke uses a fake Codex app-server to verify resident thread context, streaming deltas, approval forwarding, and rollback behavior without a live Codex account.
- Added real provider shell functionality for Iteration 2:
  - DOM mode accepts browser/page snapshots at `POST /providers/dom/snapshot`, updates provider readiness, emits DOM snapshot tool output, and injects the latest DOM context into model requests.
  - `providers/browser-dom-extension` adds an unpacked Chrome/Edge Manifest V3 extension that captures the active tab and posts a DOM snapshot to the daemon.
  - The browser DOM extension now has committed icon assets, manifest icon/action metadata, and `npm run package:extension` to generate `dist/providers/codex-widget-dom-extension-0.1.0.zip`.
  - Vision mode accepts screen snapshots at `POST /providers/screen/snapshot`, updates provider readiness, emits screen snapshot tool output, and injects screen description/OCR context into model requests.
  - `providers/screen-capture-helper/capture-screen.ps1` captures the Windows virtual desktop, compresses it to JPEG data URL, and posts it to the Vision snapshot endpoint.
  - The Vision-mode Capture action sends `provider.captureScreen` to the daemon, which runs the screen capture helper and refreshes provider status without requiring the user to run PowerShell manually.
  - Screen/Vision image data is now attached to Codex app-server Vision turns as image input instead of remaining daemon-only metadata.
  - The Windows screen capture helper now supports optional OCR text through auto-detected `tesseract` or a `CODEX_WIDGET_SCREEN_OCR_COMMAND`/`-OcrCommand` template that receives `{image}`.
  - Added bundled OCR runtime packaging: `npm run build:ocr-runtime` prepares `dist/ocr-runtime/ocr-runtime.json`, can fetch requested tessdata language packs, can copy a Tesseract runtime from `CODEX_WIDGET_OCR_RUNTIME_DIR`, `CODEX_WIDGET_TESSERACT_EXE`, PATH, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, or standard Windows install locations, records bundled tessdata languages, and installed helpers resolve `_up_/dist/ocr-runtime` before PATH OCR.
  - Added OCR language selection defaults: auto-generated bundled Tesseract commands choose `eng+kor` when both bundled language packs exist, fall back to available `eng`/`kor`, and allow `CODEX_WIDGET_SCREEN_OCR_LANGUAGE`/`-OcrLanguage` overrides.
  - Added OCR-only image preprocessing: helper OCR now receives an upscaled PNG temp image by default while the snapshot payload remains compressed JPEG; `CODEX_WIDGET_SCREEN_OCR_DISABLE_PREPROCESS=1` restores the older JPEG OCR input path.
  - Added Settings/env configured Vision crop parameters plus daemon-computed screen image hash/change/diff metadata with configurable thresholding so repeated captures can be distinguished from changed and below-threshold context.
  - Terminal/PTY mode executes explicit local commands (`/run`, `$`, `PS>`, `run:`, or fenced shell blocks), streams stdout/stderr as tool output, blocks dangerous command patterns by default, and returns a markdown terminal result.
- Added a persistent command-session layer for Terminal/PTY mode:
  - `/pty start` starts a daemon-owned child shell in the configured Codex widget terminal workdir.
  - `/pty <command>` streams output and returns a markdown terminal-session result while preserving shell state between commands.
  - `/pty status` and `/pty stop` expose the session lifecycle.
  - Direct `terminal.input` protocol messages now send live PTY text/key input and SGR mouse click/drag/wheel sequences without creating chat turns; idle PTY output is broadcast back as `terminal.output`.
- Hardened the renderer chat layout:
  - Conversation messages now use explicit grid flow so user bubbles, assistant markdown, active streaming state, and skeletons stay in separate rows.
  - GFM tables use fixed full-width layout on wide viewports and contained horizontal scrolling on narrow widget widths.
  - Prompt resize clamps against the actual panel height so the composer cannot cover the conversation region.
  - More action menus are aligned above the button with right edges matched.
- Added app-server-backed regenerate boundaries:
  - The renderer computes how many assistant turns are removed when regenerating a selected answer.
  - The daemon receives `regenerate.dropTurns` and calls Codex app-server `thread/rollback` before starting the replacement turn.
  - This preserves app-server context before the selected answer without sending the visible chat history as a prompt.
- Added `docs/providers/dom-snapshot-bookmarklet.js`, `docs/providers/screen-snapshot-example.json`, `npm run smoke:dom`, `npm run smoke:extension`, `npm run smoke:screen`, `npm run smoke:screen-capture:live`, `npm run smoke:screen-helper`, `npm run smoke:screen-helper:live`, and `npm run smoke:terminal`.
- Added `npm run smoke:renderer-chat` for browser-level validation of multi-turn chat overlap, table width, prompt resize, and response action menu placement.
- Added `npm run smoke:resident-soak` for a short resident daemon soak covering runtime samples, ping/pong health, idle active request count, app-server closed state in mock mode, RSS ceiling, and RSS growth.
- Replaced the packaged Tauri daemon child holder with a native daemon supervisor that restarts the Node daemon after unexpected exits with capped exponential backoff, keeps dev-mode duplicate spawn disabled by default, and kills the daemon child on widget shutdown.
- Added `npm run smoke:tauri-supervisor` to validate supervisor backoff and actual child restart behavior through Rust tests.
- Exposed native daemon supervisor diagnostics to the renderer via `get_native_daemon_status`; the widget status strip and Settings runtime grid can now show native daemon starting/running/restarting/error state even while the WebSocket is reconnecting.
- Added packaged daemon runtime resources: `npm run build:web` now creates `dist/daemon-bundle/standalone.js`, prepares `dist/node-runtime/node.exe`, and Tauri bundles both directories so installed Windows builds do not depend on a user-installed `node` command for the widget daemon.
- Added `npm run smoke:node-runtime` and included it in `npm run smoke:all` to verify the bundled Node runtime can run the dependency-bundled daemon without repository `node_modules`.
- Added `npm run smoke:release-resources` to verify generated MSI/NSIS build scripts include the bundled daemon, Node runtime, screen helper, and DOM extension resources.
- Added `npm run smoke:release-launch` to launch the release exe hidden, verify the packaged daemon WebSocket on `127.0.0.1:4128`, and clean up the process tree.
- Added a browser DOM extension Options page backed by `chrome.storage.sync`, so users can point the extension at another local daemon port without editing extension code. The extension only accepts local `http://127.0.0.1/...` or `http://localhost/...` snapshot URLs ending in `/providers/dom/snapshot`.
- Added `npm run smoke:release-install` for NSIS silent install/uninstall observation: it refuses to overwrite existing install state, launches the installed app hidden, verifies the daemon WebSocket, uninstalls, and checks install directory, uninstall registry entry, product install key, and desktop shortcut cleanup.
- Added `npm run release:verify` as the one-command live release gate. It runs `smoke:all:live`, `build`, release resource smoke, release exe launch smoke, NSIS install smoke, MSI install smoke, and prints release artifact sizes.
- Added `npm run release:readiness` as a release-candidate audit. It validates current release artifacts, browser store metadata/package/submission packet readiness, latest release soak evidence, and reports manual blockers for browser store submission and the default two-hour soak.
- Fixed installed-build daemon resource resolution. The native shell now checks the installed exe-adjacent `_up_` resource directory for `dist/daemon-bundle/standalone.js` and `dist/node-runtime/node.exe` before falling back to development paths or system `node`.
- Strengthened `npm run smoke:release-install` to find the installed bundled daemon process, kill it, and verify the native supervisor restarts it with a new PID before uninstall cleanup.
- Added a daemon parent watchdog through `CODEX_WIDGET_NATIVE_PARENT_PID`, so the installed daemon exits when the native app process disappears unexpectedly instead of surviving as an orphan.
- Added `providers/browser-native-host`, an optional Chrome/Edge native messaging host that receives framed `domSnapshot` messages, validates local daemon URLs, and posts snapshots to the local daemon. The browser extension now tries native messaging first and falls back to direct local HTTP when the host is not registered.
- Added browser extension store-readiness metadata: `store-listing.md`, `privacy.md`, `review-notes.md`, `npm run release:browser-store-packet`, and `npm run smoke:browser-store` for permission rationale/privacy/package/submission packet validation.
- Added `npm run release:soak`, a longer hidden release-exe soak that checks runtime samples, ping/pong health, daemon process presence, process-tree working set, and cleanup after the soak.
- Release soak now writes a JSON evidence report under `dist/reports/release-soak-latest.json` by default, with `CODEX_WIDGET_RELEASE_SOAK_REPORT` available for named manual/multi-hour runs.
- Made response Branch runtime-safe: Branch now sends `session.branch` to reset daemon-side proxy/app-server session state, stores the selected user/assistant pair as a one-shot `branchContext`, sends that seed with the next prompt only, and clears it after use so visible branch state does not keep running against hidden old app-server context.
- Added daemon reconnect replay: active agent events are broadcast to connected clients, bounded assistant response snapshots are retained in the daemon, reconnecting renderers receive `message.snapshot`, and a WebSocket close no longer aborts every active request.
- Added native PTY runtime packaging and a node-pty/ConPTY backend for Terminal/PTY mode:
  - `node-pty@1.1.0` is now a runtime dependency.
  - `npm run build:pty-runtime` prepares `dist/pty-runtime` with native node-pty resources, and Tauri bundles it for installed builds.
  - `/pty` sessions prefer node-pty/ConPTY, keep the stdio shell fallback via `CODEX_WIDGET_TERMINAL_BACKEND=pipe`, and support `/pty resize`, `/pty write`, and `/pty key` raw-input commands in addition to command execution.
  - `npm run smoke:pty-runtime` and the existing terminal-session smoke cover packaged native PTY loading and the node-pty backend.
- Added a dedicated renderer PTY viewport for Terminal mode:
  - Terminal tool events now accumulate in a sticky, scrollable PTY surface instead of only appearing in the small Activity log.
  - PTY mode exposes icon-only quick actions for `/pty start`, `/pty status`, `/pty stop`, and local viewport clear.
  - PTY raw input/key requests now drain output for a short quiet window, and the Terminal viewport includes direct input controls for text, Enter, Tab, Escape, and Ctrl+C.
  - PTY direct input now uses `terminal.input` instead of `/pty write` ask turns, keeps text/key controls available during active PTY work, and exposes a mouse-input toggle that forwards SGR click, release, drag, and wheel sequences.
  - Renderer chat smoke now verifies the PTY tab, terminal quick action request, terminal output rendering, viewport containment, and prompt/conversation separation.
- Added `npm run smoke:release-msi-install` for MSI install/uninstall observation:
  - The smoke performs a silent MSI install into a per-user temp directory using `ALLUSERS=2 MSIINSTALLPERUSER=1`.
  - It verifies installed bundled daemon/Node/OCR/PTY resources, launches the installed app hidden, confirms the daemon WebSocket, silently uninstalls, and checks cleanup.
  - `npm run release:verify` now runs the MSI smoke after the existing NSIS install smoke.
- Added `npm run release:browser-store-packet`:
  - It generates `dist/browser-store-submission/codex-widget-dom-extension-<version>` with the extension zip, store listing, privacy disclosure, review notes, native host notes, icons, and SHA-256 checksums.
  - `npm run smoke:browser-store` and `npm run release:readiness` now verify the submission packet exists and can be regenerated.
  - `release:readiness` now treats the unconfirmed soak blocker as a default 120-minute evidence requirement unless `CODEX_WIDGET_RELEASE_MULTI_HOUR_SOAK_MS` or the explicit manual-acceptance env flag is used.
- Added `npm run release:confirm-browser-store`:
  - After actual Chrome Web Store or Edge Add-ons dashboard submission, it writes `dist/reports/browser-store-submission-confirmation.json` with store name, submitted timestamp, submission id or listing URL, package name, and package SHA-256.
  - `release:readiness --require-manual-gates` validates that confirmation report, so the final manual gate has concrete evidence instead of only an env flag.
- Added `docs/release/deferred-gates.json` and release-readiness deferred-gate reporting so default readiness can represent product-owner deferrals without conflating them with missing automated checks.

## Next Recommended Sprint

Post-dogfooding release-channel follow-up: submit the DOM extension packet to Chrome Web Store or Microsoft Edge Add-ons using `docs/release/browser-store-submission.md`, then record confirmation with `npm run release:confirm-browser-store`.

## Open Issues

- Codex app-server is still marked experimental by the Codex CLI, so the bridge should preserve the `codex exec resume` fallback until the protocol is stable enough for production packaging.
- App-server approval and tool-user-input requests now have renderer UI, but the exact Codex app-server protocol is still experimental and may require adapter changes as CLI releases evolve.
- External OAuth provider/backend agent proxy support remains optional for non-Codex auth modes; this repo primarily implements the desktop widget/daemon client boundary.
- OAuth refresh tokens are not persisted; users may need to sign in again when an access token expires.
- Browser DOM provider is snapshot-based and has an unpacked Chrome/Edge extension bridge, local-only Options URL configuration, optional native messaging host, generated zip package, store-readiness metadata, and generated submission packet; final browser store account submission is deferred until after dogfooding.
- Screen capture/vision provider is snapshot-based and has a daemon-triggered Windows capture helper, Settings/env/visual-drag configured crop, optional OCR command hook, bundled OCR runtime packaging, standard Windows Tesseract discovery, bundled tessdata language acquisition/defaults, OCR-only PNG preprocessing, image hash/change/diff metadata with configurable thresholding, and direct app-server image input.
- Terminal/PTY provider now has a node-pty/ConPTY command/raw-input backend, short raw-input output drain, direct `terminal.input` text/key/mouse input, idle PTY output broadcast, and a renderer PTY viewport with direct input controls.
- Browser store account submission is deferred until after dogfooding. The two-hour release soak passed on 2026-05-05 with evidence in `docs/reports/release-soak-2026-05-05-2h.md`.
- The live readiness completion audit is recorded in `docs/reports/live-readiness-audit-2026-05-06.md`; it maps the objective to concrete artifacts and records the browser store submission deferral decision.

## Verification

Completed after harness install:

- `npm run vibe:doctor`
- `node .vibe\harness\scripts\vibe-preflight.mjs --bootstrap`
- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`

Completed after latest `/vibe-sync`:

- `npm run vibe:sync -- --dry-run`
- `npm run vibe:sync -- --force`
- `npm run vibe:sync -- --dry-run`
- `npx tsc -p .vibe/harness/tsconfig.harness.json --noEmit`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap` after switching all role providers to `codex`
- `node .vibe/harness/scripts/vibe-sprint-mode.mjs status`

Completed after `/vibe-sync` to v1.7.4:

- `npm run vibe:sync -- --dry-run` resolved `^v1.7.2` to `v1.7.4` and found two conflicts: `docs/context/orchestration.md`, `docs/orchestration/providers.md`.
- `npm run vibe:sync -- --force`
- Re-applied Codex role/provider overrides to the two conflicted docs after sync; the expected follow-up dry-run still reports those two files as local project overrides.
- `npx tsc -p .vibe/harness/tsconfig.harness.json --noEmit`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- UTF-8/mojibake checks over touched sync/context files

Completed after OAuth proxy client conversion:

- `npm run lint`
- `npm run smoke`
- Local inline OAuth auth-start smoke with dummy provider config
- Local inline OAuth callback/token/proxy streaming smoke with a dummy HTTP provider
- UTF-8/mojibake checks over touched files

Completed after dev hot services change:

- `node --check scripts/dev-hot.mjs`
- `npm run lint`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`

Completed after OAuth token config mode:

- `npm run lint`
- `npm run smoke`
- Local inline static OAuth token proxy smoke
- WebSocket daemon status reports `missing CODEX_WIDGET_OAUTH_ACCESS_TOKEN` while `.env` token is blank
- UTF-8/mojibake checks over touched files

Completed after inline token-mode Sign in UX:

- `npm run lint`
- `npm run smoke`
- Local inline token save smoke: `auth.save-token` -> `.env` upsert -> Bearer proxy stream
- WebSocket daemon status reports `signInAvailable: true` while token is blank
- UTF-8/mojibake checks over touched files

Completed after PKCE/social-login Sign in path:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`
- WebSocket auth-start smoke returns a PKCE authorize URL using `http://127.0.0.1:4128/oauth/callback`
- Running daemon reports `signInMethod: "pkce"`, `configured: true`, and `authenticated: false` until the external OAuth backend completes login
- UTF-8/mojibake checks over touched files

Completed after local dev auth/proxy server:

- `node --check scripts/dev-auth-proxy.mjs`
- `node --check scripts/dev-hot.mjs`
- `npm run lint`
- `npm run smoke`
- `GET http://127.0.0.1:8787/health` returns `{"ok":true}`
- End-to-end PKCE smoke: `auth.start` -> dev auth proxy authorize redirect -> daemon `/oauth/callback` -> token exchange -> authenticated WebSocket status -> Bearer `/agent/stream` response

Completed after Codex CLI OpenAI/ChatGPT auth flow:

- `codex login status` reports `Logged in using ChatGPT`
- `npm run lint`
- `npm run smoke`
- Running daemon WebSocket auth status reports `mode: "codex"`, `authenticated: true`, `signInMethod: "codex"`
- Running daemon prompt smoke returns `widget-codex-live-ok` through `codex exec --json`
- UTF-8/mojibake checks over touched files

Completed after renderer UI redesign:

- `npm run lint`
- `npm run smoke`
- Playwright screenshot at `430x610` for idle widget state
- Playwright screenshot at `430x610` after composer submission/streaming state
- UTF-8/mojibake checks over touched renderer files

Completed after widget-scale/window-control fix:

- `npm run lint`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`
- Playwright `360x480` interaction smoke: auth button toggles `OpenAI -> Sign in -> OpenAI`, prompt input accepts typed text
- Native window rect check reports the running Tauri process at approximately `374x488` including window shadow/bounds
- UTF-8/mojibake checks over touched renderer/Tauri config files

Completed after Pin/Opacity/native window-control update:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Playwright `360x480` UI smoke: Pin label changes `Pinned -> Unpinned`; opacity slider updates the displayed value to `80%`
- Rolled maximize back to the native Tauri maximize/unmaximize command after confirming custom widget-size expansion is not needed
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after webview-edge/native-titlebar layout update:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: panel starts at `left=0, top=0`, titlebar height is `32px`, mascot is `88x88`, opacity slider updates to `85%`, and prompt input remains clickable
- Playwright maximized layout smoke with `.is-maximized` at `1366x768`: panel fills the viewport and mascot moves to the bottom-right with right padding on the prompt/activity area
- UTF-8/mojibake checks over touched renderer/context files

Completed after Activity/opacity/titlebar cleanup:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` UI smoke: opacity slider accepts `0`, panel background alpha reaches `0`, text/input remains visible, Pin button has no text content, Activity log content is separated into a non-overlapping two-line area, and panel bottom border reports `0px`
- Playwright responsive titlebar smoke: opacity controller is visible at `360px` next to `Codex Widget` and hidden at `320px`
- UTF-8/mojibake checks over touched renderer/context files

Completed after native Tauri border removal:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Runtime Win32 style check on the Tauri window reports `WS_CAPTION=false`, `WS_BORDER=false`, `WS_DLGFRAME=false`, and `WS_THICKFRAME=false`
- Native maximize/restore smoke keeps those frame bits disabled while moving between `360x480` and maximized bounds
- UTF-8/mojibake checks over touched Tauri/context files

Completed after radius/mascot/opacity-control refinement:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: widget panel has `12px` top radius, `0px` bottom radius, `0px` bottom border, mascot is `116x116`, and mascot does not overlap panel/prompt/activity
- Playwright maximized layout smoke: panel radius is `0px`, panel fills `1366x768`, mascot is `136x136` at bottom-right, and prompt/activity right padding clears the mascot
- Opacity controller is iconless and reduced to a `58px` titlebar range control
- UTF-8/mojibake checks over touched renderer/context files

Completed after prompt click/focus repair:

- `npm run lint`
- `npm run smoke`
- Browser Playwright focus smoke: prompt input is enabled after reconnect, pointer click focuses it, and typed text is accepted
- Native Tauri click smoke: after WebView reload, clicking the prompt area and sending keys writes `nativefocus` into the input
- Added WebSocket auto-reconnect so daemon restarts no longer leave the prompt disabled in `Offline`
- Added prompt-row pointer focus capture and raised prompt row z-index to keep input focus reliable in the transparent native window
- UTF-8/mojibake checks over touched renderer/context files

Completed after model/reasoning selector UI:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: Model and Reason selectors render between status and mode rows, no panel rows overlap, and selected values persist in localStorage.
- Playwright submit-packet smoke: selecting `gpt-5.3-codex-spark` and `xhigh` sends `{ model, reasoningEffort }` with the `ask` WebSocket message.
- Prompt focus smoke remains valid after the new controls: clicking the prompt row focuses the input and typed text is accepted.
- Codex daemon path now passes selected values to `codex exec --json -m <model> -c model_reasoning_effort="<level>"`; OAuth proxy requests include `model`, `reasoningEffort`, and `reasoning_effort`.
- UTF-8/mojibake checks over touched renderer/daemon/protocol/env-example files

Completed after panel-based resize handles:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added eight resize hit areas on the white `.widget-panel` only; the transparent mascot/agent area has no resize handle.
- Implemented Tauri manual resize fallback through `outerPosition`, `outerSize`, `scaleFactor`, `setPosition`, and `setSize` so resizing works even with the Windows native frame stripped.
- Native smoke confirmed right panel-edge drag changed the window from `360x480` to `450x480`, then restored it.
- Native smoke confirmed white panel bottom-edge drag changed the window from `360x480` to `360x550`, then restored it.
- Playwright DOM smoke confirmed close button hit testing still resolves to the close button, panel right/bottom edges resolve to resize handles, and mascot area resolves to the shell rather than a handle.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after diagonal resize responsiveness fix:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Replaced per-frame paired renderer `setPosition`/`setSize` calls with one custom Tauri `set_window_frame` command backed by Windows `SetWindowPos`.
- Coalesced renderer resize updates so drag movement keeps only the newest pointer coordinates while an IPC frame update is in flight; this avoids request backlog during diagonal drags.
- Native smoke confirmed panel bottom-right diagonal drag changed the window from `360x480` to `448x557`, then restored it.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after widget affordance/UI follow-up:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added mascot window dragging through a Tauri drag region plus `startDragging`; native smoke moved the window by `72x45` from the mascot and restored it.
- Slimmed the titlebar opacity range control to a `10px` input, `1px` track, and `7px` thumb aligned to the track center.
- Filled the active Pin icon interior with the same accent color used by the opacity slider.
- Changed the auth button copy to `Sign in` / `Sign out` instead of provider names.
- Moved the model/reasoning selector row directly above the `Ask Codex` prompt row.
- Suppressed the default right-side `codex` model label in the status strip.
- Raised the app minimum height to `480px` and added explicit min dimensions for the shell, panel, fixed rows, and key controls; Playwright `320x480` and `360x480` layout smokes reported no row overlap.
- Taste-skill review pass confirmed controls keep their click targets, model row is above the prompt, mascot hit testing resolves to the image drag target, and Pin fill uses the accent color.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after native diagonal resize loop fix:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added a Tauri `start_window_resize` command that temporarily enables the Windows resize frame only for the active resize loop, posts the matching native hit-test resize message, then restores the borderless style after mouse release.
- Updated renderer resize startup so panel handles try the native resize loop first and keep the coalesced manual `set_window_frame` path only as a fallback.
- Native smoke confirmed panel bottom-right diagonal drag changed the window from `360x480` to `456x564`, then restored it.
- Native style smoke confirmed `WS_CAPTION`, `WS_BORDER`, `WS_DLGFRAME`, and `WS_THICKFRAME` are all false after the drag.

Completed after prompt composer layout update:

- `npm run lint`
- `npm run smoke`
- Converted the prompt field from a single-line input to a vertically resizable textarea with Enter-to-submit and Shift+Enter newline behavior.
- Moved the model/reasoning selector row below the prompt composer.
- Added extra padding to the Ready empty-state panel under the mode selector.
- Playwright `360x480` layout smoke confirmed the prompt row is before the model row, the model row is before Activity, Ready padding is `12px`, and dragging the textarea resize handle grew the textarea from `38px` to `84px` while the conversation region shrank from `96px` to `50px`.

Completed after prompt area resize clarification:

- `npm run lint`
- `npm run smoke`
- Removed the browser-native textarea resize affordance and added a thin prompt-composer top drag handle instead.
- Composer drag now changes the prompt row height, and the textarea height follows the row height.
- Send/stop button is vertically centered within the prompt row.
- Playwright `360x480` layout smoke confirmed the prompt row grew from `46px` to `90px`, textarea grew from `38px` to `82px`, textarea CSS `resize` is `none`, and model/activity row order stays intact.

Completed after prompt composer max-height expansion:

- `npm run lint`
- `npm run smoke`
- Raised the prompt composer absolute max height from `96px` to `192px`.
- Added viewport-aware clamping so the composer only reaches `192px` when the panel has enough height to keep the conversation region visible.
- Playwright smoke confirmed `360x480` clamps at `96px` with a `48px` conversation area, while `360x640` reaches `192px` with a `111px` conversation area; textarea follows at `88px` and `184px`, and the send button remains vertically centered.

Completed after conversation overflow UX fix:

- `npm run lint`
- `npm run smoke`
- Removed the assistant bubble's internal `max-height` and nested `overflow-y: auto` behavior.
- Kept scrolling at the conversation timeline level only and auto-pinned the timeline to the bottom during streamed responses.
- Long-response Playwright mock session confirmed a `2995` character assistant response renders as one natural bubble with `overflow-y: visible`, `max-height: none`, no assistant-level scroll, and the conversation timeline scrolled to bottom.

Completed after realtime conversation streaming fix:

- `npm run lint`
- `npm run smoke`
- Replaced the single `lastPrompt`/`answer` renderer state with a persistent `chatMessages[]` timeline so follow-up prompts preserve previous user/assistant bubbles.
- Added per-response stream buffers and a UI typewriter loop so large backend deltas reveal progressively instead of appearing as one static text jump.
- Slowed the loading skeleton animation to `2.4s`.
- Added assistant response states (`Queued`, `Thinking`, `Working`, `Streaming`, `Typing`, `Done`, `Stopped`, `Error`) with animated dots and a live cursor so long-running/tooling phases remain visible after the first text arrives.
- Playwright mock stream confirmed: skeleton duration is `2.4s`, a `670` character response had only `90` visible characters shortly after first delta with dots/cursor active, a second prompt left `2` user and `2` assistant bubbles, and no assistant bubble had nested scroll.
- Playwright tooling smoke confirmed a post-answer tool phase shows `Working` with dots/cursor while assistant text remains visible.

Completed after GPT-style conversation layout pass:

- `npm install react-markdown remark-gfm`
- `npm run lint`
- `npm run smoke`
- Removed visible per-message `You` / `Codex` / `Agent / GPT-*` labels from active chat messages.
- Restyled user prompts as right-aligned dark bubbles with left padding; assistant responses now use full-width document-style text instead of a boxed assistant bubble.
- Added `react-markdown` plus `remark-gfm` rendering for assistant messages, including GFM table styling, code, links, blockquotes, lists, and zebra table rows.
- Added compact response actions matching the available widget scope: copy, positive feedback, negative feedback, regenerate, and more-action logging.
- Made the typing reveal more natural by using smaller variable character steps and punctuation/newline delays instead of fixed large chunks.
- Playwright GFM/UI smoke confirmed no `.message-meta` nodes, no `You`/`Codex`/`Agent / GPT` label text, right-aligned user bubble with left padding, full-width assistant response, rendered markdown table, 5 action buttons, active streaming state, and cursor during partial reveal.

Completed after widget Codex execution context separation:

- `npm run lint`
- `npm run smoke`
- Changed widget-launched Codex CLI sessions so they no longer run from this repository by default.
- Default live widget prompts now invoke `codex exec --skip-git-repo-check -C <user-home>` outside the widget repo while preserving normal user-file search/edit/delete capability.
- Added a protected-source instruction wrapper around widget prompts so source changes for this repo are redirected to CLI sessions.
- Added `CODEX_WIDGET_CODEX_WORKDIR`, `CODEX_WIDGET_CODEX_ADD_DIRS`, and `CODEX_WIDGET_CODEX_SANDBOX` documentation/env examples for explicit local-file boundary overrides.

Completed after widget shutdown / sandbox setup fix:

- `npm run lint`
- `npm run smoke`
- Killed one stuck widget-launched `codex exec` process tree whose Windows sandbox setup was consuming CPU.
- Changed the widget default Codex sandbox to `danger-full-access` to avoid the Windows home-directory `workspace-write` sandbox setup path while keeping requested desktop file operations possible.
- Added Windows `taskkill /T /F` process-tree cleanup when a widget Codex request is aborted so `cmd -> node -> codex -> sandbox` descendants do not survive cancel, socket close, or reload.
- WebSocket cancel smoke confirmed a live request launched with `-s danger-full-access`, no `codex-windows-sandbox-setup` process appeared, and no `codex exec` process remained after cancel.

Completed after conversation UI/action bugfix pass:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Made user prompt bubbles fully rounded and centered the streaming dots/loading indicator alignment.
- Moved the prompt height CSS variable to the widget panel grid so prompt resizing reallocates layout height instead of overlapping the conversation.
- Added a codeblock renderer with language label and per-block copy action; tightened markdown/code/table width rules and hid conversation horizontal overflow.
- Reduced side resize handle width so the conversation scrollbar remains clickable while the outermost edge still resizes.
- Fixed response copy to use the full buffered assistant response, added visible feedback logs/states, and changed regenerate to replace the old assistant answer with a pending response instead of appending a second answer.
- Playwright narrow-width smoke confirmed uniform user bubble radii, no conversation horizontal overflow at `330px`, codeblock/table rendering, full response copy, feedback visibility, regenerate replacement, prompt resize without overlap, and usable scrollbar area at `320px`.

Completed after feedback popup and prompt resize hardening:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Added local feedback submission state so selected negative feedback reasons and details are stored in the widget session after submitting the popup.
- Negative feedback now opens a modal-style feedback popup; while either good or bad feedback is selected, the opposite icon is hidden until the selected icon is toggled off.
- Added CSS tooltips and hover/toggled backgrounds for response action icons, and removed native button borders from the action icons.
- Moved the prompt resize hit area fully inside the prompt row and clipped prompt row overflow so textarea resizing cannot paint over the conversation.
- Playwright feedback/resize smoke confirmed bad feedback opens the popup, reason/details submit into visible state/logs, opposite feedback icon hides and returns after toggle-clear, hover tooltip opacity reaches `1`, and textarea/prompt resize no longer overlaps the conversation or paints outside the prompt row.

Completed after response action simplification:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Browser Playwright action/link smoke confirmed response evaluation buttons are gone, `Copy markdown` and `Clear feedback` no longer render, More opens above the button with right edges aligned, Read aloud invokes `speechSynthesis`, Branch leaves a focused user/assistant pair, and split markdown links do not expose raw `[label](url)` syntax while streaming.
- UTF-8/mojibake checks over touched renderer/context files

Completed after Codex app-server runtime transition:

- `npm run lint`
- `npm run smoke`
- `npm run build:renderer`
- Live daemon app-server smoke confirmed two-turn context preservation through one background `codex app-server` thread.
- Added `src/daemon/codexAppServer.ts` for JSON-RPC process/session ownership and `src/daemon/codexRuntime.ts` for shared workdir/sandbox/policy helpers.
- Updated `docs/context/product.md`, `docs/context/architecture.md`, and `.env.example` with `CODEX_WIDGET_CODEX_RUNTIME=app-server` default and `exec` fallback.
- UTF-8/mojibake checks over touched daemon/context files

Completed after `/vibe-iterate` iter-2 runtime protocol pass:

- `npm run lint`
- `npm run smoke`
- Daemon provider/reset protocol smoke confirmed `provider.status` and `session.reset` events.
- Renderer Playwright smoke confirmed localStorage chat restore, provider status dots, and New chat reset cleanup.
- Renderer Playwright fake-WebSocket smoke confirmed approval and user-input interaction cards return `interaction.respond` payloads.
- Live daemon app-server smoke confirmed two-turn context preservation still works with `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request`.
- Regenerated `docs/reports/project-report.html`.

Completed after resident desktop ops pass:

- `npm run lint`
- `npm run smoke` with strengthened provider/runtime event checks
- `npm run smoke:resident`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Renderer Playwright smoke confirmed Settings runtime/provider layout and hidden prompt rows at `360x480`.
- `npm run build` produced:
  - `src-tauri/target/release/codex-widget-for-desktop.exe`
  - `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi`
  - `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe`

Completed after DOM/Terminal provider shell pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:dom`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `node --check scripts/smoke-dom-provider.mjs`
- `node --check scripts/smoke-terminal.mjs`
- `node --check src/daemon/providers/providerRegistry.ts`
- `node --check src/daemon/providers/terminalProvider.ts`

Completed after Screen/Vision snapshot provider pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:screen`
- `npm run smoke:dom`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `node --check scripts/smoke-screen-provider.mjs`
- `node --check src/daemon/server.ts`
- `node --check src/daemon/providers/providerRegistry.ts`

Completed after browser DOM extension bridge pass:

- `npm run smoke:extension`
- `node --check scripts/smoke-browser-extension.mjs`
- `node --check providers/browser-dom-extension/service-worker.js`

Completed after Windows screen capture helper pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:dom`
- `npm run smoke:screen`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:live`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `npm run smoke:all:live`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-live.mjs`
- `node --check scripts/smoke-all.mjs`
- `node --check src/daemon/server.ts`

Completed after app-server diagnostics pass:

- `npm run lint`
- `npm run smoke:resident`
- `npm run smoke:all:live`
- `node --check src/daemon/codexAppServer.ts`

Completed after daemon-triggered Vision capture pass:

- `npm run lint`
- `npm run smoke:screen-capture:live`
- `npm run smoke:all:live`
- `node --check scripts/smoke-screen-capture-request.mjs`
- `node --check src/daemon/providers/screenCaptureProvider.ts`

Completed after screen helper OCR hook pass:

- `npm run lint`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run smoke:screen-helper:live`
- `npm run smoke:screen`
- Screen helper live smoke now posts fake OCR output and asserts it reaches the daemon snapshot.

Completed after bundled OCR runtime packaging pass:

- `npm run lint`
- `npm run build:ocr-runtime`
- `npm run smoke:ocr-runtime`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- The default local build created `dist/ocr-runtime/ocr-runtime.json` with `available: false` because no local Tesseract runtime is installed; the packaging smoke used a mock Tesseract runtime source and verified copy/manifest generation plus daemon-side bundled OCR command resolution.

Completed after browser DOM extension Options pass:

- `node --check providers\browser-dom-extension\service-worker.js`
- `node --check providers\browser-dom-extension\options.js`
- `node --check scripts\smoke-browser-extension.mjs`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-launch`
- Extension smoke now verifies the Options page, storage permission, local-only host permissions, Options script syntax, and packaged zip entries.

Completed after NSIS release install smoke pass:

- `node --check scripts\smoke-release-install.mjs`
- `npm run smoke:release-install`
- Post-smoke checks confirmed no `Codex Widget` install directory under `%LOCALAPPDATA%`, no uninstall registry entry, no `Software\mir3626\Codex Widget` product install key, and no desktop shortcut remained.

Completed after release verification gate pass:

- `node --check scripts\release-verify.mjs`
- `npm run release:verify`
- Release verification ran the live smoke gate, Tauri release build, release resource smoke, release exe launch smoke, NSIS install smoke, and MSI install smoke, then reported release exe/MSI/NSIS artifact sizes.

Completed after installed daemon resource/restart pass:

- `cargo fmt --check --manifest-path src-tauri\Cargo.toml`
- `cargo check --manifest-path src-tauri\Cargo.toml --no-default-features`
- `npm run build`
- `node --check scripts\smoke-release-install.mjs`
- `npm run smoke:release-install`
- Manual diagnostic confirmed the installed app spawned `%LOCALAPPDATA%\Codex Widget\_up_\dist\node-runtime\node.exe` with `_up_\dist\daemon-bundle\standalone.js`, not repo `dist` or system `node`.
- `npm run release:verify` passed after the parent-watchdog change; release install smoke now verifies bundled daemon restart and app-process kill orphan cleanup.

Completed after browser native messaging host pass:

- `node --check providers\browser-native-host\native-host.mjs`
- `node --check providers\browser-dom-extension\service-worker.js`
- `node --check scripts\smoke-browser-native-host.mjs`
- `node --check scripts\smoke-browser-extension.mjs`
- `npm run smoke:browser-native-host`
- `npm run smoke:extension`
- `npm run release:verify`
- Native host smoke framed a DOM snapshot over stdio, verified the host posted it to a local daemon-compatible endpoint, and checked Chrome/Edge registry installer markers.
- Release verification confirmed the native host provider files are bundled into MSI/NSIS resources and installed by the NSIS smoke.

Completed after browser store-readiness pass:

- `node --check scripts\smoke-browser-store-readiness.mjs`
- `npm run smoke:browser-store`
- `npm run release:verify`
- Store readiness smoke verifies extension name/description length, icon files, permission rationales, host permissions, privacy/review notes, native messaging disclosure, no-remote-code statement, and generated package presence.
- Release verification now includes browser store readiness through `smoke:all:live`.

Completed after release longer soak pass:

- `node --check scripts\smoke-release-soak.mjs`
- `npm run release:soak`
- The release soak built the release app, launched the release exe hidden for 60 seconds, collected 13 runtime samples and 29 pong responses, detected the root app and daemon processes, and ended with a 463.6MB process-tree working set across 10 processes.
- `npm run smoke:release-soak`
- The standalone release soak smoke reused the current release build, collected 13 runtime samples and 29 pong responses, detected the root app and daemon processes, and ended with a 409.1MB process-tree working set across 9 processes.

Completed after branch-safe runtime pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:renderer-chat`
- `npm run smoke:screen`
- `npm run smoke:all`
- Daemon smoke now verifies `session.branch` does not broadcast a visible `session.reset`; renderer chat smoke verifies Branch sends `session.branch`, the next prompt includes one-shot `branchContext`, and the following branch prompt does not replay that seed.

Completed after reconnect replay pass:

- `npm run lint`
- `npm run smoke:daemon-reconnect`
- `npm run smoke`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- Reconnect smoke verifies an active response survives the first WebSocket closing, a second client receives a `message.snapshot` containing the already-streamed text, and the final `message.completed` reaches the reconnected client.

Completed after persistent terminal session pass:

- `npm run lint`
- `npm run smoke:terminal-session`
- `npm run smoke:terminal`
- `npm run smoke:all:live`
- `npm run build`
- Added `npm run smoke:terminal-session` and included it in the serial readiness gate.

Completed after native PTY runtime pass:

- `node --check scripts/prepare-pty-runtime.mjs`
- `node --check scripts/smoke-pty-runtime.mjs`
- `npm run lint`
- `npm run smoke:pty-runtime`
- `npm run smoke:terminal-session`
- `npm run build:web`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- PTY runtime smoke verifies `dist/pty-runtime` contains a loadable `node-pty` package, spawns a native PTY, and checks daemon PTY runtime resolution.
- Terminal session smoke now verifies `/pty resize` and the node-pty backend when `CODEX_WIDGET_TERMINAL_BACKEND` is not forced to `pipe`.
- Release resource/install smokes now verify `_up_/dist/pty-runtime/pty-runtime.json` and `_up_/dist/pty-runtime/node_modules/node-pty/package.json` are bundled and installed.

Completed after renderer PTY viewport pass:

- `npm run lint`
- `node --check scripts/smoke-renderer-chat-layout.mjs`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- Renderer chat smoke now covers the PTY tab, terminal quick action request, terminal output rendering, terminal viewport containment, and prompt/conversation separation.

Completed after MSI release install smoke pass:

- `node --check scripts/smoke-release-msi-install.mjs`
- `node --check scripts/release-verify.mjs`
- JSON parse check for `package.json`
- `npm run smoke:release-msi-install`
- `npm run release:verify`
- MSI smoke installs into `%TEMP%\codex-widget-msi-smoke`, launches the installed app hidden, verifies daemon WebSocket startup, uninstalls, and confirms no test install directory or port `4128` daemon remains.

Completed after standard OCR runtime discovery pass:

- `node --check scripts/prepare-ocr-runtime.mjs`
- `node --check scripts/smoke-ocr-runtime.mjs`
- `npm run smoke:ocr-runtime`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- OCR runtime preparation now finds explicit runtime dirs, explicit executables, PATH `tesseract`, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, and standard Windows install layouts before writing the bundled `dist/ocr-runtime/ocr-runtime.json` manifest.

Completed after OCR language defaults pass:

- `node --check scripts/prepare-ocr-runtime.mjs`
- `node --check scripts/smoke-ocr-runtime.mjs`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-ocr.mjs`
- `npm run smoke:ocr-runtime`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run lint`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- OCR runtime manifests now include bundled `.traineddata` languages, and bundled OCR command resolution auto-selects `eng+kor` when `eng` and `kor` language packs are both present.

Completed after PTY direct input pass:

- `node --check scripts/smoke-renderer-chat-layout.mjs`
- `node --check scripts/smoke-terminal-session.mjs`
- `npm run lint`
- `npm run smoke:terminal-session`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- Terminal session smoke now verifies raw `/pty write` output drain, and renderer chat smoke verifies the Terminal viewport input row sends `/pty write` plus Ctrl+C key requests.

Completed after release soak report pass:

- `node --check scripts/smoke-release-soak.mjs`
- `npm run smoke:release-soak`
- The short release soak produced 13 runtime samples, 29 pong responses, 411.1MB process-tree working set across 9 processes, and `dist/reports/release-soak-latest.json`.
- Release soak now writes a JSON report with duration, runtime sample count, pong count, latest runtime status, process-tree memory, thresholds, and process details for later manual/multi-hour evidence review.

Completed after release readiness audit pass:

- `node --check scripts/release-readiness.mjs`
- `npm run release:readiness`
- `node scripts/release-readiness.mjs --require-manual-gates` was run intentionally and failed as expected at that time because browser store submission and a true multi-hour soak had not been confirmed.
- Default readiness audit initially reported manual blockers for browser store submission and multi-hour soak. The 2026-05-05 two-hour soak later cleared the multi-hour blocker, and the 2026-05-06 product-owner decision deferred browser store submission until after dogfooding.
- After the 2026-05-06 product-owner deferral, default `npm run release:readiness` reports `status: deferred` for browser store submission via `docs/release/deferred-gates.json`; strict manual-gate mode still fails until actual store submission is confirmed.

Completed after OCR preprocessing pass:

- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-ocr.mjs`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run lint`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- Screen helper OCR smoke now verifies OCR commands receive the default preprocessed `.png` image path.

Completed latest release build after OCR preprocessing pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,315,264 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,766,904 bytes)

Completed after fake app-server protocol smoke pass:

- `node --check scripts/smoke-codex-app-server.mjs`
- `npm run smoke:app-server`
- `npm run smoke:all`
- `smoke:all` now includes fake Codex app-server coverage for thread reuse, streaming deltas, approval interaction forwarding, and regenerate rollback.

Completed after live app-server smoke pass:

- Added `npm run smoke:app-server:live` and included it in `npm run smoke:all:live`.
- `npm run smoke:app-server:live` passed against the logged-in local Codex CLI with 12 streaming deltas.
- App-server shutdown now waits for the Codex child process tree before daemon close returns, preventing live smoke temp workdir cleanup from racing the background CLI process.
- `npm run smoke:all:live`, `npm run build`, and `npm run smoke:release-resources` passed after the live smoke addition.
- Latest release artifacts: `codex-widget-for-desktop.exe` 10,315,776 bytes, MSI 39,505,920 bytes, NSIS 26,763,736 bytes.

Completed after Vision crop/diff metadata pass:

- `node --check scripts/smoke-screen-provider.mjs`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-renderer-chat-layout.mjs`
- `npm run smoke:renderer-chat`
- `npm run smoke:screen`
- `npm run smoke:screen-helper`
- `npm run lint`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- Settings now exposes compact Vision crop controls, screen capture requests carry the enabled crop rectangle, the helper accepts virtual-screen crop parameters, and screen snapshot responses include `imageHash`, `imageChanged`, `imageDiffRatio`, `imageDiffThreshold`, and `imageMeaningfullyChanged` metadata for repeated-capture diff awareness.

Completed after Vision drag crop picker pass:

- Settings now includes a visual crop selector for Vision capture regions.
- The selector converts the dragged webview rectangle into screen crop coordinates using Tauri window geometry and persists the result into the existing crop settings.
- `npm run smoke:renderer-chat` verifies the picker writes the selected crop size and preserves the existing crop capture request path.
- `npm run smoke:all`, `npm run build`, and `npm run smoke:release-resources` passed after the picker addition.
- Latest release artifacts: `codex-widget-for-desktop.exe` 10,316,800 bytes, MSI 39,505,920 bytes, NSIS 26,753,674 bytes.

Completed after OCR language acquisition pass:

- `prepare-ocr-runtime` can fetch requested tessdata packs during build with `CODEX_WIDGET_TESSDATA_LANGUAGES`.
- Added `npm run ocr:fetch-languages -- eng kor` for ad hoc language-pack acquisition into `dist/ocr-runtime/tessdata`.
- `npm run smoke:ocr-runtime` now verifies build-time tessdata fetch, the ad hoc fetch CLI, manifest language recording, and bundled OCR command resolution without relying on external network.
- `npm run smoke:all`, `npm run build`, and `npm run smoke:release-resources` passed after the OCR acquisition addition.
- Latest release artifacts: `codex-widget-for-desktop.exe` 10,316,800 bytes, MSI 39,510,016 bytes, NSIS 26,763,909 bytes.
- Latest release artifacts after this pass: exe 10,315,776 bytes, MSI 39,505,920 bytes, NSIS 26,764,799 bytes.

Completed after renderer chat layout hardening:

- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run smoke:all:live`
- `npm run build`

Completed after regenerate rollback pass:

- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run smoke:all:live`
- `npm run build`
- The renderer smoke asserts that regenerating the first of three assistant answers sends `regenerate.dropTurns: 3`.

Completed after direct Vision image input pass:

- `npm run lint`
- `npm run smoke:screen`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:screen` now asserts that screen snapshots become app-server image input items.

Completed after resident soak gate pass:

- `npm run lint`
- `npm run smoke:resident-soak`
- `npm run smoke:all:live`

Completed after browser DOM extension packaging pass:

- `npm run package:extension`
- `npm run smoke:extension`
- `npm run lint`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:extension` now verifies manifest icons, service worker syntax, zip creation, and required zip entries.

Completed after native daemon supervisor pass:

- `npm run smoke:tauri-supervisor`
- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run build`
- Added packaged-app daemon restart supervision with capped exponential backoff and shutdown cleanup; the smoke now verifies both delay capping and actual child restart after an exit.
- Added renderer-visible native daemon diagnostics so offline/reconnecting states can distinguish dev-services mode, daemon restart, and daemon errors.

Completed after bundled daemon runtime pass:

- `npm run smoke:node-runtime`
- `npm run lint`
- `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features`
- `npm run smoke:tauri-supervisor`
- `npm run smoke:all:live`
- `npm run build`
- `Select-String` over generated MSI/NSIS installer scripts confirmed `_up_\dist\daemon-bundle\standalone.js` and `_up_\dist\node-runtime\node.exe` are included.
- `npm run smoke:release-resources`
- `npm run smoke:release-launch`

Completed latest release build after provider/runtime readiness passes:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,307,072 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (4,161,536 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (3,063,170 bytes)
- Tauri resources include `_up_/providers/screen-capture-helper/capture-screen.ps1` and `_up_/providers/browser-dom-extension/manifest.json`.

Completed latest release build after persistent terminal session pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe`
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe`

Completed latest release build after native PTY runtime pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,312,704 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,497,728 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,760,198 bytes)
- Release bundles include `_up_/dist/pty-runtime/pty-runtime.json` and `_up_/dist/pty-runtime/node_modules/node-pty/package.json`.

Completed latest release build after renderer PTY viewport pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,501,824 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,764,420 bytes)

Completed latest release build after standard OCR runtime discovery pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,762,752 bytes)

Completed latest release build after OCR language defaults pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,758,248 bytes)

Completed latest release build after PTY direct input pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,315,264 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,501,824 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,773,974 bytes)

Completed after dogfood tooltip/activity/artifact polish:

- Mascot playback is now fixed at 6fps and the temporary FPS tuning slider was removed from the system strip.
- Activity detail count badges now use normal weight, expand for 100+ counts, and the detail/provider-history popover uses responsive row sizing so timestamps stay single-line.
- Renderer native `title` attributes were removed in favor of the shared `data-tooltip`/`FloatingTooltipRoot` path; tooltip placement now recalculates when moving quickly between response action buttons.
- Session artifacts now open from a bottom-left floating conversation button instead of staying pinned inline below the chat, and the panel closes on outside click/Escape.
- Empty untouched `New chat` tabs now use `session.discard` and are deleted without entering trash; non-empty sessions still fall back to normal trash behavior.
- Verification passed `npm run typecheck`, `npm run smoke:renderer-chat`, `npm run smoke:storage`, `npm run build:web`, `node scripts\smoke-daemon.mjs`, and `git diff --check`.

Completed after floating artifact visual polish:

- The active-session artifact popup now has a higher layer than widget buttons, explicit always-visible borders on both the trigger and popup, and a slightly lower sticky trigger position.
- Generated artifact summary badges now show a file icon, extension code, semantic extension name, and extension-specific color treatment based on the generated file.
- Renderer smoke now verifies artifact popup z-index/borders/button offset and generated Markdown badge icon/text/color behavior.
- Verification passed `npm run typecheck`, `npm run smoke:renderer-chat`, `npm run build:web`, and `git diff --check`.

Completed after trash/tab/model/artifact dogfood polish:

- Trash counts now use normal weight, trash-popover hover tooltips were removed, and each trash row now has a Restore icon plus a permanent delete icon wired to daemon `session.delete`.
- Active session tabs now use a thin full green border instead of a top-only green bar.
- Session switch feedback moved from the whole model row to thicker animated select borders; the border uses a green conic gradient that rotates counterclockwise once and then clears.
- Generated artifact badges now show only icon plus extension, with centered alignment and no tooltip; the floating artifact trigger moved further down.
- Verification passed `npm run typecheck`, `npm run smoke:storage`, `npm run smoke:renderer-chat`, `npm run build:web`, `node scripts\smoke-daemon.mjs`, and `git diff --check`.

Completed after execution permission and artifact policy dogfood polish:

- Runtime approval cards now expose `Allow`, `Always allow`, and `Deny`; `Always allow` stores an action-level execution permission in daemon-owned SQLite `app_settings` and future matching Codex app-server approval requests are auto-applied before the renderer is prompted.
- Settings now includes an `Execution permissions` section where saved action policies can be changed between `Ask`, `Always allow`, and `Deny`.
- Tool/provider context output is no longer promoted into artifacts. Screen/DOM/Vision snapshots remain provider history/activity context; artifacts are reserved for user-requested generated/modified/deleted outputs such as app-server file changes.
- Floating artifact badges were tightened again and artifact rows now show version/time metadata so duplicate titles can be compared by recency.
- Model/Reason session-switch feedback now draws a green line from the select border near the 11 o'clock position counterclockwise, holds briefly, then fades out instead of rotating a full border background.
- Verification passed `npm run typecheck`, `npm run build:daemon`, `node scripts\smoke-storage.mjs`, `node scripts\smoke-codex-app-server.mjs`, `node scripts\smoke-screen-provider.mjs`, `npm run smoke:renderer-chat`, `npm run build:web`, `node scripts\smoke-daemon.mjs`, and `git diff --check`.

Completed after control alignment and daemon restart:

- Model/Reason labels now share the select control vertical center, and Agent/DOM/Vision/PTY tabs keep icon/text centers aligned.
- Renderer smoke now explicitly fails if those control centers drift at the minimum dogfood viewport.
- No daemon listener was present on `4128`; a hidden manual daemon was started from `dist\daemon\standalone.js` and `/storage/health` reports ready SQLite storage under `C:\Users\Tony\AppData\Local\Codex Widget`.
- Verification passed `npm run smoke:renderer-chat`, `/storage/health`, and `git diff --check`.

Completed after Mode/Vision UX polish:

- Model/Reason select-border animation now uses the same accent at the start and end of the gradient head, a softened moving endpoint, and an 1.8s timeline with the final 0.5s fading opacity to zero after the full loop.
- DOM/Vision/PTY selected-state re-clicks are now no-ops and keep the current mode selected. Vision opens its action menu from the Mode bar when entering Vision mode.
- The previous in-conversation Vision toolbar was removed. A Mode-bar-attached Vision status panel stays hidden by default, slides/fades in for screen capture, recording, and Agent screen sharing, shows a blinking red live dot for recording/streaming, and delays its fade-out after completion.
- The active-session artifact floating trigger now sits lower at `bottom: -14px` while smoke still checks it stays above the prompt composer.
- Verification passed `npm run typecheck`, `npm run smoke:renderer-chat`, `npm run build:renderer`, `node --check scripts\smoke-renderer-chat-layout.mjs`, and `git diff --check`. Follow-up no-op selected Mode re-click verification also passed `npm run typecheck`, `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, and `git diff --check`.

Completed after external URL approval and Recovery Vault polish:

- Browser-open app-server approval requests now produce a renderer `external.url` event after Allow/Always allow, including saved `allow` permission policies, so the existing Tauri `open_external_url` path actually opens the browser instead of only approving the request.
- Deleted session UI now uses `Recovery Vault` language instead of Trash, uses an Archive icon for archive/recovery entry points, and uses an X icon for permanent delete inside the vault.
- Verification passed `npm run typecheck`, `node --check scripts\smoke-codex-app-server.mjs`, `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:app-server`, `npm run smoke:renderer-chat`, `npm run build:renderer`, and `git diff --check`.

Completed after artifact floating anchor correction:

- The active-session artifact floating trigger no longer uses `position: sticky`; it is fixed against the widget lower-bar stack and visually sits 8px above the prompt composer.
- Renderer smoke now measures the trigger-to-prompt gap and asserts the trigger remains non-sticky.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, and `git diff --check`.

Completed after artifact floating guard adjustment:

- The active-session artifact floating trigger now visually sits 4px above the lower bar.
- When a session has artifacts, the conversation gains a bottom guard spacer so the fixed artifact trigger cannot cover the final assistant response action buttons.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason animation origin adjustment:

- The model/reason select-border draw now starts from an explicit top-left text-start origin (`0deg` at `12px 50%`) instead of the previous top-center-biased path, so the visual start point is around the first option character.
- Renderer smoke now asserts the configured select-border start origin.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason animation tail adjustment:

- After the model/reason select-border draw completes, the full gradient border now rotates counterclockwise for 0.5s at opacity 1, then holds that completed rotation for a separate 0.5s fade-out.
- The tail phase is driven by `--model-select-spin`, leaving the draw phase and text-start origin intact; the total animation duration is now 2.3s.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after visible model/reason tail correction:

- The model/reason select-border motion now uses separate pseudo-elements: `::after` draws the border and `::before` handles the completed-border tail.
- The tail layer uses a full high-contrast conic gradient with a 1.3s delay, then rotates for 0.5s at opacity 1 and fades for the next 0.5s so the final motion is visible in the live widget.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason tail sequencing correction:

- The tail layer no longer starts during the draw phase. Its base opacity is `0`, and the animation uses `forwards` rather than `both` so delay no longer backwards-fills the visible 0% frame.
- Renderer smoke now asserts the tail fill mode and pre-delay opacity, which catches simultaneous draw/tail execution.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason tail visibility correction:

- The completed-border tail no longer relies on custom-property conic angle changes, which were too subtle in the live WebView.
- The tail pseudo-element now physically rotates with `transform: rotate(-360deg)` and a higher-contrast green gradient, while preserving the delayed start and fade-out sequencing.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason single-layer motion correction:

- The draw/tail pseudo-element handoff was removed. Model/reason select-border draw, full-border spin, and fade-out now run in one `::after` animation layer.
- The single-layer timeline prevents the drawn border from disappearing before a delayed tail layer becomes visible.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason simple draw fallback:

- Product owner chose to stop pursuing the post-draw rotation. Model/reason select-border animation now only draws the border to completion, briefly holds it, and fades out.
- Rotation/tail transform code was removed; renderer smoke now asserts a simple 1.6s no-transform draw/fade timeline.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after Codex app-server browser-open duplicate correction:

- Browser-open approvals no longer emit a renderer `external.url` event from the app-server approval path.
- The bridge still answers Codex app-server approvals with the required protocol payload `decision: "accept"`; Codex runtime now owns the actual browser/PowerShell `Start-Process` side effect, avoiding double opens.
- App-server smoke now asserts approved direct URL and PowerShell browser-open actions do not generate widget-side URL open events.
- Verification passed `node --check src\daemon\codexAppServer.ts`, `node --check scripts\smoke-codex-app-server.mjs`, `npm run smoke:app-server`, `npm run typecheck`, and `git diff --check`.
- Manual daemon was restarted on `127.0.0.1:4128`; the stale pre-restart app-server chain was stopped, leaving only the current daemon-owned app-server process chain.

## Restart Steps

1. Run `git status --short --untracked-files=all` and inspect the sync diff.
2. Default local live auth is Codex CLI auth. Use `CODEX_WIDGET_AUTH_MODE=codex`; Sign in should invoke `codex login` if the user is not already logged into Codex/ChatGPT.
3. Default Codex runtime is `CODEX_WIDGET_CODEX_RUNTIME=app-server`, which starts a daemon-owned background `codex app-server`. Set `CODEX_WIDGET_CODEX_RUNTIME=exec` only to force the older `codex exec resume` fallback.
4. Widget-launched Codex sessions default to `CODEX_WIDGET_CODEX_WORKDIR=<user-home>`, `CODEX_WIDGET_CODEX_SANDBOX=danger-full-access`, and `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request`; override only when testing a different desktop file boundary or trusted no-approval automation path.
5. Use the dev auth proxy only for mock backend OAuth experiments: run `npm run dev:auth-proxy` or set `CODEX_WIDGET_DEV_AUTH_PROXY=1` before `npm run dev`.
6. For production-style backend OAuth proxy live responses, set `CODEX_WIDGET_AUTH_MODE=pkce` and replace `CODEX_WIDGET_AUTH_BASE_URL`/`CODEX_WIDGET_AGENT_PROXY_URL` with a real backend that implements `/oauth/authorize`, `/oauth/token`, redirects to `http://127.0.0.1:4128/oauth/callback`, and serves streaming model responses.
7. For token-mode fallback responses, set `CODEX_WIDGET_AUTH_MODE=token`, press Sign in in the widget, and use the inline token form to save the OAuth access token and backend proxy URL into gitignored `.env`.
8. Run `node .vibe/harness/scripts/vibe-sprint-mode.mjs status` to confirm whether extended mode is still active.
9. Use `npm run dev` for renderer HMR plus daemon restart-on-change; use `npm run dev:services` only when testing the service loop without launching Tauri.
10. Run `npm run smoke:all` after follow-up TypeScript/widget/provider changes; it includes fake Codex app-server thread/approval/rollback coverage. Use `npm run smoke:all:live` when validating Windows desktop capture behavior.
11. For renderer UI work, run `npm run smoke:renderer-chat` and capture a `360x480` Playwright smoke against `http://127.0.0.1:5173/?daemonPort=4128` when a visual screenshot is needed. Model/reasoning selectors live between the status strip and mode tabs and persist to localStorage keys `codex-widget-model` and `codex-widget-reasoning-effort`. For mascot asset updates, keep generated sequential source sheets under `src/renderer/assets/mascot/`, run `python scripts/build-mascot-assets.py`, then run `npm run build:web` and `npm run smoke:renderer-chat`.
12. Renderer visible chat persists under `codex-widget-chat-messages:v1`; use the titlebar New chat control or `session.reset` protocol event to clear both UI and daemon session state.
13. The titlebar close button hides the widget to tray; use tray Quit to exit the resident app.
14. Run `npm run smoke:resident` when resident lifecycle, daemon health, or resource behavior changes.
15. Run `npm run smoke:tauri-supervisor` after Tauri/Rust daemon lifecycle changes.
16. Run `npm run smoke:node-runtime` after daemon bundle, Node runtime resource, or Tauri resource packaging changes; run `npm run smoke:pty-runtime` after PTY runtime packaging changes.
17. Run `npm run smoke:release-resources` after `npm run build` when release bundle resources change.
18. Run `npm run smoke:release-launch` after `npm run build` when native daemon startup, bundled runtime resolution, or release exe behavior changes.
19. Run `npm run smoke:release-install` after `npm run build` when NSIS installability, bundled installed resources, or installer cleanup behavior changes. Run `npm run smoke:release-msi-install` after MSI installability, WiX, or release verification changes. Both refuse to run over existing install state unless `CODEX_WIDGET_RELEASE_INSTALL_SMOKE_ALLOW_EXISTING=1` is set for a controlled test machine.
20. Run `npm run smoke:dom` after browser/provider page-context ingress changes; run `npm run smoke:browser-action`, `npm run smoke:browser-action:playwright`, `npm run smoke:browser-action:cdp`, `npm run smoke:browser-action:evaluate`, and `npm run smoke:browser-action:native` after Browser Action daemon/protocol/adapter/evaluate changes; run `npm run dogfood:browser-action` when semantic Browser Action acceptance evidence needs refreshing; run `npm run smoke:extension` after browser extension package changes, `npm run smoke:browser-bridge` after Browser Bridge popup/badge/heartbeat/permission/command-first changes, `npm run dogfood:browser-bridge` when snapshotless Browser Bridge evidence needs refreshing, `npm run smoke:browser-native-host` after native messaging host changes, `npm run smoke:browser-store`, `npm run release:browser-store-packet`, and a temp-output `npm run release:confirm-browser-store` check after browser store metadata/submission packet/confirmation changes, `npm run smoke:screen` after Vision provider changes, `npm run smoke:screen-capture:live` after daemon-triggered capture changes, `npm run smoke:screen-helper`, `npm run smoke:screen-helper:ocr`, and `npm run smoke:ocr-runtime` after screen helper/OCR changes, `npm run smoke:terminal` after one-shot terminal provider changes, and `npm run smoke:terminal-session` plus `npm run smoke:pty-runtime` after `/pty` session changes.
21. DOM snapshot testing can use `providers/browser-dom-extension` as an unpacked Chrome/Edge extension or `docs/providers/dom-snapshot-bookmarklet.js` as a fallback against the local daemon on port `4128`.
22. Screen snapshot testing can use `providers/screen-capture-helper/capture-screen.ps1` for live capture or `docs/providers/screen-snapshot-example.json` as the raw payload shape against `POST /providers/screen/snapshot`.
23. Run `npm run release:verify` as the full live release gate before treating a build as releasable; it includes NSIS and MSI install smokes.
24. Run `npm run release:soak` for longer release-exe resident validation before manual release candidates or resident lifecycle changes. Use `CODEX_WIDGET_RELEASE_SOAK_MS=7200000` and a named `CODEX_WIDGET_RELEASE_SOAK_REPORT` for the default two-hour release-candidate evidence run.
25. Run `npm run build` before individual release checks when not using `release:verify`; MSI/NSIS bundle creation is now part of the installability gate.
26. Run `npm run vibe:checkpoint` before ending any follow-up maintenance session.

Use `docs/context/qa.md` for routine follow-up commands.

## Latest Update: Browser Action Widget UI Live Automation

Implemented the recommended live automation path that tests Browser Action the way a user does: one Chromium profile hosts the target page with the Browser Bridge extension, and a separate browser-hosted widget UI receives prompts through the real chat composer and approval buttons.

- Added `npm run dogfood:browser-action:live:widget-ui`, backed by `scripts/browser-action-live-runner.mjs --mode widget-ui`. It launches an isolated daemon, local fixture server, Vite renderer, target extension browser, and separate widget browser.
- Widget UI mode now types into `Ask Codex`, clicks the real `Send prompt` control, handles Browser Action approval cards through `Allow` / `Always allow` / `Deny`, screenshots both target and widget surfaces, and verifies final target-browser state.
- Fixed renderer final-answer replacement for approved Browser Action prompts. A later `message.completed` that replaces an approval receipt now updates the visible assistant message instead of leaving the old receipt stuck on screen.
- Hardened Browser Bridge command pickup for real UI timing: daemon WebSocket command polls wait briefly for just-queued commands, command redelivery cooldown is shorter, and the extension schedules wake retries after queued/progress events so approved actions do not stall behind an aborted long-poll response.
- Verification passed `npm run lint`, `npm run build:web`, `npm run smoke:browser-action`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, and `npm run dogfood:browser-action:live:widget-ui -- --run-id browser-action-widget-ui-final5-20260511`.
- Restarted the live dev runtime after daemon/renderer changes. Renderer is on `127.0.0.1:5173` PID `92796`, daemon `/storage/health` is ok on `127.0.0.1:4128` PID `10192`, and widget PID is `109152`.

Manual follow-up: reload the unpacked Browser Bridge extension once in Chrome/Edge so the installed service worker uses the wake retry update. The automated widget UI run loads the updated unpacked extension directly.

## Latest Update: Browser Action Live Latency And Grouped Always Allow

Completed the live Browser Action follow-up for slow/inconsistent `뒤로가기`, repeated Always Allow prompts, and general action startup latency.

- Browser Action Always Allow now stores grouped policies through `createAlwaysAllowBrowserActionPolicyInput()` instead of URL-specific `actionLabel` values for normal safe action families. Navigation Always Allow covers similar navigate actions without pinning to one target URL; click/type/check/select share the `safe_click_type` family; read/scroll/screenshot share `safe_read_scroll`.
- Browser Bridge now deduplicates in-flight/recent extension command `requestId`s so stale redelivery cannot execute a previous back/navigate command after a later scenario setup.
- Browser Bridge adds a daemon WebSocket command wake-up path. The extension still keeps HTTP long-poll as fallback, but it now listens for daemon `browserAction.progress: queued` events and immediately requests `browserBridge.command`, avoiding Manifest V3 alarm wake-up delays.
- `npm run dogfood:browser-action:live -- --run-id browser-action-ws-wakeup-always-allow-20260511` passed all seven scenarios. Latest latency evidence: concept random post 554ms, read 113ms, back 178/185ms, first approval navigate 329ms, grouped Always Allow navigate 199ms, reuse navigate 198ms.
- `npm run smoke:browser-bridge` now covers the WebSocket command poll path in addition to HTTP poll/status refresh.

Manual follow-up: reload the unpacked Browser Bridge extension once in Chrome/Edge so the installed service worker uses the WebSocket wake-up and command dedupe code.

## Previous Update: Browser Perception Interface Implementation

Iteration `iter-19` completed `docs/plans/browser-perception-interface-handoff.md`.

- Browser Perception is now implemented under `src/daemon/browser-perception/` with `PreparedBrowserViewContext`, source identity, freshness/stability policy, context store, and `ensureFreshContext`.
- Browser Bridge command polling can deliver `observe_now` before action commands. The extension now posts fast observe acknowledgements to `/browser-action/extension/ack` and final observe results to `/browser-action/extension/observe-result`.
- Browser Bridge snapshots include top-level mutation revision, last mutation timestamp, and mutation quiet duration for SPA/dynamic-page stabilization.
- Prompt, direct command, direct observe, and plan Browser Action paths now call Browser Perception before extension-backed planning/execution.
- Connected/allowed prompt flows emit `browser_perception_waiting` progress and wait for a bounded fresh context instead of returning the old retry-later final answer.
- Added `npm run smoke:browser-perception`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-perception:stabilization`, `npm run smoke:browser-action:fresh-context`, and `npm run dogfood:browser-perception`.
- Dogfood report: `docs/reports/browser-perception-dogfood-evidence-2026-05-10.md`.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting so Chrome/Edge uses the new observe ack/result code.

## Previous Update: Browser Perception Interface Handoff

Added `docs/plans/browser-perception-interface-handoff.md` after live testing showed the next failure class:

```text
현재 활성 탭 관찰이 아직 갱신되지 않았습니다.
Browser Bridge가 gall.dcinside.com 페이지를 읽는 중입니다.
잠시 후 다시 실행해 주세요.
```

This confirms that Browser View Graph v2 is necessary but not sufficient. View Graph v2 can model a page once a valid observation exists, but Browser Action still needs a Browser Perception layer that guarantees request-scoped fresh active-tab context before prompt/direct action planning.

The new handoff scopes:

- daemon `PreparedBrowserViewContext` store and `ensureFreshContext` API
- extension observe command ack/result/timeout/cancel semantics
- long-poll or upgraded poll delivery for `observe_now`
- SPA/query/history/mutation stabilization
- active-tab dirty invalidation and graph revision handling
- Browser Action prompt/direct integration before planning and before side-effect execution
- Semantic Interface evidence publication from prepared contexts
- renderer progress states so "reading page" is not returned as the final chat answer

`docs/plans/sprint-roadmap.md` now includes planned Iteration `iter-19: Browser Perception Interface` with six recommended sprints.

## Previous Update: Browser View Graph v2 Implementation

Iteration `iter-18` completed `docs/plans/browser-view-graph-v2-handoff.md`.

- Browser Action previously relied on prompt-time snapshot/observation; View Graph v2 is now the prepared page-understanding foundation before broader Browser Perception.
- Added `src/daemon/browser-perception/view-graph/` with schema-versioned v2 graph construction: identity, route key, query signature, freshness, regions, controls, forms, content lists, edges, affordance index, diagnostics, and redaction summary.
- `BrowserObservation.viewGraph` now emits v2 graphs while preserving existing Browser Action consumers.
- Browser Bridge snapshots include additive DOM/ARIA/landmark/form/list/mutation metadata; ProviderRegistry stores a prepared BrowserObservation and attaches its v2 graph to the DOM snapshot.
- Prompt Browser Action can use a fresh prepared v2 graph before falling back to request-time snapshot waiting.
- Semantic Interface projection carries graph action hints, risk hints, list/form ids, freshness, and view revision; representative content resolution now prefers v2 content-list evidence.
- Added `npm run smoke:browser-view-graph-v2`, `npm run dogfood:browser-view-graph-v2`, and report `docs/reports/browser-view-graph-v2-dogfood-evidence-2026-05-10.md`.
- Verification passed `npm run lint`, `npm run smoke` including `build:web`, focused Browser Action/Bridge/Semantic smokes, Browser Action/Semantic/View Graph dogfood scripts, UTF-8/mojibake checks, project report refresh, and `npm run vibe:checkpoint`.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting so Chrome/Edge uses the updated metadata collection code.

## Previous Update: Browser View Graph v2 Handoff

Added `docs/plans/browser-view-graph-v2-handoff.md` as the focused handoff for the next Browser Action prepared-context track.

The plan scopes View Graph v2 as a schema-versioned, deterministic page-understanding model with view identity/freshness, regions, controls, content lists, forms, edges, affordance indexes, Semantic Interface evidence projection, extension metadata upgrades, SPA/query transition handling, privacy-safe audit summaries, and dogfood evidence. It should be implemented before further Browser Action resolver tuning because the current live failures are rooted in missing prepared page semantics rather than isolated target-normalization bugs.

## Latest Update: iter-17 Browser Action Runtime Closure

Completed the requested follow-up order `2 -> 3 -> 1 -> 6 -> 7 -> 5` through `$vibe-iterate`.

- View Graph/runtime source handling: prompt-driven Browser Action now retries the affected step once when the extension reports expected-source URL/tab/window mismatch, using the returned active-tab snapshot to refresh observation and re-resolve.
- Semantic Interface/Memory live path: smoke/dogfood verification passed, and representative-content resolution now rejects utility/profile/category/comment anchors while preferring article-like content links.
- Browser Bridge status: `/browser-action/extension/poll` refreshes daemon-visible active-tab URL/title/tab/window/permission, reducing stale snapshot decisions between heartbeat updates.
- UX cleanup: failed, clarification, and extension-pending prompt responses now return clearer user-facing text instead of raw execution receipts; successful read/show flows still render page observations.
- Verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, Browser Action core/e2e/prompt-classification smokes, Browser Bridge/extension smokes, Semantic Interface/Memory smokes, and the Browser Action/Semantic dogfood scripts.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting so Chrome/Edge uses the updated service worker and bridge modules.

## Latest Update: iter-14 Browser Action Semantic Target Pipeline

Completed `iter-14` through `$vibe-iterate` after live dogfood exposed that `새 채팅 눌러줘` failed as a low-confidence side-effect action. The failure was not that Browser Action could not use Vision-style graph/resolver concepts; it was that Browser Action still had a regex-only prompt parser and a shallow target ranker that let broad DOM containers compete with the intended actionable element.

Implemented the Vision Context-inspired split:

- `src/daemon/browser-action/intentResolver.ts` owns executable prompt intent, Korean command suffix stripping, and target phrase extraction.
- `src/daemon/browser-action/targetLexicon.ts` owns target normalization, compact Korean label matching, aliases, and tokenization.
- `targetResolver` now expands aliases, uses CJK-aware tokens, and caps non-actionable container candidates so links/buttons/inputs win over sidebar/page regions.
- Browser Bridge auto-observe now posts snapshots to the daemon over HTTP before falling back to native host, avoiding a native-host-only success path that can leave the daemon's DOM snapshot empty.

Verification passed `npm run lint`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:extension`, `npm run smoke:browser-bridge`, `npm run smoke:dom`, `npm run smoke:browser-native-host`, `git diff --check`, UTF-8/mojibake checks, and `npm run vibe:checkpoint`. Dev services and the Tauri widget process were restarted; `/storage/health` is ready on `127.0.0.1:4128`. The unpacked browser extension must be reloaded once for the service-worker auto-observe transport change to affect the live browser.

Follow-up Browser Bridge setting added: the extension popup/options now include `Allow all sites except blocklist`. Turning it on requests Chrome/Edge optional host permissions for `http://*/*` and `https://*/*`; the service worker then allows all supported sites except entries in `observeBlocklist`. Blocklist entries accept origins/hosts such as `https://private.example`, `example.com`, or `*.example.com`.

Live DCInside prompt fix: `개념글 눌러서 재밌어보이는 글 보여줘` now extracts `개념글` as the click target. Browser Bridge also captures `[onclick]`/`[tabindex]` controls and prioritizes visible actionable DOM elements before applying the element cap so hidden DCInside settings/overlay controls do not crowd out real page tabs.

## Latest Update: Semantic Interface Accuracy Handoff Amendment

After reviewing OpenAI Privacy Filter and running a Codex/Claude accuracy debate, `docs/plans/semantic-interface-handoff.md` was updated before implementation. The decision is to keep the current graph/affordance `semantic-interface` architecture, not replace it with Privacy Filter-style token span labeling, but to promote selected Privacy Filter reliability patterns to v1 requirements.

The handoff now requires `RedactedTraceRecord`, `StepTransitionGrammar`, `OperatingProfile`, `SemanticDecisionOutcome`, and typed/untyped/adversarial eval modes. V1 calibration is defined as evidence-profile gating plus top-vs-runner-up margin and typed abstention, with statistical calibration deferred until a held-out trace set exists. The golden trace suite must cover duplicate labels, hydration drift, ARIA/visible mismatch, offscreen/occluded targets, i18n aliases, dynamic id churn, shadow DOM boundaries, and nested form scope. Under-evidenced side-effect resolution must return `abstain` or clarification rather than fabricating confidence.

## Latest Update: iter-15 Semantic Interface Started

Iteration `iter-15` is active. It follows `docs/plans/semantic-interface-handoff.md` and carries forward iter-14's Browser Action semantic target improvements into a reusable daemon-side `semantic-interface` module. Planned sprint order:

- `iter-15-sprint-01-type-surface-golden-traces`
- `iter-15-sprint-02-browser-action-shadow-and-redacted-traces`
- `iter-15-sprint-03-vision-read-locate-conformance`
- `iter-15-sprint-04-low-risk-browser-live-gate-and-completion`

Current sprint: `iter-15-sprint-01-type-surface-golden-traces`. Browser Action live behavior must remain unchanged during Sprint 01; the first implementation is type surface, deterministic ranker/replay, transition grammar, operating profiles, redacted traces, Browser Action adapter conversion, and golden trace smoke coverage.

## Latest Update: Architecture Foundation Consolidation

Completed Iteration `iter-21` for architecture/process consolidation.

- Added sharded current architecture docs under `docs/architecture/`, covering runtime boundaries, capability transactions, prepared context, safety policy, agent tool runtime, renderer boundary, semantic interface, and testing/observability.
- Moved completed Browser Action/Semantic handoff files into `docs/plans/deprecated/` and added `docs/plans/README.md` so old handoffs are tombstoned rather than treated as active architecture authority.
- Added shared daemon foundations:
  - `src/daemon/capability-transaction/`
  - `src/daemon/prepared-context/`
  - `src/daemon/safety/`
  - `src/daemon/agent-tools/`
- Browser Action now records shared capability transaction snapshots/timings, shared prepared-context lease metadata, shared safety-decision metadata, simulated agent-tool invocation metadata, and redacted debug bundles for non-completed prompt transactions.
- Semantic Interface gained a generic `preparedContextToSemanticSnapshot()` adapter so prepared contexts can become source-agnostic semantic evidence.
- Vision TaskCapsules and Terminal state gained shared prepared-context adapters, and Terminal destructive command gating now uses the shared safety kernel.
- Added `docs/architecture/surface-control.md` plus a shared surface-control stage model for Browser, Vision, Terminal, Workspace, and bounded Desktop automation.
- Renderer decomposition continued with `useWidgetRuntimeDerivedState`, moving derived runtime display state out of `WidgetRuntime.tsx`.
- Live Browser Action report artifacts are ignored by default; curated evidence should still be promoted to tracked reports explicitly.
- Added `npm run smoke:architecture-foundations` and included it in `smoke:all`.

Verification passed `npm run lint`, `npm run smoke:architecture-foundations`, `npm run smoke:terminal`, `npm run smoke:browser-action`, `npm run smoke:browser-interaction-transaction`, `npm run smoke:browser-perception`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:renderer`, and final `npm run smoke:all`.

## Latest Update: iter-22 P0/P1 Priority Closure

Completed the current P0/P1 follow-up set after architecture consolidation.

- Browser Bridge now reports extension build id, source hash, runtime id, daemon expected build/hash, and `reloadRequired` so stale unpacked extension code is visible before live-site retesting.
- Browser Action now emits `browserAction.diagnostics` events with timing summaries and redacted debug-bundle metadata for non-completed prompt transactions.
- Ambiguous Browser Action clarification choices can render redacted bbox previews in the renderer, improving target selection without persisting full sensitive page state.
- Screen snapshots now project into shared prepared-context identity/freshness/digest summaries, joining the existing Vision TaskCapsule and Terminal state adapters.
- `WidgetRuntime` prompt submission/focus/key handling moved into `usePromptSubmission`, continuing renderer decomposition.
- Added `docs/dogfood/semantic-trace-corpus.jsonl`, semantic golden-trace metric summarization, and `npm run smoke:semantic-trace-corpus`.

Verification passed `npm run build:web`, `npm run smoke:all`, `git diff --check`, UTF-8/mojibake checks, project report refresh, and `npm run vibe:checkpoint`. The live dev runtime was restarted; renderer is listening on `127.0.0.1:5173`, daemon health is ok on `127.0.0.1:4128`, and the Tauri widget is running.

## Latest Update: iter-23 Post-Priority Hardening

Completed the requested follow-up order `4 -> 1 -> 2 -> 3 -> newly found improvements -> remaining items`.

- Renderer decomposition: `useChatSessionController` now delegates assistant stream/typewriter state to `useAssistantMessageStream` and reuses `useDismissableOverlay` for action-menu/session-trash dismissal.
- Live semantic feedback: added `docs/dogfood/browser-action-semantic-live-corpus.jsonl` plus `npm run smoke:browser-action:semantic-live-corpus`, referencing reviewed Browser Action live report rows without raw screenshots/page dumps.
- Browser Bridge reload UX: popup now exposes `Reload bridge` when stale extension code is detected and calls `chrome.runtime.reload()`.
- Debug export: Browser Action summary/diagnostics blocks can copy or download JSON from the renderer.
- Verification-noise fixes: Vite renderer vendor chunking removes the >500KB JS chunk warning, `smoke:all` suppresses Node SQLite experimental warning noise, and smoke temp cleanup now schedules deferred retry after Windows `EPERM`.
- Remaining feasible/BLOCKED items: app-server client-tool BLOCKED contract is encoded in `src/daemon/agent-tools/appServerClientTool.ts`; `docs/architecture/open-blockers.md` records external blockers; Vision ASR sidecar command execution is implemented behind `CODEX_WIDGET_ASR_SIDECAR_COMMAND`; restricted-page recovery text is clearer.

Verification passed `npm run lint`, `npm run build:web`, `npm run smoke:browser-action:semantic-live-corpus`, `npm run smoke:vision-context`, `npm run smoke:extension`, `npm run smoke:architecture-foundations`, `npm run smoke:browser-action:renderer`, final `npm run smoke:all`, `git diff --check`, UTF-8/mojibake checks, project report refresh, and `npm run vibe:checkpoint`. The live dev runtime was restarted; renderer is listening on `127.0.0.1:5173`, daemon health is ok on `127.0.0.1:4128`, and the Tauri widget is running.

## Latest Update: iter-24 Browser Action Reliability Foundation Started

Iteration `iter-24` was started with `docs/plans/browser-action-reliability-foundation-handoff.md` as the current handoff. The goal covers ten workstreams: runtime stabilization, verification v2, intent transaction hardening, live test harness, perception scheduler, Semantic Interface v2, Semantic Memory feedback, UX simplification, app-server/tool contract, and architecture boundary cleanup.

Sprint 01 completed the first reliability slice:

- Added the active handoff and iter-24 roadmap entries.
- Browser Bridge popup/options default fixes and daemon-reported reload status are in the working tree from the current live-debug pass.
- History navigation source mismatch and prompt-step retry handling now avoid double-running `back`/`forward`/`reload`.
- Navigate verification now fails if the requested destination was not reached, instead of accepting arbitrary route/view changes.
- Browser Action feedback-only prompts such as history behavior complaints no longer execute as browser commands.
- Explicit recovery history commands are parsed before generic content-open click phrases.
- Long numeric content references such as `1174404번글` are treated as content identifiers, not ordinal positions.
- Representative content candidate generation now prefers main/unknown content landmarks and excludes navigation/sidebar/header/footer links when real content candidates exist.
- Added `npm run smoke:browser-action:live-harness` to verify live-runner dry-run scenario/report artifacts and included it in `smoke:all`.

Focused verification passed: `npm run build:daemon`, `npm run smoke:browser-action:transaction-verification`, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-action:transaction-concurrency`, `node scripts/smoke-browser-interaction-transaction.mjs core`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-perception`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-perception:stabilization`, `npm run smoke:semantic-interface`, `npm run smoke:semantic-memory`, `npm run smoke:extension`, `npm run smoke:architecture-foundations`, `npm run smoke:browser-action:live-harness`, and `npm run lint`.

Final aggregate verification for the sprint also passed `npm run build:web`, `npm run smoke`, and `npm run smoke:all`. During the first aggregate run, `smoke-browser-action-cdp.mjs` exposed a Windows temp profile cleanup race (`Cookies-journal` EBUSY) after the CDP checks passed; the CDP smoke now reuses the shared deferred smoke temp cleanup helper.

This was the sprint-01 status at the time; iter-24 is now completed by the later completion-audit entry below.

## Latest Update: iter-24 Scheduler, Memory, Tool Contract, Boundary Progress

Continued the active Browser Action Reliability Foundation.

- Browser Perception Scheduler now queues bounded background `observe_now` commands from Browser Bridge heartbeat, HTTP poll, and WebSocket command-poll status when the active tab is connected and allowed but no fresh prepared context exists.
- Background observe commands are deduped across queued, foreground-waiting, and extension-in-flight states. Foreground prompt/direct observe commands now outrank queued background work, and successful background observe results are ingested even when no waiter is attached.
- Semantic Memory feedback now affects Browser Action candidate ranking as a bounded advisory signal. It can reorder equally supported current-view candidates but cannot bypass freshness, visibility, safety, approval, or current view evidence.
- Browser Action simulated agent-tool integration now has a normalized `AgentToolResult` projection for result/error/approval-compatible future app-server tool adoption.
- `smoke:architecture-foundations` now checks source-size budgets for key Browser Action, Browser Perception, renderer runtime, and extension bridge files to catch giant-file regressions.

Focused verification passed `npm run build:daemon`, `npm run smoke:browser-perception`, `npm run smoke:browser-perception:extension-command`, `node scripts/smoke-browser-interaction-transaction.mjs core`, `npm run smoke:semantic-interface`, `npm run smoke:semantic-memory`, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-action:transaction-verification`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:fresh-context`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:architecture-foundations`, and `npm run smoke:browser-action`.

Aggregate verification also passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:browser-action:live-harness`, `npm run smoke:browser-bridge`, final `npm run smoke:all`, `git diff --check`, mojibake scan for changed files, project report refresh, and `npm run vibe:checkpoint`.

This was the mid-iteration status at the time; iter-24 is now completed by the later completion-audit entry below.

## Latest Update: iter-24 Browser Action Reliability Foundation Complete

Completed the active Browser Action Reliability Foundation goal across the ten requested workstreams.

- Runtime stabilization, verification v2, intent transaction hardening, live test harness, Browser Perception scheduling, Semantic Interface v2 integration, Semantic Memory feedback, UX simplification, app-server/tool contract boundary, and architecture cleanup are mapped to concrete evidence in `docs/reports/browser-action-reliability-completion-audit-2026-05-11.md`.
- Browser Perception schedules background `observe_now` commands from bridge heartbeat, HTTP poll, and WebSocket poll state; foreground prompt/direct observes outrank background work; successful no-waiter background observe results refresh prepared active-tab context.
- Semantic Memory contributes bounded advisory candidate-ranking evidence and remains unable to override freshness, visibility, safety, approval, or current-view evidence.
- Browser Action simulated tool results normalize into a shared `AgentToolResult` contract while official app-server client-tool integration stays explicitly BLOCKED on a stable external contract.
- Architecture foundations smoke now enforces source-size budgets for key Browser Action, Browser Perception, renderer runtime, and extension bridge files.
- Isolated live dogfood `iter24-scheduler-memory-isolated-20260511` passed 8/8 scenarios, with tracked semantic-live corpus rows added for representative content, prepared read, history navigation, and forward navigation.

Verification for closure passed lint, build:web, smoke, smoke:all, Browser Action/Perception/Bridge/Extension/Semantic/App-server focused smokes, live harness smoke, semantic live corpus smoke, isolated live dogfood, git diff check, mojibake scan, project report refresh, and checkpoint. Reload the unpacked Browser Bridge extension once before manual live-site retesting so Chrome/Edge uses the updated popup/service-worker files.

## Latest Update: iter-25 Browser Native Desktop Helper Complete

Implemented the bounded Windows UI Automation helper requested after the Browser Action reliability foundation.

- Added `providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`, implementing the existing `browser-native-desktop-helper.v1` stdin/stdout JSON contract for `status`, `observe`, and bounded `execute`.
- The helper enumerates browser windows, observes UIA controls with role/label/selector/bbox metadata, executes browser-window scoped read/click/type/check/select/scroll/navigate/back/forward/reload actions, blocks `evaluate`, and rejects sensitive password/token/cookie/payment-like text.
- `nativeDesktopAdapter` now auto-discovers the bundled helper when `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP=1` and `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER` is unset, while still honoring an explicit helper path.
- Added `npm run smoke:browser-native-desktop-helper` and `npm run smoke:browser-native-desktop-helper:live`; the live smoke launches an isolated Chrome/Edge profile, verifies UIA observation, and executes bounded reload.
- Registered the helper as a Tauri bundle resource and updated architecture/blocker docs. The former UIA-helper BLOCKED item is now reduced to a future signed Rust/.NET/native hardening track.

Verification passed `npm run smoke:browser-native-desktop-helper`, `npm run smoke:browser-native-desktop-helper:live`, `npm run smoke:browser-action:native`, `npm run lint`, and `npm run smoke:all`. The live helper smoke may emit the standard Windows deferred temp cleanup warning after killing the isolated browser profile.

## Latest Update: iter-26 Browser Native Desktop Helper Hardening Complete

Implemented the Rust native helper hardening track requested after iter-25.

- Added `providers/browser-native-desktop-helper-rs/`, a Rust Windows UI Automation helper implementing the existing `browser-native-desktop-helper.v1` stdin/stdout JSON contract.
- The native helper supports `status`, `observe`, safe `read`, bounded click/type/select/check/scroll/navigation commands, rejects `evaluate`, and blocks/redacts password/token/cookie/payment-like text.
- Added `npm run build:browser-native-desktop-helper`, which builds the Rust helper and copies it to `dist/browser-native-desktop-helper/browser-native-desktop-helper.exe`.
- Added `npm run sign:browser-native-desktop-helper` for future `signtool.exe` signing when a certificate is configured, plus `npm run smoke:browser-native-desktop-helper:signature` to enforce signed helpers under `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1`.
- Updated daemon helper discovery to prefer explicit `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER`, then bundled Rust helper, then PowerShell fallback.
- Registered `../dist/browser-native-desktop-helper` as a Tauri resource and kept the PowerShell helper packaged as a development/debug fallback.
- Wrote `docs/plans/browser-native-desktop-helper-hardening-handoff.md` and `docs/reports/browser-native-desktop-helper-hardening-audit-2026-05-12.md`.

Verification passed `cargo check --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml`, `npm run build:browser-native-desktop-helper`, `npm run sign:browser-native-desktop-helper` (skipped because signing env is unset), `npm run smoke:browser-native-desktop-helper-native`, `npm run smoke:browser-native-desktop-helper:signature`, `npm run smoke:browser-native-desktop-helper`, `npm run smoke:browser-action:native`, `npm run lint`, `npm run build:web`, and `npm run smoke:all`.

Remaining blocker: actual Authenticode signing requires a code-signing certificate or CI signing service. Once available, set `CODEX_WIDGET_SIGN_HELPERS=1` plus certificate env vars for signing and `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1` for release enforcement.

Runtime state: dev daemon and renderer were restarted after the helper/Tauri resource changes; daemon health is ok on `127.0.0.1:4128`, renderer responds on `127.0.0.1:5173`, widget PID is `101648`, and logs are under `dist/logs/dev-runtime-native-helper-hardening-20260512b.log`.

## Latest Update: Browser Action Latency Optimization

Implemented the requested Browser Action speed roadmap slice after reviewing the prompt -> perception -> extension -> verification path.

- Added fine-grained Browser Interaction timing marks for prompt planning, fresh-context wait, observation recording, plan execution, extension command wait, and follow-up extension command wait.
- Targetless `navigate` / `back` / `forward` / `reload` prompts now use Browser Bridge active-tab metadata as a lightweight source snapshot when possible, avoiding request-time DOM observe before browser-history/navigation commands.
- Browser Bridge extension commands now attach redacted latency traces to observe/action results, use lightweight tab snapshots for tab-navigation actions, shorten stable/post-action snapshot polling, and allow tab-navigation execution before DOM injection checks.
- Browser Perception background observe defaults are hotter and shorter, WebSocket command-poll wait is lower, extension wake retries are earlier, and normal auto-observe refresh no longer posts a heavy legacy DOM snapshot before command-first perception can run.
- Background observe results refresh in-memory prepared context without writing every background observation into provider snapshot history or broadcasting a ledger update; foreground/explicit observations still persist normally.
- E2E smoke now covers fast history navigation from Browser Bridge active-tab state and asserts transaction timing diagnostics.

Verification passed `npm run lint`, `npm run build:daemon`, `npm run build:web`, `npm run smoke`, Browser Action focused smokes, Browser Perception/View Graph/Bridge/Extension/DOM smokes, transaction smokes, app-server smoke, Playwright/CDP/evaluate/native adapter smokes, and final `npm run smoke:all`. Project report and checkpoint were refreshed. Live dev runtime was restarted; daemon is healthy on `127.0.0.1:4128`, Vite is listening on `127.0.0.1:5173`, widget PID is `86152`, and logs are under `dist/logs/dev-runtime-latency-optimization-20260512.log`. Reload the unpacked Browser Bridge extension once before manual browser-action retesting.

## Latest Update: Windows Computer Use Daemon Foundation Handoff

Added `docs/plans/windows-computer-use-daemon-foundation-handoff.md` as the proposed design handoff for the daemon-side foundation needed before broader Windows computer-use work.

- The design keeps the daemon as the local control plane and explicitly avoids a helper-to-helper invocation mesh or external broker.
- It defines durable capability jobs, helper process supervision, resource/blob offload, concurrency scheduling, cancellation, common capability events, shared approval/safety, context leases, verification/evidence, restart reconciliation, and a migration path from existing Browser Action/Vision/Terminal flows.
- `docs/plans/README.md` now links the new proposed handoff.

Open risks: the handoff is planning-only; no runtime code or storage migration has been implemented yet. The first implementation slice should add a capability runtime skeleton, SQLite migration, event contract, and a read-only screen/OCR wrapper before moving side-effecting desktop/browser actions.

## Latest Update: Windows Computer Use Daemon Foundation Implemented

Implemented the first daemon-owned capability runtime slice from `docs/plans/windows-computer-use-daemon-foundation-handoff.md`.

- Added shared capability protocol events/messages, WebSocket handlers, and HTTP diagnostics routes for `capability.start`, `capability.cancel`, job listing, and job detail/resource inspection.
- Added SQLite schema v3 plus storage APIs for durable capability jobs, job events, resources, startup reconciliation, shutdown cancellation, and blob-backed resource records.
- Added `src/daemon/capability-runtime/` with durable queue, scheduler, cancellation registry, helper supervisor, resource manager, safety gate, runtime, and renderer event mapper.
- Wired the daemon to instantiate the runtime, emit capability events to connected clients, reconcile jobs on startup, and shut down active jobs through the runtime before closing storage.
- Routed direct `screen_observe` and existing `provider.captureScreen` through capability jobs, added a native `desktop_action` handler over the existing bounded browser-native desktop helper, and kept Browser Action APIs compatible during migration.
- Added a foundation safety policy: read-only screen/OCR/observe work can run automatically; desktop/browser/terminal/tool side effects default to `awaiting_approval` even when the caller omits `requireApproval`.
- Added lease-key serialization through the scheduler so same-surface jobs do not run concurrently when a caller supplies a `leaseId`/`lockKey`.
- Added `scripts/smoke-capability-runtime.mjs` and included it in `smoke:all`; it covers queue completion, approval denial, helper-supervised OCR, helper timeout, helper cancellation/kill, blob resources, same-lease serialization, startup reconciliation, shutdown cancellation, and schema version 3.

Verification passed `npm run smoke:capability-runtime`, `npm run smoke:storage`, `npm run smoke:screen`, `npm run smoke:ocr-runtime`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-native-desktop-helper-native`, `npm run smoke:terminal`, `npm run lint`, final `npm run smoke:all`, `git diff --check`, strict UTF-8 decoding for 36 touched files, and replacement-character scan. The `file` command is unavailable in this Windows PowerShell environment, so UTF-8 validation used .NET strict decoding instead.

Remaining migration follow-ups: Browser Action should dual-emit/store its internal queued commands as capability jobs, browser chrome/bookmark helpers still need concrete implementation, context leases/per-surface locks need deeper adapter-specific keys, and verification/evidence classes are still foundation-level rather than full effect-specific proof.

## Latest Update: Windows Computer Use Daemon Foundation Browser/Terminal/Tool Migration

Extended the daemon-owned capability runtime beyond the initial foundation slice.

- Browser Action now dual-writes and dual-emits capability jobs for approvals, queued extension commands, extension pickup/running transitions, results, observes, and failures while keeping existing Browser Action APIs compatible.
- Added `browser_chrome` capability routing through the Browser Bridge extension with bookmark list/create/update/remove/open support, result callbacks, audited side-effect approval, and Chrome/Edge extension `bookmarks` permission docs/smokes.
- Added supervised `terminal` capability execution for approved one-shot shell commands, using the shared helper supervisor timeout/cancel/stdout/stderr/diagnostics path.
- Added `agent_tool` capability boundary jobs for the supported simulated daemon runtime and explicit app-server client-tool BLOCKED contract reporting, without adding arbitrary tool execution.
- Added helper diagnostics, verification summaries, resource accounting, ephemeral cleanup reporting, and focused smokes for browser chrome, terminal, and agent-tool capability paths.
- Split Browser Bridge browser-chrome/bookmark execution into `providers/browser-dom-extension/bridge/browser-chrome.js` so `action-channel.js` stays below the architecture source-size budget.

Verification passed `npm run build:daemon`, `npm run smoke:terminal-capability`, `npm run smoke:agent-tool-capability`, `npm run lint`, direct capability smokes, `npm run smoke:browser-action`, `npm run smoke:storage`, `npm run smoke:extension`, `npm run smoke:browser-store`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:architecture-foundations`, final `npm run smoke:all`, `git diff --check`, strict UTF-8 decoding for 63 touched text files, replacement-character scan for 63 touched text files, `.cs` touched-file check, and `npm run vibe:checkpoint`. `git diff --check` emitted only existing CRLF normalization warnings for `src/daemon/server.ts` and `src/daemon/storage/storage.ts`.

## Latest Update: Windows Computer Use Daemon Foundation Audited Complete

Completed the post-implementation audit pass against `docs/plans/windows-computer-use-daemon-foundation-handoff.md` and closed the remaining foundation gaps found during the audit.

- Added durable `capability_locks` storage APIs, runtime lock acquire/release, HTTP diagnostics lock reporting, and smoke coverage for lock persistence/release.
- Added runtime priority dispatch so queued interactive capability work starts before lower-priority background work when capacity frees.
- Added context lease expiry/mismatch validation before execution and before verification, plus approval deadline expiry handling.
- Added daemon-level `ocr` capability handling with bounded helper command support, capped text previews, and optional full-text blob evidence; included it in `smoke:all`.
- Added recursive sensitive-input redaction before capability persistence and credential-like terminal command rejection before execution.
- Added final capability-state activity records for session ledgers.
- Updated Browser Action command waiter shutdown clearing to resolve pending prompt waiters with `undefined`, allowing cancellation/failure continuation paths to complete.
- Strengthened verification summaries with failure classes and required explicit effect proof for desktop actions that declare `expectedEffect`/`expectedState`.
- Wrote `docs/reports/windows-computer-use-daemon-foundation-completion-audit-2026-05-12.md`, mapping handoff requirements to implementation evidence.

Final verification passed `npm run lint`, `npm run smoke:architecture-foundations`, final `npm run smoke:all`, `git diff --check`, strict UTF-8 decoding for 66 touched text files, replacement-character scan for 66 touched text files, `.cs` touched-file check, and `npm run vibe:checkpoint`. `git diff --check` emitted only CRLF normalization warnings for `src/daemon/server.ts` and `src/daemon/storage/storage.ts`.

## Latest Update: Capability Jobs Panel and Windows Dogfood Matrix

Implemented the recommended follow-up order after the daemon foundation: a renderer Capability Jobs MVP first, then a safe Windows high-risk dogfood matrix and evidence collector.

- Added renderer state and event handling for `capability.jobs`, `capability.job`, and `capability.resource` events.
- Added `CapabilityJobsPanel` inside the Activity details popover. It lists recent capability jobs, shows status/kind/priority/requested-by metrics, displays recent events/resources, fetches `/capabilities/jobs/:id` detail JSON, supports refresh/copy JSON, and exposes approve/cancel controls for eligible jobs.
- Wired capability job refresh/cancel/approve through existing daemon WebSocket messages and included job count in the Activity badge.
- Added `docs/plans/windows-computer-use-high-risk-dogfood-matrix.md` with read-only, reversible side-effect, high-risk, credential-sensitive, and destructive scenario classes.
- Added `npm run dogfood:windows-computer-use`, which runs a safe baseline collector: Windows theme registry read-only evidence, simulated Browser Chrome bookmark CRUD through the daemon command bridge, and credential-like terminal command rejection before persistence.
- Generated `docs/reports/windows-computer-use-high-risk-dogfood-2026-05-12.md` and JSON evidence under `docs/reports/assets/windows-computer-use-high-risk-dogfood-2026-05-12/`.

Verification passed `npm run lint`, `npm run build:renderer`, `npm run dogfood:windows-computer-use`, `npm run smoke:capability-runtime`, `npm run smoke:browser-chrome-capability`, `npm run smoke:terminal-capability`, `npm run smoke:agent-tool-capability`, final `npm run smoke:all`, `git diff --check`, strict UTF-8 decoding for touched files, replacement-character scan, quoted-question mojibake scan, `.cs` touched-file check, and `npm run vibe:checkpoint`. `git diff --check` emitted only the existing CRLF normalization warnings for `src/daemon/server.ts` and `src/daemon/storage/storage.ts`.

Runtime state: the dev widget is running. Renderer/Vite listens on `127.0.0.1:5173` (PID `102756`), daemon listens on `127.0.0.1:4128` (PID `81472`), and Tauri widget PID is `121300`. Two safe OCR seed jobs exist in the live daemon so the new Capability Jobs panel has visible rows; use Activity details -> Capability Jobs -> refresh if the panel opened before the events arrived.

## Latest Update: Push/Refactor Prep

Prepared and pushed the current working tree on `main`.

- Added `docs/plans/post-daemon-foundation-refactor-prep.md` to define the next behavior-preserving refactor pass.
- The recommended refactor order is daemon capability registration extraction, Activity/Capability stylesheet split, optional renderer capability hook extraction, then separate live dogfood expansion.
- The prep explicitly keeps live Windows OS mutation and release signing hardening out of the first refactor pass.
- Pushed implementation commit `98096d8` (`Add Windows computer-use capability foundation`) to `origin/main`.

Verification from the previous closure remains valid: `npm run lint`, `npm run build:renderer`, `npm run dogfood:windows-computer-use`, focused capability smokes, `npm run smoke:all`, `git diff --check`, UTF-8/mojibake scans, and `npm run vibe:checkpoint` passed.

## Latest Update: Capability Foundation Refactor Pass

Completed the behavior-preserving refactor pass from `docs/plans/post-daemon-foundation-refactor-prep.md`.

- Extracted daemon capability registration out of `src/daemon/server.ts` into `src/daemon/capabilities/registerCapabilities.ts`; `server.ts` now wires the runtime and bridge dependencies instead of owning every capability handler inline.
- Split Activity/Capability UI rules out of `src/renderer/styles/composer-activity-mascot.css` into `src/renderer/styles/activity-capability.css`, leaving composer/mascot rules scoped to that file.
- Extracted renderer Capability Jobs state/actions into `src/renderer/hooks/useCapabilityJobsController.ts`; `WidgetRuntime.tsx` now keeps the event-handler injection but no longer owns refresh/cancel/approve implementations inline.
- Architecture budgets now have more headroom: `src/daemon/server.ts` is 164 lines and `src/renderer/WidgetRuntime.tsx` is 665 lines after the split.

Verification passed `npm run build:daemon`, `npm run build:renderer`, `npm run lint`, `npm run smoke:architecture-foundations`, focused capability smokes (`capability-runtime`, `browser-chrome-capability`, `ocr-capability`, `terminal-capability`, `agent-tool-capability`), final `npm run smoke:all`, `git diff --check`, strict UTF-8 decoding for touched files, and mojibake scans. `git diff --check` emitted only the existing CRLF normalization warning for `src/daemon/server.ts`; the `file` utility is unavailable in this Windows PowerShell environment, so strict .NET UTF-8 decoding was used as fallback.

Runtime state: dev-hot is running. Renderer/Vite listens on `127.0.0.1:5173` (PID `102756`), daemon health is ok on `127.0.0.1:4128` (PID `74232`), and the Tauri widget remains running as PID `121300`. Use `npm run dev` for a full restart if the Tauri shell itself needs to be relaunched.

Pushed refactor commit `592b2ba` (`Refactor capability foundation wiring`) to `origin/main`.

## Latest Update: Research Performance Architecture A-F Implementation

Implemented the full research-driven performance architecture substrate from
`docs/plans/research-driven-performance-architecture-handoff.md` across
workstreams A-F.

- Added storage schema v4 and daemon storage APIs for unified computer-use eval
  runs/steps/resources, perception graphs, structured failure memory, and
  capability DAG runs/nodes.
- Added shared research architecture protocol types and HTTP debug/readiness
  routes under `/computer-use/eval/*`, `/computer-use/perception-graphs`, and
  `/computer-use/failure-memory`.
- Added eval import/rollup scripts for Browser Action live corpus, semantic
  trace corpus, and Windows high-risk dogfood evidence.
- Added deterministic ASR command decoder with contextual lexicon, Korean/English
  aliases, command-slot scoring, slot preservation confidence, and
  side-effect-risk clarification.
- Added perception graph builders for Browser observations and OCR text, then
  migrated Browser Action target resolution to graph threshold explanations.
- Added ROI/delta perception cascade helpers and wired `screen_observe`/`ocr`
  capabilities to tile hashes, dirty regions, cascade stage summaries, and OCR
  perception graph recording.
- Added structured failure memory with bounded calibration hints that never
  become proof, approval bypass, or task-completion authority.
- Added incremental capability DAG runtime on top of existing capability jobs,
  with parallel observe fan-out, local DAG nodes, capability job linkage,
  cancellation-compatible status, and eval ledger integration.
- Capability runtime now auto-creates eval runs for generic jobs without an
  `evalRunId`, records per-event eval steps, finalizes runs on terminal job
  events, and links capability resources into eval resources.
- Wrote `docs/architecture/research-performance-architecture.md` and updated
  architecture/QA/open-blocker docs.

Verification passed `npm run lint`, `npm run build:daemon`,
`npm run build:web`, `npm run smoke:architecture-foundations`,
`npm run smoke:capability-runtime`, `npm run smoke:browser-action`,
`npm run smoke:vision-context`, `npm run smoke:asr-runtime-candidates`,
`npm run smoke:research-performance-architecture`, final `npm run smoke:all`,
`git diff --check`, strict UTF-8 decoding for 31 touched files, quoted-question
mojibake scan, and `.cs` touched-file check. `file` is unavailable in this
Windows PowerShell environment, so strict .NET UTF-8 decoding was used as the
encoding fallback. `git diff --check` emitted only the existing CRLF
normalization warning for `src/daemon/storage/storage.ts`; `smoke:all` emitted
one standard deferred Windows temp cleanup retry.

Remaining explicit non-completed items: official app-server client-tool
contract, production signing certificate/service, GPU ASR validation, human
microphone corpus benchmark, and ASR fine-tuning/LoRA.

## Latest Update: Research Computer-Use Scenario Dogfood

Added and executed a realistic safe computer-use scenario suite to validate the
research performance architecture against workflow-shaped cases rather than only
unit-like smoke coverage.

- Added `npm run dogfood:research-computer-use` backed by
  `scripts/collect-research-computer-use-scenarios.mjs`.
- Generated `docs/dogfood/research-computer-use-scenarios-2026-05-14.json`.
- Generated `docs/reports/research-computer-use-scenarios-2026-05-14.md` and
  JSON evidence under
  `docs/reports/assets/research-computer-use-scenarios-2026-05-14/evidence.json`.
- Scenario coverage:
  - Korean ASR browser search with deterministic command-slot decode,
    perception graph target explanation, ROI cascade, and approval-gated
    Browser Action capability.
  - Browser Chrome bookmark list/open with approval-required side effect.
  - Windows Settings observation with high-risk Reset target rejection and
    structured failure memory calibration.
  - Terminal safe command execution plus credential-like command rejection before
    persistence.
  - Cross-app capability DAG with setup, parallel observe/OCR, graph merge, plan,
    approval, agent-tool action, verification, and eval ledger nodes.
- Scenario metrics recorded 5/5 passed scenarios, 6 eval runs, all modalities
  covered (`asr`, `browser`, `cross_app`, `terminal`, `vision`, `windows`),
  task success rate 1.000, proof rate 1.000, p95 latency 256 ms, and p95
  perception latency 58 ms.
- Registered the new dogfood command in
  `docs/architecture/research-performance-architecture.md` and
  `docs/context/qa.md`.

Verification passed `npm run dogfood:research-computer-use`, `npm run lint`,
`npm run smoke:research-performance-architecture`, `npm run smoke:vision-context`,
final `npm run smoke:all`, `git diff --check`, strict UTF-8 decoding for 38
touched files, quoted-question mojibake scan, and `.cs` touched-file check.
Known non-failing noise: Node SQLite experimental warning, unsigned helper notice
in development mode, existing CRLF normalization warnings, and one standard
deferred Windows temp cleanup retry.

## Latest Update: 30-Case Computer-Use Process Validation

Added and executed the requested 30-case process validation suite that treats
each item as a user-facing widget scenario and records the required fields:
user scenario, architecture workflow, success status, and follow-up work.

- Added `npm run dogfood:computer-use-process-30` backed by
  `scripts/collect-computer-use-process-validation-30.mjs`.
- Generated `docs/dogfood/computer-use-process-validation-30-2026-05-14.json`.
- Generated `docs/reports/computer-use-process-validation-30-2026-05-14.md` and
  JSON evidence under
  `docs/reports/assets/computer-use-process-validation-30-2026-05-14/evidence.json`.
- Results: 30 scenarios recorded, 18 passed, 10 intentionally BLOCKED, 2
  needs-follow-up, 0 unexpected failures.
- Coverage includes Browser search/action/bookmark/restricted surfaces,
  permission/file-picker/download gaps, Windows Settings/app/file-explorer
  workflows, Vision OCR/ROI/cache/VLM fallback, ASR alias/clarification cases,
  Terminal approval/credential/cancel cases, cross-app DAG execution, and the
  app-server custom tool contract blocker.
- Evidence summary: 40 eval runs, 10 perception graphs, 15 structured failure
  memory records, 7 eval resources, 1 DAG run, task success rate 0.692, proof
  rate 0.308, p95 latency 141 ms, and p95 perception latency 40 ms.
- Separate improvement items found during testing were recorded in the report,
  including process-validation UI, live trace calibration, print-to-PDF/download
  verifier, permission/file-picker native helper coverage, reversible Windows
  workflows, real cascade timing, flakiness classifier, renderer failure-memory
  visibility, terminal package-manager policy, and official app-server
  custom-tool integration.

Verification passed `npm run dogfood:computer-use-process-30`, `npm run lint`,
`npm run smoke:research-performance-architecture`, final `npm run smoke:all`,
`git diff --check`, strict UTF-8 decoding for 42 touched files, quoted-question
mojibake scan, and `.cs` touched-file check. Known non-failing noise remains the
Node SQLite experimental warning, unsigned helper notice in development mode,
existing CRLF normalization warnings, and one deferred Windows temp cleanup
retry.

## Latest Update: Scoped Autonomy Toolsmith Foundation

Implemented the permission-scoped self-implementation foundation requested after
the computer-use process validation exposed missing-capability limits.

- Added `docs/plans/scoped-autonomy-toolsmith-runtime-handoff.md` as the
  detailed design handoff for Codex-YOLO-like scoped autonomy.
- Added shared protocol types in `src/shared/protocol/scopedAutonomy.ts`.
- Added storage schema v5 and storage facade APIs for autonomy permission
  profiles, autonomy runs, capability gaps, generated tool specs, and generated
  tool runs.
- Added `src/daemon/scoped-autonomy/` with permission profile evaluation,
  credential redaction, deterministic capability-gap detection, and a Toolsmith
  runtime.
- Initial Toolsmith support covers reviewed built-in
  `web_research_to_pdf.v1`: detect the missing workflow, check scoped grants,
  materialize a Node script in the runtime workspace, require fixture smoke,
  execute, generate Markdown/PDF artifacts, and link artifacts into the eval
  ledger.
- Added `/computer-use/autonomy/*` HTTP routes for profiles, runs, gaps, tool
  specs, tool runs, and plan/materialize/smoke/execute control.
- Added `npm run smoke:scoped-autonomy-toolsmith` and
  `npm run dogfood:scoped-autonomy-toolsmith`.
- Generated `docs/dogfood/scoped-autonomy-toolsmith-2026-05-14.json`,
  `docs/reports/scoped-autonomy-toolsmith-2026-05-14.md`, JSON evidence under
  `docs/reports/assets/scoped-autonomy-toolsmith-2026-05-14/evidence.json`, and
  persistent generated report artifacts under
  `docs/reports/assets/scoped-autonomy-toolsmith-2026-05-14/generated-report/`.
- Updated architecture, QA, README, and open-blocker docs.

Verification passed `npm run lint`, `npm run build:daemon`,
`npm run smoke:research-performance-architecture`,
`npm run smoke:scoped-autonomy-toolsmith`,
`npm run dogfood:scoped-autonomy-toolsmith`, final `npm run smoke:all`,
`git diff --check`, strict UTF-8 decoding for 57 touched files,
quoted-question mojibake scan, and `.cs` touched-file check. `git diff --check`
emitted only known CRLF normalization warnings for `.vibe/agent/session-log.md`
and `src/daemon/storage/storage.ts`. `smoke:all` ended green with the known
unsigned development helper notice and one standard Windows temp cleanup retry.

Remaining explicit deferrals: arbitrary generated code synthesis beyond
reviewed templates, renderer permission-profile UX, live source extraction and
citation verification for web research, package installation by generated
tools, unattended Windows settings mutation, credential access, authenticated
crawling, official app-server client-tool contract, production signing, GPU ASR
validation, and human microphone corpus benchmark.

## Latest Update: Scoped Autonomy Self-Implementation Runtime

Extended the scoped autonomy foundation into an end-to-end self-implementation
system for bounded computer-use YOLO behavior.

- Added storage schema v6 for profile scope/use counts, structured gap fields,
  generated tool manifests/source hashes/stability, rollback data, and daemon
  capability inventory.
- Expanded permission profiles with network/browser/generated-code/risk/runtime
  grants, one-time and persistent profile semantics, and exact missing-grant
  reporting.
- Added capability inventory seeding for built-in, generated, blocked, and
  externally unavailable capabilities, including document conversion, file
  picker, package-install helper, browser download verification, and native
  Windows blockers.
- Replaced monolithic Toolsmith execution with a self-implementation loop:
  materialize source in daemon runtime workspace, write manifest, run smoke,
  parse failure, revise within iteration budget, activate after smoke pass, and
  register the generated capability.
- Upgraded `web_research_to_pdf` to staged live/fallback execution:
  crawl_or_observe, extract, verify_sources, draft_markdown, render_pdf,
  store_artifact, and verify_artifact.
- Added generated vertical slices for safe terminal local scripts and browser
  download verification.
- Added executable autonomy DAG run support, debug bundle export, rerun mode,
  and rollback cleanup for runtime-generated tools.
- Added `/computer-use/autonomy` routes for inventory, profile update,
  self-implement, run-dag, debug bundle, rerun, and rollback.
- Added renderer Autonomy Toolsmith panel inside Activity details for profiles,
  runs, gaps, DAG nodes, generated tools, blocked grants, and debug bundle copy.
- Added `docs/plans/scoped-autonomy-self-implementation-handoff.md`.
- Added new verification and evidence scripts:
  `smoke:scoped-autonomy-self-implementation`,
  `dogfood:scoped-autonomy-self-implementation`, and
  `dogfood:scoped-autonomy-web-research-live`.

Verification passed `npm run lint`, `npm run build:daemon`, `npm run build:web`,
`npm run smoke:research-performance-architecture`,
`npm run smoke:capability-runtime`, `npm run smoke:browser-action`,
`npm run smoke:vision-context`, `npm run smoke:asr-runtime-candidates`,
`npm run smoke:scoped-autonomy-toolsmith`,
`npm run smoke:scoped-autonomy-self-implementation`,
`npm run dogfood:scoped-autonomy-toolsmith`,
`npm run dogfood:scoped-autonomy-self-implementation`, and
`npm run dogfood:scoped-autonomy-web-research-live`, plus final
`npm run smoke:all`, `git diff --check`, strict UTF-8 decoding,
quoted-question mojibake scan, and `.cs` touched-file check.

Remaining explicit deferrals: official app-server custom client-tool contract,
production signing certificate/service, unrestricted credential flows,
unattended high-risk Windows mutation, authenticated browser profile/cookie
access, GPU ASR validation, human microphone corpus benchmark, and full package
install helper promotion beyond blocked inventory classification.

## Latest Update: Real Widget Session Browser Action Eval Repair

Audited the live widget chat session `4749a65b-8799-4408-b401-d6951ea7c852`
(`특갤켜줘`) after the product-owner requested verification of actual
widget-session dogfood, not fixture-style scenario evidence.

Findings:
- The Browser Bridge/Browser Action event stream showed successful real browser
  actions, but the unified computer-use eval ledger recorded the corresponding
  prompt runs as `failed/action_failed`.
- Root cause was prompt eval finalization happening before the extension command
  result returned. The eval run was finalized from the initial queued/pending
  plan instead of the eventual browser result.
- A second real-use regression was target interpretation: corrective prompts
  like "개념글 버튼 눌러달라는 뜻이야" and chained write-flow prompts could be
  treated as representative-content clicks instead of explicit control clicks.

Implemented fixes:
- Added `promptEvalLedger.ts` so Browser Action prompt evals can record
  non-terminal checkpoints while extension commands are pending and finalize
  only after timeout or final extension result.
- Linked Browser Action capability mirror jobs to the prompt eval run through
  persisted job input metadata and carried the eval id through queued/result
  extension follow-up paths.
- Updated eval rollup action counting to prefer explicit prompt-level
  `actionCount` and `succeededActionCount` fields before falling back to
  capability-step counting.
- Hardened Korean Browser Action intent parsing so explicit button/tab/menu/link
  wording sets the requested role, direct filter button correction does not
  become content-open intent, and write/compose flows are not misclassified as
  representative post selection.
- Added `scripts/audit-real-use-widget-session.mjs` and
  `npm run audit:real-use-session` to inspect real chat-session messages,
  Browser Action events, eval runs, activity, and historical mismatch findings.
- Added `scripts/smoke-browser-action-real-use-regressions.mjs` and
  `npm run smoke:browser-action:real-use-regressions` to lock the eval lifecycle
  regression.

Verification passed `npm run build:daemon`,
`npm run smoke:browser-action:prompt-classification`,
`npm run smoke:browser-action:transaction-verification`,
`npm run smoke:browser-interaction-transaction`,
`npm run smoke:browser-action:real-use-regressions`,
`npm run smoke:browser-action`, `npm run lint`, `git diff --check`, strict
UTF-8 decoding, replacement-character scan, and `.cs` touched-file check.

Historical note: the existing live DB rows remain historical evidence and are
not rewritten by the fix. Running `npm run audit:real-use-session -- --session
4749a65b-8799-4408-b401-d6951ea7c852 --since 2026-05-14T09:00:00.000Z --json`
still reports the prior mismatch: successful Browser Action events paired with
failed eval rows. New runs should finalize from the real extension result.

## Latest Update: Browser Chrome Deep Actions

Added and implemented `docs/plans/browser-chrome-deep-actions-handoff.md` for
the Browser Bridge chrome-control gap list.

Implemented:
- Expanded `browser_chrome` commands for tab groups:
  `tab_group.list`, `tab_group.create`, `tab_group.claim`,
  `tab_group.update`, and `tab_group.release`.
- Expanded downloads commands:
  `download.search`, `download.observe`, `download.verify`,
  `download.start`, `download.cancel`, and `download.erase`.
- Added high-risk one-time approval policy for `history.*`, `debugger.*`, and
  `file_upload.*` commands. `bookmark.list`, `tab_group.list`, and download
  read/verify commands remain read-only.
- Added redacted history evidence: origins are retained, URL paths are redacted.
- Added bounded debugger commands using fixed CDP methods only:
  `debugger.inspect` and `debugger.screenshot`; arbitrary debugger evaluation
  remains unavailable.
- Added file upload commands:
  `file_upload.inspect`, `file_upload.set_files`, `file_upload.clear`, and
  `file_upload.blocked`. File selection requires explicit absolute
  `approvedFilePaths`, uses debugger-backed `DOM.setFileInputFiles`, records
  basename-only evidence, and supports clear as rollback.
- Added transient capability input handling so file upload paths are available
  in memory for execution but redacted in durable capability job input/output.
- Added extension permissions and store/privacy rationale for `tabGroups`,
  `downloads`, `history`, and `debugger`.
- Generalized capability verification from bookmark-only to
  `browser_chrome_effect`.
- Expanded Browser Chrome capability smoke coverage and added
  `smoke:browser-chrome-deep-actions`.

Verification passed `npm run build:daemon`, extension JS syntax check,
`npm run smoke:browser-chrome-deep-actions`, `npm run smoke:extension`,
`npm run lint`, `npm run smoke:capability-runtime`, and
`npm run smoke:browser-action:native`, plus `git diff --check`, strict UTF-8
decoding, replacement-character scan, and `npm run vibe:checkpoint`.

Remaining boundaries: browser restricted pages remain unsupported by extension
DOM injection; native file picker UI selection still belongs to the signed
native helper track; production extension/helper signing remains dependent on
the release signing path.

## Latest Update: Windows Codex Computer Use Parity Runtime

Continuing from `docs/plans/windows-codex-computer-use-parity-handoff.md`,
implemented the next Browser Action session-runtime slice.

Implemented:
- Added shared Computer Session prompt-run summaries to
  `src/shared/protocol/computerUse.ts` and included `promptRuns` in the debug
  bundle.
- Extended `ComputerSessionRuntime` so `POST
  /computer-use/sessions/:id/browser-action-prompt` creates a tracked prompt
  run, records each step, starts the first Browser Action operation, and keeps
  step/DAG/capability job linkage.
- Added `POST
  /computer-use/sessions/:id/browser-action-prompt/continue` for manual prompt
  run continuation.
- Connected Browser Bridge extension result handling to
  `continueBrowserActionPromptByCapabilityJob(...)`, so a completed prompt
  step can automatically enqueue the next Browser Action step.
- Expanded `smoke:computer-use-session-http` to cover prompt debug-bundle
  export, single-step prompt completion, and a two-step Korean prompt with
  automatic continuation.
- Updated the parity handoff/checklist to mark multi-step Browser Action prompt
  continuation implemented. Isolated browser lifecycle, renderer Computer Use
  UX, full observe/plan/action/verify DAG execution, and native watch-mode
  remain open.

Verification passed `npm run build:daemon`,
`npm run smoke:computer-use-session-http`, `npm run smoke:browser-action`, and
`npm run lint`. A new full `smoke:all`, diff check, UTF-8 scan, and checkpoint
should be run before any push or closure.

Follow-up slice implemented:
- Added persistent Playwright controlled-browser sessions for Computer Session
  Browser Action ids. The Playwright adapter still opens/closes per action for
  normal Browser Action usage, but `computer-session-browser-action:*` sessions
  reuse a page so multi-step isolated-browser prompts keep DOM/navigation
  state.
- Computer Session prompt planning on the `isolated_browser` surface now
  defaults to `adapterId: "playwright"` and `source.kind:
  "controlled_browser"`.
- The daemon Computer Session Browser Action executor now performs
  `observeViaAdapter` before non-extension adapter execution, fixing empty DOM
  target resolution for Playwright/CDP paths.
- Computer Session cancel closes the persistent Playwright browser for
  isolated-browser sessions and records `surface_cleanup` evidence.
- Added `scripts/smoke-computer-use-isolated-browser.mjs`,
  `npm run smoke:computer-use-isolated-browser`, and included it in
  `smoke:all`.

Focused verification passed `npm run smoke:computer-use-isolated-browser`,
`npm run smoke:computer-use-session-http`, `node
scripts/smoke-browser-action-playwright.mjs`, `npm run smoke:browser-action`,
and `npm run lint`. Run final aggregate checks before pushing.

## Latest Update: Renderer Computer Use Sessions Panel

Implemented the first renderer UX pass for the Windows Codex Computer Use parity
track:
- Added `src/renderer/components/ComputerUseSessionsPanel.tsx`.
- Activity details now includes a Computer Use panel below Capability Jobs and
  Autonomy Toolsmith.
- The panel fetches `/computer-use/surfaces`, `/computer-use/sessions`, and
  `/computer-use/sessions/:id/debug-bundle`.
- Users can create a bounded Computer Use session, select execution surface,
  run a Browser Action prompt, manually continue a prompt run, cancel a session,
  copy the debug bundle, and approve/cancel awaiting capability jobs.
- The panel shows session state, selected surface, DAG node count, capability
  job count, blocked/requires-action state, prompt runs, prompt steps, and
  recent DAG nodes.
- Updated the parity handoff/checklist to mark Renderer UX as partially
  implemented. Artifact/rollback previews, high-risk grant creation, and
  long-running streaming polish remain open.

Verification passed `npm run build:renderer`, `npm run lint`, and
`npm run smoke:renderer-chat`. Run aggregate `smoke:all`, diff check, UTF-8
scan, and checkpoint before any push or closure.

## Latest Update: Browser Chrome Computer Session Smoke

Added a focused Computer Session Browser Chrome verification slice:
- Added `scripts/smoke-computer-use-browser-chrome.mjs`.
- Added `npm run smoke:computer-use-browser-chrome` and included it in
  `smoke:all`.
- The smoke starts a `regular_browser_extension` Computer Use session, executes
  `browser_chrome` operations through
  `/computer-use/sessions/:id/operations`, polls the Browser Bridge command
  queue, posts extension results, and verifies linked capability jobs plus DAG
  nodes in the debug bundle.
- Coverage includes `tab_group.list`, `download.verify`, and high-risk
  `history.search` with one-time approval and redacted path evidence.
- Updated the parity handoff/checklist to mark Browser Chrome structured
  operation mapping as partially implemented through Computer Session.

Verification passed `npm run smoke:computer-use-browser-chrome`,
`npm run smoke:browser-chrome-capability`, and `npm run lint`. Run final
aggregate checks before push/closure.

## Latest Update: Computer Session DAG Follow-Up Nodes

Added verification/eval follow-up DAG nodes after Computer Session capability
actions:
- `CapabilityRuntime` now appends `${actionNodeId}:verification` and
  `${actionNodeId}:eval_ledger` nodes when a linked capability job completes.
- Browser Action capability mirror applies the same follow-up node creation
  when an extension result completes a linked Computer Session action node.
- Follow-up verification nodes include verifier status/proof/error metadata
  when present; eval ledger nodes include the linked eval run id and completed
  capability job id.
- `smoke:computer-use-session-http` now asserts follow-up nodes for prompt
  Browser Action steps, including the two-step Korean continuation case.
- `smoke:computer-use-browser-chrome` now asserts follow-up nodes for Browser
  Chrome operations including the one-time approved history path.

Focused verification passed `npm run build:daemon`,
`npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-browser-chrome`,
`npm run smoke:capability-runtime`, and `npm run lint`. Run aggregate
`smoke:all`, diff check, UTF-8 scan, and checkpoint before push/closure.

## Latest Update: Computer Session Evidence And Perception Bundle

Implemented the first Phase 4 observation/evidence slice:
- `ComputerSessionDebugBundle` now includes `evalResources` and
  `perceptionGraphs`.
- Session observations are structured records with kind/source/surface,
  capability job id, DAG node id, eval run id, perception graph id, resource
  ids, freshness, summary, metadata, and redaction policy.
- Browser Action extension results for `computer-session-browser-action:*`
  sessions are promoted into `browser_dom` observations and
  `computer_session_browser_action_result` perception graphs.
- OCR/screen/terminal-like capability completions through Computer Session can
  create structured observation records and eval resource links.
- Renderer Computer Use panel now shows evidence counts and recent observation
  records in addition to sessions, prompt runs, jobs, and DAG nodes.

Focused verification passed `npm run build:daemon`,
`npm run smoke:computer-use-session`, `npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-isolated-browser`,
`npm run smoke:computer-use-browser-chrome`, `npm run build:renderer`,
`npm run smoke:renderer-chat`, and `npm run lint`. Run final aggregate checks
before push/closure.

## Latest Update: Browser Parity Smoke

Added the first explicit Computer Session browser parity operation smoke:
- `scripts/smoke-computer-use-browser-parity.mjs`.
- `npm run smoke:computer-use-browser-parity`.
- Included the new smoke in `smoke:all`.
- Added `npm run smoke:computer-use-debug-bundle` as the focused debug-bundle
  verification entry point backed by the session HTTP smoke.
- The browser parity smoke starts an isolated Playwright controlled-browser
  Computer Session, types into a search input, clicks submit, and verifies
  completed Browser Action jobs, action/verification/eval DAG follow-up nodes,
  post-action `browser_dom` observations, perception graph export, and cleanup.

Focused verification passed `npm run smoke:computer-use-browser-parity`.
Aggregate checks need to be rerun after this smoke addition.

## Latest Update: Computer Session Rollback Surface

Added the first rollback/cleanup debug model:
- `ComputerSessionDebugBundle` now includes `rollbackActions`.
- Rollback actions record kind, label, status, risk class, capability job id,
  target, reason, timestamps, and metadata.
- Session cancellation records active capability-job cancellation actions.
- Isolated browser cleanup records a `close_surface` rollback action when the
  persistent Playwright surface is closed, or `skipped` when no surface was
  open.
- Renderer Computer Use panel now shows rollback action count and recent
  rollback records.
- High-risk artifact deletion is still intentionally not implemented without
  explicit file grants and verifier proof.

Focused verification passed `npm run lint`, `npm run smoke:computer-use-session`,
`npm run smoke:computer-use-isolated-browser`,
`npm run smoke:computer-use-browser-parity`, and
`npm run smoke:renderer-chat`. Aggregate checks need to be rerun after this
rollback slice.

## Latest Update: Terminal Parity Smoke

Added the first Terminal/PT Y Computer Session parity smoke:
- `scripts/smoke-computer-use-terminal-parity.mjs`.
- `npm run smoke:computer-use-terminal-parity`.
- Included the new smoke in `smoke:all`.
- The smoke starts a `pty_workspace` session, requests a safe local terminal
  command, verifies that terminal execution is approval-gated, approves through
  the capability WebSocket path, waits for completion, and checks terminal
  output.
- Debug-bundle export now reconciles completed asynchronous capability jobs
  into structured observations if the original operation returned
  `awaiting_approval`. This lets post-approval terminal completion appear as a
  `terminal` observation with linked DAG/eval evidence.

Focused verification passed `npm run smoke:computer-use-terminal-parity`,
`npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-browser-parity`, and `npm run lint`. Aggregate
checks need to be rerun after this terminal slice.

## Latest Update: Toolsmith Artifact Through Computer Session

Implemented the first Phase 7 integration slice:
- `toolsmith` Computer Session operations now run
  `ScopedAutonomyRuntime.runGoalDag` instead of the simulated `agent_tool`
  bridge.
- The parent session DAG action node records autonomy run/eval/DAG ids, tool
  spec id, tool run ids, artifact count, redacted artifact hashes, and
  Toolsmith verification summary.
- The parent session DAG appends verification/eval follow-up nodes for the
  Toolsmith operation.
- Scoped autonomy Markdown/PDF/citation artifacts are mirrored into the parent
  Computer Session eval resources and exposed as a `file` observation in the
  session debug bundle.
- Artifact deletion rollback is represented as blocked until explicit file
  rollback grants and verifier proof exist.
- Added `scripts/smoke-computer-use-toolsmith-artifact.mjs`,
  `npm run smoke:computer-use-toolsmith-artifact`, and `smoke:all` coverage.

Focused verification passed `npm run smoke:computer-use-toolsmith-artifact`,
`npm run smoke:computer-use-session-http`,
`npm run smoke:scoped-autonomy-self-implementation`, and `npm run lint`.
Aggregate checks need to be rerun after this Toolsmith slice.

## Latest Update: Native Watch Boundary

Implemented the first safe Phase 11 native foreground boundary slice:
- `visual_desktop_action` Computer Session operations no longer bridge directly
  to the broad v1 `desktop_action` helper.
- Foreground visual mutation is blocked before native input unless future
  watch-mode helper v2 preconditions are satisfied.
- The blocked path records `actualInputSent: false`, a failed `approval` DAG
  node, a failed `action` DAG node, and deterministic
  `:verification`/`:eval_ledger` follow-up nodes.
- Debug bundles expose the blocker through `safetyDecisions`, a
  `foreground_desktop_watch_boundary` observation, a failed verifier result,
  and a `none_available` rollback record explaining no rollback is needed
  because no foreground input was sent.
- Computer Session debug bundles now include `failureMemory`; the native watch
  blocked path records a structured failure memory item as calibration only
  with `mayCompleteTask: false`, `mayBypassApproval: false`, and
  `proofSource: false`.
- Renderer Computer Use panel shows failure-memory counts and recent
  calibration records next to evidence and rollback records.
- Missing preconditions now include one-time approval, visible countdown,
  active-window assertion, process allowlist, user-idle guard,
  abort-on-user-input, pre/post evidence, signed watch-mode helper v2, and
  effect verification/rollback proof.
- Native Browser Action helper capability advertisement now matches the v1
  helper contract: `screenshot` is not advertised, status diagnostics list it
  as explicitly unsupported, and direct screenshot requests return a fallback
  explanation before helper invocation.
- Added `scripts/smoke-computer-use-native-watch-boundary.mjs`,
  `npm run smoke:computer-use-native-watch-boundary`, and `smoke:all`
  coverage.

Verification passed `npm run build:daemon`,
`node scripts/smoke-computer-use-native-watch-boundary.mjs`,
`npm run smoke:computer-use-native-watch-boundary`,
`npm run smoke:computer-use-session`, `npm run smoke:computer-use-session-http`,
`npm run smoke:browser-action:native`, `npm run lint`, `npm run smoke:all`,
`npm run build:renderer`, `npm run smoke:renderer-chat`,
`git diff --check`, strict UTF-8 / replacement-character scan, and
`npm run vibe:checkpoint`. Known non-failing notes: helper signature smoke
still reports the unsigned development helper as allowed, `git diff --check`
prints existing CRLF normalization warnings for `.vibe/agent/session-log.md`
and `src/daemon/server.ts`, and one smoke temp cleanup was deferred with the
standard Windows retry path.

## Latest Update: Effect Verifier And Recovery Boundary

Implemented the first Phase 9 verifier/recovery slice:
- Added `src/daemon/computer-use/effectVerifier.ts`.
- Capability-backed Computer Session operations now run a session-level
  verifier after job completion.
- Explicit operation expectations such as `text contains ...` and
  `stdout contains ...` are checked against actual output before the session
  can complete.
- Failed/inconclusive verification records an `effect_verification` eval step,
  failed verification/eval DAG follow-up nodes, a bounded `fallback` recovery
  node, a `recovery_attempt` eval step, and structured failure memory as
  calibration only.
- Recovery budget is currently one attempt per Computer Session; when no safe
  automatic recovery action is available, the attempt is recorded as skipped
  with next-action hints instead of marking task success.
- Added `scripts/smoke-computer-use-effect-verifier.mjs`,
  `npm run smoke:computer-use-effect-verifier`, and `smoke:all` coverage.
- Added `npm run dogfood:computer-use-30` as a checklist-compatible alias for
  the existing `dogfood:computer-use-process-30` runner.

Focused verification passed `npm run smoke:computer-use-effect-verifier`,
`npm run smoke:computer-use-session`, `npm run smoke:computer-use-terminal-parity`,
`npm run smoke:computer-use-native-watch-boundary`, and `npm run lint`.
Run aggregate checks, diff check, UTF-8 scan, and checkpoint after any further
edits.

## Latest Update: Approval Card Grant/Risk Clarity

Implemented the first Phase 10 approval clarity slice:
- Computer Use awaiting-approval rows now show inferred grant, risk class,
  reason, and command/action summary instead of only capability kind/id.
- Covered job classes: terminal, browser_chrome, browser_action,
  desktop_action, and agent_tool.
- Blocked or approval-pending Computer Sessions can now derive scoped autonomy
  requirements from current safety decisions, selected surface grants, and
  awaiting capability jobs.
- The renderer can create a narrow `one_time` `scoped_yolo` permission profile
  from those derived grants, attach it to the session through
  `POST /computer-use/sessions/:id/profile`, and record the profile attachment
  in `safetyDecisions` plus an eval ledger step.
- Computer Use session creation now has an active permission profile selector.
  It defaults to no profile, passes only the user's explicit selection into
  `/computer-use/sessions`, and auto-selects a just-created one-time profile
  for the next run.
- Warning/error approval rows now include an expandable sanitized Preview with
  redacted capability input and approval evidence, so high-risk approvals are
  not reduced to a generic continue/approve button.
- Computer Use debug resources with artifact-like roles now render in an
  Artifacts section with retention and blob/capability resource identifiers.
- Artifact-like eval resources can now be opened/downloaded through
  `/computer-use/eval/runs/:runId/resources/:resourceId/content`. The route is
  gated to artifact/file/report/PDF/citation/markdown/download roles, blocks raw
  screen/audio/perception resources, caps direct serving at 25 MB, and never
  exposes blob filesystem paths. The renderer provides Open, Save, and text
  Copy controls for eligible resources.
- The profile attachment is permission evidence only. It does not bypass
  external blockers such as the missing signed watch-mode helper v2,
  foreground countdown, active-window assertion, abort-on-user-input guard, or
  effect verification/rollback proof.
- Added `scripts/smoke-computer-use-one-time-profile.mjs`,
  `npm run smoke:computer-use-one-time-profile`, and `smoke:all` coverage.

Verification passed `npm run build:daemon`, `npm run build:renderer`,
`npm run smoke:computer-use-one-time-profile`, `npm run lint`,
`npm run smoke:renderer-chat`, and final `npm run smoke:all` after the profile
selector change. The later high-risk preview UI change passed
`npm run build:renderer`, `npm run lint`, and `npm run smoke:renderer-chat`.
The artifact resource UI change also passed the same renderer-focused checks.
Final `npm run smoke:all` was rerun after all profile/preview/artifact UI and
artifact content-route changes and passed. The Toolsmith artifact smoke now
fetches both Markdown and PDF resources through the content route. Remaining
final housekeeping for this slice is diff check, UTF-8 scan, and checkpoint.

## Latest Update: Terminal Profile Allowlist

Implemented the Phase 8 profile-level terminal allowlist slice:
- Computer Session terminal operations now evaluate the active scoped autonomy
  profile before capability enqueue.
- If the profile grants the command prefix and session risk class, the terminal
  job is enqueued with `requireApproval: false`, and the allow decision is
  recorded in `safetyDecisions`.
- If a profile is present but the command grant is missing, the operation is
  blocked before creating a capability job. The action DAG node, eval step, and
  safety decision include exact missing `AutonomyPermissionRequirement`
  records.
- Credential-like and destructive terminal command patterns are hard-blocked at
  the Computer Session boundary before approval or profile preapproval.
- `scripts/smoke-computer-use-terminal-parity.mjs` now covers three terminal
  paths: no real profile -> approval required, allowlisted profile -> completed
  without approval, and profile missing command grant -> blocked before job
  creation.

Verification passed `npm run build:daemon`, `npm run lint`,
`npm run smoke:computer-use-terminal-parity`,
`npm run smoke:computer-use-effect-verifier`,
`npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-one-time-profile`, and final `npm run smoke:all`.
Remaining final housekeeping for this slice is diff check, UTF-8 scan, and
checkpoint.

## Latest Update: Browser Chrome Session Coverage

Expanded the Computer Session Browser Chrome smoke coverage:
- `scripts/smoke-computer-use-browser-chrome.mjs` now drives
  `tab_group.list`, `bookmark.list`, one-time approval `bookmark.create`,
  `download.verify`, high-risk one-time `history.search`, high-risk one-time
  `debugger.inspect`, and high-risk one-time `file_upload.set_files` through
  `POST /computer-use/sessions/:id/operations`.
- The smoke verifies Browser Bridge polling/result completion, capability job
  completion, action/verification/eval DAG follow-up nodes, debug-bundle
  visibility, redacted history evidence, and redacted file-path evidence.

Verification passed `npm run smoke:computer-use-browser-chrome`,
`npm run lint`, and final `npm run smoke:all`. Remaining final housekeeping
for this slice is diff check, UTF-8 scan, and checkpoint.

## Latest Update: Browser Action Pre/Post Observations

Implemented a Phase 3/5 evidence improvement:
- Browser Action extension results for `computer-session-browser-action:*`
  now record separate `pre_action` and `post_action` `browser_dom`
  observations instead of collapsing to a single post-action observation.
- Each observation gets its own perception graph source
  (`computer_session_browser_action_pre_action` or
  `computer_session_browser_action_post_action`) plus eval step/resource links.
- `smoke:computer-use-session-http` and `smoke:computer-use-browser-parity`
  now assert both pre-action and post-action observation evidence.

Verification passed `npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-browser-parity`, `npm run lint`, and final
`npm run smoke:all`. Remaining final housekeeping for this slice is diff
check, UTF-8 scan, and checkpoint.

## Latest Update: Verifier Audit Surface

Implemented the Phase 9 verifier audit workflow:
- Added `computer-use-verifier-audit.v1` shared audit types and daemon audit
  logic for eval-ledger verifier steps.
- The audit classifies false-negative records, false-positive candidates,
  inconclusive verifier results, expected-effect action steps missing verifier
  evidence, and consistent verifier passes/failures.
- Computer Session debug bundles now include `verifierAudit` so copied/saved
  bundles carry the audit summary alongside verifier results and failure
  memory.
- Added `/computer-use/eval/verifier-audit` and
  `/computer-use/eval/runs/:runId/verifier-audit`; readiness output now embeds
  a verifier audit summary.
- Added `scripts/smoke-computer-use-verifier-audit.mjs`,
  `npm run smoke:computer-use-verifier-audit`, and `smoke:all` coverage.

Verification passed `npm run build:daemon`,
`npm run smoke:computer-use-verifier-audit`,
`npm run smoke:computer-use-effect-verifier`,
`npm run smoke:computer-use-session-http`, and
`npm run smoke:computer-use-browser-parity`. Aggregate verification also
passed `npm run lint`, final `npm run smoke:all`, `git diff --check`, and a
strict UTF-8/replacement-character scan for 78 touched/untracked text files
(the only quoted-question hit was a legitimate download query suffix literal).
Known non-failing notes: unsigned helper remains allowed in development mode,
CRLF normalization warnings for `.vibe/agent/session-log.md`,
`src/daemon/server.ts`, and `src/daemon/storage/storage.ts`, plus one standard
Windows temp cleanup deferred retry.

Follow-up within the same Phase 9 slice:
- `smoke:computer-use-effect-verifier` now includes an unsupported
  expected-effect target that produces an `inconclusive` verifier result and
  proves the session remains failed.
- `smoke:computer-use-verifier-audit` now asserts the inconclusive audit bucket
  in both session-scoped audit output and readiness output.
- `EffectVerifier` now treats unsupported explicit expected outcomes as
  inconclusive unless the capability output carries explicit effect proof or
  the expected value is present in the output evidence. Generic capability
  success no longer silently satisfies an unsupported `expectedOutcome`.
- Effect verification now updates the parent eval run status/task success after
  verifier pass/fail/inconclusive results, so debug bundles and readiness audit
  do not keep a stale passed/partial eval state after a verifier failure.

Verification after the inconclusive follow-up passed
`npm run smoke:computer-use-effect-verifier`,
`npm run smoke:computer-use-verifier-audit`,
`npm run smoke:computer-use-session-http`, `npm run lint`, and final
`npm run smoke:all`.

## Latest Update: Verifier Audit Renderer Surface

Added renderer visibility for the Phase 9 audit data:
- `ComputerUseSessionsPanel` now includes a `Verifier` metric, audit bucket
  counts, and recent audit rows from `bundle.verifierAudit`.
- The panel surfaces false-negative records, false-positive candidates,
  inconclusive verifier results, and missing verifier evidence without requiring
  the user to copy the full debug bundle.
- Styling reuses the compact Computer Use section layout with a four-column
  audit metric strip.

Verification passed `npm run build:renderer`, `npm run smoke:renderer-chat`,
and `npm run lint`.

## Latest Update: 30-Case Dogfood Rerun

Reran the fixture-backed Computer Use 30-case process validation after the
verifier/eval/audit changes. This entry was later superseded on 2026-05-16 by
the PDF/download refresh at the top of this handoff:
- Command: `npm run dogfood:computer-use-30`
- Outputs:
  - `docs/dogfood/computer-use-process-validation-30-2026-05-16.json`
  - `docs/reports/computer-use-process-validation-30-2026-05-16.md`
  - `docs/reports/assets/computer-use-process-validation-30-2026-05-16/evidence.json`
- Superseded latest results: 30 scenarios, 21 passed, 9 intentionally blocked,
  0 needs-follow-up, 0 unexpected failures, 43 eval runs, 11 perception graphs,
  16 eval resources, 1 DAG run.
- Superseded latest metrics: task success rate 0.786, proof rate 0.405, p95
  latency 108 ms, p95 perception latency 40 ms.

This remains safe fixture-backed evidence. Live browser/OS trace promotion is
still a separate follow-up.

## Latest Update: Debug Bundle Save UX

Added a Save debug bundle control to the Computer Use panel toolbar:
- Existing Copy still writes the selected session debug bundle JSON to the
  clipboard.
- New Save creates a local browser download named
  `computer-use-debug-<session>.json` from the currently loaded or freshly
  fetched debug bundle.

Verification passed `npm run build:renderer`, `npm run smoke:renderer-chat`,
and `npm run lint`.

## Latest Update: Toolsmith Artifact DAG Nodes

Added parent Computer Session DAG nodes for Toolsmith artifacts:
- `recordToolsmithSessionArtifacts` now creates `${action}:store_artifact` and
  `${action}:verify_artifact` nodes under the parent session DAG.
- `store_artifact` records artifact roles and mirrored eval resource ids.
- `verify_artifact` requires blob-backed artifact content plus hash evidence
  and records a passed/failed verification summary.
- A `toolsmith_artifact_verification` eval step links the verifier node to the
  session eval run.
- The file observation metadata now points to the parent store/verify artifact
  node ids.

Verification passed `npm run build:daemon`,
`npm run smoke:computer-use-toolsmith-artifact`, and
`npm run smoke:computer-use-session-http`.

## Latest Update: Browser Chrome Print-To-PDF Primitive

Added a bounded Browser Bridge debugger command:
- New command: `debugger.print_to_pdf`.
- Extension implementation uses Chrome debugger `Page.printToPDF` with bounded
  print options.
- Output records PDF format, byte length, SHA-256 when available, and omits
  inline PDF bytes by default unless explicitly requested and under the inline
  size cap.
- The command is covered as a high-risk one-time Browser Chrome operation in
  both direct capability and Computer Session Browser Chrome smokes.

Verification passed `npm run build:daemon`,
`npm run smoke:browser-chrome-capability`,
`npm run smoke:computer-use-browser-chrome`, and `npm run smoke:extension`.

Final aggregate verification for this slice also passed `npm run lint` and
final `npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Toolsmith Source Visibility

Implemented a Phase 7/10 source-evidence UX slice:
- Parent Computer Session Toolsmith artifact collection now builds a
  `sourceSummary` from child Toolsmith tool-run output, citation/source
  artifacts when available, fetched URL evidence, browser-fallback warnings,
  and source counts.
- The `sourceSummary` is stored in the parent eval step, `store_artifact` and
  `verify_artifact` DAG node outputs, and the `toolsmith_scoped_autonomy` file
  observation metadata.
- The Computer Use renderer panel now shows a Sources section for Toolsmith
  runs, listing source status, title/URL, browser-fallback marker, character
  count, and excerpt when available.
- `smoke:computer-use-toolsmith-artifact` now asserts the source summary,
  including the deterministic browser-fallback source, in addition to artifact
  and rollback evidence.

Verification passed `npm run smoke:computer-use-toolsmith-artifact`,
`npm run build:renderer`, `npm run smoke:renderer-chat`, and `npm run lint`.

## Latest Update: Terminal Debug Bundle Output Redaction

Implemented a Phase 8 terminal hardening slice:
- Computer Session debug bundles now sanitize terminal capability job outputs.
- Raw stdout/stderr are omitted from the debug-bundle job payload and replaced
  with `terminalOutput` metadata containing length, SHA-256, a short
  credential-redacted preview, preview size, and redaction mode.
- Terminal observations already used metadata/length summaries; this closes the
  remaining bundle path that exposed raw terminal output through
  `capabilityJobs`.
- `smoke:computer-use-terminal-parity` now verifies that the capability job API
  can still inspect completed stdout for the job owner while the Computer
  Session debug bundle exposes only redacted preview/hash metadata.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-terminal-parity`.

## Latest Update: Terminal Output Root Diff Artifacts

Implemented the remaining Phase 8 artifact-effect slice for terminal output
roots:
- Terminal Computer Session operations can now declare `trackOutputRoots`,
  `outputRoots`, or `expectedOutputRoots`.
- If an active scoped autonomy profile grants those directories as write roots,
  the session runtime snapshots bounded files before execution and diffs them
  after a completed terminal job.
- New or modified bounded files are stored as blob-backed
  `terminal_diff_artifact` eval resources with basename/hash/change metadata.
- A `terminal_output_root_diff` file observation links those resources in the
  debug bundle. This complements explicit `expectedArtifacts` without requiring
  the user to name every output file.
- `smoke:computer-use-terminal-parity` now creates both an explicitly declared
  artifact and an automatically detected output-root diff artifact.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-terminal-parity`.

## Latest Update: Toolsmith Browser Fetch Fallback

Connected the Browser Chrome document-capture primitive to the Toolsmith
research artifact path:
- `ScopedAutonomyRuntime.runGoalDag` now accepts `browserFallbackDocuments`.
- The generated `web_research_to_pdf` tool receives both network domain grants
  and browser domain grants.
- During `crawl_or_observe`, direct HTTP still runs first when network grants
  allow it. If direct fetch fails or returns a bad HTTP status and a matching
  browser fallback document exists for an allowed browser domain, the tool uses
  the browser-captured text/metadata instead of treating the source as failed.
- Fallback evidence is marked with `status: "browser_fallback"`,
  `browserFallback: true`, a `fallbackReason`, sanitized capture metadata, and
  `browser_fallback_used:<host>:<reason>` warnings. The evidence flows into
  extracted sources, citations, Markdown, PDF, eval resources, and parent
  session artifact export.
- `ComputerSessionRuntime` forwards `browserFallbackDocuments` from
  `toolsmith` operations into the autonomy DAG.
- `smoke:computer-use-toolsmith-artifact` now covers a deterministic direct
  HTTP failure (`127.0.0.1:9`) with a supplied browser fallback document,
  proving the final report includes browser fallback evidence.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-toolsmith-artifact`. Follow-up verification also
passed `npm run smoke:scoped-autonomy-self-implementation`,
`npm run smoke:computer-use-session-http`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

Follow-up Phase 7 rerun/rollback polish:
- The Autonomy Toolsmith renderer panel now has buttons to rerun the selected
  run's last completed execute tool run and to rollback the selected autonomy
  run without deleting user artifacts.
- `smoke:computer-use-toolsmith-artifact` now verifies the HTTP rerun route and
  rollback route after artifact creation. The smoke profile uses a bounded
  one-time profile with enough use budget to cover initial execution and rerun.

Verification passed `npm run build:renderer`, `npm run smoke:renderer-chat`,
`npm run smoke:computer-use-toolsmith-artifact`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Terminal Artifact Effect Detection

Implemented the first Phase 8 artifact-effect slice:
- Terminal Computer Session operations may declare `expectedArtifacts`.
- After a completed terminal job, the session runtime reads only declared files
  that exist inside the active scoped autonomy profile's approved write roots.
- Matching files are stored as blob-backed eval resources with path-redacted
  basename and SHA-256 metadata.
- The session debug bundle receives a `file` observation from
  `terminal_expected_artifact`, while the terminal observation records
  `artifactCount`.
- `smoke:computer-use-terminal-parity` now creates a terminal artifact in the
  smoke output root with an approved `echo` command and verifies the eval
  resource plus file observation. The blocked command path still proves missing
  command grants.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-terminal-parity`. Follow-up verification passed
`npm run lint`, `npm run smoke:computer-use-session-http`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Observation Freshness Checks

Implemented the first Phase 4 freshness slice:
- Computer Session debug bundles now annotate observations at export time with
  `ageMs`, `staleAfterMs`, `freshnessCheckedAt`, and computed `fresh`/`stale`/
  `unknown` freshness.
- Debug bundles also include `freshnessSummary` with fresh/stale/unknown
  counts, max age, and stale observation ids.
- Capability-backed Computer Session operations can opt into a preflight with
  `requiresFreshObservation` or `maxEvidenceAgeMs`.
- If fresh current evidence is required but missing/stale/unknown, the runtime
  blocks before creating a capability job, records a safety decision, failed
  action DAG node, and `evidence_freshness_check` eval step with
  `perception_miss` failure class.
- `smoke:computer-use-session` now injects synthetic stale DOM evidence,
  verifies stale preflight blocking, and checks the debug bundle freshness
  summary.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-session`. Follow-up verification passed
`npm run lint`, `npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-browser-parity`, and final `npm run smoke:all`.
Known non-failing notes remained the unsigned browser-native helper allowed in
development mode and one Windows temp cleanup deferred retry.

## Latest Update: Computer Use Before/After Observation Preview

Implemented a Phase 10 renderer UX slice:
- The Computer Use panel now groups Browser Action `pre_action` and
  `post_action` observations by DAG/capability job into a Before / after
  section.
- Each preview shows the action type, redacted target/source summary, freshness
  status, URL/title, element count, perception graph node count, verifier
  status, and capability job id.
- The preview is intentionally structured/redacted instead of bitmap-backed so
  it stays within the current raw screenshot retention policy.
- Full foreground visual bitmap before/after preview remains future work until
  signed watch-mode helper v2 and screenshot retention boundaries are promoted.

Verification passed `npm run build:renderer`, `npm run smoke:renderer-chat`,
`npm run lint`, and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper allowed in development mode and one Windows
temp cleanup deferred retry.

## Latest Update: Live OpenAI Toolsmith Dogfood

Implemented a Phase 7 live evidence slice:
- `scripts/collect-scoped-autonomy-web-research-live-dogfood.mjs` now uses the
  current Seoul date for output paths and validates real source body evidence
  rather than treating HTTP 403 status-only fetches as success.
- The scoped autonomy live dogfood now captures official OpenAI Codex docs with
  Playwright browser fallback when daemon-side HTTP fetches are blocked, passes
  those fallback documents into `web_research_to_pdf`, and requires live source
  text, citations, Markdown/PDF artifacts, and PDF header proof.
- Added `scripts/collect-computer-use-toolsmith-live-dogfood.mjs` and
  `npm run dogfood:computer-use-toolsmith-live` to execute the same OpenAI
  research-to-PDF scenario through the parent daemon `ComputerSessionRuntime`
  Toolsmith route.
- The Computer Session dogfood verifies parent debug-bundle evidence, linked
  child autonomy run, parent DAG follow-up nodes, mirrored eval resources,
  browser fallback captures, report text, and PDF bytes.
- New live evidence:
  `docs/dogfood/scoped-autonomy-web-research-live-2026-05-16.json`,
  `docs/reports/scoped-autonomy-web-research-live-2026-05-16.md`,
  `docs/dogfood/computer-use-toolsmith-live-2026-05-16.json`, and
  `docs/reports/computer-use-toolsmith-live-2026-05-16.md`.

Verification passed `npm run dogfood:scoped-autonomy-web-research-live`,
`npm run dogfood:computer-use-toolsmith-live`,
`npm run smoke:computer-use-toolsmith-artifact`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Browser Chrome Download Verification Evidence

Implemented a Phase 6 download-proof slice:
- Computer Session now reconciles completed `browser_chrome` capability jobs
  into structured session observations, the same way Browser Action,
  screen/OCR, and terminal jobs already do.
- `browser_chrome` `download.verify` operations may include
  `approvedDownloadPath`. The runtime reads that file only after the Browser
  Chrome result reports `verified: true` and only if the active scoped autonomy
  profile grants the path through read/write roots.
- Approved verified downloads are stored as blob-backed eval resources with
  role `download_verified_file`. Durable redaction exposes basename, SHA-256,
  byte size, and source, without exposing full local paths.
- The debug bundle adds a `browser_chrome_download_verify` file observation
  linked to the eval resource, so download completion can be proven through the
  same observation/resource path as Toolsmith and terminal artifacts.
- `smoke:computer-use-browser-chrome` now creates an approved smoke download,
  verifies the `download_verified_file` resource and linked file observation,
  and retains detailed assertion diagnostics for future failures.
- The same smoke now covers the full Browser Chrome deep command matrix through
  Computer Session operations: tab group list/create/claim/update/release,
  bookmark list/create/update/open/remove,
  download search/observe/verify/start/cancel/erase, history search/open,
  debugger inspect/screenshot/print-to-PDF, and file upload inspect/set/clear.
  Read-only commands run without approval, while side-effect/high-risk commands
  prove the `awaiting_approval` path before explicit approval.
- Browser Bridge `debugger.screenshot` now includes PNG SHA-256 alongside byte
  length while still omitting inline screenshot bytes by default.
- Browser Action Computer Session operations now upsert
  `${actionNodeId}:verification` and `${actionNodeId}:eval_ledger` follow-up
  nodes directly when the session operation reaches a final state. This removes
  the Browser parity smoke race where the action node completed but mirror
  timing left the first action's follow-up DAG nodes missing.

Verification passed `npm run smoke:computer-use-browser-chrome`,
`npm run smoke:browser-chrome-capability`, `npm run smoke:extension`,
`npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-browser-parity`, `npm run lint`, focused
`npm run smoke:browser-action`, and final `npm run smoke:all`. The first
aggregate run before the direct follow-up fix exposed the Browser parity
follow-up DAG timing race; focused smokes passed after the fix and the
aggregate rerun passed. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Screen ROI Cascade Evidence Resource

Implemented a second Phase 4 perception slice:
- `screen_observe` capability output already includes tile hashes, dirty
  regions, and cascade stages when image data is available.
- Computer Session now detects that screen cascade payload and stores it as a
  blob-backed eval resource with role `roi_cascade_evidence`.
- The resource is linked from the screen observation and keeps raw screenshot
  retention boundaries explicit with `rawScreenshotStored: false`.
- `smoke:computer-use-session` overrides `screen_observe` with deterministic
  tile/dirty/cascade output and verifies the screen observation links the
  `roi_cascade_evidence` resource.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-session`. Follow-up verification passed
`npm run lint`, `npm run smoke:computer-use-session-http`,
`npm run smoke:research-performance-architecture`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Computer Session Action Route Evidence

Implemented the first Phase 5 action-router evidence slice:
- Computer Session DAG action nodes now record
  `computer-session-action-route.v1`.
- Route evidence includes operation kind, selected surface, execution mode,
  preference rank, visual fallback usage, and a routing reason.
- Current execution modes cover structured Toolsmith, structured terminal,
  Browser Chrome API, screen ROI/cascade observe, ROI OCR, Playwright DOM,
  CDP Browser Action, extension-injected DOM, native browser-window helper, and
  foreground visual watch-mode.
- Browser Action DAG node output mirrors the selected route so the debug bundle
  can explain why isolated-browser actions used Playwright DOM instead of
  visual/native fallback.
- `smoke:computer-use-browser-parity` now verifies the click action route is
  `dom_playwright_locator` and `visualFallbackUsed: false`.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-browser-parity`. Follow-up verification passed
`npm run lint`, `npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-browser-chrome`, and final `npm run smoke:all`
after adding a wait loop for Browser parity follow-up DAG nodes. Known
non-failing notes remained the unsigned browser-native helper allowed in
development mode and one Windows temp cleanup deferred retry.

Renderer follow-up:
- Computer Use DAG rows now surface action-route evidence directly when present
  (`executionMode`, preference rank, and structured/visual fallback status)
  instead of requiring the user to inspect the raw debug bundle.

Verification passed `npm run build:renderer` and `npm run smoke:renderer-chat`.
Follow-up verification passed `npm run lint`,
`npm run smoke:computer-use-browser-parity`, and final `npm run smoke:all`.
Known non-failing notes remained the unsigned browser-native helper allowed in
development mode and one Windows temp cleanup deferred retry.

## Latest Update: Browser Action Stale-Evidence Recovery

Implemented the next Phase 9 recovery slice:
- Browser Action Computer Session operations that declare
  `requiresFreshObservation` or `maxEvidenceAgeMs` now check the latest
  non-skeleton session observation before executing.
- If the latest target evidence is stale or missing, the runtime spends the
  one-attempt recovery budget on a safe Browser Action `read` reobserve through
  the same adapter/source/session before continuing the original action.
- Recovery is recorded as a `browser_action_reobserve_recovery` eval step and
  an `observe` DAG node with action type, redacted target summary, prior
  observation freshness, required max age, recovery capability job, and
  post-recovery freshness.
- The original action proceeds only when post-recovery evidence is fresh. If
  the budget is exhausted or reobserve cannot produce fresh evidence, the
  session fails rather than executing on stale DOM evidence.
- `smoke:computer-use-browser-parity` now primes a stale DOM observation,
  exercises the fresh-evidence-gated type action, asserts the recovery node and
  eval step, and then verifies normal Browser Action follow-up DAG nodes.

Verification passed `npm run build:daemon`,
`npm run smoke:computer-use-browser-parity`,
`npm run smoke:computer-use-effect-verifier`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Browser Action Target Evidence

Implemented the next Phase 4/5 target-grounding slice:
- Browser Action `pre_action` Computer Session observations now carry
  `computer-session-target-evidence.v1` when the Browser Action result target
  can be matched to a perception graph node.
- The evidence is stored in both debug-bundle observation metadata and the
  corresponding `browser_action_pre_action_observation` eval step output.
- The record includes graph id, node id, element id, action type, mapped action
  risk, confidence threshold, allowed decision, confidence, evidence
  sources/classes, disagreement notes, and a compact redacted target summary.
- This gives Browser target choice a session-level explanation path without
  treating failure memory or previous success as proof. Full cross-source graph
  arbitration across DOM/UIA/OCR/screenshot/VLM remains a later slice.
- `smoke:computer-use-browser-parity` now asserts the isolated-browser click
  target evidence is side-effect safe, allowed, and backed by DOM selector
  evidence in both the debug bundle and eval ledger.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-browser-parity`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper allowed in development mode and one Windows
temp cleanup deferred retry.

Renderer follow-up:
- Computer Use Before / after observation panes now display Browser Action
  target evidence when present: allowed/blocked verdict, risk, confidence over
  threshold, target label/node id, evidence sources, and evidence classes.
- The preview remains compact and redacted; it does not expose screenshots or
  raw DOM payloads.

Verification passed `npm run build:renderer` and `npm run smoke:renderer-chat`.
Follow-up verification passed `npm run lint` and final `npm run smoke:all`.
Known non-failing notes remained the unsigned browser-native helper allowed in
development mode and one Windows temp cleanup deferred retry.

## Latest Update: Shared Perception Target Arbitration

Implemented the first shared session-level target arbitration primitive:
- Added `arbitratePerceptionTarget()` in `src/daemon/perception-graph/index.ts`.
  It considers fresh perception graphs, matches by node id, element id, label,
  or text, scores candidates by evidence confidence, match confidence,
  freshness, and disagreement penalty, and returns
  `perception-target-arbitration.v1`.
- Browser Action target evidence now uses the shared arbitration helper instead
  of a direct one-off graph lookup. `computer-session-target-evidence.v1`
  records graph count, candidate count, stale graph count, selected score,
  match reason, selected graph source, and arbitration reason.
- This is still a DOM-backed first slice. The helper is ready for UIA/OCR/
  screenshot/VLM graph inputs, but those sources are not yet merged into
  Browser Action target choice.

Verification passed `npm run build:daemon`,
`npm run smoke:research-performance-architecture`, and
`npm run smoke:computer-use-browser-parity`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper allowed in development mode and one Windows
temp cleanup deferred retry.

## Latest Update: Native Helper UIA Graph Evidence

Implemented the first UIA/native-helper graph input:
- Added `buildPerceptionGraphFromNativeObservation()` in the perception graph
  module. It converts bounded native browser-window helper snapshots into graph
  nodes with `uia` evidence: semantic label, accessibility role, visible text,
  `uia_selector`, bbox, freshness, and source reliability.
- Computer Session `desktop_action` observations now create
  `computer_session_native_browser_observation` graphs when the helper output
  includes `observation` or `after` snapshots.
- This keeps the v1 helper browser-window scoped. It does not promote broad
  foreground desktop mutation or bypass the signing/watch-mode blockers.
- `smoke:browser-action:native` now drives the mock helper through the Computer
  Session `native_browser_window_action` path and asserts the graph preserves
  UIA selector evidence for the `tab-back` element.

Verification passed `npm run build:daemon` and
`npm run smoke:browser-action:native`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper allowed in development mode and one Windows
temp cleanup deferred retry.

## Latest Update: Screen ROI Cache Reuse

Implemented runtime reuse for screen tile hashes:
- Computer Session state now keeps the latest screen tile hash set per session.
- Repeated `screen_observe` operations automatically receive
  `previousTileHashes`, `previousTileHashObservationId`, and
  `previousTileHashCapturedAt`.
- Completed screen observations update the cache and record
  `metadata.screenTileCache` with tile count, previous tile count, dirty region
  count, and cache update status.
- `smoke:computer-use-session` now runs two screen observes. The second one
  receives the previous tile hash, returns zero dirty regions, and verifies the
  `roi_ocr` cascade stage is skipped.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-session`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper allowed in development mode and one Windows
temp cleanup deferred retry.

## Latest Update: Computer Session Action Feedback

Implemented the first action-feedback envelope:
- Added `ComputerSessionActionFeedbackSummary` to the shared Computer Use
  protocol and `ComputerSessionDebugBundle.actionFeedbacks`.
- Browser Action result recording now creates a `browser_action` feedback row
  after pre/post observations are recorded. The row links action type/status,
  verifier status, before/after observation ids, perception graph id,
  capability job id, DAG node id, target evidence, and redaction policy.
- Browser Action feedback rows now create linked `browser_action_feedback` eval
  ledger steps; the debug-bundle feedback row stores the eval step id.
- Renderer Computer Use Activity details now show a Feedback section with
  action type, summary, verifier status, before/after ids, graph id, and job id.
- This is the structured feedback envelope needed for the Computer Use action
  loop. Raw screenshot feedback remains governed by existing blob retention and
  watch-mode boundaries.

Verification passed `npm run build:daemon`, `npm run build:renderer`,
`npm run smoke:computer-use-browser-parity`, and
`npm run smoke:renderer-chat`. Follow-up verification passed `npm run lint`
and final `npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Screen Observe Perception Graphs

Implemented the first non-DOM graph input for Computer Session observations:
- Added `buildPerceptionGraphFromScreenObservation()` in the perception graph
  module. It converts bounded screen text/boxes into graph nodes that combine
  OCR visible-text/box evidence with screenshot-region, bbox, freshness, and
  source-reliability evidence.
- `screen_observe` Computer Session completions now create
  `computer_session_screen_observation` graphs when output includes
  `screenText`, `recognizedText`, `ocrBoxes`, `textBoxes`, or equivalent
  bounded text regions.
- The graph id is linked from the screen observation and eval step alongside
  the existing `roi_cascade_evidence` resource. Raw screenshots remain outside
  the debug bundle and follow the existing retention policy.
- `smoke:computer-use-session` now asserts screen observations expose the
  graph and that the node has both screenshot-region and OCR visible-text
  evidence.

Verification passed `npm run build:daemon` and
`npm run smoke:computer-use-session`. Follow-up verification passed
`npm run lint`, `npm run smoke:research-performance-architecture`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Arbitration Actionability Gate

Hardened the shared target arbitration safety rule:
- Non-actionable screen/OCR nodes can still ground read-only state, but they no
  longer authorize side-effect, high-risk, or credential actions.
- Such candidates record `target_not_actionable`; an actionable DOM/UIA/native
  node is required before action execution can treat the target as allowed.
- `smoke:research-performance-architecture` now asserts read-only screen OCR
  can pass while side-effect screen OCR is blocked. Browser parity still passes
  because DOM targets are actionable.

Verification passed `npm run build:daemon`,
`npm run smoke:research-performance-architecture`, and
`npm run smoke:computer-use-browser-parity`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper allowed in development mode and one Windows
temp cleanup deferred retry.

## Latest Update: Native Helper Release Readiness

Implemented the release-signing hardening slice for the v1 native browser-window
helper:
- Runtime native helper status diagnostics now include
  `native-desktop-helper-release-readiness.v1` with helper provenance, source,
  implementation, size, SHA-256, mtime, Authenticode signature status, blockers,
  and development-only/release-ready verdict.
- The diagnostics explicitly keep Node/cmd/PowerShell helpers
  development-only. Native `.exe` helpers require a valid Authenticode
  signature before `releaseReady` can be true.
- Release readiness now checks the bundled helper artifact and gates
  `browser-native-helper-signing`; the gate is deferred in
  `docs/release/deferred-gates.json` until a production certificate or CI
  signing service exists. Strict release mode still fails on the deferred gate.
- The broader foreground `visual_desktop_action` path remains blocked until
  signed watch-mode helper v2, countdown/idle/user-input-abort guards,
  active-window proof, and rollback/effect verification are implemented.

Verification passed `npm run build:daemon`,
`npm run smoke:browser-action:native`,
`npm run smoke:browser-native-desktop-helper:signature`,
`node --check scripts/release-readiness.mjs`, and a direct
`getNativeDesktopHelperReleaseReadiness()` probe. Follow-up verification passed
`npm run lint`, final `npm run smoke:all`, `git diff --check`,
UTF/mojibake scan, and .cs BOM check. Known non-failing notes remained the
unsigned browser-native helper allowed in development mode and one Windows temp
cleanup deferred retry.

## Latest Update: Browser Permission Content Settings

Implemented the helper-v2-free browser permission workflow:
- Added Browser Chrome commands `permission.get` and `permission.set`.
  `permission.get` is read-only; `permission.set` requires one-time approval
  through the existing capability safety policy.
- The Browser Bridge extension executes permission changes through Chrome
  `contentSettings` for bounded site permissions such as camera, microphone,
  location, notifications, popups, and automatic downloads.
- Computer Session persistence redacts URL paths for permission commands while
  retaining transient full URLs only for command execution. Output evidence
  records permission type, origin, primary pattern, requested/verified setting,
  `pathRedacted: true`, `popupWorkflow: content_settings_api`, and
  `nativePopupClick: false`.
- Extension metadata now declares and explains the `contentSettings`
  permission in store listing, privacy notes, and review notes. The visual
  browser permission-bubble click path remains blocked until signed watch-mode
  helper v2 exists.

Verification passed `npm run build:daemon`,
`npm run smoke:browser-chrome-capability`,
`npm run smoke:computer-use-browser-chrome`, `npm run smoke:extension`, and
`npm run smoke:browser-store`. A pre-existing
`smoke:computer-use-session-http` race was fixed by polling capability job
completion after Browser Action result POST. Follow-up verification passed
`npm run lint`, `npm run smoke:computer-use-session-http`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Computer Use Rollback Actions

Implemented the first executable Computer Session rollback route:
- Added `POST /computer-use/sessions/:sessionId/rollback-actions/:rollbackId`.
- `delete_artifact` rollback actions call the scoped-autonomy rollback runtime,
  record a `rollback_action` eval cleanup step, update rollback status/metadata
  in the debug bundle, and require explicit `includeUserArtifacts` plus
  `confirmUserArtifacts` before deleting user artifacts. Safe rollback defaults
  to runtime-only cleanup and skips user artifacts.
- `cancel_capability_job` rollback actions now cancel the active capability job
  through the capability runtime.
- Renderer rollback rows now expose compact Safe/Delete controls. Delete is
  only enabled for `delete_artifact` rollback rows, while completed/skipped
  rows cannot be rerun from the panel.

Verification passed `npm run build:daemon`, `npm run build:renderer`,
`npm run smoke:computer-use-toolsmith-artifact`, and
`npm run smoke:renderer-chat`. Follow-up verification passed `npm run lint`
and final `npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper allowed in development mode and one Windows temp cleanup
deferred retry.

## Latest Update: Computer Session Browser Prompt Dogfood

Added a direct Computer Session Browser Action prompt dogfood slice:
- `dogfood:computer-use-browser` now runs four user-like Korean browser prompt
  scenarios through `/computer-use/sessions/:id/browser-action-prompt` on an
  isolated browser fixture: read current page, search form submit,
  representative content selection, and navigation.
- The runner writes dated dogfood JSON, a report, asset evidence, and a redacted
  sample JSONL ledger under `docs/dogfood/` and `docs/reports/assets/`.
- `smoke:computer-use-browser-dogfood` validates prompt-run completion,
  Computer Session DAG/eval/verifier linkage, DOM observations, side-effect
  perception graph evidence, action feedback, cleanup rollback, redaction, and
  latency samples.
- The promotion gate now includes
  `computer_session_browser_prompt_dogfood` as a passed but non-promoting
  fixture readiness slice. Public-site live Computer Session browser prompt
  evidence is still required before promotion.
- The renderer Promotion gate section now shows all gate rows instead of
  truncating at six.

Verification passed `node --check` for the new/gate scripts,
`npm run dogfood:computer-use-browser`, `npm run smoke:computer-use-browser-dogfood`,
`npm run gate:computer-use-promotion`,
`npm run smoke:computer-use-promotion-gate-route`,
`npm run smoke:computer-use-promotion-gate`, `npm run build:renderer`,
`npm run smoke:renderer-chat`, `npm run lint`, and final
`npm run smoke:all`. `git diff --check` returned only existing CRLF
normalization warnings, UTF/mojibake scan passed for changed text files, and no
`.cs` files were touched.

## Latest Update: Computer Session Browser Prompt Live Corpus

Added repeated public-site live dogfood for the parent Computer Session Browser
Action prompt route:
- `dogfood:computer-use-browser-live` runs four public-site scenarios through
  `/computer-use/sessions/:id/browser-action-prompt` on isolated browser
  surfaces: read `example.com`, search on `wikipedia.org`, click Example
  Domain's More information link, and navigate to IANA reserved domains.
- `smoke:computer-use-browser-live-dogfood` validates the live evidence file
  and redacted sample ledger.
- The runner was executed twice on 2026-05-16, producing 8 live sample rows in
  `docs/reports/assets/computer-use-browser-prompt-live-runs.jsonl`.
- The promotion gate now includes `computer_session_browser_prompt_live` as a
  promotable live prompt slice. It requires repeated samples, required intent
  coverage, public host coverage, direct prompt-route evidence, prompt-run
  completion, DAG/eval/verifier evidence, DOM observations, side-effect graph
  evidence, action feedback, cleanup proof, public URL metadata only, and p95
  latency samples.

Focused verification passed `node --check` for the new/gate scripts,
two runs of `npm run dogfood:computer-use-browser-live`,
`npm run smoke:computer-use-browser-live-dogfood`, and
`npm run gate:computer-use-promotion`. Follow-up verification passed
`npm run smoke:computer-use-promotion-gate-route`,
`npm run smoke:computer-use-promotion-gate`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned helper
development allowance and one Windows temp cleanup deferred retry.

## Latest Update: Toolsmith NPM Dependency Prepare Smoke

Added a focused Toolsmith dependency-preparation smoke:
- `ScopedAutonomyRuntime.prepareToolDependencies(...)` exposes the existing
  dependency preparation path as a callable runtime API for direct verification.
- `smoke:scoped-autonomy-npm-dependency-prepare` creates a generated-tool
  manifest with a local `file:` npm fixture, so package-install behavior is
  tested without registry/network dependency.
- The smoke proves the blocked path first: with `npm`, runtime workspace write,
  and `side_effect` grants but no `package_install`, the tool run is blocked,
  the missing grant names `package_install`, and no lockfile is written.
- The smoke then proves the allowed path: with `package_install`, `npm`,
  runtime workspace write, and `side_effect`, dependency preparation completes,
  `package.json`/`package-lock.json` are created under the generated tool
  runtime workspace, and lockfile hashes/provenance are recorded in both the
  tool run and eval step.
- The smoke found and fixed a Windows npm spawn issue. Toolsmith now invokes
  npm through `cmd.exe /d /s /c npm.cmd ...` on Windows, while non-Windows keeps
  a direct `npm` spawn.

Verification passed `node --check` for the new smoke and `smoke-all`, `npm run
build:daemon`, `npm run smoke:scoped-autonomy-npm-dependency-prepare`, `npm run
smoke:scoped-autonomy-self-implementation`, `npm run lint`, final `npm run
smoke:all`, `git diff --check`, UTF/mojibake scan, and `.cs` touched-file
check. Known non-failing notes remained existing CRLF normalization warnings,
the unsigned browser-native helper development allowance, and one Windows temp
cleanup deferred retry. `npm run vibe:checkpoint` passed after this boundary.

## Latest Update: Computer Use Source/Artifact Evidence UX

Improved the Computer Use renderer evidence surface:
- The Artifacts section now shows compact proof metrics: blob-backed count,
  text artifact count, PDF count, and whether any artifact rows lack blob
  proof.
- Artifact rows now summarize basename/redaction mode when available instead
  of only showing opaque blob/capability ids.
- The Sources section now shows source-quality metrics: direct source count,
  browser-fallback count, total extracted characters, and an overall quality
  label (`direct`, `fallback`, `hybrid`, or `mixed`).
- Source rows now preserve browser fallback reason in the visible summary.

Verification passed `npm run build:renderer` and `npm run smoke:renderer-chat`.
Follow-up verification passed `npm run lint`, final `npm run smoke:all`,
`git diff --check`, UTF/mojibake scan, and `.cs` touched-file check. Known
non-failing notes remained existing CRLF normalization warnings, the unsigned
browser-native helper development allowance, and one Windows temp cleanup
deferred retry. `npm run vibe:checkpoint` passed after this boundary.

## Latest Update: Autonomy Toolsmith Stability UX

Improved the Autonomy Toolsmith renderer panel:
- Selected runs now show stability/rerun summary from generated tool manifests,
  including rerun count and last rerun status when available.
- Rollback impact is summarized from the latest rollback tool run or manifest
  rollback actions without displaying raw filesystem targets.
- Dependency provenance is summarized by dependency source counts.
- Artifact contract evidence is summarized by required/total contract roles.

Verification passed `npm run build:renderer`, `npm run smoke:renderer-chat`,
`npm run lint`, final `npm run smoke:all`, `git diff --check`, UTF/mojibake
scan, and `.cs` touched-file check. Known non-failing notes remained existing
CRLF normalization warnings, the unsigned browser-native helper development
allowance, and one Windows temp cleanup deferred retry. `npm run
vibe:checkpoint` passed after this boundary.

## Latest Update: Toolsmith Rerun Artifact Comparison

Made Toolsmith rerun comparison artifact-aware:
- `ScopedAutonomyRuntime.rerunToolRun(...)` now writes
  `toolsmith-rerun-comparison.v1` into the rerun tool-run output.
- The comparison records scalar fingerprint match plus artifact fingerprint
  counts and changed/missing/added artifact keys without raw paths.
- A dedicated `toolsmith_rerun_comparison` eval step is recorded.
- Manifest stability continues to update from the comparison result.
- Autonomy Toolsmith stability cards now include latest artifact delta count
  when rerun comparison evidence exists.

Verification passed `npm run build:daemon`, `npm run build:renderer`,
`node --check scripts/smoke-scoped-autonomy-self-implementation.mjs`,
`npm run smoke:scoped-autonomy-self-implementation`,
`npm run smoke:renderer-chat`, `npm run lint`, final `npm run smoke:all`,
`git diff --check`, UTF/mojibake scan, and `.cs` touched-file check. Known
non-failing notes remained existing CRLF normalization warnings, the unsigned
browser-native helper development allowance, and one Windows temp cleanup
deferred retry. `npm run vibe:checkpoint` passed after this boundary.

## Latest Update: Windows Settings Read-Only Smoke

Added a Computer Session smoke for a real Windows settings read-only workflow:
- `smoke:computer-use-windows-settings` creates a scoped autonomy profile with
  only `reg query` allowed, starts a `pty_workspace` session, and executes
  `reg query HKCU\Environment` through the terminal capability path.
- The smoke verifies allow safety-decision evidence, completed terminal
  capability job evidence, terminal observation evidence, and debug-bundle
  terminal redaction. Raw stdout/stderr are omitted while bounded preview/hash
  metadata remain available.
- The same smoke attempts
  `reg add HKCU\Environment /v CODEX_WIDGET_BLOCKED_SMOKE /t REG_SZ /d blocked /f`
  and verifies the mutation is blocked before capability job creation with
  exact missing command/risk requirements plus
  `terminal_command_destructive_boundary`.
- The smoke is wired into `smoke:all`.
- `smoke:computer-use-session-http` was hardened against a prompt-run/DAG
  follow-up race by polling for Browser Action `:verification` and
  `:eval_ledger` nodes before asserting.

Verification passed `node --check` for both touched smoke scripts,
`npm run smoke:computer-use-session-http`,
`npm run smoke:computer-use-windows-settings`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained existing CRLF
normalization warnings, the unsigned browser-native helper development
allowance, and one Windows temp cleanup deferred retry. The renderer artifact
content URL builder now avoids a double-quoted question-mark suffix literal so
the strict mojibake scan remains clean. Final `git diff --check`,
UTF/mojibake scan, and `.cs` touched-file check passed after this handoff/log
update.

## Latest Update: Active Job Cancellation Smoke

Added focused coverage for Computer Session cancellation propagation:
- `smoke:computer-use-session` now includes a cancellable long-running
  `screen_observe` handler that waits for the `AbortSignal`.
- The smoke starts a second Computer Session, launches the long-running
  operation, cancels the session, and verifies the capability job reaches
  `cancelled` after observing the abort signal.
- The debug bundle must contain the cancelled capability job, a completed
  `cancel_capability_job` rollback action, and a cancelled DAG run.
- This verifies the Phase 2 requirement that session cancellation propagates to
  active capability jobs, not only to session state.

Focused verification passed `node --check scripts/smoke-computer-use-session.mjs`
and `npm run smoke:computer-use-session`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper development allowance and one Windows temp
cleanup deferred retry.

## Latest Update: Browser Profile Surface Gate

Enforced explicit grants for current browser profile access:
- `ComputerSessionRuntime.start()` now blocks `regular_browser_extension`
  startup unless the attached scoped autonomy profile grants
  `browser_automation` and `high_risk`.
- Blocked startup records a `surface_permission_profile` safety decision, a
  failed `permission_check` DAG node with exact missing requirements, a blocked
  eval step, and failed eval/DAG run status.
- `smoke:computer-use-session` now verifies both no-profile blocked startup and
  allowed startup with an explicit browser profile grant.
- `smoke:computer-use-browser-chrome` now carries the explicit `high_risk`
  grant in its one-time Browser Chrome profile.

Focused verification passed `npm run build:daemon`,
`node --check scripts/smoke-computer-use-session.mjs`,
`node --check scripts/smoke-computer-use-browser-chrome.mjs`,
`npm run smoke:computer-use-session`, and
`npm run smoke:computer-use-browser-chrome`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper development allowance and one Windows temp
cleanup deferred retry.

## Latest Update: Daemon-Scoped DAG Runtime

Promoted DAG runtime ownership into daemon startup:
- `startDaemon()` now constructs a process-level `CapabilityDagRuntime` beside
  the daemon `CapabilityRuntime`.
- The daemon injects that instance into `ComputerSessionRuntime`; the runtime
  constructor fallback remains available for direct tests.
- This closes the Phase 2 gap where daemon Computer Sessions relied on a
  session-runtime-owned DAG runtime.

Focused verification passed `npm run build:daemon` and
`npm run smoke:computer-use-session-http`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper development allowance and one Windows temp
cleanup deferred retry.

## Latest Update: Session-Level Cross-Source Target Graph Set

Expanded target evidence for Browser Action pre-action observations:
- Target arbitration now receives a deduplicated session graph set: current
  Browser Action graph, perception graphs linked from prior session
  observations, and recent stored session graphs.
- `computer-session-target-evidence.v1` now embeds
  `computer-session-target-graph-set.v1` with graph/source counts, source
  breakdown, current graph id, and observation-linked graph count.
- Arbitration metadata now includes candidate-source summaries so debug bundles
  show whether DOM, OCR/screenshot, UIA/native, or other sources contributed
  candidates.
- Safety remains unchanged: non-actionable OCR/screenshot evidence may explain
  and rank but cannot authorize side-effect actions without actionable
  structured evidence.
- Renderer target evidence previews now show graph/source counts.
- `smoke:computer-use-session` verifies a DOM click target arbitrated against a
  matching screen/OCR graph.

Focused verification passed `node --check scripts/smoke-computer-use-session.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-session`,
`npm run smoke:computer-use-browser-parity`, and
`npm run smoke:research-performance-architecture`. Follow-up verification
passed `npm run build:renderer`, `npm run smoke:renderer-chat`,
`npm run lint`, and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper development allowance and one Windows temp
cleanup deferred retry.

## Latest Update: Native File Picker Boundary

Added an explicit non-executing boundary for native file picker workflows:
- `ComputerStructuredOperation` now includes `native_file_picker_action`.
- `ComputerSessionRuntime` blocks native picker automation before local path
  disclosure or native input while signed helper v2, one-time file-selection
  approval, active-window proof, abort-on-user-input, and path redaction
  preconditions are missing.
- Blocked attempts record approval/action/follow-up DAG nodes, a
  `native_file_picker_preconditions` safety decision, a
  `native_file_picker_blocked` eval step, a `native_file_picker_boundary` file
  observation, verifier failure, skipped rollback, and structured failure
  memory.
- `smoke:computer-use-native-watch-boundary` now covers both foreground visual
  input blocking and native file picker blocking, and asserts no
  `desktop_action` capability job is created for either boundary.
- `windows_native_watch_boundary` promotion gate now verifies the file picker
  boundary implementation and smoke coverage through
  `native_file_picker_blocked_before_path_disclosure` and
  `native_file_picker_boundary_smoke_present`.

Focused verification passed `node --check scripts/smoke-computer-use-native-watch-boundary.mjs`,
`npm run build:daemon`, and `npm run smoke:computer-use-native-watch-boundary`.
Follow-up verification passed `npm run lint`, final `npm run smoke:all`,
`node --check scripts/gate-computer-use-promotion.mjs`,
`npm run smoke:computer-use-promotion-gate`, and
`npm run smoke:computer-use-promotion-gate-route`. The first aggregate attempt
hit a transient `smoke:computer-use-session-http` FK failure; the focused HTTP
smoke passed immediately afterward and the next aggregate run passed. Known
non-failing notes remained the unsigned browser-native helper development
allowance and one Windows temp cleanup deferred retry.

## Latest Update: Future VM Sandbox Boundary

Added a non-executing boundary for the future VM/sandbox surface:
- `future_vm_session` now carries VM-specific surface grants:
  `vm.session_backend`, `vm.network_isolation`, `vm.lifecycle_cleanup`, and
  `vm.artifact_sync_policy`.
- Requested `future_vm_session` sessions block during setup with
  `future_vm_session_backend_not_available` before VM creation, network bridge,
  host mutation, clipboard/file sync, or raw screenshot retention.
- The blocked start records failed/skipped DAG nodes, a
  `future_vm_session_preconditions` safety decision,
  `future_vm_session_blocked` eval step, `future_vm_session_boundary`
  observation, failed verifier, skipped rollback, and structured failure
  memory with abstention triggers.
- Added `smoke:computer-use-vm-sandbox-boundary`, wired it into `smoke:all`,
  and added a passed-but-non-promoting `future_vm_sandbox_boundary` promotion
  gate.

Focused verification passed `node --check scripts/smoke-computer-use-vm-sandbox-boundary.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-vm-sandbox-boundary`,
`node --check scripts/gate-computer-use-promotion.mjs`, and
`npm run smoke:computer-use-promotion-gate`. Follow-up verification passed
`npm run smoke:computer-use-surface-manager`,
`npm run smoke:computer-use-promotion-gate-route`, `npm run lint`, and final
`npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper development allowance and one Windows temp cleanup
deferred retry.

## Latest Update: Dedicated Computer Use Debug Bundle Smoke

Replaced the `smoke:computer-use-debug-bundle` proxy alias with a direct route
and schema smoke:
- Added `scripts/smoke-computer-use-debug-bundle.mjs`.
- The smoke starts a blocked `future_vm_session` case, fetches
  `/computer-use/sessions/:id/debug-bundle`, and verifies
  `computer-session-debug-bundle.v1` shape, redaction policy, eval/DAG status,
  top-level arrays, freshness summary, boundary observation, skipped rollback,
  verifier failure, and failure memory.
- `smoke:all` now runs the dedicated debug-bundle smoke.

Focused verification passed `node --check scripts/smoke-computer-use-debug-bundle.mjs`
and `npm run smoke:computer-use-debug-bundle`. Follow-up verification passed
`npm run lint` and final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper development allowance and one Windows temp
cleanup deferred retry.

## Latest Update: Renderer Computer Use Live Refresh

Added event-driven live refresh for the renderer Computer Use panel:
- `WidgetRuntime` now increments a Computer Use refresh signal when daemon
  `computer.session.*`, `capability.job`, `capability.jobs`, or
  `capability.resource` events arrive.
- `WidgetRuntimeView` and `ActivityLog` pass that signal into
  `ComputerUseSessionsPanel`.
- `ComputerUseSessionsPanel` debounces the signal, runs a quiet refresh of
  session/surface/profile/promotion-gate data, refetches the selected debug
  bundle after the quiet refresh settles, and shows a compact Live refresh
  timestamp metric.
- Added `scripts/smoke-renderer-computer-use-live-refresh.mjs` and
  `smoke:renderer-computer-use-live-refresh`; the smoke runs a fake daemon over
  HTTP+WebSocket and verifies a `computer.session.state` event updates renderer
  session state plus the selected debug-bundle DAG row without manual refresh.
- Wired the focused smoke into `smoke:all`.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-live-refresh.mjs`,
`npm run smoke:renderer-computer-use-live-refresh`, `npm run build:renderer`,
`npm run smoke:renderer-chat`, and `npm run lint`. Follow-up verification
passed final `npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper development allowance and one Windows temp cleanup
deferred retry.

## Latest Update: Browser Bridge Restricted Reload Gate

Added a Browser Bridge restricted/reload promotion-readiness guard:
- `scripts/gate-computer-use-promotion.mjs` now emits
  `browser_bridge_restricted_reload_boundary`.
- The gate is passed but non-promoting. It verifies the
  `browser.restricted.extensions.reload` 30-case scenario remains blocked by
  design, `smoke:browser-bridge` covers `reloadRequired`, `permission_needed`,
  and `restricted` bridge states, `smoke:extension` plus popup source expose
  `Reload bridge` through `chrome.runtime.reload()`, renderer Browser Action UI
  contains reload/restricted recovery guidance, and injected Browser Action
  commands retain the restricted-page bypass guard.
- `smoke-computer-use-promotion-gate-route` now asserts the new gate is exposed
  through `/computer-use/eval/promotion-gate`.
- Regenerated the 2026-05-16 promotion gate evidence/report.

Focused verification passed `node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run smoke:computer-use-promotion-gate`,
`npm run gate:computer-use-promotion`,
`npm run smoke:computer-use-promotion-gate-route`,
`npm run smoke:browser-bridge`, and `npm run smoke:extension`. Follow-up
verification passed final `npm run smoke:all`. Known non-failing notes remained
the unsigned browser-native helper development allowance and one Windows temp
cleanup deferred retry.

## Latest Update: Windows Settings Reversible Dogfood

Added the reversible middle step for Windows app/settings dogfood:
- `ComputerSessionRuntime` now recognizes a narrow
  `reversibleWindowsSetting.scope = "hkcu_app_registry"` descriptor for terminal
  operations.
- The only allowed reversible registry root is
  `HKCU\Software\CodexWidgetComputerUseSmoke`; `reg add/delete` must exactly
  match the bounded set/delete command form and safe value name/data patterns.
- The bounded path still requires scoped autonomy grants for exact command
  allowlist, `osMutation`, and `high_risk`. Unmarked or broad `reg add/delete`
  commands remain blocked by `terminal_command_destructive_boundary`.
- `smoke:computer-use-windows-settings` now verifies read-only `reg query`,
  blocked broad `HKCU\Environment` mutation, bounded reversible set/query/delete
  with absence proof, safety-decision evidence, and terminal observation
  metadata.
- `gate:computer-use-promotion` now exposes this as
  `windows_settings_reversible_dogfood_boundary`, a passed but non-promoting
  guard for the read-only/reversible/blocked Windows settings progression.

Focused verification passed `node --check scripts/smoke-computer-use-windows-settings.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-windows-settings`,
`node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run smoke:computer-use-promotion-gate`,
`npm run gate:computer-use-promotion`, and
`npm run smoke:computer-use-promotion-gate-route`. Follow-up verification
passed `npm run lint` and final `npm run smoke:all`. Known non-failing notes
remained the unsigned browser-native helper development allowance and one
Windows temp cleanup deferred retry.

## Latest Update: Autonomy Toolsmith Rerun History UX

Added historical rerun comparison browsing to Activity details:
- `AutonomyToolsmithPanel` now summarizes all `mode: "rerun"` tool runs with
  `toolsmith-rerun-comparison.v1` output into compact history rows.
- Rows show matched/changed verdict, scalar match state, artifact match state,
  changed/missing/added artifact counts, artifact totals, elapsed time, and a
  redacted rerun id.
- The stability evidence card still shows the latest artifact delta summary;
  the new history block lets users inspect older comparisons without opening
  raw Toolsmith JSON.
- Added `scripts/smoke-renderer-autonomy-rerun-history.mjs`,
  `smoke:renderer-autonomy-rerun-history`, and `smoke:all` wiring.

Focused verification passed `node --check scripts/smoke-renderer-autonomy-rerun-history.mjs`,
`npm run smoke:renderer-autonomy-rerun-history`, `npm run build:renderer`, and
`npm run smoke:renderer-chat`. Follow-up verification passed `npm run lint` and
final `npm run smoke:all`. Known non-failing notes remained the unsigned
browser-native helper development allowance and one Windows temp cleanup
deferred retry.

## Latest Update: Approved Execution Handoff Shards

The product owner reviewed the Windows Codex Computer Use parity briefing and
approved proceeding with the current design. Because the implementation scope is
large, added a dedicated sharded execution handoff under:

- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/README.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/01-target-boundaries.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/02-current-inventory.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/03-implementation-slices.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/04-runtime-contracts.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/05-verification-dogfood-promotion.md`
- `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/06-resume-maintenance.md`

The top-level parity handoff and `08-implementation-resumption-handoff.md` now
point future sessions to the `09` pack before continuing implementation. The
pack captures the accepted benchmark target, non-negotiable safety boundaries,
current source inventory, immediate next slice, runtime contracts, verification
matrix, dogfood/promotion rules, and restart/maintenance procedure.

Immediate next recommended implementation slice:

- Foreground watch-mode user-input abort preflight.
- Keep it non-executing and blocked before native input.
- Record DAG/safety/observation/verifier/failure-memory/debug evidence with
  `actualInputSent: false`.
- Strengthen the `windows_native_watch_boundary` promotion gate without
  claiming helper v2 completion.

## Latest Update: Foreground Watch User-Input Abort Preflight

Implemented the first post-handoff slice:

- `ComputerStructuredOperation.visual_desktop_action` accepts optional
  `watchPreflight` metadata.
- `ComputerSessionRuntime` normalizes that metadata to
  `foreground-watch-preflight.v1`.
- `abortOnUserInputArmed` plus `userInputDetected` now blocks with
  `foreground_watch_user_input_abort` before native input.
- Active-window drift blocks with
  `foreground_watch_active_window_drift_abort` before native input.
- The original helper-v2 unavailable path still blocks with
  `foreground_watch_mode_v2_not_available`.
- All visual watch boundary paths keep `actualInputSent: false` and create no
  `desktop_action` capability job.
- `smoke:computer-use-native-watch-boundary` now covers the user-input abort
  path and verifies DAG/eval/verifier/safety/observation/failure-memory
  evidence.
- `windows_native_watch_boundary` promotion gate now checks for the abort guard
  and smoke evidence while staying non-promoting.

Focused verification passed `node --check scripts/smoke-computer-use-native-watch-boundary.mjs`,
`node --check scripts/gate-computer-use-promotion.mjs`,
`node --check scripts/smoke-computer-use-promotion-gate-route.mjs`,
`npm run build:daemon`, `npm run smoke:computer-use-native-watch-boundary`,
`npm run smoke:computer-use-promotion-gate`,
`npm run gate:computer-use-promotion`, and
`npm run smoke:computer-use-promotion-gate-route`.

## Latest Update: Renderer One-Time Profile Draft Preview

Implemented a focused Renderer Permission Profile UX slice:

- `ComputerUseSessionsPanel` shows a draft one-time profile preview for blocked
  runs before attachment.
- The preview exposes scope, max uses, credential policy, risk classes, browser
  grants, exact command count, and write-root count.
- Generated one-time profiles still derive grants only from missing
  requirements and keep `credentialAccess: "never"`.
- Added `scripts/smoke-renderer-computer-use-profile-draft.mjs`,
  package script `smoke:renderer-computer-use-profile-draft`, and
  `smoke:all` wiring.
- The smoke runs a fake daemon, verifies the draft UI, clicks `One-time`,
  checks the profile POST body is one-time/high-risk/browser-scoped with no
  credential grant, and verifies session attachment.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-profile-draft.mjs`,
`node --check scripts/smoke-all.mjs`, `npm run build:renderer`, and
`npm run smoke:renderer-computer-use-profile-draft`.

## Latest Update: Renderer Selected Profile Detail And Lifecycle Controls

Extended the Computer Use permission-profile UX:

- Selecting an active profile in `ComputerUseSessionsPanel` now shows profile
  detail: scope, mode, status, risk classes, browser grant summary, command and
  write counts, generated-code state, credential policy, use count, and expiry.
- The detail card exposes Disable and Expire actions using the existing
  `POST /computer-use/autonomy/profiles/:id` update route.
- `smoke:renderer-computer-use-profile-draft` now also verifies selected
  profile detail rendering, exact domain/command/write-root grant values, and
  Disable lifecycle POST wiring.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-profile-draft.mjs`,
`npm run build:renderer`, and `npm run smoke:renderer-computer-use-profile-draft`.

## Latest Update: macOS Parity Implementation Handoff Shards

The product owner reviewed the updated macOS Computer Use parity briefing and
approved proceeding. Added a new detailed shard pack under:

- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/README.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/01-parity-contract.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/02-runtime-architecture.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/03-browser-chrome-and-web.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/04-native-screen-and-windows.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/05-toolsmith-terminal-artifacts.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/06-safety-permission-release.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/07-eval-dogfood-promotion.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/08-implementation-backlog.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/09-resume-protocol.md`

The pack defines user-outcome parity, the daemon Computer Session loop,
browser/chrome/web implementation paths, native/screen/watch-mode boundaries,
Toolsmith/terminal/artifact workflows, safety/release policy, eval/dogfood
promotion gates, ordered implementation phases, and context-loss resume rules.

Updated the top-level parity handoff, `00-overview.md`, the approved execution
README, and `docs/plans/README.md` so future sessions read the new `10` pack
after the current `09` status pack. The first implementation phase in the new
backlog is to finish the interrupted Browser Chrome repeated dogfood slice and
to treat regular browser-extension session cancellation as cleanup
reconciliation when no isolated `close_surface` rollback exists.

## Latest Update: Browser Chrome Repeated Dogfood Gate

Completed the Browser Chrome repeated dogfood stabilization slice:

- `collect-computer-use-browser-chrome-dogfood.mjs` now treats regular
  browser-extension session cancellation as cleanup reconciliation when no
  isolated `close_surface` rollback exists.
- The collector verifies completed eval evidence through the current
  `browser_chrome_observation` step linked to the capability job id, while
  retaining compatibility with the older `browser_chrome` step name.
- Reran `dogfood:computer-use-browser-chrome`, producing successful repeated
  fixture-bridge evidence for `download.verify` and `debugger.print_to_pdf`.
- Added `browser_chrome_repeated_dogfood` to `gate:computer-use-promotion`.
  It verifies schema, fixture evidence class, repeated samples, 100% latest
  sample success, `download_verified_file` resource proof, debugger PDF proof,
  redaction, cleanup reconciliation, verifier/eval nodes, and p95 samples.
- The gate remains non-promoting with
  `fixture_bridge_dogfood_needs_real_extension_live_gate_before_promotion`, so
  real extension live samples remain the next Browser Chrome promotion step.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome`
- `npm run smoke:computer-use-browser-chrome-dogfood`
- `npm run smoke:computer-use-promotion-gate`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended slice: continue Renderer Permission Profile UX Completion with
full create/edit management or profile lifecycle evidence in the promotion gate.

## Latest Update: Renderer Selected Profile Grant Details

Added exact selected-profile grant details to the Computer Use panel:

- Active selected profiles now show domain, command allow-prefix, read root,
  write root, package install, OS mutation, generated-tool, and generated-code
  grant values in a compact scrollable list.
- The profile detail smoke now verifies `example.com`,
  `node scripts/report.mjs`, and an approved output root render before the
  Disable lifecycle action is triggered.

Focused verification passed `node --check scripts/smoke-renderer-computer-use-profile-draft.mjs`,
`npm run build:renderer`, and `npm run smoke:renderer-computer-use-profile-draft`.

## Latest Update: Browser Chrome Real Extension Local Dogfood Gate

Added real Browser Bridge extension local-fixture dogfood for Browser Chrome
deep actions:

- `collect-computer-use-browser-chrome-live-extension-dogfood.mjs` launches a
  Playwright Chromium persistent profile with the unpacked MV3 Browser Bridge
  extension.
- The collector attaches WebSocket listeners immediately after socket creation,
  configures the extension against the daemon, forces Chrome download behavior
  into the approved smoke output root, and refreshes the bridge when commands
  are queued.
- The download scenario executes real extension `download.start`, waits for
  `download.observe` to reach `complete`, then runs `download.verify` with an
  approved path and records `download_verified_file` eval resource evidence.
- The debugger scenario targets the allowed fixture tab id explicitly and runs
  fixed-command `debugger.print_to_pdf` with raw PDF bytes omitted from
  reports.
- Added `smoke:computer-use-browser-chrome-live-extension-dogfood`.
- Wired that evidence smoke into `smoke:all`.
- Added `browser_chrome_live_extension_dogfood` to the Computer Use promotion
  gate and route smoke. The gate passes but remains non-promoting with
  `real_extension_local_fixture_gate_passed_public_live_gate_required`.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-live-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome-live-extension`
- `npm run smoke:computer-use-browser-chrome-live-extension-dogfood`
- `npm run smoke:computer-use-promotion-gate`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: collect repeated public-site real
extension samples while keeping local-fixture and public-site evidence classes
separate.

## Latest Update: Browser Chrome Public Extension Promotion Gate

Added repeated public-site Browser Chrome dogfood through the real Browser
Bridge extension:

- `collect-computer-use-browser-chrome-public-extension-dogfood.mjs` launches
  Chromium with the unpacked extension, configures daemon bridge settings, and
  runs real extension commands against public unauthenticated targets.
- The collector runs two repeated `download.start` + `download.verify` samples
  against a W3C public dummy PDF, two fixed-command `debugger.print_to_pdf`
  samples against `example.com`, and two bounded
  `tab_group.claim/update/release` samples on a dogfood-owned public tab.
- Evidence records public hosts plus URL SHA-256 hashes only, keeps full public
  URLs out of reports, stores download artifacts as basename/hash-backed
  `download_verified_file` resources, and omits raw PDF bytes.
- Added `dogfood:computer-use-browser-chrome-public-extension`,
  `smoke:computer-use-browser-chrome-public-extension-dogfood`, and
  `smoke:all` coverage.
- Added `browser_chrome_public_extension_dogfood` to the Computer Use
  promotion gate and route smoke as a promotable public-site repeated
  real-extension gate covering download, fixed debugger PDF, and tab-group
  side effects.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `node --check scripts/smoke-all.mjs`
- `npm run dogfood:computer-use-browser-chrome-public-extension`
- `npm run smoke:computer-use-browser-chrome-public-extension-dogfood`
- `npm run smoke:computer-use-promotion-gate`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: broaden public real-extension dogfood to
permission/history/file-upload workflows, one risk family at a time.

## Latest Update: Browser Chrome Public Extension History Search Gate

Extended the repeated public-site Browser Chrome dogfood through the real
Browser Bridge extension:

- `collect-computer-use-browser-chrome-public-extension-dogfood.mjs` now runs
  two additional `history.search` samples after seeding only a fresh temporary
  Chromium profile with `example.com`.
- The history slice requires one-time approval, records `risk: high` and
  `approval: one_time`, verifies every returned item has path-redacted URL
  metadata, and stores only host/count/URL-hash evidence.
- The user browser profile is not touched; the dogfood profile is temporary and
  cleaned up with the rest of the public-extension run.
- `browser_chrome_public_extension_dogfood` now requires 8 latest samples:
  download start/verify, fixed debugger print-to-PDF, tab-group
  claim/update/release, and redacted history search.
- Updated the public-extension smoke, promotion gate, route smoke, and parity
  handoff shards to treat history search as completed public real-extension
  evidence.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome-public-extension`
- `npm run smoke:computer-use-browser-chrome-public-extension-dogfood`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: permission/site-setting read and bounded
set/rollback guidance dogfood, or live one-time profile approval dogfood.

## Latest Update: Browser Chrome Public Extension Permission Rollback Gate

Extended the same public real-extension dogfood with bounded Chrome
site-permission evidence:

- `collect-computer-use-browser-chrome-public-extension-dogfood.mjs` now adds
  two `permission.get+set+rollback` samples for the `example.com` camera
  content setting in a fresh temporary Chromium profile.
- Each sample reads the initial setting, applies `camera=block` via
  `chrome.contentSettings` after one-time approval, verifies the applied
  setting, restores the initial setting with a second one-time approval, and
  verifies rollback.
- Evidence stores only host, permission type, scoped-setting values,
  popupWorkflow=`content_settings_api`, nativePopupClick=`false`, URL hash,
  verifier/eval nodes, and cleanup proof. It does not store full origin
  patterns or touch the user's real browser profile.
- `browser_chrome_public_extension_dogfood` now requires 10 latest samples:
  download start/verify, fixed debugger print-to-PDF, tab-group
  claim/update/release, redacted history search, and permission rollback.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome-public-extension`
- `npm run smoke:computer-use-browser-chrome-public-extension-dogfood`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: file-upload blocked/approved preflight
or multi-tab tab group dogfood.

## Latest Update: Browser Chrome Public Extension Multi-Tab Group Gate

Extended the same public real-extension dogfood with multi-tab tab-group
evidence:

- `collect-computer-use-browser-chrome-public-extension-dogfood.mjs` now opens
  two public `example.com` tabs in the fresh temporary Chromium profile, reads
  both explicit tab ids through the Browser Bridge active-tab status, and runs
  two `tab_group.multi_tab_claim+update+release` samples.
- Each sample claims exactly the two dogfood-owned public tab ids, updates the
  group label/color, releases both tabs, and closes the extra dogfood tab.
- Evidence stores only host/hash, tabCount=2, releaseCount>=2, dogfood-owned
  multi-tab redaction, verifier/eval nodes, and cleanup proof.
- `browser_chrome_public_extension_dogfood` now requires 12 latest samples:
  download start/verify, fixed debugger print-to-PDF, single-tab group,
  redacted history search, permission rollback, and multi-tab group.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome-public-extension`
- `npm run smoke:computer-use-browser-chrome-public-extension-dogfood`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: file-upload blocked/approved preflight
or broader permission-type matrix.

## Latest Update: Browser Chrome Public Extension File Upload Gate

Extended the same public real-extension dogfood with bounded file-upload
evidence:

- `collect-computer-use-browser-chrome-public-extension-dogfood.mjs` now
  creates an approved temporary upload file under the dogfood runtime root,
  opens `https://the-internet.herokuapp.com/upload`, and runs two
  `file_upload.inspect+set_files+clear` samples through the real unpacked
  Browser Bridge extension.
- Each sample inspects `#file-upload`, sets exactly the approved temp file via
  the extension/debugger file-input path, verifies selected basename evidence,
  clears the file input, and never submits the form.
- Evidence stores only public host/hash metadata, input count,
  target-input-found proof, selected basename, clear status, `pathRedacted:
  true`, `submitClicked: false`, verifier/eval nodes, and cleanup proof.
- `browser_chrome_public_extension_dogfood` now requires 14 latest samples:
  download start/verify, fixed debugger print-to-PDF, single-tab group,
  redacted history search, permission rollback, multi-tab group, and
  file-upload inspect/set/clear.
- The Computer Use promotion gate remains promotable for this public-site
  real-extension evidence class and now checks the public upload host and
  no-submit/basename-only redaction proof.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome-public-extension`
- `npm run smoke:computer-use-browser-chrome-public-extension-dogfood`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: broaden the public real-extension
permission-type matrix, or defer to signed helper v2 for native file-picker
selection and browser permission-bubble recovery.

## Latest Update: Browser Chrome Public Extension Permission Matrix Gate

Extended the public real-extension Browser Chrome permission rollback dogfood
from a single camera setting to a small permission matrix:

- `collect-computer-use-browser-chrome-public-extension-dogfood.mjs` now runs
  two `permission.get+set+rollback` samples each for `camera`, `microphone`,
  and `location` on `example.com`.
- Each sample reads the initial site setting, applies `block` through Chrome
  `contentSettings` with one-time approval, verifies it, restores the initial
  value with a second one-time approval, and verifies rollback.
- Evidence records only host/hash metadata, permission type, scoped setting
  values, `popupWorkflow: content_settings_api`, `nativePopupClick: false`,
  rollback proof, verifier/eval nodes, and cleanup proof.
- `browser_chrome_public_extension_dogfood` now requires 18 latest samples:
  download start/verify, fixed debugger print-to-PDF, single-tab group,
  redacted history search, camera/microphone/location permission rollback,
  multi-tab group, and file-upload inspect/set/clear.
- The promotion gate now exposes `permissionTypesCovered` and requires
  `camera`, `microphone`, and `location` before treating the public-extension
  gate as promotable.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome-public-extension`
- `npm run smoke:computer-use-browser-chrome-public-extension-dogfood`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: live profile-approval dogfood, or defer
native file-picker selection and browser permission-bubble recovery until signed
helper v2 is available.

## Latest Update: Browser Chrome Public Extension Profile Approval Gate

Added live profile-approval proof to the public real-extension Browser Chrome
dogfood:

- The collector now starts with a no-profile `regular_browser_extension`
  session and verifies it blocks with exact missing grant types:
  `browser_automation` and `risk_class`.
- It then creates a narrow one-time `scoped_yolo` Browser Chrome profile,
  attaches it to the blocked session through
  `POST /computer-use/sessions/:id/profile`, verifies the
  `profile_attached` safety decision and `permission_profile_attached` eval
  step, and cancels the blocked session for cleanup proof.
- The same attached profile is reused for the real extension public command
  matrix: download, print-to-PDF, tab group, history, camera/microphone/location
  permission rollback, multi-tab group, and file upload.
- `browser_chrome_public_extension_dogfood` now keeps 18 command samples and a
  separate `profileApproval` evidence block. The promotion gate requires
  `profileApprovalCovered` before treating the public-extension gate as
  promotable.

Focused verification passed:

- `node --check scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/smoke-computer-use-browser-chrome-public-extension-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:computer-use-browser-chrome-public-extension`
- `npm run smoke:computer-use-browser-chrome-public-extension-dogfood`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`

Next recommended Browser Chrome slice: renderer polish for repeated public
dogfood outcomes, or defer native file-picker/permission-bubble recovery until
signed helper v2 is available.

## Latest Update: Renderer Public Extension Proof Panel

Added renderer polish for the repeated public Browser Chrome dogfood outcomes:

- `ComputerUseSessionsPanel` now expands
  `browser_chrome_public_extension_dogfood` into a dedicated "Public extension
  proof" panel under Promotion gate.
- The panel shows latest sample count, p95 latency, public host count,
  profile-approval status, command-family coverage, permission types, and
  redaction proof.
- `smoke-renderer-computer-use-browser-chrome-evidence.mjs` now provides a
  fake public-extension promotion gate payload and verifies the rendered proof
  text for `Samples 18`, `p95`, `Hosts 3`, `Profile proved`, command-family
  coverage, `camera/microphone/location`, and redaction proof.

Focused verification passed:

- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`

Next recommended Browser Chrome slice: defer native file-picker and browser
permission-bubble recovery until signed helper v2 is available; otherwise move
to release-signing readiness hardening.

## Latest Update: Native Helper Signing Preflight Evidence

Added a release-signing hardening slice for the browser native desktop helper:

- `sign-browser-native-desktop-helper.mjs` now writes a redacted
  `browser-native-desktop-helper-signing.v1` report for skipped, blocked,
  dry-run, failed, and signed outcomes.
- The report includes helper basename/extension, size, SHA-256, mtime,
  signature status, signing method metadata, and timestamp host, but does not
  include certificate passwords or absolute local paths.
- `CODEX_WIDGET_SIGNING_DRY_RUN=1` exercises signing readiness without mutating
  the helper binary.
- `smoke-browser-native-desktop-helper-signing-readiness.mjs` verifies
  development-mode deferral, strict-mode failure when no Authenticode
  certificate or CI signing service is configured, helper hash evidence, and
  redaction.
- `smoke:all` now includes the signing-readiness smoke next to the existing
  native helper signature smoke.

Focused verification passed:

- `node --check scripts/sign-browser-native-desktop-helper.mjs`
- `node --check scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs`
- `npm run smoke:browser-native-desktop-helper:signing-readiness`

Production signing itself remains externally blocked until an Authenticode
certificate or CI signing service is available.

## Latest Update: Browser Permission Bubble Native-Click Boundary

Added an explicit non-executing boundary for browser permission popup native
click recovery:

- `ComputerStructuredOperation` now includes
  `browser_permission_bubble_action`.
- `ComputerSessionRuntime` handles that operation before capability execution
  and blocks with `browser_permission_bubble_helper_v2_not_available`.
- The blocked result records `actualInputSent: false`,
  `nativePopupClick: false`, `permissionChanged: false`, required grants,
  missing preconditions, fallback guidance to the contentSettings API/manual
  handling, approval/action/verification/eval DAG nodes, a metadata-only
  screen observation, skipped rollback, verifier failure, and structured
  failure memory.
- `smoke:computer-use-native-watch-boundary` now exercises the permission
  bubble operation and proves no `desktop_action` job is created.
- `windows_native_watch_boundary` promotion gate now verifies the
  implementation and smoke evidence with
  `browser_permission_bubble_blocked_before_native_click` and
  `browser_permission_bubble_boundary_smoke_present`.

Focused verification passed:

- `node --check scripts/smoke-computer-use-native-watch-boundary.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-native-watch-boundary`
- `npm run smoke:computer-use-promotion-gate`
- `npm run smoke:computer-use-promotion-gate-route`

Actual permission-bubble native clicking remains blocked until signed
watch-mode helper v2 exists; the existing Browser Chrome `contentSettings` path
continues to cover supported permission state changes without native popup
clicking.

## Latest Update: Renderer Native Boundary Proof Panel

Added renderer UX for the non-promoting Windows native boundary gate:

- `ComputerUseSessionsPanel` now summarizes `windows_native_watch_boundary`
  into a dedicated "Native boundary proof" panel under Promotion gate.
- The panel shows foreground input, native file picker, browser permission
  popup, and signing guard state from daemon-owned gate metrics.
- It explicitly labels guarded/non-promoting status and uses the metrics to
  show that paths and popup clicks remain hidden before signed helper v2.
- `smoke-renderer-computer-use-browser-chrome-evidence.mjs` now provides a
  fake native boundary gate payload and verifies the rendered panel text.

Focused verification passed:

- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`

## Latest Update: Toolsmith Repeated Fixture Breadth Samples

Strengthened the scoped autonomy self-implementation evidence gate:

- `dogfood:scoped-autonomy-self-implementation` now appends redacted
  `scoped-autonomy-generated-tool-breadth-sample.v1` JSONL rows to
  `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`.
- The rows cover execute and rerun samples for `web_research_to_pdf`,
  `terminal_generated_tool`, and `browser_download_verify`; each row records
  class, mode, status, elapsed time, matched rerun state, artifact match, and
  redaction proof.
- `scoped_autonomy_self_implementation_breadth` now requires two samples per
  generated class, p95 latency samples, sample path redaction, active generated
  tools, source revision after failed smoke, matched reruns, and high-risk
  native blocking.
- The gate remains non-promoting with promotion class
  `fixture_repeated_generated_tool_gate_passed_live_generated_tool_gate_required`
  because the current breadth samples are fixture-backed, not live generated
  tool evidence.
- The renderer "Toolsmith breadth proof" panel now shows sample count and p95
  beside scenario/class/rerun/path proof.

Focused verification passed:

- `node --check scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `npx tsc --noEmit -p tsconfig.json --pretty false`
- `npm run dogfood:scoped-autonomy-self-implementation`
- `npm run gate:computer-use-promotion -- --json`
- absolute-path scan for
  `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`
- `npm run build:renderer`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run smoke:scoped-autonomy-self-implementation`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run audit:computer-use-parity`
- `npm run lint`
- `npm run smoke:all`
- `git diff --check` with only known CRLF normalization warnings
- UTF-8/mojibake scan over touched text files

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Current Resume Point

Latest completed implementation slice is **Terminal Artifact Delta Manifest And
Rollback**, plus terminal allow-prefix shell-chaining hardening:

- parity audit status: `implemented_with_guarded_boundaries`
- parity audit counts: passed=59, guarded=6, missing=0
- final verification: `npm run lint`, `npm run smoke:computer-use-session`,
  `npm run smoke:all`, `npm run audit:computer-use-parity`, `git diff
  --check`, UTF-8/mojibake scan
- terminal safety addition: unquoted shell control operators (`&`, `|`, `;`,
  newlines) now return `terminal_command_shell_chaining_boundary` before
  allow-prefix evaluation, preventing `echo ... & node -v` style bypasses
- renderer UX addition: `ComputerUseSessionsPanel` now shows a "Terminal
  artifact deltas" proof section with created/modified/deleted counts,
  rollback-candidate count, resource roles, and sanitized rollback-path status
- known non-failing outputs: unsigned helper development allowance, Windows temp
  cleanup deferred retry, known CRLF warnings for `.vibe/agent/session-log.md`,
  `src/daemon/server.ts`, and `src/daemon/storage/storage.ts`

Do not mark the active goal complete yet. Guarded boundaries remain: official
app-server client-tool contract, production signing certificate/service,
unrestricted credential flows, unattended high-risk Windows mutation,
authenticated browser profile/cookie access, GPU ASR validation, and human
microphone corpus benchmark.

## Latest Update: Terminal Artifact Delta Manifest And Rollback

Closed the terminal/PT Y evidence gap where output-root tracking recorded only
some changed files without a complete effect manifest:

- `ComputerSessionRuntime` now converts approved terminal output-root snapshots
  into `computer-session-terminal-artifact-delta.v1` manifests.
- The manifest records created/modified/deleted counts, captured artifact
  count, omitted count, rollback-candidate count, basename-only entries,
  relative-path hashes, artifact hashes, and previous hashes for modified or
  deleted files.
- New/modified bounded files still become blob-backed
  `terminal_diff_artifact` eval resources.
- The manifest itself is stored as a blob-backed
  `terminal_output_root_delta_manifest` eval resource.
- Created files become explicit `delete_artifact` rollback candidates, but the
  action stays `blocked` until the user presses the destructive delete path.
- Confirmed terminal artifact rollback rechecks the active permission
  profile's approved write roots and the artifact hash before deleting.
- Modified/deleted files are evidence-only for now; they are not automatically
  restored because the snapshot stores hashes, not prior file bytes.
- Debug bundle export sanitizes terminal rollback targets so raw local paths are
  not exposed to the renderer.
- `smoke:computer-use-terminal-parity` now creates, modifies, and deletes files
  inside an isolated approved output root; verifies declared artifact evidence,
  diff artifact evidence, the delta manifest, create/modify/delete counts,
  sanitized rollback metadata, and confirmed deletion of the generated artifact.
- `audit:computer-use-parity` now includes
  `slice:terminal-artifact-delta-manifest`.

Verification passed for this slice:

- `node --check scripts/smoke-computer-use-terminal-parity.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-terminal-parity`
- `npm run smoke:computer-use-session`
- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=59, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 260 dirty/new text files with 0 bad UTF-8; the
  three `'?` hits are intentional SQL placeholder/redaction literals, and no
  `.cs` files were touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith Dependency Policy Review Final Verification

The dependency policy review slice is now fully recorded beyond focused tests:

- `toolsmith-dependency-policy-review.v1` is emitted for completed and blocked
  dependency preparation paths.
- External registry npm dependencies remain blocked before install unless the
  profile includes an exact `npm:name@version` package allowlist grant.
- Local `file:` package dependency dogfood remains allowed by default policy
  and proves isolated install, package provenance, generated-tool import, rerun
  stability, blob-backed artifacts, eval/resource evidence, and path redaction.
- The renderer Toolsmith panel exposes the Package policy evidence card.
- The promotion gate requires dependency policy review evidence for
  `scoped_autonomy_npm_dependency_dogfood`.

Final aggregate verification passed:

- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=56, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 153 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Computer Session Snapshot Persistence

Closed the Phase 1 deferred session-storage gap for Computer Use sessions:

- Added storage schema v7 table `computer_use_sessions`.
- Added storage APIs:
  - `upsertComputerUseSessionSnapshot`
  - `readComputerUseSessionSnapshot`
  - `listComputerUseSessionSnapshots`
- `ComputerSessionRuntime` now persists session snapshots on create,
  transition, observation, action batch, action feedback, verifier, rollback,
  prompt-run, and debug-bundle export boundaries.
- A recreated `ComputerSessionRuntime` hydrates persisted snapshots before
  serving `listSessions`, `read`, or `exportDebugBundle`.
- Snapshots include summary, observations, action feedbacks, action batches,
  prompt runs, rollback actions, safety decisions, verifier results, recovery
  attempts, and screen tile cache state.
- `smoke:computer-use-session` now verifies persisted snapshot reads, snapshot
  listing, screen-tile-cache persistence, and debug-bundle reconstruction from
  a fresh runtime instance.
- `audit:computer-use-parity` now includes
  `runtime:session-storage-snapshot`.
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
  has been updated so the old memory-only/deferred note no longer misleads a
  resumed agent.

Verification passed:

- `node --check scripts/smoke-computer-use-session.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-session`
- `npm run smoke:storage`
- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=57, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 260 dirty/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith Dependency Policy Review Final Verification

The dependency policy review slice is now fully recorded beyond focused tests:

- `toolsmith-dependency-policy-review.v1` is emitted for completed and blocked
  dependency preparation paths.
- External registry npm dependencies remain blocked before install unless the
  profile includes an exact `npm:name@version` package allowlist grant.
- Local `file:` package dependency dogfood remains allowed by default policy
  and proves isolated install, package provenance, generated-tool import, rerun
  stability, blob-backed artifacts, eval/resource evidence, and path redaction.
- The renderer Toolsmith panel exposes the Package policy evidence card.
- The promotion gate requires dependency policy review evidence for
  `scoped_autonomy_npm_dependency_dogfood`.

Final aggregate verification passed:

- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=56, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 153 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith Dependency Policy Review Evidence

Extended the external npm package allowlist slice with explicit dependency
policy review evidence:

- Dependency prepare output now includes
  `toolsmith-dependency-policy-review.v1`, covering package classification,
  exact allowlist requirements, install isolation flags (`ignore-scripts`,
  `no-audit`, `no-fund`, no shell), lockfile/package provenance status, review
  outcome, and promotion boundary.
- Blocked external registry packages now return the same policy review before
  install, so the missing exact `npm:name@version` allowlist grant is
  inspectable without creating lockfiles.
- `dogfood:scoped-autonomy-npm-dependency`, its smoke, and
  `scoped_autonomy_npm_dependency_dogfood` now require dependency policy
  review evidence.
- The renderer Toolsmith panel now shows a "Package policy" card with
  local/external counts, scripts-off state, and lockfile provenance.
- `audit:computer-use-parity` tracks this under
  `slice:scoped-autonomy-npm-package-allowlist-policy`.

Focused verification passed:

- `node --check scripts/collect-scoped-autonomy-npm-dependency-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-npm-dependency-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run lint`
- `npm run build:renderer`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run dogfood:scoped-autonomy-npm-dependency`
- `npm run smoke:scoped-autonomy-npm-dependency-dogfood`
- `npm run gate:computer-use-promotion -- --json`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run smoke:renderer-autonomy-rerun-history`
- `npm run audit:computer-use-parity`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=56, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run smoke:all`
- `npm run audit:computer-use-parity`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 153 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith Dependency Policy Review Evidence

Extended the external npm package allowlist slice with explicit dependency
policy review evidence:

- Dependency prepare output now includes
  `toolsmith-dependency-policy-review.v1`, covering package classification,
  exact allowlist requirements, install isolation flags (`ignore-scripts`,
  `no-audit`, `no-fund`, no shell), lockfile/package provenance status, review
  outcome, and promotion boundary.
- Blocked external registry packages now return the same policy review before
  install, so the missing exact `npm:name@version` allowlist grant is
  inspectable without creating lockfiles.
- `dogfood:scoped-autonomy-npm-dependency`, its smoke, and
  `scoped_autonomy_npm_dependency_dogfood` now require dependency policy
  review evidence.
- The renderer Toolsmith panel now shows a "Package policy" card with
  local/external counts, scripts-off state, and lockfile provenance.
- `audit:computer-use-parity` continues to track this under
  `slice:scoped-autonomy-npm-package-allowlist-policy`.

Focused verification passed:

- `node --check scripts/collect-scoped-autonomy-npm-dependency-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-npm-dependency-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run lint`
- `npm run build:renderer`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run dogfood:scoped-autonomy-npm-dependency`
- `npm run smoke:scoped-autonomy-npm-dependency-dogfood`
- `npm run gate:computer-use-promotion -- --json`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run smoke:renderer-autonomy-rerun-history`
- `npm run audit:computer-use-parity`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=56, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run smoke:all`
- `npm run audit:computer-use-parity`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 153 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith External NPM Package Allowlist Boundary

Narrowed package-install permission semantics so external registry packages are
not covered by broad `packageInstall: true` alone:

- `AutonomyPermissionGrants` now includes `packageAllowlist`, normalized to
  `["file:*"]` by default for backward-compatible local file package dogfood.
- Registry npm dependencies add an exact package requirement such as
  `npm:name@version` during dependency preparation.
- Permission evaluation now requires a matching `packageAllowlist` entry for
  non-local npm packages while preserving local `file:` package fixtures.
- Renderer one-time profile grant generation carries package allowlist entries
  from `package_install` requirements and profile details show package allow
  patterns.
- `smoke:scoped-autonomy-npm-dependency-prepare` now proves an external npm
  dependency is blocked before install without exact allowlist, no lockfile is
  written, and an exact `npm:...@...` allowlist satisfies the package
  permission requirement.
- Dependency prepare output now includes
  `toolsmith-dependency-policy-review.v1`, covering package classification,
  exact allowlist requirements, install isolation flags, lockfile/package
  provenance status, review outcome, and promotion boundary.
- `dogfood:scoped-autonomy-npm-dependency`, its smoke, and the promotion gate
  now require dependency policy review evidence.
- The renderer Toolsmith panel now shows a "Package policy" card with
  local/external counts, scripts-off state, and lockfile provenance.
- `audit:computer-use-parity` now includes
  `slice:scoped-autonomy-npm-package-allowlist-policy`.

Focused verification passed:

- `node --check scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
- `node --check scripts/collect-scoped-autonomy-npm-dependency-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-npm-dependency-dogfood.mjs`
- `npm run build:daemon`
- `npm run lint`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run dogfood:scoped-autonomy-npm-dependency`
- `npm run smoke:scoped-autonomy-npm-dependency-dogfood`
- `npm run gate:computer-use-promotion -- --json`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run build:renderer`
- `npm run smoke:renderer-autonomy-rerun-history`
- `npm run audit:computer-use-parity`
- `npm run smoke:scoped-autonomy-npm-dependency-dogfood`
- `npm run smoke:computer-use-promotion-gate-route`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=56, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run smoke:all`
- `npm run audit:computer-use-parity`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 153 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith NPM Dependency Dogfood Gate

Promoted the package-consuming generated-tool dependency proof from a single
smoke to repeated local dogfood evidence:

- Added `scripts/collect-scoped-autonomy-npm-dependency-dogfood.mjs`.
- Added `scripts/smoke-scoped-autonomy-npm-dependency-dogfood.mjs`.
- Added npm scripts:
  `dogfood:scoped-autonomy-npm-dependency` and
  `smoke:scoped-autonomy-npm-dependency-dogfood`.
- `smoke:all` now includes the npm dependency dogfood smoke.
- The dogfood runs two package-consuming generated-tool scenarios using a local
  file npm package fixture. Each scenario proves isolated npm install, installed
  package `package.json` hash provenance, import via
  `CODEX_WIDGET_TOOL_DEPENDENCY_ROOT`, blob-backed artifact storage,
  `toolsmith_dependency_prepare` and `toolsmith_execute` eval proof, matched
  rerun stability, p95 samples, and path redaction.
- Evidence is written to:
  - `docs/dogfood/scoped-autonomy-npm-dependency-2026-05-16.json`
  - `docs/reports/scoped-autonomy-npm-dependency-2026-05-16.md`
  - `docs/reports/assets/scoped-autonomy-npm-dependency-2026-05-16/evidence.json`
  - `docs/reports/assets/scoped-autonomy-npm-dependency-runs.jsonl`
- New promotion gate:
  `scoped_autonomy_npm_dependency_dogfood`.
  It is `passed` and intentionally non-promoting with
  `promotionClass: local_dependency_gate_passed_external_package_policy_required`.
  External registry package installation still needs package allowlist,
  provenance review, and lockfile policy before promotion.

Focused verification passed:

- `node --check scripts/collect-scoped-autonomy-npm-dependency-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-npm-dependency-dogfood.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `npm run dogfood:scoped-autonomy-npm-dependency`
- `npm run smoke:scoped-autonomy-npm-dependency-dogfood`
- `npm run gate:computer-use-promotion -- --json`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run audit:computer-use-parity`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=55, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 150 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith NPM Dependency Execution Proof

Strengthened the scoped-autonomy npm dependency slice from lock/provenance
preparation to package-consuming generated-tool execution:

- `prepareDependencyWorkspace` now performs isolated `npm install` under the
  generated tool runtime dependency workspace instead of lockfile-only install.
- Dependency preparation records installed package provenance through each
  prepared package's redacted `package.json` path, byte size, and SHA-256 hash.
- `executeGeneratedTool` now redacts permission decisions in blocked/completed
  eval outputs and passes the prepared dependency workspace to generated Node
  tools only through `CODEX_WIDGET_TOOL_DEPENDENCY_ROOT`.
- `smoke:scoped-autonomy-npm-dependency-prepare` now creates a local file npm
  package, prepares it inside the isolated runtime workspace, activates a
  smoke-only generated tool, imports the prepared package from the generated
  entrypoint, writes a blob-backed report artifact, verifies the
  `toolsmith_execute` eval step, and asserts no absolute local package or
  dependency-workspace path leaks.
- `audit:computer-use-parity` now includes
  `slice:scoped-autonomy-npm-dependency-execution`.

Focused verification passed:

- `node --check scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run audit:computer-use-parity`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=52, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 145 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith NPM Dependency Redaction

Hardened scoped-autonomy dependency preparation before broader package-consuming
dogfood:

- `src/daemon/scoped-autonomy/toolsmithRuntime.ts` now redacts path-like string
  values, including absolute `file:` dependency versions, not only keys named
  `path`/`*Path`/`*Dir`.
- `toolsmith_dependency_prepare` eval-step output now stores a redacted
  permission decision, so filesystem/package-install requirement values do not
  expose temporary local package paths.
- `scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs` now asserts the
  completed tool-run output and eval-step output contain no absolute local
  paths and no unredacted local `file:` package fixture path.
- `audit:computer-use-parity` includes
  `slice:scoped-autonomy-npm-dependency-redaction`.

Focused verification passed:

- `node --check scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs`
- `npm run build:daemon`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run audit:computer-use-parity`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=51, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run lint`
- `npm run smoke:all`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 240 touched/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Computer Use Dogfood Report Links

Added an operator-console slice for dogfood/report/evidence inspection:

- `GET /computer-use/eval/dogfood-reports` lists latest Computer Use,
  scoped-autonomy, promotion-gate, and parity-audit reports as repo-relative
  paths.
- `GET /computer-use/eval/dogfood-reports/content?path=...` serves bounded
  Markdown/JSON/JSONL/TXT content only from `docs/reports/**` and
  `docs/dogfood/**`, rejects absolute paths/traversal, and enforces a direct
  view size cap.
- The Renderer Computer Use panel now shows a "Dogfood reports" section with
  latest report/evidence/dogfood links.
- `smoke:computer-use-promotion-gate-route` now verifies the dogfood report
  list, content route, expected public-extension report/evidence/dogfood paths,
  and path-traversal rejection.
- `smoke:renderer-computer-use-browser-chrome-evidence` now asserts the
  dogfood report links panel.
- `audit:computer-use-parity` now includes `eval:dogfood-report-links`.

Focused verification passed:

- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run build:renderer`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run audit:computer-use-parity`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=50, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 240 touched/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith Generated-Tool Live Breadth

Added the first repeated live/local-live generated-tool breadth gate:

- New script:
  `scripts/collect-scoped-autonomy-generated-tool-live-breadth-dogfood.mjs`.
- New smoke:
  `scripts/smoke-scoped-autonomy-generated-tool-live-breadth.mjs`.
- New npm scripts:
  `dogfood:scoped-autonomy-generated-tool-live-breadth` and
  `smoke:scoped-autonomy-generated-tool-live-breadth`.
- `smoke:all` now includes the live breadth evidence smoke.
- The dogfood runs two execute/rerun samples each for:
  - `web_research_to_pdf`: official OpenAI docs browser-captured source
    evidence, PDF/Markdown/citation artifacts, source-quality accepted, stable
    fallback capture hashes.
  - `local_document_conversion`: approved local Markdown source-file
    conversion, source SHA-256, skipped web stages, Markdown/PDF artifacts.
  - `terminal_generated_tool`: real local `node --version` generated wrapper,
    no shell expansion, stdout artifact proof.
  - `browser_download_verify`: public browser-backed `example.com` download
    written under the dogfood root, size/SHA-256 verification, path redaction.
- Evidence is written to:
  - `docs/dogfood/scoped-autonomy-generated-tool-live-breadth-2026-05-16.json`
  - `docs/reports/scoped-autonomy-generated-tool-live-breadth-2026-05-16.md`
  - `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-2026-05-16/evidence.json`
  - `docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-runs.jsonl`
- New promotion gate:
  `scoped_autonomy_generated_tool_live_breadth`.
  It requires schema validity, class breadth, all eight latest scenarios
  succeeded, two execute samples per class, p95 samples, accepted web source
  quality, repeated stable browser-fallback hashes, local document conversion
  proof, terminal command proof, public download proof, matched reruns/
  artifacts, and path redaction.
- The new gate is `passed`, `promotable: true`, and
  `promotionClass: eligible_for_generated_tool_promotion_review`.
- The Computer Use renderer Promotion section now includes a "Toolsmith live
  breadth proof" panel for sample count, p95, class count, execute-run count,
  live coverage, calibration, and redaction.

Focused verification passed:

- `node --check scripts/collect-scoped-autonomy-generated-tool-live-breadth-dogfood.mjs`
- `node --check scripts/smoke-scoped-autonomy-generated-tool-live-breadth.mjs`
- `node --check scripts/gate-computer-use-promotion.mjs`
- `node --check scripts/smoke-computer-use-promotion-gate-route.mjs`
- `node --check scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `npx tsc --noEmit -p tsconfig.json --pretty false`
- `npm run dogfood:scoped-autonomy-generated-tool-live-breadth`
- `npm run smoke:scoped-autonomy-generated-tool-live-breadth`
- `npm run gate:computer-use-promotion -- --json`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-browser-chrome-evidence`
- `npm run audit:computer-use-parity`

Current parity audit after this slice:
`implemented_with_guarded_boundaries`, passed=49, guarded=6, missing=0.

Aggregate verification passed after this slice:

- `npm run lint`
- `npm run smoke:all`
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 240 touched/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Computer Session Snapshot Persistence

Closed the Phase 1 deferred session-storage gap for Computer Use sessions:

- Added storage schema v7 table `computer_use_sessions`.
- Added storage APIs:
  - `upsertComputerUseSessionSnapshot`
  - `readComputerUseSessionSnapshot`
  - `listComputerUseSessionSnapshots`
- `ComputerSessionRuntime` now persists session snapshots on create,
  transition, observation, action batch, action feedback, verifier, rollback,
  prompt-run, and debug-bundle export boundaries.
- A recreated `ComputerSessionRuntime` hydrates persisted snapshots before
  serving `listSessions`, `read`, or `exportDebugBundle`.
- Snapshots include summary, observations, action feedbacks, action batches,
  prompt runs, rollback actions, safety decisions, verifier results, recovery
  attempts, and screen tile cache state.
- `smoke:computer-use-session` now verifies persisted snapshot reads, snapshot
  listing, screen-tile-cache persistence, and debug-bundle reconstruction from
  a fresh runtime instance.
- `audit:computer-use-parity` now includes
  `runtime:session-storage-snapshot`.
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
  has been updated so the old memory-only/deferred note no longer misleads a
  resumed agent.

Verification passed:

- `node --check scripts/smoke-computer-use-session.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-session`
- `npm run smoke:storage`
- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=57, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 260 dirty/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Toolsmith Dependency Policy Review Final Verification

The dependency policy review slice is now fully recorded beyond focused tests:

- `toolsmith-dependency-policy-review.v1` is emitted for completed and blocked
  dependency preparation paths.
- External registry npm dependencies remain blocked before install unless the
  profile includes an exact `npm:name@version` package allowlist grant.
- Local `file:` package dependency dogfood remains allowed by default policy
  and proves isolated install, package provenance, generated-tool import, rerun
  stability, blob-backed artifacts, eval/resource evidence, and path redaction.
- The renderer Toolsmith panel exposes the Package policy evidence card.
- The promotion gate requires dependency policy review evidence for
  `scoped_autonomy_npm_dependency_dogfood`.

Final aggregate verification passed:

- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=56, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 153 dirty text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Computer Session Snapshot Persistence

Closed the Phase 1 deferred session-storage gap for Computer Use sessions:

- Added storage schema v7 table `computer_use_sessions`.
- Added storage APIs:
  - `upsertComputerUseSessionSnapshot`
  - `readComputerUseSessionSnapshot`
  - `listComputerUseSessionSnapshots`
- `ComputerSessionRuntime` now persists session snapshots on create,
  transition, observation, action batch, action feedback, verifier, rollback,
  prompt-run, and debug-bundle export boundaries.
- A recreated `ComputerSessionRuntime` hydrates persisted snapshots before
  serving `listSessions`, `read`, or `exportDebugBundle`.
- Snapshots include summary, observations, action feedbacks, action batches,
  prompt runs, rollback actions, safety decisions, verifier results, recovery
  attempts, and screen tile cache state.
- `smoke:computer-use-session` now verifies persisted snapshot reads, snapshot
  listing, screen-tile-cache persistence, and debug-bundle reconstruction from
  a fresh runtime instance.
- `audit:computer-use-parity` now includes
  `runtime:session-storage-snapshot`.
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
  has been updated so the old memory-only/deferred note no longer misleads a
  resumed agent.

Verification passed:

- `node --check scripts/smoke-computer-use-session.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-session`
- `npm run smoke:storage`
- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=57, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 260 dirty/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Computer Session Restart Reconciliation

Extended the Computer Session snapshot slice with fail-closed restart
reconciliation for interrupted active sessions:

- `ComputerSessionRuntime` hydration now detects persisted non-final session
  states (`created`, `observing`, `planning`, `executing`, `verifying`,
  `recovering`, etc.).
- Interrupted sessions are marked `cancelled` with
  `blockedReason: "computer_session_runtime_restarted"` before being exposed
  through `read`, `listSessions`, or `exportDebugBundle`.
- Active session capability jobs in `queued`, `scheduled`, `awaiting_approval`,
  `running`, or `cancelling` are cancelled in durable storage with a
  `computer_session_runtime_restarted` reason and a capability-job event.
- Non-final DAG nodes and DAG run are marked `cancelled`.
- Running eval runs are marked `cancelled` with `taskSuccess: "abstained"` and
  `failureClass: "external_blocker"`.
- Non-final prompt runs/steps are marked `cancelled`.
- Debug bundles retain `runtime_restart_reconciliation` safety evidence,
  restart verifier evidence, completed `cancel_capability_job` rollback rows,
  and a `runtime_restart_reconciliation` eval step.
- `smoke:computer-use-session` now creates a synthetic executing session with a
  running capability job, DAG node/run, and eval run, recreates the runtime,
  and verifies every linked object is reconciled before use.
- `audit:computer-use-parity` keeps this under
  `runtime:session-storage-snapshot`.

Verification passed:

- `node --check scripts/smoke-computer-use-session.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-session`
- `npm run smoke:storage`
- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=57, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 260 dirty/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Latest Update: Browser Action Adapter Fallback Routing

Closed the Browser parity gap where Computer Session action routing only
recorded route choice but did not reroute retryable adapter failures:

- `ComputerSessionRuntime` now attempts one bounded Browser Action adapter
  fallback for retryable adapter failures.
- Controlled-browser Playwright failures can reroute once to CDP.
- Regular-browser/active-tab failures can reroute once to the
  extension-injected DOM adapter.
- Fallback is disabled for credential, password, secret, token, payment,
  restricted, permission/approval, unsafe, policy, destructive, or explicit
  `disableAdapterFallback` cases.
- The original action DAG node records `routeAttempts`,
  `computer-session-browser-action-adapter-fallback.v1`, and the final
  `actionRoute`.
- A separate `fallback` DAG node records the fallback attempt.
- A `browser_action_adapter_fallback` eval step records primary and fallback
  status.
- Debug bundles include the fallback safety decision and verifier evidence.
- `smoke:computer-use-session` now proves a synthetic CDP failure is retried
  through extension DOM, and verifies DAG/eval/safety/verifier evidence.
- `audit:computer-use-parity` now includes
  `action:browser-adapter-fallback`.
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
  has been updated to remove the stale "rerouting later work" statement for
  this bounded browser-adapter case. Native/coordinate fallback remains guarded
  by the existing signed helper/watch-mode boundaries.

Verification passed:

- `node --check scripts/smoke-computer-use-session.mjs`
- `node --check scripts/audit-windows-codex-computer-use-parity.mjs`
- `npm run build:daemon`
- `npm run smoke:computer-use-session`
- `npm run lint`
- `npm run smoke:all`
- `npm run audit:computer-use-parity`
  (`implemented_with_guarded_boundaries`, passed=58, guarded=6, missing=0)
- `git diff --check` with only known CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`
- UTF-8/mojibake scan over 260 dirty/new text files with 0 bad UTF-8,
  0 suspicious question-mark literals, and no `.cs` files touched

Known non-failing aggregate output remained: unsigned helper development
allowance and Windows temp cleanup deferred retry.

## Current Resume Point

Latest completed implementation slice is **Terminal Artifact Delta Manifest And
Rollback**:

- parity audit status: `implemented_with_guarded_boundaries`
- parity audit counts: passed=59, guarded=6, missing=0
- final verification: `npm run lint`, `npm run smoke:computer-use-session`,
  `npm run smoke:all`, `npm run audit:computer-use-parity`, `git diff
  --check`, UTF-8/mojibake scan
- known non-failing outputs: unsigned helper development allowance, Windows temp
  cleanup deferred retry, known CRLF warnings for `.vibe/agent/session-log.md`,
  `src/daemon/server.ts`, and `src/daemon/storage/storage.ts`

Do not mark the active goal complete yet. Guarded boundaries remain: official
app-server client-tool contract, production signing certificate/service,
unrestricted credential flows, unattended high-risk Windows mutation,
authenticated browser profile/cookie access, GPU ASR validation, and human
microphone corpus benchmark.
