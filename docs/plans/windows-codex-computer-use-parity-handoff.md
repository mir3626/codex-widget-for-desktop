# Windows Codex Computer Use Parity Handoff

Status: active architecture handoff
Date: 2026-05-15

## Shards

This handoff is intentionally sharded because the parity track is larger than a
single implementation note.

- `windows-codex-computer-use-parity/README.md` - root index and context-loss
  restart map for the full parity shard set. Read this immediately after this
  top-level handoff when chat context is missing.
- `windows-codex-computer-use-parity/00-overview.md` - product target,
  architecture direction, current repo reality, and non-negotiable boundaries.
- `windows-codex-computer-use-parity/01-contract-session-runtime.md` -
  normalized Computer Action contract, session runtime, routes, events, and
  debug bundle contract.
- `windows-codex-computer-use-parity/02-surfaces-permissions-safety.md` -
  execution surfaces, permission profiles, risk classes, restricted-page,
  credential, file, network, and generated-code policy.
- `windows-codex-computer-use-parity/03-observation-perception-action.md` -
  observation model, perception graph, ROI cascade, target grounding, action
  routing, effect verification, and failure memory.
- `windows-codex-computer-use-parity/04-browser-tool-terminal-slices.md` -
  Browser Action, Browser Chrome, Toolsmith, Terminal, download, file upload,
  document conversion, and research-to-PDF slices.
- `windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md` -
  native helper scope correction, watch-mode, Windows foreground safety,
  signing, rollback, and future VM route.
- `windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md` - eval
  ledger, debug bundle, renderer UX, dogfood corpus, promotion gates, and
  release readiness.
- `windows-codex-computer-use-parity/07-migration-checklist.md` - phased
  implementation checklist and acceptance status.
- `windows-codex-computer-use-parity/08-implementation-resumption-handoff.md` -
  operational resume guide for future sessions after context loss.
- `windows-codex-computer-use-parity/09-approved-execution-handoff/` -
  product-owner approved execution pack with target boundaries, current
  inventory, ordered implementation slices, runtime contracts, verification
  gates, and resume maintenance rules.
- `windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/` -
  product-owner approved, deeply sharded macOS Computer Use parity execution
  handoff. It translates the accepted benchmark briefing into user-outcome
  contracts, runtime architecture, browser/native/tooling workstreams, safety
  policy, promotion gates, ordered backlog, and context-loss resume rules.

If context is lost, read `windows-codex-computer-use-parity/README.md`, then
`00`, then `09-approved-execution-handoff/README.md`, then
`09-approved-execution-handoff/07-current-status-ledger.md`, then
`10-macos-parity-implementation-handoff/README.md`, then
`10-macos-parity-implementation-handoff/09-resume-protocol.md`, then `08`,
then `07`, then the specific domain shard for the file you are about to modify.

## Implementation Progress

### 2026-05-16 Context-Loss Handoff Index Slice

Implemented:

- Added `windows-codex-computer-use-parity/README.md` as the root index shard
  for the parity migration.
- The index records the mandatory startup sequence, shard map, current stable
  boundary, disabled foreground executor invariant, non-negotiable safety
  boundaries, implementation policy, verification ladder, next safe work, and
  external blockers.
- Updated the handoff reading order so future sessions start from the root
  index before diving into domain shards.

Verification passed:

- `npm run build:daemon`
- `npm run smoke:computer-use-native-watch-boundary`
- `npm run audit:computer-use-parity`
- `npm run gate:computer-use-promotion`
- `npm run smoke:all`
- UTF-8/mojibake scan over touched/new text files

### 2026-05-16 Autonomy Toolsmith Rerun History Slice

Implemented:

- Renderer Autonomy Toolsmith panel now shows a historical rerun comparison
  section for `toolsmith-rerun-comparison.v1` tool-run outputs.
- Each row exposes matched/changed verdict, scalar match state, artifact match
  state, changed/missing/added artifact counts, artifact totals, elapsed time,
  and a redacted rerun id.
- Added compact rerun-history styling in Activity details.
- Added `scripts/smoke-renderer-autonomy-rerun-history.mjs`,
  `smoke:renderer-autonomy-rerun-history`, and `smoke:all` wiring.

Focused verification passed:

- `node --check scripts/smoke-renderer-autonomy-rerun-history.mjs`
- `npm run smoke:renderer-autonomy-rerun-history`
- `npm run build:renderer`
- `npm run smoke:renderer-chat`

### 2026-05-15 Phase 1/2 Foundation Slice

Implemented:

- Shared protocol `src/shared/protocol/computerUse.ts`.
- Normalized OpenAI/widget computer action adapter:
  - single `action`
  - batched `actions[]`
  - raw widget-native action object
  - unknown action blocks the batch
