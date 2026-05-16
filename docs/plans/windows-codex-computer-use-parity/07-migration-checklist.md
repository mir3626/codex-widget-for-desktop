# 07 - Migration Checklist

## Phase 0 - Prep And Guardrails

Status target: design accepted, no behavior change.

Tasks:

- Add this handoff and keep it linked from `docs/plans/README.md`.
- Keep the resumption shard
  `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`
  current whenever a large implementation boundary changes. Done.
- Confirm existing blockers in `docs/architecture/open-blockers.md`.
- Identify feature flags for new computer-use session runtime.
- Add protocol tests before runtime wiring.

Acceptance:

- No existing Browser Action, Toolsmith, Terminal, or Vision flows regress.

## Phase 1 - Protocol And Session Skeleton

Current status: partially implemented on 2026-05-15.

Tasks:

- Add `src/shared/protocol/computerUse.ts`. Done.
- Add normalized `ComputerAction` and action batch adapter. Done.
- Add `ComputerSessionRuntime` skeleton. Done.
- Add session storage schema if current storage cannot represent sessions.
  Done. Storage schema v7 adds `computer_use_sessions` snapshots with summary,
  observation, action feedback, action batch, prompt run, rollback, safety,
  verifier, recovery, and screen tile cache state. `ComputerSessionRuntime`
  persists snapshots on create/transition/observation/action-feedback/
  verifier/rollback/prompt updates and hydrates persisted snapshots when the
  runtime is recreated. Hydration now also fail-closed reconciles non-final
  persisted sessions: active capability jobs are cancelled in storage, running
  DAG nodes/runs are cancelled, running eval runs are marked cancelled, prompt
  runs are cancelled, and debug bundles retain
  `runtime_restart_reconciliation` safety/verifier/rollback/eval evidence.
- Add session event protocol. Done.
- Add smoke for action adapter. Done:
  - single action
  - actions array
  - unknown action blocked
  - keypress normalization
  - scroll normalization

Acceptance:

- `npm run smoke:computer-use-action-adapter`. Passing.
- `npm run smoke:computer-use-session`. Passing.
- `npm run smoke:computer-use-session-http`. Passing.
- session can be created/cancelled without executing real actions. Done.
- debug bundle can export skeleton session. Done.

## Phase 2 - Capability Runtime Integration

Current status: started on 2026-05-15.

Tasks:

- Register real `browser_action` capability handler. Partial. Read-only Browser
  Action is handled; side-effect actions fail with explicit
  `browser_action_executor_not_bound` until the Computer Session executor route
  is bound. Updated: daemon HTTP Computer Session operations now bind side-effect
  Browser Action execution through `BrowserActionSessionManager`; direct
  capability enqueue without a bound executor still fails explicitly.
- Add `computerSessionId`, `dagRunId`, and `evalRunId` linkage to capability
  job requests/results. Partial. `executeOperation` sends `sessionId`,
  `dagRunId`, `dagNodeId`, and `evalRunId` into capability jobs.
- Promote `CapabilityDagRuntime` into daemon server startup. Done for daemon
  Computer Sessions. `startDaemon()` now creates a process-level
  `CapabilityDagRuntime` beside `CapabilityRuntime` and injects it into
  `ComputerSessionRuntime`; the runtime fallback remains only for direct unit
  construction. Covered by `smoke:computer-use-session-http`.
- Ensure cancellation propagates to active capability jobs. Done for
  capability-backed Computer Session jobs. `ComputerSessionRuntime.cancel()`
  cancels non-final session jobs through `CapabilityRuntime.cancel()`, records a
  `cancel_capability_job` rollback action, cancels the DAG run, and closes
  surface resources. `smoke:computer-use-session` now includes a long-running
  `screen_observe` handler that waits for the abort signal and verifies the job
  reaches `cancelled`, rollback evidence is completed, and the DAG run is
  cancelled.
- Add operation execution route:
  `POST /computer-use/sessions/:id/operations`. Done for capability-backed
  operation envelopes and Browser Action executor-backed side-effect commands.
- Add Browser Action prompt route:
  `POST /computer-use/sessions/:id/browser-action-prompt`. Done for Browser
  Action prompt plans with tracked prompt-run state.
- Add Browser Action prompt continuation route:
  `POST /computer-use/sessions/:id/browser-action-prompt/continue`. Done.
- Auto-continue Browser Action prompt runs when Browser Bridge extension result
  completes a prompt-linked capability job. Done.
- Add action completion follow-up DAG nodes. Done for capability-backed
  Computer Session operations and Browser Action mirror completions:
  `:verification` and `:eval_ledger` nodes are appended after the action node
  when the linked capability job reaches a terminal state. Browser Action
  operations executed directly through `ComputerSessionRuntime` now also upsert
  those follow-up nodes at the session boundary, so debug-bundle evidence does
  not depend on mirror-event timing.
- Keep old Browser Action endpoints working.

Acceptance:

- Existing Browser Action smokes still pass.
- New session smoke records eval run and DAG nodes.
- HTTP session route creates a debuggable session.
- Runtime recreation can hydrate a persisted session snapshot and export a
  debug bundle with observations, action batches, rollback rows, eval/DAG
  linkage, and freshness evidence. Covered by `smoke:computer-use-session`.
- Runtime recreation fail-closed reconciles interrupted active sessions before
  exposing them as resumable. Covered by `smoke:computer-use-session` with a
  synthetic executing session, running capability job, DAG node/run, and eval
  run.
- Cancelling a session propagates to an active capability job. Done in
  `smoke:computer-use-session` with a cancellable `screen_observe` job and
  debug-bundle rollback proof.
- Session operation route creates a capability-backed DAG node and job for
  read-only Browser Action.
- Session operation route can queue a safe Browser Action click through the
  Browser Bridge extension path and update the linked DAG node when the
  extension result arrives.
- Browser Action prompt route can plan a prompt into a Browser Action click,
  execute it through the Computer Session operation path, and update the linked
  DAG node after extension completion.
- Browser Action prompt route can execute a two-step prompt by queueing the
  first Browser Bridge command, auto-continuing after its result, queueing the
  next command, and marking the prompt run completed after all steps finish.
- Capability-backed Computer Session operations expose action, verification,
  and eval ledger DAG nodes in the debug bundle after completion. Browser
  Action session operations now assert this deterministically in both session
  HTTP and browser parity smokes.

## Phase 3 - Surface Manager

Current status: partially implemented on 2026-05-16.

Tasks:

- Add `ExecutionSurfaceManager`.
- Implement `isolated_browser` surface wrapper. Partial. Computer Session
  Browser Action prompt runs on this surface now default to a persistent
  Playwright controlled-browser page and close it on session cancel.
- Implement `tool_workspace` surface wrapper.
- Implement `pty_workspace` surface wrapper.
- Register `regular_browser_extension` as higher-risk surface.
  Done for selection and session-start enforcement. The surface is registered
  with `requiresUserProfileAccess: true` and default risk
  `profile_private_data`; Computer Session startup now blocks this surface
  unless the attached scoped autonomy profile grants browser automation plus
  `high_risk`.
- Add surface selection policy.

Acceptance:

- Public web task selects isolated browser by default.
- Research-to-PDF selects tool workspace by default.
- Current browser profile task requires explicit browser profile grant. Done
  for Computer Session startup. `smoke:computer-use-session` starts a
  `regular_browser_extension` session without a profile and verifies a failed
  `permission_check` DAG node, blocked safety decision, failed eval run, and
  missing `browser_automation` requirement; the same smoke then attaches a
  scoped profile with browser automation plus `high_risk` and verifies the
  surface can start. `smoke:computer-use-browser-chrome` now uses the explicit
  high-risk profile grant for Browser Chrome parity.
- Isolated browser prompt smoke can perform a two-step DOM-dependent workflow
  without using the user's active browser profile.

## Phase 4 - Observation And Perception Loop

Current status: partially implemented on 2026-05-16.

Tasks:

- Add observation resource model for screenshot/DOM/UIA/OCR/terminal/file.
  Partial. Computer Session observations are now structured records with
  capability/eval/DAG/resource/perception graph linkage for Browser DOM,
  screen, OCR, and terminal-like completions.
- Wire existing perception graph into session observe step. Partial. Browser
  Action extension results for `computer-session-browser-action:*` sessions
  now record separate pre-action and post-action DOM observations as
  perception graphs and expose them through the session debug bundle.
  `screen_observe` completions with bounded text/box evidence now create
  `computer_session_screen_observation` graphs that combine OCR visible-text/
  box evidence with screenshot-region/bbox/freshness evidence and link back to
  the screen observation/eval step. Native browser-window helper outputs with
  `observation` or `after` snapshots now create
  `computer_session_native_browser_observation` graphs with UIA label/role/text/
  selector/bbox/freshness evidence.
- Add current evidence freshness checks. Partial. Computer Session debug
  bundles now annotate observations with current age/stale windows and include
  a `freshnessSummary`. Operations may opt into a freshness preflight with
  `requiresFreshObservation` or `maxEvidenceAgeMs`; stale/missing current
  evidence blocks before capability job creation, records a safety decision,
  failed DAG node, and `evidence_freshness_check` eval step. The session smoke
  covers stale DOM evidence blocking.
- Start ROI cascade executor with cached graph and DOM/UIA stages first.
- Add tile hashing and dirty-region records. Partial. `screen_observe`
  capability output already computes tile hashes, dirty regions, and cascade
  stages. Computer Session now mirrors that output into a blob-backed
  `roi_cascade_evidence` eval resource and links it from the screen
  observation, preserving raw screenshot retention boundaries. When the same
  output includes bounded text/box evidence, the screen observation also links
  a perception graph built from OCR plus screenshot-region evidence.
- Add screen tile cache reuse. Partial. Computer Session now keeps the latest
  screen tile hashes per session and injects `previousTileHashes` plus previous
  observation metadata into repeated `screen_observe` operations. The session
  smoke verifies an unchanged second observation has zero dirty regions and
  skips `roi_ocr`.

Acceptance:

- Session debug bundle shows pre/post observations. Partial. Browser Action
  result observations now expose separate pre-action and post-action
  `browser_dom` records, `perceptionGraphs`, and `evalResources`; screenshot
  blob previews still follow the existing retention policy and are not embedded
  by default. The bundle now also shows per-observation freshness, a freshness
  summary, and screen observation perception graphs when bounded text/box
  evidence exists.
- Browser target decision references perception graph evidence. Partial.
  Browser Action result graphs are available for explanation/debug, and
  pre-action Computer Session observations now include
  `computer-session-target-evidence.v1` linking the selected target to a
  perception graph node, risk threshold, confidence, evidence sources/classes,
  disagreement notes, allowed decision, and `perception-target-arbitration.v1`
  candidate metadata. `smoke:research-performance-architecture` verifies the
  shared arbitration helper directly, and `smoke:computer-use-browser-parity`
  verifies this target evidence for an isolated-browser click. Full cross-source
  session-level graph arbitration has started: target evidence now records a
  `computer-session-target-graph-set.v1` summary that combines the current
  Browser Action graph with session-linked DOM/screen/native/OCR perception
  graphs, including source breakdown and candidate-source summaries. The
  session smoke verifies a side-effect DOM target arbitrated with matching
  screen/OCR evidence, while preserving the rule that non-actionable
  screenshot/OCR evidence cannot authorize the click by itself.
- Non-actionable visual evidence cannot authorize side effects. Implemented for
  the shared arbitration helper: screen/OCR nodes may ground read-only evidence,
  but side-effect/high-risk/credential candidates require an actionable node and
  otherwise record `target_not_actionable`. Covered by
  `smoke:research-performance-architecture`.
- Native browser-window UIA evidence enters the graph. Partial. The v1 bounded
  helper is still browser-window scoped and unsigned for production, but
  `desktop_action` observe/execute outputs now map helper snapshots into
  `computer_session_native_browser_observation` perception graphs. Covered by
  `smoke:browser-action:native`.
- Unchanged page avoids redundant expensive OCR stage where supported.
  Partial. The perception cascade planner supports cached/unchanged early exit
  in architecture/dogfood smokes, and Computer Session now records cascade
  evidence from screen observe results. Runtime cache reuse for repeated
  `screen_observe` is implemented for tile hashes; live provider calibration
  and broader VLM/detector skip metrics remain later work.

## Phase 5 - Browser Parity Slice

Current status: partially implemented on 2026-05-16.

Tasks:

- Wire Browser Action backend into session DAG. Partial. Browser Action
  operations now execute through Computer Session operation routes and produce
  action/verification/eval DAG chains.
- Add screenshot feedback after action batches.
  Partial. Browser Action results now create `ComputerSessionActionFeedbackSummary`
  rows in the debug bundle after pre/post observations are recorded. The row
  links the action type/status, verifier status, before/after observation ids,
  perception graph id, DAG node id, capability job id, target evidence, and
  redaction policy. It also creates a linked `browser_action_feedback` eval
  step. This is a structured feedback envelope rather than embedded raw
  screenshot feedback; screenshot blobs remain governed by retention policy.
- Add action router preference:
  - DOM/selector
  - Playwright/CDP
  - extension injected
  - coordinate/native fallback
  Partial. Computer Session action DAG nodes now record
  `computer-session-action-route.v1` evidence with selected surface,
  execution mode, preference rank, reason, and whether a visual fallback was
  used. Browser parity smoke verifies isolated browser actions choose
  `dom_playwright_locator` and do not use visual fallback. Computer Session
  now also supports one bounded automatic Browser Action adapter fallback for
  retryable adapter failures: controlled-browser Playwright can reroute once to
  CDP, and regular-browser/active-tab Browser Action can reroute once to the
  extension-injected DOM path. Credential, permission, restricted-page, policy,
  destructive, and safety failures do not fallback. The fallback writes
  `browser_action_adapter_fallback` eval evidence, a `fallback` DAG node,
  `computer-session-browser-action-adapter-fallback.v1` action output, and a
  safety decision. Covered by `smoke:computer-use-session`.