- Daemon `ComputerSessionRuntime` skeleton:
  - session state transitions
  - execution surface selection
  - eval run creation/finalization
  - capability DAG skeleton creation/completion
  - observation/action/verifier/debug-bundle in-memory records
  - cancellation propagation to session capability jobs
- Daemon `ExecutionSurfaceManager`:
  - `isolated_browser`
  - `regular_browser_extension`
  - `tool_workspace`
  - `pty_workspace`
  - `foreground_desktop_watch`
  - `future_vm_session`
- HTTP surface:
  - `GET /computer-use/surfaces`
  - `GET /computer-use/sessions`
  - `POST /computer-use/sessions`
  - `GET /computer-use/sessions/:id`
  - `POST /computer-use/sessions/:id/operations`
  - `POST /computer-use/sessions/:id/browser-action-prompt`
  - `POST /computer-use/sessions/:id/cancel`
  - `GET /computer-use/sessions/:id/debug-bundle`
- Computer Session capability operation execution:
  - creates per-operation DAG nodes
  - bridges `browser_action`, `browser_chrome`, `terminal`,
    `screen_observe`, `ocr`, `toolsmith`, `native_browser_window_action`, and
    `visual_desktop_action` operation envelopes to capability jobs where
    possible
  - waits for read-only/fast jobs to settle
  - surfaces `awaiting_action_confirmation` when capability approval is needed
- Browser Action side-effect executor binding:
  - daemon `ComputerSessionRuntime` accepts an optional Browser Action executor
  - server wiring calls the existing `BrowserActionSessionManager`
  - approval, queued extension command, and immediate result paths reuse the
    existing Browser Action capability mirror
  - Browser Action capability mirror now carries `dagRunId`/`dagNodeId`
  - extension completion updates the linked Computer Session DAG node
- Browser Action prompt/planner path:
  - Computer Session can convert prompt text through existing
    `planBrowserActionFromPrompt`
  - planned Browser Action steps execute through the Computer Session operation
    executor
  - plan metadata is recorded as a computer-use eval step and emitted as a
    `computer.session.plan` event
  - prompt run state is exported in the debug bundle as `promptRuns`
  - extension result handling auto-continues the next prompt step when the
    completed capability job belongs to an active prompt run
  - `POST /computer-use/sessions/:id/browser-action-prompt/continue` is
    available as a manual recovery/inspection path
  - HTTP smoke verifies a prompt-planned click queues through Browser Bridge,
    completes via extension result, and marks the linked DAG node completed
  - HTTP smoke also verifies a two-step Korean prompt: first control click,
    automatic continuation, second content-link click, and completed prompt run
- Browser Action capability handler foundation:
  - read-only Browser Action can complete through the registered capability
    handler
  - side-effect Browser Action now fails with explicit
    `browser_action_executor_not_bound` instead of falling through to the
    generic missing-handler failure unless a bound executor result is supplied
- Isolated browser surface lifecycle:
  - Computer Session prompt plans on `isolated_browser` default to the
    Playwright controlled-browser adapter
  - the daemon Browser Action executor now observes through non-extension
    adapters before executing, so Playwright/CDP target resolution uses fresh
    structured DOM instead of an empty active-tab snapshot
  - Playwright adapter runtime keeps a persistent page per Computer Session
    Browser Action session id and reuses it across prompt steps
  - Computer Session cancel closes the associated persistent Playwright
    browser and records a `surface_cleanup` safety decision
  - `npm run smoke:computer-use-isolated-browser` verifies a two-step isolated
    browser prompt where the first click mutates DOM state and the second step
    depends on that updated DOM
- Renderer Computer Use panel:
  - Activity details now include a `ComputerUseSessionsPanel`
  - the panel can list/select Computer Use sessions and execution surfaces
  - it can create bounded sessions, run Browser Action prompts, manually
    continue prompt runs, cancel sessions, and copy debug bundles
  - selected session detail shows state, surface, DAG node count, capability
    job count, blocked/approval status, awaiting approval jobs, prompt runs,
    prompt steps, and recent DAG nodes
  - approval/cancel actions reuse the existing capability job panel callbacks
- Browser Chrome through Computer Session DAG:
  - added `npm run smoke:computer-use-browser-chrome`
  - verifies `browser_chrome` operation envelopes through
    `POST /computer-use/sessions/:id/operations`
  - covers `tab_group.list/create/claim/update/release`,
    `bookmark.list/create/update/open/remove`,
    `download.search/observe/verify/start/cancel/erase`,
    `history.search/open`, `debugger.inspect/screenshot/print_to_pdf`, and
    `file_upload.inspect/set_files/clear`
  - read-only commands run without approval; side-effect/high-risk Browser
    Chrome commands return `awaiting_approval` and execute only after explicit
    capability approval in the smoke
  - verifies Browser Bridge command polling/result completion, capability job
    completion, DAG node completion, debug-bundle visibility, and redacted
    history/file-path evidence
  - Browser Bridge `debugger.print_to_pdf` uses Chrome debugger
    `Page.printToPDF`, records PDF byte length/SHA-256 when available, and
    omits inline PDF bytes by default
  - Browser Bridge `debugger.screenshot` now records PNG byte length and
    SHA-256 even when inline screenshot bytes are omitted, matching the
    document-capture proof style used by print-to-PDF
  - `download.verify` can now prove a completed approved download by reading
    the declared `approvedDownloadPath` only when the active scoped profile
    grants the file root, storing a blob-backed `download_verified_file` eval
    resource, and exposing basename/SHA-256/size through a
    `browser_chrome_download_verify` file observation
- Operation verification/eval DAG follow-ups:
  - capability-backed Computer Session action nodes now create deterministic
    follow-up DAG nodes after job completion:
    - `${actionNodeId}:verification`
    - `${actionNodeId}:eval_ledger`
  - Browser Action capability mirror applies the same follow-up node creation
    when an extension result completes a linked Computer Session DAG node
  - Browser Action operations executed directly through
    `ComputerSessionRuntime` also upsert the same follow-up nodes at the
    session boundary, avoiding timing dependence on mirror events
  - verification nodes carry verifier status/proof/error metadata when present
  - eval ledger nodes carry the linked eval run id and completed capability job
    id, so the debug bundle exposes the observe/act/verify/eval chain rather
    than only the action node
  - focused smokes assert these follow-up nodes for Browser Action prompt steps
    and Browser Chrome session operations
- Computer Session evidence/perception debug bundle:
  - `ComputerSessionDebugBundle` now includes `evalResources` and
    `perceptionGraphs` alongside session observations
  - `ComputerSessionDebugBundle` now includes `actionFeedbacks`, a compact
    action-loop feedback envelope that links an action result to before/after
    observations, verifier status, capability job id, DAG node id, perception
    graph id, redaction policy, and target evidence when available
  - session observations are structured records with kind/source/surface,
    capability job id, DAG node id, eval run id, perception graph id, resource
    ids, freshness, summary, metadata, and redaction policy
  - Browser Action extension results for `computer-session-browser-action:*`
    sessions are promoted into separate pre-action and post-action
    `browser_dom` observations
  - Browser Action before/after DOM observations are recorded as
    `computer_session_browser_action_pre_action` and
    `computer_session_browser_action_post_action` perception graphs and linked
    to eval steps/resources
  - Browser Action pre-action observations now include
    `computer-session-target-evidence.v1` in both observation metadata and the
    eval step output. The evidence links the selected action target back to the
    perception graph node, records action risk, confidence threshold, allowed
    decision, evidence sources/classes, disagreement notes, and a compact
    redacted target summary. This makes Browser target choice inspectable from
    the session debug bundle without using memory or prior success as proof.
  - `arbitratePerceptionTarget()` now provides a shared
    `perception-target-arbitration.v1` helper for selecting a target candidate
    across fresh session perception graphs. The first Browser Action
    integration records graph count, candidate count, stale graph count,
    selected score, match reason, selected graph source, and arbitration reason
    inside `computer-session-target-evidence.v1`.
  - Arbitration now distinguishes visible evidence from actionable proof:
    non-actionable screen/OCR nodes can satisfy read-only target grounding but
    are marked `target_not_actionable` and cannot authorize side-effect,
    high-risk, or credential actions without current actionable DOM/UIA/native
    evidence.
  - Browser Action result handling now creates a `browser_action` action
    feedback row after recording pre/post observations. This gives the session
    a normalized action-after-feedback surface even when raw screenshots are
    intentionally not embedded. The feedback row is also mirrored into a
    `browser_action_feedback` eval ledger step and stores the linked eval step
    id in the debug bundle.
  - OCR/screen/terminal capability completions can now create structured
    session observations and eval resource links when executed through
    Computer Session operations
  - `screen_observe` completions that include `screenText`, `recognizedText`,
    `ocrBoxes`, `textBoxes`, or equivalent bounded text regions now create a
    `computer_session_screen_observation` perception graph. Nodes carry OCR
    visible-text evidence plus screenshot-region/bbox/freshness evidence, and
    remain linked to the screen observation, eval step, and ROI cascade resource
    without embedding raw screenshots.
  - Computer Session now keeps a per-session screen tile-hash cache. Repeated
    `screen_observe` operations automatically receive `previousTileHashes` plus
    the previous observation id/capture time, allowing unchanged screens to
    produce zero dirty regions and skip expensive ROI OCR/detector stages when
    the capability output supports cascade early exit.
  - Native browser-window helper `desktop_action` outputs that include
    `observation` or `after` snapshots now create a
    `computer_session_native_browser_observation` perception graph. Nodes use
    `uia` evidence classes such as semantic label, accessibility role, visible
    text, `uia_selector`, bbox, freshness, and source reliability. This keeps
    signed/bounded browser-window UIA evidence in the same graph substrate as
    DOM and screen/OCR observations.
  - Renderer Computer Use panel shows evidence counts and recent observation
    records so users can inspect whether a run has current proof, not only an
    action status