- Add isolated browser lifecycle cleanup.
- Add browser dogfood cases.
  Partial. Existing reviewed Browser Action live semantic corpus is now included
  in the Computer Use promotion gate as `browser_action_semantic_live_corpus`.
  The gate validates report-backed pass rows, required intent coverage
  (`read_current_page`, `filter_or_tab_activation`, `history_navigation`,
  `search_form_fill_submit`, `representative_content_selection`), widget UI plus
  isolated source coverage, redaction, and p95 latency samples. A companion
  `browser_action_recovery_live_corpus` now links reviewed failure rows to
  later passing recovery rows, covering `permission_missing`, `wrong_effect`,
  and `latency_regression` across widget UI and isolated dogfood. Direct
  Computer Session Browser Action prompt dogfood now exists as
  `npm run dogfood:computer-use-browser` plus
  `npm run smoke:computer-use-browser-dogfood`; it executes fixture-backed
  read, search/form-submit, representative content selection, and navigation
  scenarios through `/computer-use/sessions/:id/browser-action-prompt`, records
  prompt-run, DAG, verifier, observation, action-feedback, and cleanup evidence,
  and is represented in the promotion gate as a passed but non-promoting fixture
  slice. Public-site live prompt dogfood now also exists as
  `npm run dogfood:computer-use-browser-live` plus
  `npm run smoke:computer-use-browser-live-dogfood`; it runs the same parent
  Computer Session prompt route against `example.com`, `wikipedia.org`, and
  `iana.org`, appends redacted sample rows, and is represented in the promotion
  gate as `computer_session_browser_prompt_live`.

Acceptance:

- Public browser search/navigation task completes through session runtime.
  Partial. `npm run smoke:computer-use-browser-parity` runs a local controlled
  browser search workflow through Computer Session operations with Playwright
  type/click actions. Existing Browser Action live public-site and isolated
  dogfood is now represented in the promotion gate through
  `browser_action_semantic_live_corpus` and
  `browser_action_recovery_live_corpus`. Direct Computer Session prompt-path
  browser dogfood is now fixture-backed through
  `computer_session_browser_prompt_dogfood` and public-site live through
  `computer_session_browser_prompt_live`, covering read, search/form-submit,
  representative link selection, and navigation through the parent session
  prompt route.
- Task has eval ledger run, DAG nodes, verifier proof, and debug bundle.
  Partial. The browser parity smoke verifies completed capability jobs,
  action/verification/eval DAG nodes, post-action observations, perception
  graph export, and debug bundle evidence.
- `npm run smoke:computer-use-isolated-browser` proves Playwright adapter
  observation, persistent isolated page state, prompt-run step tracking, and
  surface cleanup.
- `npm run smoke:computer-use-browser-parity` proves typed input, click,
  verifier evidence, DAG follow-ups, and post-action perception export through
  the Computer Session runtime. It also verifies action-route evidence for the
  selected Playwright DOM path.
- `npm run dogfood:computer-use-browser` writes a dated direct prompt-route
  dogfood evidence/report pair, and
  `npm run smoke:computer-use-browser-dogfood` validates the fixture-backed
  corpus without treating it as promotable public-site evidence.
- `npm run dogfood:computer-use-browser-live` writes repeated public-site
  prompt-route evidence and
  `npm run smoke:computer-use-browser-live-dogfood` validates the live sample
  ledger, host coverage, prompt-run completion, DAG/eval/verifier linkage,
  DOM observations, side-effect graph evidence, action feedback, and cleanup.

## Phase 6 - Browser Chrome Slice

Current status: partially implemented on 2026-05-16.

Tasks:

- Map Browser Chrome commands to structured operations. Partial. Computer
  Session operation envelopes can now execute `browser_chrome` capability jobs
  and record linked DAG nodes.
- Add approval cards for history/debugger/file upload.
  Covered in Computer Session smoke: `history.search`, `debugger.inspect`,
  `debugger.print_to_pdf`, and `file_upload.set_files` require one-time
  approval before Browser Bridge execution.
- Add tab group, download, bookmark, debugger, history, file upload nodes.
  Covered through `npm run smoke:computer-use-browser-chrome` for
  `tab_group.list/create/claim/update/release`,
  `bookmark.list/create/update/open/remove`,
  `download.search/observe/verify/start/cancel/erase`,
  `history.search/open`, `debugger.inspect/screenshot/print_to_pdf`, and
  `file_upload.inspect/set_files/clear`.
  The debugger screenshot path records byte length/SHA-256 without requiring
  inline image retention, mirroring the print-to-PDF proof contract.
- Add verifier outputs for browser chrome effects.
  Partial. Browser Chrome capability verifier output is now reflected in the
  Computer Session follow-up `:verification` DAG node after completion.
- Ensure redaction for history/download paths/file paths.
  Partial. History and file upload evidence stays redacted, and
  `download.verify` now stores approved local download artifacts as
  blob-backed eval resources with basename-only path evidence, SHA-256, size,
  and a `browser_chrome_download_verify` file observation when the active
  permission profile grants the download root.

Acceptance:

- Tab group and bookmark tasks pass smokes.
  Done for read/create/claim/update/release tab group paths and
  read/create/update/open/remove bookmark paths through the Computer Session
  browser chrome smoke.
- Download verify records basename/hash when allowed. Done for Computer
  Session `browser_chrome` operations with an active scoped profile granting
  the file root; `smoke:computer-use-browser-chrome` asserts the
  `download_verified_file` eval resource and linked file observation.
- History/debugger/file upload cannot run without one-time approval.
  Covered in the Computer Session browser chrome smoke: all three paths first
  return `awaiting_approval` and only execute after explicit capability
  approval.
- Renderer Browser Chrome evidence UX is covered by
  `npm run smoke:renderer-computer-use-browser-chrome-evidence`. The Computer
  Use panel summarizes download verification, history/path redaction, fixed
  debugger command evidence, site permission mutation verifier labels, and
  file-upload basename/path redaction from daemon-owned jobs, observations, and
  eval resources.
- `npm run smoke:computer-use-browser-chrome` proves tab group read,
  tab group mutation/claim/release, bookmark read/create/update/open/remove,
  download search/observe/verify/start/cancel/erase, high-risk
  history/debugger/file-upload approval, Browser Bridge result completion,
  action/verification/eval DAG node update, debug-bundle visibility, and
  redacted history/file-path/download artifact evidence through the Computer
  Session operation route.

## Phase 7 - Toolsmith And Research Artifact Slice

Current status: partially implemented on 2026-05-16.

Tasks:

- Route scoped autonomy runs through shared session/DAG where practical.
  Partial. `toolsmith` Computer Session operations now run
  `ScopedAutonomyRuntime.runGoalDag`, update the parent session DAG action
  node, add verification/eval follow-up nodes, and mirror artifact evidence
  into the parent Computer Session debug bundle.
- Upgrade web research to PDF as first production-useful vertical slice.
  Partial. The existing scoped autonomy `web_research_to_pdf` runtime is now
  reachable through a `tool_workspace` Computer Session operation and covered
  by `npm run smoke:computer-use-toolsmith-artifact`. Live OpenAI public-doc
  dogfood is now covered by `npm run dogfood:scoped-autonomy-web-research-live`
  and `npm run dogfood:computer-use-toolsmith-live`.