- Browser parity operation smoke:
  - added `npm run smoke:computer-use-browser-parity`
  - uses an isolated Playwright controlled browser through Computer Session
    operations, not direct Browser Action APIs
  - performs a user-like search form workflow with two structured operations:
    type into a search field and click the submit button
  - verifies completed Browser Action jobs, action/verification/eval DAG
    follow-up nodes, post-action browser DOM observations, perception graph
    export, and surface cleanup
  - added `npm run smoke:computer-use-debug-bundle` as the focused debug bundle
    verification entry point backed by the session HTTP smoke
- Rollback/cleanup debug surface:
  - `ComputerSessionDebugBundle` now includes `rollbackActions`
  - rollback actions are structured records with kind/label/status/risk class,
    capability job id, target, reason, timestamps, and metadata
  - session cancellation records capability-job cancellation rollback actions
    for active jobs
  - isolated browser cleanup records a `close_surface` rollback action when
    the persistent Playwright surface is closed or skipped when no surface was
    open
  - Renderer Computer Use panel shows rollback counts and recent rollback
    records; high-risk artifact deletion remains blocked until explicit file
    grants and proof are implemented
  - Toolsmith parent session DAGs now add `store_artifact` and
    `verify_artifact` nodes for mirrored report/PDF/citation artifacts; the
    verifier node records blob-backed content and hash proof
- Terminal parity operation smoke:
  - added `npm run smoke:computer-use-terminal-parity`
  - uses a `pty_workspace` Computer Session and executes a safe local terminal
    command through the session operation route
  - validates that terminal execution remains approval-gated, then resumes via
    capability approval and records completed job output
  - terminal operations now evaluate active Computer Session autonomy profiles:
    if a real scoped profile grants the command prefix and session risk class,
    the command is preapproved and recorded in safety decisions; if a profile is
    present but the command grant is missing, the action is blocked before a
    capability job is created with exact missing requirements in DAG/eval output
  - credential-like and destructive terminal command patterns are hard-blocked
    at the Computer Session boundary before approval or profile preapproval
  - debug-bundle export reconciles completed asynchronous capability jobs into
    structured observations, so post-approval terminal completion is visible as
    a `terminal` observation with verifier/eval DAG follow-ups
  - Computer Session debug bundles sanitize terminal capability job output:
    raw stdout/stderr are replaced with length, SHA-256, and a short
    credential-redacted preview under `terminalOutput`
  - terminal operations can declare `trackOutputRoots`/`outputRoots`/
    `expectedOutputRoots`; approved profile write roots are snapshotted before
    execution and diffed after completion, with new/modified bounded files
    stored as `terminal_diff_artifact` eval resources and linked from a
    `terminal_output_root_diff` file observation
- Toolsmith/research artifact through Computer Session:
  - `toolsmith` Computer Session operations now run `ScopedAutonomyRuntime`
    goal DAGs instead of the previous simulated `agent_tool` bridge
  - the session action node records the linked autonomy run id, autonomy eval
    run id, autonomy DAG id, tool spec id, tool run ids, artifact count, and
    redacted artifact hashes
  - the session DAG appends verification/eval follow-up nodes for the
    Toolsmith operation
  - Markdown/PDF/citation artifacts produced by scoped autonomy are mirrored
    into the parent Computer Session eval resources and exposed as `file`
    observations in the session debug bundle
  - Toolsmith source/citation evidence is summarized into the parent
    Computer Session file observation metadata (`sourceSummary`) and surfaced
    in the renderer Computer Use panel as a Sources section, including source
    status, URL/title, browser-fallback marker, character count, and excerpt
    when the generated citation/source artifact provides it
  - artifact deletion rollback is represented as a blocked rollback action
    until an explicit file rollback grant and verifier proof exist
  - added `npm run smoke:computer-use-toolsmith-artifact`, which creates a
    scoped one-time permission profile, runs web_research_to_pdf through a
    `tool_workspace` Computer Session, and verifies report/PDF resources,
    observation evidence, autonomy run linkage, and DAG follow-ups
  - `npm run dogfood:scoped-autonomy-web-research-live` now uses the current
    Seoul date for evidence paths, fetches official OpenAI Codex docs, and
    supplies Playwright browser-capture fallback documents when daemon-side HTTP
    returns 403. The dogfood requires a valid live source body, report/PDF
    artifacts, citations, and PDF header proof before passing.
  - added `npm run dogfood:computer-use-toolsmith-live`, which runs the same
    OpenAI Codex research-to-PDF scenario through the daemon HTTP
    `ComputerSessionRuntime` Toolsmith route, verifies the parent debug bundle,
    parent DAG follow-up nodes, mirrored eval resources, browser fallback
    captures, Markdown report text, and PDF bytes
  - latest live evidence paths:
    `docs/dogfood/scoped-autonomy-web-research-live-2026-05-16.json`,
    `docs/reports/scoped-autonomy-web-research-live-2026-05-16.md`,
    `docs/dogfood/computer-use-toolsmith-live-2026-05-16.json`, and
    `docs/reports/computer-use-toolsmith-live-2026-05-16.md`
- Native foreground watch boundary:
  - native Browser Action adapter capability advertisement now matches the v1
    helper: `screenshot` is no longer advertised, status diagnostics list it as
    explicitly unsupported, and direct screenshot execution is rejected before
    helper invocation with fallback hints to `screen_observe`, Playwright, or
    CDP
  - `visual_desktop_action` Computer Session operations no longer fall through
    to the broad v1 `desktop_action` helper path
  - the runtime now blocks foreground visual mutation before native input unless
    the selected surface is a true watch-mode path with the required helper v2
    preconditions
  - blocked runs create explicit DAG evidence:
    - `approval` node with missing preconditions
    - failed `action` node with `actualInputSent: false`
    - deterministic `:verification` and `:eval_ledger` follow-up nodes
  - debug bundles now expose the watch-mode blocker through `safetyDecisions`,
    a `foreground_desktop_watch_boundary` observation, a failed verifier
    result, and a `none_available` rollback record explaining that no rollback
    is needed because no foreground input was sent
  - `ComputerSessionDebugBundle` now includes `failureMemory`; the watch-mode
    blocked path records a structured failure memory item as calibration only
    (`mayCompleteTask: false`, `proofSource: false`) with recovery hints and
    abstention triggers for missing watch-mode/helper-v2 guards
  - Renderer Computer Use panel now shows failure-memory counts and recent
    calibration records alongside DAG/evidence/rollback data
  - missing preconditions recorded in the action output include one-time
    approval, visible countdown, active-window assertion, process allowlist,
    user-idle guard, abort-on-user-input, pre/post evidence, signed helper v2,
    and effect verification/rollback proof
  - the current browser-window scoped native helper remains available through
    `native_browser_window_action`/Browser Action fallback paths, but it is not
    treated as sufficient for broad foreground desktop Computer Use
  - added `npm run smoke:computer-use-native-watch-boundary`, which exercises
    the daemon HTTP Computer Session path and asserts that no `desktop_action`
    capability job is created for a blocked foreground click