- Add browser-backed fetch fallback for blocked HTTP.
  Partial. Browser Chrome now has a bounded `debugger.print_to_pdf` command
  using Chrome debugger `Page.printToPDF` with byte length/hash evidence, which
  provides a browser-backed document capture primitive. Toolsmith
  `web_research_to_pdf` now accepts `browserFallbackDocuments` and uses them
  when direct HTTP fetch is unavailable for an allowed browser domain, recording
  `browser_fallback_used` warnings and carrying fallback evidence into
  citations/report/PDF artifacts. The live dogfood scripts now capture official
  OpenAI docs through Playwright-backed browser fallback when daemon-side HTTP
  returns 403. Extension-driven capture remains a later promotion path for the
  regular Browser Bridge surface.
- Add PDF artifact verification. Partial. Scoped autonomy verifies the PDF
  artifact and stores blob-backed eval resources; the parent Computer Session
  mirrors report/PDF resources, exposes hashes/resource ids, and now adds
  parent-session `store_artifact`/`verify_artifact` DAG nodes with blob/hash
  proof.
- Add rerun comparison. Partial. The scoped autonomy runtime and HTTP route
  support rerunning a stored generated-tool manifest and updating stability
  metadata. The Autonomy Toolsmith panel now exposes a rerun control for the
  selected run's last completed execute tool run, and the Computer Session
  Toolsmith smoke verifies `/computer-use/autonomy/rerun` plus rollback through
  daemon HTTP. Reruns now write `toolsmith-rerun-comparison.v1` output with
  scalar and artifact fingerprint comparison, record a
  `toolsmith_rerun_comparison` eval step, update manifest stability, and expose
  artifact delta count in the Autonomy Toolsmith stability card. The Autonomy
  Toolsmith panel now also renders historical rerun comparison rows so users
  can inspect matched/changed scalar and artifact outcomes across more than the
  latest rerun. Covered by `npm run smoke:renderer-autonomy-rerun-history`.
- Add generated-tool class breadth. Partial. `web_research_to_pdf`,
  `local_document_conversion`, `terminal_generated_tool`, and
  `browser_download_verify` can all be
  materialized under scoped profiles, smoke-tested, activated only after smoke
  passes, executed from runtime workspaces, and rerun from manifest with
  `toolsmith-rerun-comparison.v1` scalar/artifact stability evidence.
  `local_document_conversion.v1` is a separate reviewed template rather than a
  web-research alias: the gap detector classifies Markdown/text-to-PDF requests
  without crawl/source extraction, the DAG skips crawl/extract/source-verify
  nodes, and the converter records source-content hash, Markdown/PDF artifacts,
  blob-backed eval resources, and rerun comparison. `dogfood:scoped-autonomy-
  self-implementation` now records those four classes plus a blocked high-risk
  `native_windows_workflow` scenario in redacted evidence. The promotion gate
  tracks this as `scoped_autonomy_self_implementation_breadth`, passed but
  non-promoting until repeated live generated-tool samples exist.
- Add package install isolation and provenance. Partial. Toolsmith dependency
  preparation now has an explicit runtime API and DAG node path, checks
  `package_install`, `npm` command, `filesystem_write`, and `side_effect`
  grants before installation, writes npm lockfiles only inside the generated
  tool runtime workspace, records lockfile hashes/provenance in the tool run
  and eval step, and uses a Windows-safe `cmd.exe /c npm.cmd` spawn path. The
  smoke uses a local `file:` npm fixture, so it proves isolation without
  network-dependent package registry behavior. Real package-consuming generated
  tool dogfood remains future use-case driven work.

Acceptance:

- OpenAI/Codex research-to-PDF scenario creates Markdown/PDF artifacts.
  Partial. The deterministic Computer Session Toolsmith smoke uses fixture
  source documents and creates Markdown/PDF artifacts through the reviewed
  template. Live OpenAI official-doc dogfood now creates Markdown/PDF artifacts
  through both the scoped autonomy runtime and the parent Computer Session
  Toolsmith route using browser-backed source capture. The self-implementation
  breadth dogfood adds fixture-level rerun stability across web/PDF, local
  document conversion, terminal, and download-verifier generated tools; repeated
  live generated-tool p95 comparison remains future work.
- Distinct DAG nodes exist for crawl, extract, verify, draft, render, store,
  verify artifact. Done in the scoped autonomy child DAG; parent session now
  links to that autonomy DAG from the Toolsmith action node and adds parent
  `store_artifact`/`verify_artifact` nodes for mirrored artifact proof.
- Debug bundle lists URLs, commands, files, hashes, sources, and verifier.
  Partial. Parent session debug bundle lists mirrored artifact resources,
  hashes, autonomy run linkage, verifier/eval follow-up nodes, and blocked
  artifact rollback. Toolsmith outputs now include browser fallback URLs in
  crawl evidence and fallback text in report artifacts. Computer Session now
  also summarizes Toolsmith source/citation evidence into the parent file
  observation metadata, and the renderer shows a Sources section with source
  status, URL/title, fallback marker/reason, character count, and excerpt when
  available. Renderer source/artifact panels now include compact source-quality
  and artifact-proof metrics so direct/fallback evidence, blob-backed artifact
  count, PDF count, text count, and missing blob proof are visible without
  opening the raw debug bundle.
- `npm run smoke:scoped-autonomy-npm-dependency-prepare` proves package install
  preparation blocks before any lockfile is written when the profile lacks
  `package_install`, then succeeds with an explicit scoped profile and records
  `package.json`/`package-lock.json` hashes as provenance.

## Phase 8 - Terminal/PT Y Slice

Current status: partially implemented on 2026-05-16.

Tasks:

- Add terminal/PTY session as computer-use backend nodes. Partial.
  `pty_workspace` Computer Sessions can execute terminal capability operations
  through the shared operation route.
- Add command allowlist enforcement at node execution. Partial. Terminal
  commands remain capability approval-gated when no real profile is attached.
  With an active scoped autonomy profile, Computer Session terminal operations
  now evaluate `commands.allowPrefixes` plus session risk class before enqueue:
  matching commands are preapproved with safety-decision evidence, missing
  command grants block before capability-job creation with exact missing
  requirements, and credential/destructive patterns are hard-blocked at the
  Computer Session boundary. Terminal permission now also blocks unquoted shell
  control operators such as `&`, `|`, `;`, and newlines before allow-prefix
  evaluation can accidentally approve a chained command like
  `echo ok & node -v`.
  `npm run smoke:computer-use-windows-settings` now covers the Windows settings
  read-only slice with a real `reg query HKCU\Environment` command and proves a
  registry mutation command is blocked by the destructive terminal boundary
  before any capability job is created.
- Add terminal output redaction and resource limits. Partial. The terminal
  helper keeps bounded stdout/stderr and Computer Session observations store
  metadata/lengths rather than raw output in the observation summary.
  Computer Session debug bundles now also sanitize terminal capability job
  output by replacing raw stdout/stderr with length, SHA-256, and a short
  credential-redacted preview. Debug bundle terminal output metadata now also
  exposes stdout/stderr truncation booleans, helper byte limits, and
  `terminal_helper_bounded_output` resource-limit evidence while keeping raw
  stdout/stderr and raw truncation internals out of the bundle. Covered by
  `smoke:computer-use-terminal-parity`, including a large-output command that
  proves stdout is truncated to the helper byte limit and only preview/hash/
  length metadata are exported.