- Effect verifier and recovery boundary:
  - added `src/daemon/computer-use/effectVerifier.ts`
  - capability-backed Computer Session operations now run a session-level
    verifier after capability completion instead of treating every completed
    job as a proven task success
  - explicit expectations such as `text contains ...` and
    `stdout contains ...` are checked against the actual capability output
  - failed or inconclusive verification records an `effect_verification` eval
    step, overrides the session verification/eval DAG follow-up nodes to failed,
    creates a bounded `fallback` recovery-attempt node, records a
    `recovery_attempt` eval step, writes structured failure memory as
    calibration-only evidence, and leaves the session failed rather than
    completed
  - recovery budget is currently one bounded attempt per Computer Session; if
    no automatic recovery action is available, the attempt is recorded as
    skipped with a safe next action of reobserve or user clarification
  - Browser Action operations that declare `requiresFreshObservation` or
    `maxEvidenceAgeMs` now run a target-scoped stale-evidence recovery slice
    before the original action: the session records a
    `browser_action_reobserve_recovery` eval step and an `observe` DAG node,
    performs a safe Browser Action `read` reobserve through the same adapter
    and source, and proceeds with the original action only if the latest
    evidence is fresh after recovery
  - stale-evidence recovery records the action type, redacted target summary,
    previous observation freshness, required max age, reobserve capability job,
    and post-recovery freshness; if the recovery budget is exhausted or
    reobserve does not produce fresh evidence, the session fails instead of
    executing on stale DOM evidence
  - added `npm run smoke:computer-use-effect-verifier`, which verifies an OCR
    text expectation mismatch and an unsupported expected-effect target are not
    marked successful and produce verifier, recovery, eval, DAG, and
    failure-memory evidence
  - added `computer-use-verifier-audit.v1`, which audits eval ledger verifier
    steps for false-negative records, false-positive candidates, inconclusive
    verifier results, and expected-effect action steps missing verifier evidence
  - verifier audit summaries are now included in Computer Session debug bundles,
    `/computer-use/eval/verifier-audit`, run-scoped verifier audit routes, and
    readiness output
  - added `npm run smoke:computer-use-verifier-audit`, which verifies the audit
    surface from an OCR expected-text mismatch and an inconclusive unsupported
    expected-effect target through the daemon HTTP path
  - expanded `npm run smoke:computer-use-browser-parity` to prime an old
    Browser Action DOM observation, execute a fresh-evidence-gated type action,
    assert the reobserve recovery node/eval step, and then verify the normal
    action/verification/eval-ledger follow-up nodes
  - Browser Action pre-action evidence now records target grounding output from
    the session perception graph. The parity smoke asserts that an isolated
    browser click has a matching graph node, passes the side-effect threshold,
    and exposes DOM selector evidence in both the debug-bundle observation and
    the eval ledger step.
  - The target grounding path now uses the shared perception arbitration helper
    rather than a one-off graph lookup. `npm run smoke:research-performance-architecture`
    covers the helper directly, and `npm run smoke:computer-use-browser-parity`
    verifies Browser Action target evidence carries arbitration metadata.
- Renderer approval clarity:
  - Computer Use awaiting-approval rows now show inferred grant, risk class,
    reason, and command/action summary rather than only capability kind/id
  - warning/error approval rows include a sanitized expandable Preview payload
    with job id, capability kind, grant, risk class, command/action summary,
    redacted input payload, requestedBy/priority, approval id, timeout, and
    retry evidence
  - grant/risk summaries currently cover terminal commands, browser chrome
    commands, Browser Action side effects, desktop/watch-mode jobs, and
    generated-tool execution
  - Computer Use panel now groups Browser Action `pre_action`/`post_action`
    observations into a structured Before / after preview. The preview shows
    action type, redacted target/source summary, freshness, URL/title,
    element-count, graph-node count, verifier status, and capability job id
    without storing or rendering raw screenshots.
  - When Browser Action target evidence is present, the Before / after preview
    also shows the target grounding verdict: allowed/blocked, risk class,
    confidence/threshold, target label or node id, and compact evidence
    source/class summaries. This keeps target-choice proof visible without
    forcing users to open the raw debug JSON.
  - Computer Use panel now shows an action Feedback section when
    `actionFeedbacks` are present, including action type, summary, verifier
    status, before/after observation ids, perception graph id, and capability
    job id.
  - full bitmap before/after preview for foreground visual actions remains
    future work until the watch-mode helper v2 and raw screenshot retention
    boundaries are promoted
  - blocked or approval-pending Computer Sessions now infer the narrow
    `AutonomyPermissionRequirement` set from session safety decisions,
    selected surface grants, and awaiting capability jobs
  - the renderer can create a scoped `one_time` autonomy permission profile
    from those inferred grants, attach it to the blocked Computer Session via
    `/computer-use/sessions/:id/profile`, and record the attachment in the
    session eval ledger and debug bundle safety decisions
  - the Computer Use create row lists active autonomy permission profiles and
    passes the explicitly selected profile id into new session creation; no
    profile is selected by default, while a newly created one-time profile is
    selected for the next run
  - Computer Use debug bundles can now be copied or saved as JSON from the
    panel toolbar
  - session debug resources with artifact-like roles (`toolsmith_*`, report,
    PDF, citation, markdown, download, file) now render in an Artifacts section
    with retention and blob/capability resource identifiers
  - artifact-like eval resources can be opened or downloaded through
    `/computer-use/eval/runs/:runId/resources/:resourceId/content`; the route
    only serves artifact/file/report/PDF/citation/markdown/download roles,
    blocks raw screen/audio/perception resources, caps direct content at 25 MB,
    and never exposes the underlying blob filesystem path
  - the renderer Artifacts section now offers Open, Save, and text Copy actions
    for eligible blob-backed resources
  - the renderer Computer Use panel now shows verifier audit issue counts and
    recent audit rows from the debug bundle, including false-negative records,
    false-positive candidates, inconclusive results, and missing verifier
    evidence
  - long-running Computer Use sessions now refresh in Activity details from
    daemon `computer.session.*` and capability job/resource events without
    requiring a manual refresh; the signal is debounced and causes the selected
    session debug bundle to be reloaded after the quiet refresh settles
  - added `npm run smoke:computer-use-one-time-profile`, which validates
    blocked foreground-watch profile attachment remains evidence-only and does
    not bypass the missing signed helper/watch-mode preconditions
  - added `npm run smoke:renderer-computer-use-live-refresh`, which uses a
    fake daemon HTTP+WebSocket server to verify session and debug-bundle rows
    update after a `computer.session.state` event