- Add artifact effect detection for allowed output roots. Implemented for the
  profile-backed Computer Session terminal path. Terminal
  Computer Session operations can now declare `expectedArtifacts`. When the
  completed command creates a file inside the active permission profile's
  approved write root, the daemon stores a blob-backed eval resource and adds a
  `file` observation with basename-only/path-redacted metadata. Terminal
  operations can also declare `trackOutputRoots`/`outputRoots`/
  `expectedOutputRoots`; the runtime snapshots approved profile write roots
  before execution, diffs them after completion, and stores new/modified
  bounded files as `terminal_diff_artifact` eval resources with basename/hash
  evidence. It also writes a path-redacted
  `computer-session-terminal-artifact-delta.v1` manifest resource with
  create/modify/delete counts, relative-path hashes, artifact hashes, omitted
  counts, and rollback-candidate counts. Created files receive a blocked
  `delete_artifact` rollback row that can only execute after explicit
  user-artifact deletion confirmation; rollback rechecks the approved write
  root and artifact hash before deleting. Modified/deleted files are recorded
  as evidence but are not auto-restored. The terminal parity smoke covers
  declared artifacts, output-root diff artifacts, the delta manifest, deleted
  path evidence, rollback path redaction, and confirmed deletion of the
  generated artifact only.

Acceptance:

- Safe local command runs through session DAG. Partial. `npm run
  smoke:computer-use-terminal-parity` executes an approved `echo` command
  through Computer Session, verifies action/verification/eval DAG follow-ups,
  and records terminal observation evidence.
- Blocked command shows exact missing grant.
  Implemented for the profile-backed Computer Session path: the terminal parity
  smoke verifies `node -v` is blocked under an `echo`-only profile and records
  the missing `command` requirement in the action DAG output.
- PTY output can be observed in debug bundle. Partial. Completed terminal jobs
  are reconciled into structured session observations at debug-bundle export
  time; terminal capability job output in the debug bundle now exposes
  `terminalOutput` metadata instead of raw stdout/stderr.
  The Windows settings smoke verifies this redaction path against real Windows
  registry read output: raw stdout is absent, while preview/hash metadata remain
  available for audit.
- Approved terminal artifacts are visible in debug bundle. Implemented for the
  profile-backed Computer Session terminal path. The
  terminal parity smoke now verifies a `terminal_artifact` eval resource and
  file observation when `expectedArtifacts` points inside an approved output
  root, plus a `terminal_diff_artifact` resource and `terminal_output_root_diff`
  observation for automatically detected output-root changes. Debug bundles
  also include `terminal_output_root_delta_manifest` resources, create/modify/
  delete counts on the file observation, sanitized rollback targets without raw
  local paths, and explicit rollback completion evidence when the user chooses
  the destructive artifact-delete action. The same smoke now proves unquoted
  shell control operators are rejected before command-prefix approval, so an
  allowed command prefix cannot smuggle a chained second command.

## Phase 9 - Verification, Recovery, Failure Memory

Current status: started on 2026-05-16.

Tasks:

- Add `EffectVerifier`.
  Partial. Added Computer Session `EffectVerifier` for capability-backed
  operations. It checks capability verifier output and explicit text/stdout
  expectations, records verifier evidence, and prevents failed/inconclusive
  effects from completing the session.
- Add failure class taxonomy to session results.
  Partial. Effect verification maps perception/binding/execution/effect
  mismatch and expected-output misses into the existing computer-use failure
  classes, including `verification_false_negative`.
- Connect structured failure memory as calibration only.
  Partial. Computer Session debug bundles now include failure memory records.
  Blocked `visual_desktop_action` watch-mode attempts record structured failure
  memory with `mayCompleteTask: false`, `mayBypassApproval: false`, and
  `proofSource: false`, plus recovery hints and abstention triggers. This
  calibrates future routing/abstention and is never used as current UI proof.
- Add recovery retry budget.
  Partial. Computer Sessions now have a one-attempt recovery budget for failed
  or inconclusive effect verification. If no automatic recovery action is safe
  for the operation, the runtime records a skipped `fallback` DAG node and a
  `recovery_attempt` eval step with safe next-action hints rather than silently
  marking success. Browser Action operations that explicitly require fresh
  evidence now spend the same bounded recovery budget on a safe `read`
  reobserve before the side-effecting action proceeds.
- Add verifier false-positive/false-negative audit fields.
  Implemented. Explicit expected-output mismatches are recorded as
  `verification_false_negative` eval/failure-memory evidence, and
  `computer-use-verifier-audit.v1` now audits eval steps for false-negative
  records, false-positive candidates, inconclusive verifier results, and
  missing verifier evidence. The audit is exposed through debug bundles,
  `/computer-use/eval/verifier-audit`, run-scoped verifier audit routes, and
  readiness output.

Acceptance:

- Wrong target or stale observation creates recovery attempt.
  Partial. Failed/inconclusive effect verification now creates a recovery
  attempt node/eval step. Browser Action operations with
  `requiresFreshObservation`/`maxEvidenceAgeMs` now detect stale target
  evidence before execution, create a `browser_action_reobserve_recovery` eval
  step plus `observe` DAG node, perform a safe `read` reobserve, and proceed
  only if the post-recovery evidence is fresh. Broader automatic wrong-target
  replanning remains future work.
- Browser target evidence is explainable.
  Partial. Browser Action pre-action observations now record
  `computer-session-target-evidence.v1` in debug-bundle observation metadata and
  eval step output. The evidence links the action target to the perception
  graph node and records threshold/allowed/source/class/disagreement details.
  It now uses the shared `perception-target-arbitration.v1` helper, recording
  graph count, candidate count, stale graph count, selected score, selected
  match reason, graph source, and arbitration reason. Broader cross-source
  arbitration and automatic wrong-target replanning remain future work.
- Failure memory effect is visible but not used as proof.
  Partial. The native watch boundary smoke asserts the debug-bundle
  failure-memory safety flags, and the renderer Computer Use panel shows
  failure-memory counts plus recent calibration records.
- Inconclusive verifier does not mark task success.
  Implemented. `npm run smoke:computer-use-effect-verifier` now verifies both a
  failed expected-text mismatch and an unsupported expected-effect target that
  produces an `inconclusive` verifier result. Both leave the session failed
  with verifier/recovery/failure-memory evidence instead of completed.
- Verifier audit is regression-tested.
  Implemented. `npm run smoke:computer-use-verifier-audit` exercises an OCR
  mismatch through the daemon HTTP Computer Session path and asserts
  false-negative audit output in the debug bundle, eval route, run-scoped audit,
  and readiness surface.

## Phase 10 - Renderer UX

Current status: partially implemented on 2026-05-16.

Tasks:

- Add Computer Use panel or extend capability jobs panel. Partial. Activity
  details now includes `ComputerUseSessionsPanel`. The panel now receives
  daemon `computer.session.*` plus capability job/resource events through a
  debounced live refresh signal, so long-running Computer Use sessions update
  DAG/debug-bundle evidence without manual refresh.
- Show session state, surface, profile, DAG, approvals, blocked grants,
  artifacts, rollback, debug bundle. Partial. The first pass shows session
  state, surface, selected profile via session summary when present, active
  permission profile selector for new runs, DAG, prompt runs, capability jobs,
  approval jobs, blocked reason, evidence counts, recent observations,
  artifact resource rows, rollback action counts/records, and debug bundle
  copy/save. Artifact rows now include Open, Save, and text Copy actions
  through a gated content route. Verifier audit counts and recent audit rows
  are now visible in the panel. Toolsmith source/citation rows are now visible
  as a Sources section. Browser Action pre/post observations are now grouped
  into a Before / after preview section with action, redacted target summary,
  freshness, URL/title, element count, graph-node count, and verifier status.
  Rollback rows now expose safe rollback execution from the renderer. Toolsmith
  artifact rollback is routed through the session rollback action endpoint,
  records an eval cleanup step, and keeps user artifact deletion behind an
  explicit confirmation flag. Blocked grant chips now include requirement
  reasons as hover text and collapse overflow counts instead of silently hiding
  additional grants. Terminal artifact-delta evidence now has a compact proof
  section showing created/modified/deleted counts, rollback-candidate count,
  resource roles, and sanitized rollback-path status when a
  `terminal_output_root_delta_manifest` resource is present.
- Add narrower one-time approval creation from blocked run.
  Implemented on 2026-05-16 for Computer Sessions: the renderer derives
  scoped autonomy requirements from safety decisions, selected surface grants,
  awaiting capability jobs, and DAG-node `missingRequirements`, creates a
  `one_time` profile, attaches it to the session, and records the attachment in
  eval/debug evidence. This grants permission only; external blockers such as
  unsigned watch-mode helper v2 remain blocked.
- Add high-risk action preview.
  Partial. Awaiting approval rows in the Computer Use panel now show inferred
  grant, risk class, reason, command/action summary, and an expandable
  sanitized Preview payload for high-risk rows. Browser Action observation
  pairs now show a structured Before / after preview using redacted DOM
  evidence. Full bitmap before/after preview for foreground visual actions
  remains future work because raw screenshot retention and watch-mode helper v2
  are still bounded.

Acceptance:

- User can see why a run is blocked.
- User can export debug bundle.
  Done for the current panel. Debug bundles can be copied to clipboard or
  saved as JSON from the Computer Use toolbar.
- Approval card names exact grant and risk class.
  Partial. The renderer approval row now names the inferred grant and risk
  class from the capability job kind/input, and blocked runs can persist a
  narrower one-time profile from inferred grants. Warning/error approval rows
  also expose sanitized action input/evidence previews, and Browser Action rows
  can be inspected through structured Before / after observation previews. When
  Browser Action target evidence is present, those previews now show the
  allowed/blocked target verdict, risk class, confidence/threshold, target
  label or node id, and compact evidence source/class summaries. Blocked runs
  now also show a draft one-time profile preview before attachment: scope,
  max uses, credential policy, risk classes, browser grants, exact command
  count, and write-root count. A full foreground visual bitmap preview remains
  future work.
- Action feedback rows are visible.
  Partial. Browser Action `actionFeedbacks` are now exposed in Activity details
  with action type, verifier status, before/after observation ids, graph id, and
  capability job id. Full bitmap feedback remains future work under screenshot
  retention and watch-mode helper v2 boundaries.
- User can create/select a Computer Use session, run a Browser Action prompt,
  select an active permission profile for new sessions, run a Browser Action
  prompt, continue a prompt run, cancel a session, approve/cancel awaiting
  capability jobs, derive one-time grants from DAG missing requirements, and
  inspect prompt-run/DAG state from Activity details. Selecting an active
  permission profile now shows scope, mode, status, risk classes, browser
  grants, command/write counts, generated-code state, credential policy,
  use count, expiry, exact domain/command/write-root grant details, and
  Disable/Expire lifecycle actions. The Computer Use panel now also includes a
  permission profile manager that lists all profiles while new sessions only
  select active profiles, creates a safe one-time profile from a validated JSON
  draft, supports edit/save through the profile route, exposes Disable/Expire
  lifecycle actions, and blocks credential or persistent high-risk drafts before
  POST.
- Debug bundle and Activity details expose cleanup/rollback records for
  bounded actions such as isolated browser surface closure and active
  capability-job cancellation.
- Debug bundle and Activity details expose verifier audit counts for
  false-negative records, false-positive candidates, inconclusive results, and
  missing verifier evidence.
- Long-running session streaming is covered by
  `npm run smoke:renderer-computer-use-live-refresh`, which runs a fake daemon
  over HTTP+WebSocket and verifies a `computer.session.state` event refreshes
  session summaries and the selected session debug bundle in the renderer.
- Historical Toolsmith rerun browsing is covered by
  `npm run smoke:renderer-autonomy-rerun-history`, which runs a fake daemon and
  verifies Activity details renders multiple rerun comparison rows plus the
  latest artifact-delta summary without opening raw Toolsmith JSON.
- One-time profile draft preview is covered by
  `npm run smoke:renderer-computer-use-profile-draft`, which runs a fake daemon
  and verifies a blocked high-risk browser-profile run displays the draft
  profile, excludes credential grants, creates `credentialAccess: "never"`,
  and attaches the one-time profile to the session. The same smoke verifies
  selected-profile detail rendering, exact domain/command/write-root grant
  details, unsafe persistent credential/high-risk draft blocking, safe
  one-time manager profile creation, profile Disable lifecycle POST wiring, and
  the `renderer_permission_profile_ux` promotion gate.
- Browser Chrome evidence UX is covered by
  `npm run smoke:renderer-computer-use-browser-chrome-evidence`, which runs a
  fake daemon and verifies download, history, debugger print-to-PDF,
  permission mutation, and file-upload evidence rows with redaction/resource
  summaries, plus public-extension, Toolsmith breadth, and native-boundary
  proof panels. The Toolsmith panel summarizes
  `scoped_autonomy_self_implementation_breadth` scenario count, generated class
  count, rerun stability, path redaction, high-risk native blocking, and the
  fixture-only promotion guard. The `browser_chrome_deep_action_evidence_ux`
  promotion gate tracks the smoke as passed but non-promoting.

## Phase 11 - Native Helper Watch-Mode

Current status: boundary slice implemented on 2026-05-16.

Tasks:

- Fix helper capability advertisement.
  Done. The native Browser Action adapter no longer advertises `screenshot` for
  the v1 helper path, diagnostics list it as explicitly unsupported, and direct
  screenshot execution returns a fallback explanation before helper invocation.
- Rename/split `desktop_action` concept.
  Partial. `visual_desktop_action` is now separated from the broad v1
  `desktop_action` helper bridge inside Computer Session runtime:
  broad foreground visual actions are blocked before native input, while the
  existing browser-window scoped helper remains on its explicit native/browser
  fallback path.