- Smoke coverage:
  - `npm run smoke:computer-use-action-adapter`
  - `npm run smoke:computer-use-surface-manager`
  - `npm run smoke:computer-use-session`
  - `npm run smoke:computer-use-session-http`
  - `npm run smoke:computer-use-isolated-browser`
  - `npm run smoke:computer-use-browser-parity`
  - `npm run smoke:computer-use-debug-bundle`
  - `npm run smoke:computer-use-terminal-parity`
  - `npm run smoke:computer-use-toolsmith-artifact`
  - `npm run smoke:computer-use-browser-chrome`
  - `npm run smoke:computer-use-native-watch-boundary`
  - `npm run smoke:renderer-computer-use-live-refresh`
  - `npm run smoke:computer-use-effect-verifier`
  - `npm run smoke:computer-use-verifier-audit`
  - all Computer Use focused smokes above are included in `npm run smoke:all`
- Dogfood command compatibility:
  - `npm run dogfood:computer-use-30` now aliases the existing
    `dogfood:computer-use-process-30` runner so the migration checklist command
    works as written

Verified:

- `npm run lint`
- `npm run build:web`
- `npm run smoke:capability-runtime`
- `npm run smoke:browser-action`
- `npm run smoke:computer-use-action-adapter`
- `npm run smoke:computer-use-surface-manager`
- `npm run smoke:computer-use-session`
- `npm run smoke:computer-use-session-http`
- `npm run smoke:computer-use-isolated-browser`
- `npm run smoke:computer-use-browser-chrome`
- `npm run smoke:computer-use-native-watch-boundary`
- `npm run smoke:computer-use-effect-verifier`
- `npm run smoke:computer-use-verifier-audit`
- `npm run smoke:computer-use-promotion-gate`
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run smoke:browser-bridge`
- `npm run smoke:extension`
- `npm run smoke:browser-action:native`
- `npm run smoke:capability-runtime`
- `npm run smoke:renderer-chat`
- `npm run build:renderer`
- `npm run dogfood:computer-use-30`
- `npm run smoke:all`

Still not complete:

- Browser Action side-effect execution is now routed through the daemon HTTP
  Computer Session operation path. Prompt/planner integration now tracks
  prompt runs and auto-continues multi-step plans through Browser Bridge
  extension results. Basic isolated Playwright browser lifecycle is implemented
  for Computer Session prompt runs; broader browser profile policy, downloads,
  and user-visible renderer controls remain future phases.
- `CapabilityDagRuntime` is now used by the session skeleton and
  capability-backed actions now create action/verification/eval follow-up
  nodes. Browser Action and observe-like capability completions now surface
  structured observations, perception graphs, and eval resources in the debug
  bundle. Toolsmith artifact output now adds parent `store_artifact` and
  `verify_artifact` nodes. The `web_research_to_pdf` slice now accepts
  browser-captured fallback documents and uses them when direct HTTP fetch is
  unavailable for an allowed browser domain. Broader ROI/delta cascade
  scheduling and recovery branches remain future phases.
- Renderer Computer Use panel has a functional pass in Activity details:
  artifacts/source quality, rollback actions, high-risk grant creation,
  promotion gates, verifier audit, and long-running live refresh are now
  represented. Remaining polish is mainly historical multi-run comparison,
  richer bitmap feedback after watch-mode screenshot policy is promoted, and
  more live dogfood calibration.
- Browser Bridge restricted/reload handling is now a passed but non-promoting
  promotion gate. It verifies restricted extension-page reload requests remain
  blocked by design, reload-required/permission-needed/restricted bridge states
  are covered by smoke, the extension popup exposes the user-gesture
  `Reload bridge` path, and renderer Browser Action UI gives recovery guidance.
- The 30-case fixture-backed dogfood matrix was rerun on 2026-05-16 after the
  Toolsmith/PDF, Browser Chrome download-verification, and Vision VLM fallback
  fixture slices. Result: 21 passed, 9 intentionally blocked,
  0 needs-follow-up, 0 unexpected failures, task success rate 0.786, proof rate
  0.405, p95 latency 108 ms, and p95 perception latency 40 ms. The formerly
  blocked Codex research-to-PDF scenario now executes through a bounded
  `web_research_to_pdf` artifact path, the browser PDF download scenario now
  records `download_verified_file` eval resources, and the complex-chart
  scenario now records metadata-only `vlm_fallback_summary` evidence. Live
  browser/OS/VLM trace promotion is still separate from this fixture evidence.
- Native helper watch-mode and signed helper v2 are not implemented yet.
  The first safe boundary slice is implemented: broad `visual_desktop_action`
  is blocked before helper execution with detailed missing-precondition proof.
  Native file picker needs are also represented explicitly through
  `native_file_picker_action`; attempts are blocked before raw local path
  disclosure or native input and record safety, DAG, eval, verifier, rollback,
  and failure-memory evidence.
  Native helper release diagnostics now record provenance/SHA-256 and
  Authenticode status, and release readiness gates unsigned helpers as
  development-only through the deferred `browser-native-helper-signing` gate.
  Real foreground mutation remains blocked until signed watch-mode helper v2,
  countdown/idle/abort guards, active-window proof, and rollback/effect
  verification exist.
- Future VM/sandbox surface is now an explicit non-executing boundary:
  requested `future_vm_session` sessions block with
  `future_vm_session_backend_not_available` before VM creation, network bridge,
  host mutation, clipboard/file sync, or raw screenshot retention. The actual
  VM/sandbox backend remains blocked until isolation and lifecycle management
  are proven.

## Objective

Deliver a Windows implementation that can reach Codex macOS Computer Use user
outcomes while preserving the widget's stricter local safety boundaries.

This is not an attempt to clone unknown macOS internals. It is a public-contract
and behavior parity plan:

- Use the OpenAI Computer Use screenshot/action/feedback loop as the external
  contract.
- Use Codex app Computer Use and Browser public behavior as the product target.
- Reuse the widget's existing daemon, browser, terminal, autonomy, perception,
  eval, and safety foundations.
- Add the missing unifying runtime so those modules operate as one observable
  computer-use session.

## Required Reading Order

This handoff is sharded so a future agent can resume implementation even after
context loss.

1. `windows-codex-computer-use-parity/00-overview.md`
   - Product target, current repo reality, non-goals, and implementation map.
2. `windows-codex-computer-use-parity/01-contract-session-runtime.md`
   - Computer action protocol, session state machine, DAG ownership, and
     compatibility adapter for OpenAI action schemas.
3. `windows-codex-computer-use-parity/02-surfaces-permissions-safety.md`
   - Execution surfaces, permission profiles, high-risk boundaries, and
     per-surface safety gates.
4. `windows-codex-computer-use-parity/03-observation-perception-action.md`
   - Observation loop, perception graph, ROI cascade, target grounding, action
     routing, verification, and failure memory.
5. `windows-codex-computer-use-parity/04-browser-tool-terminal-slices.md`
   - Browser, Browser Chrome, Toolsmith, Terminal, and web-research-to-PDF
     slices that should deliver most early parity.
6. `windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md`
   - Windows UIA/native helper v2, foreground watch-mode, signing, and future
     VM/sandbox route.
7. `windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md`
   - Eval ledger, debug bundles, renderer UX, dogfood matrix, promotion gates,
     and release readiness.
8. `windows-codex-computer-use-parity/07-migration-checklist.md`
   - Concrete phased implementation checklist with acceptance tests and known
     blockers.

## Design Decisions Already Made

- The daemon remains the local control plane.
- The new center of gravity is `ComputerSessionRuntime`, not individual
  feature-specific runners.
- Browser and tool-workspace parity ship before full Windows foreground desktop
  control.
- Native foreground desktop control must start as explicit watch-mode, not
  unattended YOLO.
- Browser Action, Browser Chrome, Toolsmith, Terminal, Vision/OCR, ASR, failure
  memory, capability jobs, and eval ledger remain reusable backend modules.
- Existing module shape can change when it conflicts with the public Computer
  Use contract, but safety boundaries do not relax.

## Public Contract Sources

- OpenAI Computer Use guide:
  https://platform.openai.com/docs/guides/tools-computer-use
- OpenAI Responses API reference:
  https://platform.openai.com/docs/api-reference/responses
- Codex app Computer Use:
  https://developers.openai.com/codex/app/computer-use
- Codex app Browser:
  https://developers.openai.com/codex/app/browser

## External Blockers

The following must remain explicit blockers unless a future task supplies the
missing external dependency:

- Official app-server custom/client tool contract.
- Production Authenticode signing certificate or CI signing service.
- Unrestricted credential flow or credential vault integration.
- Unattended high-risk Windows mutation.
- Authenticated browser profile/cookie access as a default execution surface.
- GPU ASR validation.
- Human microphone ASR corpus benchmark.
- Full Windows VM/RDP/Sandbox isolated desktop runtime.