- Add watch-mode preconditions:
  - countdown
  - active window assertion
  - process allowlist
  - idle check
  - abort-on-user-input
  - pre/post evidence
  Partial. Computer Session blocked `visual_desktop_action` outputs now list
  missing preconditions for visible countdown, active-window assertion,
  process allowlist, user-idle guard, abort-on-user-input, pre/post evidence,
  signed watch-mode helper v2, and effect verification/rollback proof. These
  are recorded in the action DAG output, safety decisions, observation
  metadata, verifier result, and eval step. The runtime now also accepts
  optional `watchPreflight` metadata and records
  `foreground-watch-preflight.v1` evidence. User-input and active-window drift
  aborts get distinct reasons while still keeping `actualInputSent: false`.
- Add browser permission popup bounded workflow.
  Partial. Browser Chrome now supports bounded `permission.get` and
  `permission.set` commands via Chrome `contentSettings` for site-level
  permission outcomes such as camera/microphone/location/notifications. The
  route requires one-time approval for mutation, records origin/pattern/setting
  evidence, and explicitly marks `nativePopupClick: false`. Computer Session
  now also represents the blocked visual path as
  `browser_permission_bubble_action`; it fails before native input with
  `browser_permission_bubble_helper_v2_not_available`, records
  `actualInputSent: false`, `nativePopupClick: false`, and
  `permissionChanged: false`, and adds approval/action/verification/eval DAG
  evidence, safety decisions, metadata-only observation, skipped rollback,
  verifier failure, and structured failure memory. Visual browser
  permission-bubble clicking remains blocked until signed watch-mode helper v2.
- Keep native file picker and Windows settings mutation blocked unless helper v2
  implementation and proof are added.
  Done for the current broad visual desktop path and native file picker path.
  Blocked foreground actions create a `none_available` rollback record with
  `actualInputSent: false`, and no `desktop_action` capability job is created.
  Native file picker attempts use `native_file_picker_action`, fail before raw
  local path disclosure with `localFilePathDisclosed: false`, record
  `native_file_picker_preconditions`, and remain blocked until signed helper v2
  plus explicit file-selection approval/active-window guards exist.

Acceptance:

- Foreground action cannot run without watch-mode approval.
  Partial. It is now blocked before helper execution with explicit missing
  approval and missing helper-v2 preconditions. Blocked Computer Session
  outputs, safety decisions, observations, rollback metadata, and verifier
  results include the shared disabled `foregroundWatchExecutor` state so the
  session evidence and helper release-readiness evidence use the same executor
  contract.
- User input aborts action.
  Implemented as a non-executing preflight boundary. A
  `visual_desktop_action` with `watchPreflight.abortOnUserInputArmed` and
  `watchPreflight.userInputDetected` fails with
  `foreground_watch_user_input_abort` before native input, records
  `foreground_watch_preflight` safety evidence, observation/verifier/failure
  memory, and creates no `desktop_action` capability job. Real helper-v2
  countdown/input monitoring remains blocked until signed helper v2 exists.
- Browser permission bubble native-click blocks before mutation.
  Implemented as a non-executing helper-v2 boundary. The smoke exercises
  `browser_permission_bubble_action` and verifies `actualInputSent: false`,
  `nativePopupClick: false`, `permissionChanged: false`, no `desktop_action`
  capability job, and debug-bundle/eval/failure-memory evidence. The promotion
  gate records this under `windows_native_watch_boundary` as a non-promoting
  release guard.
- Helper status truthfully reports screenshot support.
  Done for v1 helper capability advertisement.
- Disabled helper-v2 executor contract is present.
  Done. The Rust helper accepts `foreground_watch_execute` only as a
  non-executing contract and returns
  `browser-native-desktop-helper-foreground-watch-executor.v1` with
  `enabled: false`, `supported: false`, `dryRunOnly: true`,
  `signedHelperV2Available: false`, the `browser-native-helper-signing`
  release gate, required preconditions, and `actualInputSent: false`.
  Release readiness probes this command under `browser-native-helper-contract`.
- Helper-v2-only command disabled contracts are present.
  Done. The Rust helper now fail-closes explicit helper-v2 commands including
  `capture_screenshot`, `file_picker_select`,
  `browser_permission_popup_click`, `clipboard_set_scoped`, and `menu_command`
  with `browser-native-desktop-helper-v2-disabled-command.v1`. These contracts
  keep `actualInputSent: false`, `signedHelperV2Available: false`, and
  `releaseGate: browser-native-helper-signing`, while proving command-specific
  side effects did not occur: no local path disclosure/file selection, no
  native permission popup click/mutation, no screenshot capture/raw storage, no
  clipboard content logging/mutation, and no menu command dispatch. Native
  helper native and signing-readiness smokes probe these disabled commands.
  Daemon native adapter status also probes a bounded subset of these contracts
  and mirrors the result into `helperV2Boundary` so live diagnostics can prove
  fail-closed helper-v2 behavior without relying only on release-readiness
  reports.
- Unsigned helper remains development-only for release readiness.
  Done for verification/gating. Native helper status diagnostics now expose a
  `native-desktop-helper-release-readiness.v1` record with helper provenance,
  SHA-256, implementation type, Authenticode status, and blockers. Release
  readiness now checks the bundled helper artifact and gates
  `browser-native-helper-signing`; unsigned helpers are accepted only as an
  explicit deferred development gate, while strict release mode still requires
  a production Authenticode certificate or CI signing service.
- `npm run smoke:computer-use-native-watch-boundary` proves daemon HTTP
  Computer Session foreground click requests are blocked before native input,
  expose approval/action/verification/eval DAG evidence, record debug-bundle
  safety/observation/verifier/rollback proof, and do not create a
  `desktop_action` capability job. It also proves native file picker attempts
  are blocked before local path disclosure or native input, and browser
  permission bubble native-click attempts are blocked before native click or
  permission mutation; both record the same debug-bundle/eval/failure-memory
  evidence chain.

## Phase 12 - 30-Case Dogfood And Promotion

Tasks:

- Add 30-case dogfood corpus.
  Done. Existing corpus runner is available as
  `npm run dogfood:computer-use-process-30`; `npm run dogfood:computer-use-30`
  has been added as the checklist-compatible alias.
- Add scripts to execute or mark blocked cases.
  Done. `npm run dogfood:computer-use-30` executes the safe fixture-backed
  30-case matrix and writes dated JSON/report evidence.
- Record scenario, workflow, evidence, success, luck/flakiness, and follow-up.
  Done for the current fixture-backed dogfood runner. The 2026-05-16 rerun
  recorded scenario descriptions, architecture workflows, status, log
  reproducibility assessment, and follow-up items for all 30 cases.
- Add Windows settings/app workflow progression:
  - read-only first
  - reversible second
  - mutation-blocked third
  Partial. `smoke:computer-use-windows-settings` now covers read-only
  `reg query`, a bounded reversible app-registry set/query/delete workflow
  under `HKCU\Software\CodexWidgetComputerUseSmoke`, and a blocked
  `HKCU\Environment` mutation. The reversible path requires exact command
  allowlist, `osMutation`, `high_risk`, and `reversibleWindowsSetting`
  metadata before `reg add/delete` can bypass the terminal hard block. Broad
  Windows settings mutation remains blocked.
- Add metric rollup.
  Done. The report includes eval runs, task success rate, proof rate, p95
  latency, p95 perception latency, perception graph count, failure-memory count,
  eval resource count, and DAG run count.
- Promote only slices passing promotion gates.
  Partial, with automated gate now wired. The 2026-05-16 dogfood run was
  refreshed after Toolsmith/PDF, Browser Chrome download verification, and
  Vision VLM fallback fixture evidence landed: 21 passed, 9 intentionally
  blocked, 0 needs-follow-up, and 0 unexpected failures. The refreshed matrix
  now treats the Codex research-to-PDF artifact case, browser PDF download
  verification case, and complex-chart VLM fallback case as implemented fixture
  paths, with blob-backed eval resources, basename/hash-only evidence, and
  metadata-only VLM fallback evidence.
  `npm run gate:computer-use-promotion` now writes a promotion-gate
  report/evidence record; the current gate passes fixture readiness and marks
  the scoped-autonomy and parent Computer Session live research-to-PDF slices as
  eligible for promotion review. Repeated live p95 samples are captured through
  redacted JSONL sample ledgers, and browser fallback transport is calibrated by
  repeated stable capture hashes. The gate also now includes
  `computer_session_browser_prompt_dogfood`, a direct prompt-route fixture slice
  that passes readiness but remains non-promoting until a public-site live
  Computer Session browser prompt corpus exists. That live corpus now exists as
  `computer_session_browser_prompt_live` and is eligible for promotion review
  after repeated sample rows across `example.com`, `wikipedia.org`, and
  `iana.org`.

Acceptance:

- `npm run dogfood:computer-use-30` writes report and JSON evidence.
  Done. The latest run wrote
  `docs/dogfood/computer-use-process-validation-30-2026-05-16.json`,
  `docs/reports/computer-use-process-validation-30-2026-05-16.md`, and
  `docs/reports/assets/computer-use-process-validation-30-2026-05-16/evidence.json`.
- Failed/blocked/unimplemented cases are explicit.
  Done in the fixture-backed report.
- No feature is promoted based on one success.
  Done for the current automated gate. `npm run smoke:computer-use-promotion-gate`
  dry-runs the gate and exits zero when policy-blocked slices are valid. Current
  evidence now has repeated scoped-autonomy and parent Computer Session live
  samples with p95 measurements, accepted source-quality review, and calibrated
  browser fallback transport. Fixture success remains non-promoting by design.
  Browser Action semantic live corpus is also promotable after corpus/report
  validation, required intent coverage, redaction, and latency-sample checks.
  Browser Action recovery live corpus is also promotable after preserving
  failure rows, linking them to later pass rows, validating failure-class/source
  coverage, and recording recovery/calibration tags.
  Browser Bridge restricted/reload handling is represented as the
  `browser_bridge_restricted_reload_boundary` gate. That gate is passed but
  non-promoting: it verifies the restricted extension-page reload scenario is
  blocked by design, `reloadRequired`/`permission_needed`/`restricted` bridge
  states are covered by smoke, the extension popup exposes the user-gesture
  `Reload bridge` path through `chrome.runtime.reload()`, renderer Browser
  Action UI gives recovery guidance, and restricted pages cannot be bypassed by
  injected Browser Action commands.
  Computer Session Browser Action prompt dogfood is validated as
  `fixture_gate_passed_live_gate_required`: it proves the parent session prompt
  route, prompt-run state, DAG/eval/verifier linkage, DOM observation,
  perception graph evidence for side-effect steps, action feedback, and
  isolated-browser cleanup, but fixture success alone cannot promote public
  browser behavior.
  Computer Session Browser Action prompt live corpus is also promotable after
  repeated public-site samples, required intent coverage, host coverage,
  redacted URL metadata, p95 latency samples, and the same parent session
  evidence chain.
  Windows native watch-mode is represented as the
  `windows_native_watch_boundary` gate. That gate is passed but non-promoting:
  it verifies read-only desktop observe, high-risk Windows mutation rejection,
  explicit blocked native workflow cases, release-signing deferral for unsigned
  helpers, native watch boundary smoke coverage, and `actualInputSent: false`
  before helper execution. It now also verifies the user-input abort preflight
  guard/smoke, and verifies that native file picker attempts are blocked before
  local path disclosure and that the native boundary smoke covers
  `native_file_picker_action`. It is a release guard, not permission to promote
  foreground mutation.
  Windows settings reversible dogfood is represented as
  `windows_settings_reversible_dogfood_boundary`. That gate is passed but
  non-promoting: it verifies read-only registry observation, bounded
  app-owned reversible registry mutation, exact profile grants, runtime guard
  evidence, terminal observation evidence, and broad settings mutation block.
  Future VM/sandbox is represented as the `future_vm_sandbox_boundary` gate.
  That gate is also passed but non-promoting: it verifies the surface is
  registered with VM-specific grants, `future_vm_session` requests are blocked
  before backend creation or host mutation, `smoke:computer-use-vm-sandbox-boundary`
  is wired into `smoke:all`, and the smoke asserts `vmCreated: false` plus
  `hostMutationAllowed: false`.
  Windows settings/app dogfood now includes the read-only/reversible/blocked
  progression in `smoke:computer-use-windows-settings`. The reversible case is
  deliberately limited to an app-owned HKCU smoke key and records profile grant
  and terminal observation evidence; it is not promotion of unattended Windows
  settings mutation. The promotion gate exposes this as
  `windows_settings_reversible_dogfood_boundary`, a passed but non-promoting
  fixture/release guard.
- Surface gate status in debug/readiness UI.
  Partial. `GET /computer-use/eval/promotion-gate` exposes the latest
  promotion-gate evidence/report paths, and the renderer Computer Use panel now
  shows overall status, promotable/blocked counts, fixture-only counts, and gate
  rows. This is currently a file-backed gate surface rather than a database
  ledger projection.

## Global Verification

Before closure of the full parity migration:

```text
npm run lint
npm run build:daemon
npm run build:web
npm run smoke:architecture-foundations
npm run smoke:capability-runtime
npm run smoke:browser-action
npm run smoke:browser-bridge
npm run smoke:vision-context
npm run smoke:scoped-autonomy-self-implementation
npm run smoke:computer-use-action-adapter
npm run smoke:computer-use-session
npm run smoke:computer-use-surface-manager
npm run smoke:computer-use-browser-parity
npm run smoke:computer-use-browser-dogfood
npm run smoke:computer-use-browser-live-dogfood
npm run smoke:computer-use-debug-bundle
npm run smoke:renderer-computer-use-live-refresh
npm run smoke:computer-use-windows-settings
npm run smoke:computer-use-promotion-gate
npm run smoke:computer-use-promotion-gate-route
npm run audit:computer-use-parity
npm run smoke:all
git diff --check
```

Also run strict UTF-8 and mojibake checks for touched files. If `.cs` files are
touched, verify BOM.

## Known Blockers To Keep Open

- Official app-server custom/client tool contract.
- Production signing certificate/service.
- Credential vault/unrestricted credential flow.
- Unattended high-risk Windows mutation.
- Authenticated browser profile/cookie default access.
- GPU ASR validation.
- Human microphone ASR corpus benchmark.
- Full VM/RDP/Sandbox desktop runtime.
