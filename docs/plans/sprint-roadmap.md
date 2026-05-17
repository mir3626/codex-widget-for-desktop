# Sprint Roadmap

## Iteration 1: Resident Agent Widget Foundation

### sprint-01-auth-architecture

Goal: replace the current API-key-first mental model with a documented OAuth-ready auth/backend boundary while preserving local mock and daemon development.

Dependencies: current Tauri widget and daemon.

Expected scope: docs, config, daemon auth boundary notes, optional local token abstraction.

### sprint-02-browser-dom-bridge

Goal: add the first real browser provider contract for active-tab DOM selection and element metadata.

Dependencies: shared daemon event protocol.

Expected scope: provider interface, extension/native bridge plan or scaffold, UI status events.

### sprint-03-terminal-pty-provider

Goal: add a real terminal provider using ConPTY/node-pty or a selected equivalent and stream shell output as tool events.

Dependencies: daemon provider router.

Expected scope: dependency decision, PTY lifecycle, cancel/close behavior, smoke test.

### sprint-04-screen-vision-provider

Goal: add a screen capture provider abstraction with crop/diff metadata ready for image or computer-use loops.

Dependencies: provider router and approval policy.

Expected scope: Windows capture research spike or minimal provider, safety/consent UI, testable stubs.

### sprint-05-packaging-and-startup

Goal: make the widget practical to install and run as a resident desktop utility.

Dependencies: stable shell and daemon startup.

Expected scope: Tauri bundle settings, autostart/tray behavior, release smoke checklist.

## Iteration iter-2: Resident Runtime Expansion

Carryover: Iteration 1 produced the resident Tauri shell, OAuth/Codex auth boundary, streaming chat UX, and default `codex app-server` runtime. The next iteration focuses on turning that foundation into a durable desktop assistant instead of a prototype conversation panel.

### iter-2-sprint-01-runtime-protocol

Goal: stabilize the renderer-daemon protocol for long-lived Codex sessions, including session reset, app-server interactions, and persistent visible conversation state.

Dependencies: `CodexAppServerBridge`, shared `ServerEvent`/`ClientMessage`, renderer chat timeline.

Expected scope: shared protocol types, app-server approval/user-input bridge, renderer interaction cards, local chat persistence, `CODEX_WIDGET_CODEX_APPROVAL_POLICY` config.

Status: app-server approval/input interactions, runtime diagnostics, local chat persistence, explicit New chat reset, app-server-backed regenerate rollback, branch-safe `session.branch` plus one-shot `branchContext`, reconnect response snapshot replay, fake app-server protocol coverage for thread reuse/approval/rollback, and optional live Codex app-server smoke coverage for real CLI protocol drift are implemented with daemon and renderer smoke coverage.

### iter-2-sprint-02-tool-provider-shell

Goal: promote DOM, Vision, and PTY modes from passive stubs to provider contracts with clear status, permission, and event surfaces.

Dependencies: runtime protocol from sprint 01.

Expected scope: provider interfaces, mode-specific state cards, PTY command lifecycle spike, browser/screen permission placeholders with testable events.

Status: DOM snapshot ingress, an unpacked browser DOM extension with local-only Options URL configuration, optional Chrome/Edge native messaging host, store listing/privacy/review metadata, generated browser store submission packet, browser store submission confirmation evidence support, Screen/Vision snapshot ingress, direct app-server image input, daemon-triggered Windows screen capture with Settings/env/visual-drag configured crop, optional OCR command support, bundled OCR runtime packaging with standard Windows install discovery, tessdata language acquisition/defaults, OCR-only PNG preprocessing, image hash/change/diff metadata with configurable thresholding, explicit terminal command execution, a node-pty/ConPTY-backed `/pty` command/raw-input session, raw-input output drain, direct `terminal.input` protocol, SGR mouse click/drag/wheel forwarding, and a renderer PTY viewport with direct input controls are implemented with smoke coverage. Final browser store account submission is deferred until after dogfooding; deeper native integrations are future enhancement work, not a current release gate.

### iter-2-sprint-03-resident-desktop-ops

Goal: harden resident desktop behavior for daily use.

Dependencies: stable runtime lifecycle.

Expected scope: tray/autostart settings, resource budget checks, crash/reconnect recovery, process cleanup verification, report/checkpoint refresh.

Status: tray/autostart, runtime status, installer builds, native daemon restart supervision, renderer-visible native daemon diagnostics, daemon parent watchdog cleanup, bundled daemon/Node/PTY runtime resources, installed `_up_` resource resolution, resident resource smoke, resident soak smoke, release exe longer soak with JSON evidence reports, bundled runtime smoke, release exe launch smoke, NSIS install/uninstall plus daemon/app crash cleanup smoke, MSI install/launch/uninstall smoke, one-command `release:verify`, browser store submission packet generation, a passed two-hour release soak evidence run, and `release:readiness` artifact/soak/manual-blocker audit gates are implemented. Browser store account submission is deferred until after dogfooding.

## Iteration iter-3: Durable Product State

Carryover: Iteration 2 made the widget viable for dogfooding with a daemon-owned `codex app-server`, provider ingress, PTY runtime, release/install gates, and renderer chat hardening. The next iteration shifts the product from reload-tolerant UI state to durable local-first product state: sessions, tabs, branches, trash, artifacts, provider snapshots, activity logs, and extension-ready theme/mascot/module metadata should be owned by the daemon and backed by SQLite plus a blob store.

### iter-3-sprint-01-storage-foundation

Goal: add a daemon-owned SQLite storage foundation and migration layer for sessions, messages, runtime metadata, provider snapshots, artifacts, activity, preferences, themes, mascots, and future modules.

Dependencies: `src/daemon/server.ts`, shared renderer-daemon protocol, Tauri app data path decisions, current localStorage keys.

Expected scope: storage adapter, migrations, app data directory and blob store path resolution, schema for core entities, SQLite WAL/foreign-key setup, no-secret persistence boundary, smoke coverage for migration/open/health behavior.

Status: implemented with `src/daemon/storage/*`, daemon `/storage/health`, runtime storage diagnostics, Tauri `CODEX_WIDGET_APP_DATA_DIR` propagation, `npm run smoke:storage`, and `smoke:all` coverage. The first migration creates core durable product-state tables, seeds the default dog mascot preset, keeps large blobs out of SQLite, and rejects secret-like app setting keys.

### iter-3-sprint-02-session-tabs-trash

Goal: replace single visible chat persistence with durable session, internal tab, branch, restore, and trash semantics.

Dependencies: storage foundation, current `session.reset`, `session.branch`, reconnect replay, app-server rollback behavior.

Expected scope: session/tab protocol, renderer tab UI, app restart session restore, branch-to-new-session behavior, session trash/restore, per-session model/reasoning/mode state, compatibility migration from existing localStorage chat where practical.

Status: implemented first durable slice with shared `session.snapshot`/create/open/trash/restore/branch protocol, daemon SQLite session/message persistence, renderer internal session tabs, New chat durable session creation, branch-to-new-tab seeded with the selected exchange, restorable session trash, and per-session model/reasoning/mode restoration. Smoke coverage now exercises storage session prepare/complete/branch/trash/restore and daemon branch snapshot replay. Remaining risk: persisted visible messages restore across app restart, but hidden Codex app-server thread rebinding per restored/switched session is not durable yet and should be handled in a later runtime/session sprint.

### iter-3-sprint-03-artifact-activity-ledger

Goal: track files and secondary outputs created, modified, or deleted during Agent work, and expose the same artifact viewer from chat and trashed sessions.

Dependencies: storage foundation, app-server file-change/tool events, blob store, renderer markdown/action surfaces.

Expected scope: artifact/version/file/blob tables, before/after/diff preservation for text files, full snapshot preservation for binary or generated files, artifact accordion UI, click-to-open behavior, activity one-line summary plus detail drawer, retention and size-limit defaults.

Status: implemented with daemon-owned artifact/activity ledger APIs on top of the SQLite/blob storage foundation. Tool output is captured into file-backed blobs, app-server file-change events are recorded as generated/modified/deleted artifacts with before/after snapshots and text diffs when available, `ledger.snapshot`/`ledger.refresh`/`artifact.open` protocol messages expose the ledger to the renderer, and the chat timeline plus session trash popover reuse the artifact accordion viewer. Activity now has a one-line footer summary plus a detail popover backed by daemon activity records. Smoke coverage exercises storage artifact persistence/open-path resolution, daemon tool-output ledger recording, and renderer trash artifact viewing.

### iter-3-sprint-04-vision-streaming-and-ux-foundation

Goal: evolve Vision and desktop UX foundations for real dogfooding: choose WebM recording or Agent screen streaming, preserve recording metadata, prepare non-persistent live screen-stream sessions, and polish status/mascot/activity affordances.

Dependencies: Vision provider snapshot/crop/diff/OCR path, storage foundation, activity log, renderer provider menus.

Expected scope: Vision popup menu for record vs stream, WebM-first screen recording path with metadata/blob references, Agent screen-stream metadata without mandatory video file storage, CPU/memory guardrails, default dog mascot preset metadata, status-aware mascot hooks, UI review pass using taste-skill guidance.

Status: implemented as the first Vision streaming/recording UX foundation. Vision mode now exposes a compact popup menu for snapshot capture, WebM recording, and Agent screen share. WebM recording uses browser display capture plus `MediaRecorder`, sends completion metadata to the daemon, and the daemon stores recording metadata in `vision_streams` with the video blob in the file-backed blob store. Agent screen stream starts a non-recording display-capture session, records metadata only, and sends low-frequency JPEG frames to the daemon's existing Vision snapshot endpoint so later Agent turns can consume live screen context without persisting a video file. Guardrails include local and daemon ingest limits, two-minute auto-stop, 1 fps stream cadence, and metadata-only retention for Agent streams. The mascot now reflects offline/working/recording/streaming states through lightweight CSS animation, and smoke coverage exercises storage metadata, daemon start/stop/recording completion, renderer menu interactions, and the full `smoke:all` gate.

## Iteration iter-4: Backlog Closure And Dogfood Polish

Carryover: The product owner clarified that the `/goal` directive means repeated `/vibe-iterate` execution until the categorized product backlog is actually closed, not stopping after the Iteration 3 sprint set. Iteration 3 established daemon-owned SQLite, session tabs/trash, artifact/activity ledger, and Vision recording/streaming foundations. Iteration 4 continues from the remaining dogfooding backlog: UI/interaction polish, Agent awareness of widget capabilities, richer artifacts/version UX, interactive Vision/voice foundations, PTY popup behavior, mascot/persona behavior, and durable runtime/provider history gaps.

### iter-4-sprint-01-ui-polish-and-tab-interactions

Goal: close the immediately visible dogfooding UI defects and tab/session affordance gaps before deeper runtime work.

Dependencies: renderer chat/session tabs, durable session state, existing resize handles, More action menu, model/reason controls, `smoke:renderer-chat`.

Expected scope: widen resize hit areas without visual clutter, fix Reason select minimum-width overlap, set user bubble radius to 12px, audit More action popup top-right alignment, add branch-to-new-session toast, improve Chrome-like internal tab behavior, animate per-session model/reason changes with a restrained gradient border, and run a taste-skill UI review pass.

Status: implemented. The renderer now has wider window and prompt resize hit areas, a safer minimum-width model/reason layout, 12px user message bubbles, polished active session tabs, branch-to-new-session toast feedback, and a restrained model/reason pulse when the active session changes. Renderer smoke coverage now checks minimum-width controls, resize hitbox sizes, user bubble radius, More menu top-right alignment, branch toast, session-control pulse, and existing prompt/table/terminal layout invariants.

### iter-4-sprint-02-widget-context-agent-awareness

Goal: make Agent conversations aware of the widget's own UI, modes, settings, providers, and limitations so questions like "what does the PTY button do?" receive correct contextual answers.

Dependencies: daemon app-server bridge, provider registry, settings/model state, shared prompt/context helpers.

Expected scope: widget capability/context snapshot owned by the daemon, safe developer-context injection for app-server turns, renderer-visible help metadata where useful, and smoke coverage proving Agent prompts receive current mode/provider/control context without exposing credentials or unrelated repo history.

Status: implemented. The daemon now builds a compact `Codex Widget desktop context` snapshot per Agent turn, including current mode, model/reasoning, sanitized auth state, mode/provider status, session/artifact/activity controls, Vision/DOM/PTY use cases, and source/secret safety boundaries. App-server and exec turns receive this as a dedicated context section, OAuth proxy payloads receive `widgetContext`/`widget_context`, and fake app-server smoke coverage verifies a PTY button question receives the widget context in the turn input.

### iter-4-sprint-03-artifact-rendering-and-version-browser

Goal: turn the artifact ledger from metadata into a usable artifact surface in chat and trash.

Dependencies: SQLite/blob storage, artifact/activity ledger, `artifact.open`, chat markdown/code rendering, trash popover.

Expected scope: inline rendering for generated images/documents/scripts where practical, file icons/thumbnails and full filenames, version accordion for created/modified/deleted file groups, restore/open flows from chat and trash, artifact retention metadata, and Python-generated output handling.

Status: implemented. Artifact files now expose current-version metadata plus bounded text/image previews from the daemon-owned blob store, and the renderer shows file type icons, full filename/meta rows, inline preview cards, and version accordions from both the active chat artifact surface and the session trash artifact viewer. `artifact.open` accepts an optional version id so older snapshots can be opened explicitly. Storage smoke verifies before/after/diff availability, preview content, and versioned open-path resolution; renderer smoke verifies trash-session preview rendering and versioned open requests.

### iter-4-sprint-04-vision-voice-interactive-loop

Goal: evolve Vision from one-shot capture/recording into an interactive screen-sharing foundation suitable for later voice-driven sessions.

Dependencies: Vision popup, WebM recording, Agent screen stream, provider snapshot ingress, app-server image input, storage metadata.

Expected scope: clearer popup choice between video recording and Agent screen streaming, live stream cadence/resource controls, user-consent and stop affordance hardening, optional voice prompt input spike or documented boundary, and tests for starting/stopping streams without retaining unwanted video files.

Status: implemented. Vision tools now separate snapshot capture, WebM recording, and Agent screen share into clearer menu groups. Agent share exposes cadence and max-duration controls persisted in local settings; start requests carry consent, retention, cadence, and duration metadata into the daemon-owned Vision stream record. The menu now closes on outside click/Escape, active sessions show stronger stop/status affordances, and the prompt row includes a Web Speech API voice prompt input boundary for browser-supported dictation. Renderer smoke verifies cadence/duration protocol values, recording vs metadata-only retention, menu dismissal, voice prompt dictation, and existing start/stop behavior without retaining Agent-share video files.

### iter-4-sprint-05-pty-popup-and-mascot-persona

Goal: clarify and extend the PTY and mascot surfaces so they behave like intentional product modules rather than debug panels.

Dependencies: PTY viewport, terminal input protocol, Tauri window commands, mascot preset tables, app-server prompt context.

Expected scope: list PTY use cases/history, implement or scope a separate PTY popup window connected to the parent widget, preserve direct terminal behavior, add default dog mascot persona/tone hooks for Agent responses, and keep future custom theme/mascot/module platform data boundaries explicit.

Status: implemented. The PTY viewport now includes an inline guide explaining when to use PTY, how direct input connects to the daemon PTY session, and the current popout boundary. A PTY popout entry opens a terminal-focused widget window on the same daemon port with `mode=terminal&surface=pty`, preserving the existing direct terminal behavior. Agent widget context now includes the Default Dog mascot persona, tone expectations, and mascot state hints so Agent responses can align with the current companion preset. Renderer smoke verifies the PTY guide/popout affordance remains available, and app-server smoke verifies PTY/widget context includes the mascot persona.

## Iteration iter-5: Runtime Rebinding And Provider History Closure

Carryover: Iteration 4 closed the visible dogfooding polish set and added widget context, artifact previews, Vision/voice controls, PTY popout affordances, and mascot persona context. The remaining feasible backlog is now concentrated in durable runtime/session correctness, provider history visibility, Vision resource tuning, and a completion audit that distinguishes shipped work from deferred external release tasks.

### iter-5-sprint-01-durable-app-server-thread-rebinding

Goal: preserve the hidden Codex app-server thread association per durable widget session so switching, restoring, or reopening sessions does not bleed context across tabs or silently lose the current app-server conversation.

Dependencies: daemon SQLite storage, `runtime_threads` table, `CodexAppServerBridge`, session create/open/branch/reset flows, fake app-server smoke.

Expected scope: storage read/write helpers for runtime thread metadata, bridge thread get/set/reset helpers, daemon session-aware thread binding before app-server turns, stale-thread retry/clear behavior where practical, and smoke coverage proving two widget sessions keep distinct app-server threads.

Status: implemented. The storage layer now exposes runtime thread read/write/clear helpers over the existing `runtime_threads` table. The daemon binds the session's persisted Codex app-server thread before regeneration or a new app-server turn, persists the active thread after the turn, and clears/errors the record when no usable thread remains. `CodexAppServerBridge` now exposes get/set thread helpers and retries once with a fresh thread when rollback or turn start reports a stale/unknown thread. Storage and fake app-server smokes verify thread persistence and two durable widget sessions rebinding to separate app-server threads.

### iter-5-sprint-02-provider-snapshot-history-ui

Goal: expose provider snapshot history in the widget so DOM, Vision, PTY, runtime, and stream context are visible as product state rather than hidden daemon internals.

Dependencies: provider snapshot storage, activity log, renderer provider modes, artifact/activity detail surfaces.

Expected scope: daemon protocol snapshot for recent provider records, renderer history popover or panel from provider/status/activity surfaces, clear timestamps/source/summary metadata, safe redaction for large image or credential-like fields, and smoke coverage for provider history rendering.

Status: implemented. Provider snapshots are now durable ledger state. DOM and Vision snapshot ingress record redacted provider history rows in SQLite and broadcast refreshed ledger snapshots; terminal provider starts record lightweight PTY/Terminal history rows. `LedgerSnapshot` now carries `providerSnapshots`, and the Activity detail popover shows a Provider history section with timestamp, provider label, title, and summary. Storage, DOM, Vision, renderer, and full smoke gates verify persistence, redaction, and UI rendering.

### iter-5-sprint-03-vision-resource-and-retention-tuning

Goal: tighten Vision recording and Agent screen-sharing resource behavior before more dogfooding.

Dependencies: Vision popup, `vision_streams` storage, screen snapshot ingress, local stream controls, resident smoke/resource checks.

Expected scope: visible cadence/duration/resource defaults, stream stop cleanup audit, bounded metadata retention, optional stream snapshot throttling diagnostics, and verification that Agent screen sharing remains metadata-only unless a recording is explicitly requested.

Status: implemented. Agent screen sharing now drops overlapping frame ticks while a previous frame upload is still pending and reports skipped frames alongside sent/failed counts. Vision cleanup now finalizes stream ids to prevent duplicate stop messages when tracks end during local cleanup, and provider completion/error/stopped events clear guard timers, frame timers, video elements, and media tracks. Recording and Agent-share start messages carry actual duration, byte, frame width, JPEG quality, and overlap-policy metadata; daemon guardrail activity records preserve those effective values for later dogfooding resource analysis. Daemon and renderer smokes verify guardrail diagnostics and the updated Vision protocol details.

### iter-5-sprint-04-completion-audit-and-readiness-update

Goal: audit all user-listed residual work against implemented, deferred, and not-feasible-without-dogfooding categories, refresh durable context/report files, and only then close the active goal if no feasible in-scope work remains.

Dependencies: sprints 01-03, project report generator, milestone and handoff files.

Expected scope: update milestones, iteration history, handoff, session log, project report, run the relevant smoke gates, record remaining deferred items with reasons and resume conditions, and perform a final completion audit before marking the active goal complete.

Status: implemented. Iteration 5 completed the remaining feasible non-dogfood backlog. The durable app-server thread, provider history, and Vision resource work are implemented and smoke-covered; roadmap, milestones, iteration history, handoff, session log, and project report state now distinguish shipped work from deferred follow-up. Remaining follow-up is dogfood-dependent long-run Vision CPU/memory tuning, live Codex app-server protocol validation across CLI/app-server restarts, and browser store account submission after dogfooding.

## Iteration iter-6: Renderer Architecture Refactor

Carryover: Dogfooding and source review exposed that the renderer frontend had grown into one oversized `App.tsx` and one oversized `styles.css`, making future feature work risky. This iteration keeps runtime behavior unchanged and focuses on maintainability boundaries.

### iter-6-sprint-01-renderer-structure-refactor

Goal: split the renderer into reusable UI components, shared hooks, utilities, constants/types, and scoped CSS partials without changing the widget's daemon protocol or visible behavior.

Dependencies: current renderer chat/session/Vision/PTY UI, shared protocol types, existing renderer smoke coverage.

Expected scope: App orchestration remains in `App.tsx`; presentational/feature UI moves into `src/renderer/components`; shared floating behavior moves to `src/renderer/hooks`; chat/storage/speech/terminal/Vision helpers move to `src/renderer/utils`; constants and local renderer types move to `config.ts`/`types.ts`; CSS becomes an import manifest over scoped partials.

Status: implemented. `App.tsx` dropped from 4,959 to 2,612 lines and now primarily owns state, daemon WebSocket effects, native shell handlers, and high-level routing. Renderer UI is split across titlebar/system strip, mode tabs, settings, session strip/trash, conversation, prompt/model controls, activity log, terminal, Vision, artifacts, markdown, floating tooltip, and interaction components. CSS is now grouped under `src/renderer/styles` by shell, status/sessions, chat, artifacts/interactions, terminal, settings/Vision, composer/activity/mascot, animations, and base tokens. Verification passed `npm run lint`, `npm run build:renderer`, `npm run smoke:renderer-chat`, `git diff --check`, strict UTF-8 decoding for renderer files, and mojibake scan.

## Iteration iter-7: Dogfood UI Motion Polish

Carryover: The renderer is now structurally split, so follow-up UI polish should stay within those feature components and partial CSS files instead of growing `App.tsx` again.

### iter-7-sprint-01-trash-activity-mascot-polish

Goal: apply three dogfood UI corrections: trash artifact icon placement, compact Activity footer height, and real frame-based mascot motion.

Dependencies: `SessionStrip`, Activity footer CSS, current mascot PNG asset, renderer smoke coverage.

Expected scope: move the artifact icon beside the artifact count in the trash list, reduce the Activity footer's reserved height after the one-line log change, replace CSS bounce/share mascot motion with a sprite/APNG/Lottie-like frame animation derived from the existing mascot asset, and add smoke assertions where practical.

Status: partially accepted after dogfood review. Trash artifact rows now render the session title first and an artifact-count cluster with the file icon directly left of the count. The Activity footer grid row and log-list minimum height were reduced from 76px to 52px. The mascot sprite implementation is rejected as a proxy implementation: it was generated from one static pose and does not meet the product intent of a genuinely moving mascot. Treat mascot motion as a rework item that requires a consensus step and real authored motion frames/assets before implementation. The previous renderer smoke only proves the sprite path exists; it is not acceptance evidence for mascot motion quality.

## Iteration iter-8: Vision Context Interface

Carryover: Iteration 7 dogfood UI motion work is no longer the active implementation focus. The product owner supplied `docs/plans/vision-context-interface-handoff.md` as the authoritative handoff for a new feature iteration: build a daemon-side Vision Context Interface that turns screen/browser/user capture into Codex app-server-compatible text and image inputs without sending raw WebM/audio to the model.

### iter-8-sprint-01-types-capsule-and-app-server-adapter

Goal: establish the deterministic Vision Context core before real ASR or provider complexity.

Dependencies: `docs/plans/vision-context-interface-handoff.md`, `src/daemon/codexAppServer.ts`, `src/daemon/agent.ts`, existing screen snapshot image input path.

Expected scope: `src/daemon/vision-context` shared types, `TaskCapsule`, evidence graph model, capsule markdown renderer, `CodexUserInput[]` adapter, narrow `AgentRequest` app-server input override, and smoke coverage proving text plus `localImage` inputs reach fake app-server `turn/start`.

Status: implemented. The Vision Context core types, evidence graph, capsule builder/markdown renderer, visible message renderer, app-server input adapter, `AgentRequest.appServerInput`, and Codex app-server `localImage` input handling are in place. `npm run smoke:app-server` verifies a Vision Context capsule turn reaches fake app-server with a `localImage` item.

### iter-8-sprint-02-capture-session-timeline-and-retention

Goal: add a daemon-side capture session manager with timeline events, derived evidence registration, and raw media deletion policy.

Dependencies: Sprint 01 capsule types and existing Vision recording/Agent stream metadata.

Expected scope: session start/event/stop/cancel API, selected frame/crop registry, retention defaults/privacy mode, raw video/audio deletion in success and failure paths, and smoke coverage that raw media is removed while selected derived evidence remains as policy allows.

Status: implemented. `VisionContextSessionManager` supports start/event/stop/cancel, retention defaults/privacy mode, timeline capture, selected screenshot evidence, and raw media deletion in completion/failure paths. `scripts/smoke-vision-context.mjs` verifies raw WebM/WAV temp files are deleted after capsule completion.

### iter-8-sprint-03-reference-and-intent-resolver-mvp

Goal: resolve user utterance references into capsule referents using deterministic rules.

Dependencies: Sprint 02 session timeline and capsule builder.

Expected scope: pointer-first resolution, no-pointer salient media selection, Korean temporal reference lookup for `방금`/`아까`, alternatives and uncertainty policy, rule-based intent resolver, and tests for pointer, no-pointer, disappeared-error, and alternatives scenarios.

Status: implemented. Reference resolution now handles pointer gestures, no-pointer salient visual evidence, temporal error references, alternatives, uncertainty, and rule-based intent classification. The Vision Context smoke covers place identification, circled layout repair, disappeared error evidence, and low-confidence alternatives behavior.

### iter-8-sprint-04-transcription-interface-mvp

Goal: define the transcription boundary without making a heavyweight ASR backend mandatory.

Dependencies: Sprint 02 timeline and Sprint 03 resolver.

Expected scope: `src/daemon/transcription` transcript schema, VAD/ASR interfaces, mock ASR engine for tests, optional local sidecar configuration boundary, raw audio deletion hook, and timestamped transcript fixture coverage.

Status: implemented. `src/daemon/transcription` contains transcript/audio schemas, mock ASR, optional sidecar ASR boundary, router, VAD fixture helper, and raw audio segment deletion helper. Smoke coverage uses mock ASR segments without requiring a local model.

### iter-8-sprint-05-lexicon-correction-and-clarification

Goal: add deterministic correction and action-slot confidence foundations for voice-driven Vision Context requests.

Dependencies: Sprint 04 transcription interfaces.

Expected scope: global/user/session lexicon types, correction pipeline, action-slot confidence, clarification decision policy, and smoke coverage for known confusion correction plus destructive low-confidence clarification behavior.

Status: implemented. Memory/session/tutorial lexicon helpers, correction pipeline, action-slot confidence, and clarification policy are implemented. Smoke coverage verifies a known ASR confusion maps to `react-router-dom` and a destructive low-confidence request asks for confirmation.

### iter-8-sprint-06-provider-adapter-expansion

Goal: normalize observations from existing DOM, screen, and terminal provider state.

Dependencies: Sprint 01 observation contract and current provider registry/PTY state.

Expected scope: adapter contract, screen/browser/terminal adapters, placeholder IDE/document/accessibility adapters, tests proving adapters emit observations only and do not render prompts.

Status: implemented. The adapter contract is shared in Vision Context types; screen, browser, and terminal adapters collect normalized observations from current provider-shaped data, while IDE/document/accessibility placeholders return no observations until those integrations exist. Adapters emit observations only; capsule rendering remains centralized.

### iter-8-sprint-07-renderer-protocol-and-completion-audit

Goal: connect the Vision Context module to the widget protocol and close the iteration with verification and durable context updates.

Dependencies: Sprints 01-06, existing Vision menu/status UI, daemon WebSocket protocol.

Expected scope: `visionContext.start/event/stop/cancel` client messages, daemon progress/capsule/sent/error events, renderer trigger path from Share with Agent, smoke coverage for capsule send into an app-server turn, standard verification, project report refresh, and context handoff/session-log updates.

Status: implemented. Shared protocol and daemon handlers support `visionContext.start/event/stop/cancel` plus `started/progress/capsule/sent/error` events. The renderer starts Vision Context when Agent screen share begins and stops/sends it to Agent when sharing stops. Verification passed `npm run typecheck`, `npm run smoke:vision-context`, `npm run smoke:app-server`, `node scripts/smoke-daemon.mjs`, `npm run build:web`, and `npm run smoke`.

## Iteration iter-9: Browser Action Interface

Carryover: Iteration 8 completed Vision Context as the observation/capsule side of future computer-use. Iteration 9 implements the browser actuator side from `docs/plans/browser-action-interface-handoff.md`: typed browser actions, target resolution, safety policy, extension/native integration, renderer approval, app-server action smoke coverage, and audit evidence. Arbitrary JavaScript is reserved for future `full_control_dev`, not the default implementation path.

### iter-9-sprint-01-types-observation-and-targeting

Goal: establish the deterministic Browser Action core before extension execution complexity.

Dependencies: `docs/plans/browser-action-interface-handoff.md`, existing DOM provider snapshot shape, shared protocol types.

Expected scope: `src/daemon/browser-action` shared types, browser observation normalization, stable element ids, element graph, target resolver, intent/action planner boundary, result verifier scaffolding, and focused smoke coverage for exact/role/text/focused/bbox/ambiguous/low-confidence targeting.

Status: implemented. `src/daemon/browser-action` now defines the Browser Action type surface, normalized `BrowserObservation`, stable element id normalization, `ElementGraph`, target resolver, intent boundary, result verifier, and smoke coverage for exact id, role/text, focused, bbox, ambiguous, and low-confidence resolution.

### iter-9-sprint-02-safety-policy-and-action-executor

Goal: add the safety and execution core for typed browser actions.

Dependencies: Sprint 01 observation/targeting model.

Expected scope: safe/confirm/block policy, sensitive value redaction, typed action executor, adapter contract, extension/native/CDP/Playwright/native-desktop placeholder adapters, audit log helpers, and smoke coverage for safe actions, risky confirmations, destructive clarification, and verification outcomes.

Status: implemented. The module now includes allow/confirm/block/clarify safety decisions, sensitive target redaction, destructive/low-confidence clarification, typed queued action commands, audit helpers, extension adapter contracts, and CDP/Playwright/native desktop placeholders.

### iter-9-sprint-03-extension-observation-and-typed-actions

Goal: upgrade the existing DOM extension while preserving snapshot-only behavior.

Dependencies: Sprints 01-02, `providers/browser-dom-extension`, `providers/browser-native-host`, extension packaging smoke.

Expected scope: structured `elements[]` in DOM snapshots, stable element ids/selectors, typed action helper functions for read/click/type/check/select/scroll/navigate/back/forward/reload/screenshot where practical, native-host message compatibility, and browser extension smokes against a deterministic fake page.

Status: implemented. The DOM extension keeps the existing snapshot button flow and now emits structured interactive element observations plus typed action execution for read, click, type, select/check, scroll, navigation controls, reload, and visible-tab screenshot where available. Extension packaging smoke verifies the new command/result endpoints and typed executor hooks.

### iter-9-sprint-04-daemon-protocol-and-renderer-approval

Goal: expose Browser Action lifecycle through the widget daemon and renderer.

Dependencies: Sprints 01-03, existing WebSocket protocol, renderer interaction cards/activity surface.

Expected scope: `browserAction.start/observe/execute/cancel` client messages, started/observation/progress/approval/result/error server events, daemon session manager integration, renderer approval cards, activity/audit visibility, and cancel/error handling.

Status: implemented. Shared protocol and daemon handlers now support `browserAction.start/observe/execute/cancel`, progress/result/error events, local extension poll/result HTTP endpoints, approval reuse through `interaction.required`, Activity audit rows, renderer log visibility, and cancel/error handling.

### iter-9-sprint-05-agent-integration-and-completion-audit

Goal: connect Browser Action to the Agent path and close the iteration with production-level verification.

Dependencies: Sprints 01-04, Codex app-server fake harness, existing smoke gates.

Expected scope: Agent-visible or simulated browser action capability, fake app-server smoke proving action requests/results flow without hidden side effects, final documentation/context updates, project report refresh, and full verification including lint/build/smoke/extension/native-host/DOM/app-server/browser-action smokes.

Status: implemented. Widget context exposes Browser Action capabilities to app-server turns, fake app-server smoke verifies that visibility, and `npm run smoke:browser-action` simulates the full daemon action path from request to approval, extension command polling, result verification, and audit evidence without hidden side effects. Full live app-server custom tool-call integration is deferred until Codex app-server exposes a stable client-tool contract.

## Iteration iter-10: Browser Action Production Completion

Carryover: Iteration 9 delivered a deterministic Browser Action MVP, but it is incomplete for the product owner's production-level goal. CDP, Playwright, native desktop, `full_control_dev` evaluate, adapter diagnostics, stronger reobserve/verification, action protocol evidence, and semantic dogfood evidence must be implemented or precisely marked `BLOCKED` with attempted paths.

### iter-10-sprint-01-adapter-registry-verification-and-evaluate-core

Goal: upgrade the daemon Browser Action core beyond MVP.

Dependencies: iter-9 `src/daemon/browser-action`, shared `browserAction.*` protocol.

Expected scope: adapter registry/selection/status, timeout/cancel/error normalization, multi-step plan types where scoped, stale reobserve/retry support, stronger verification result summaries, explicit non-default `evaluate` action type, `full_control_dev` safety gating, code preview approval metadata, code hash/audit, timeout/result-size limits, and credential/token/cookie extraction guards.

Status: complete. Adapter registry/status protocol, direct adapter execution path, plan types, evaluate action schema, full_control_dev gating, approval preview metadata, code hash, timeout/result limits, and credential safeguards are implemented.

### iter-10-sprint-02-playwright-and-cdp-controlled-adapters

Goal: replace controlled-browser adapter placeholders with functional implementations where the local environment supports them.

Dependencies: Sprint 01 adapter registry, Playwright dependency, local Chrome/Edge availability or precise unavailable diagnostics.

Expected scope: functional Playwright controlled-page adapter, CDP adapter for configured/managed remote debugging targets, typed action execution through both where practical, console/network summaries where practical, deterministic local-page smokes, and precise `BLOCKED` records only for real environment constraints.

Status: complete. Playwright and CDP adapters are functional with deterministic local-page smokes; CDP supports configured or managed Chrome/Edge remote debugging endpoints and reports clear unavailable diagnostics when not configured.

### iter-10-sprint-03-native-desktop-boundary-and-unavailable-paths

Goal: implement the native desktop adapter boundary to the maximum practical Browser Action scope.

Dependencies: Sprint 01 registry/status, Windows runtime constraints.

Expected scope: Windows-oriented native desktop adapter contract, availability diagnostics, browser-window scoped safety boundary, cancel/error behavior, helper/native-input or UI Automation path if practical, and tests for supported or unavailable behavior. Do not generalize into full arbitrary desktop computer-use.

Status: complete with bounded helper path. The native desktop adapter provides Windows browser-window availability diagnostics and can route executable fallback actions through the bundled PowerShell UI Automation helper when native desktop Browser Action is enabled. A signed Rust/.NET/native helper remains a future hardening track.

### iter-10-sprint-04-agent-protocol-smokes-and-dogfood-evidence

Goal: prove Agent/action flow and collect semantic evidence.

Dependencies: Sprints 01-03, fake app-server smoke harness, safe browser dogfood target.

Expected scope: simulated or tool-like Agent Browser Action request/result/error flow, evaluate approval preview flow, adapter-status protocol evidence, safe real browser/page dogfood evidence with before/after observations and verification transcript, and report under `docs/reports/browser-action-dogfood-evidence-<date>.md`.

Status: complete. Adapter-status, evaluate approval, daemon action/result/error flow, and safe real-page dogfood evidence are covered by smokes and `docs/reports/browser-action-dogfood-evidence-2026-05-08.md`.

### iter-10-sprint-05-production-completion-audit

Goal: close production-level Browser Action state.

Dependencies: Sprints 01-04 and all required verification.

Expected scope: update Browser Action handoff completed/BLOCKED state, sprint roadmap, iteration history, sprint status, project milestones, handoff, session log, project report, run all required verification commands, and only mark the goal complete if production criteria are actually satisfied.

Status: complete. Handoff, roadmap, milestones, sprint status, handoff/session log, dogfood report, and production verification commands were updated for the iter-10 Browser Action completion pass.

## Iteration iter-11: Browser Action End-to-End Control

Carryover: Iteration 10 completed the daemon-side Browser Action interface and controlled adapter baseline, but the live prompt-driven product path is still incomplete. Iteration 11 follows `docs/plans/browser-action-end-to-end-control-handoff.md` and turns Browser Action into a widget-usable control experience: user prompt -> Agent/tool command -> Browser Action plan -> approval UI -> adapter execution -> verification -> Agent response. The scope covers all eight handoff workstreams, with precise `BLOCKED` records only for real app-server custom-tool or Windows helper constraints.

### iter-11-sprint-01-prompt-tool-plan-and-policy-core

Goal: connect natural prompts to deterministic daemon Browser Action commands and add executable multi-step plans plus browser-specific saved safety policies.

Dependencies: iter-10 Browser Action module, `src/daemon/server.ts`, app-server/fake smoke harness, existing execution permission UI.

Expected scope: prompt command detection or simulated tool route, Agent-visible Browser Action command result summaries, `BrowserActionPlan` execution with step observe/resolve/safety/approval/execute/reobserve/verify/cancel, browser-specific permission records for action family/origin/risk/expiry, redaction guarantees, and smokes for prompt-driven request -> approval -> result -> Agent response plus plan/policy behavior.

Status: complete. Natural browser prompts now route into a deterministic daemon-owned Browser Action tool simulation when app-server custom tools are unavailable. `BrowserActionPlan` execution supports step-level safety, policy application, approval/extension pauses, direct adapter execution, result ids, reobserve/verify events, cancellation boundaries, and chat/activity result summaries. Browser-specific saved policies are stored by action family/origin/risk/mode/expiry and applied before execution with secret redaction.

### iter-11-sprint-02-renderer-browser-action-cockpit

Goal: make Browser Action visible and controllable from the widget UI instead of only Activity log rows.

Dependencies: Sprint 01 protocol state, existing renderer component structure, interaction approval card, Activity ledger.

Expected scope: adapter status surface, active page/session state, safety mode, action/plan timeline, approval details, evaluate preview/hash, result/error/cancel visibility, policy controls, and renderer smoke coverage.

Status: complete. The renderer now exposes a Browser Action panel in browser mode with adapter status, start/observe/cancel controls, safety mode, latest observation, plan/progress/result/error summaries, and allow/ask/deny policy controls while continuing to use the existing approval UI for risky actions and `full_control_dev` evaluate previews.

### iter-11-sprint-03-extension-channel-and-managed-browser-ops

Goal: harden extension active-tab execution and make Playwright/managed browser/CDP operation understandable and testable.

Dependencies: Sprints 01-02, DOM extension service worker, Playwright/CDP adapters, native host fallback.

Expected scope: active-tab/source mismatch detection, command timeout, result-post failure surfacing, unsupported/restricted page errors, frame/shadow-boundary diagnostics, managed browser launch/status/cleanup diagnostics, CDP endpoint diagnostics, and smokes for extension robustness plus managed/CDP availability states.

Status: complete. Extension commands now carry expected source metadata and expiry, the extension reports actual tab/window/url/title before execution, result posting retries before surfacing failure, and restricted browser pages fail visibly. Existing Playwright/CDP operating modes remain covered by controlled-browser and remote-debugging smokes, while adapter status diagnostics are exposed to the renderer.

### iter-11-sprint-04-windows-fallback-and-dogfood-matrix

Goal: implement the maximum practical bounded Windows browser fallback and collect real end-to-end Browser Action dogfood evidence.

Dependencies: Sprints 01-03, native desktop diagnostics adapter, safe public browser tasks, dogfood evidence scripts.

Expected scope: browser-window-scoped Windows fallback diagnostics/control where practical, explicit `BLOCKED` record if a Rust/.NET/PowerShell UIA helper is required, prompt-driven and adapter-driven dogfood matrix covering extension, Playwright/managed browser, CDP or unavailable evidence, risky approval/deny, non-submit form fill, docs/search/navigation, and restricted-page boundary cases.

Status: complete with typed helper boundary and remaining live-helper BLOCKED state. The native desktop adapter exposes browser-window-scoped diagnostics, a `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER` JSON helper contract for bounded observe/execute fallback, mock-covered helper execution evidence, and a precise `BLOCKED` record for real executable Windows UI Automation/browser-chrome control until a scoped helper is supplied and validated. Real E2E dogfood evidence was generated at `docs/reports/browser-action-e2e-dogfood-evidence-2026-05-08.md`, covering prompt-driven read, extension active-tab command, risky deny, non-submit fill, real Playwright navigation, CDP unavailable evidence, native boundary diagnostics, and restricted-page boundary evidence.

### iter-11-sprint-05-completion-audit

Goal: close the Browser Action end-to-end control goal with verification and durable context updates.

Dependencies: Sprints 01-04 and required verification gates.

Expected scope: update both Browser Action handoffs, roadmap, milestones, iteration history, sprint status, handoff, session log, project report, run full verification, and mark remaining production constraints only as precise `BLOCKED` items with attempted path and required scope expansion.

Status: complete. Browser Action handoffs, roadmap, iteration history, sprint status, session log, and reports now reflect iter-11 completion; verification includes `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:renderer`, and `npm run dogfood:browser-action:e2e` in addition to the existing Browser Action adapter/extension/app-server gates.

## Iteration iter-12: Browser Action Control Surface

Carryover: Iteration 11 completed the daemon-side prompt/tool simulation and E2E Browser Action baseline, but direct user invocation remains incomplete. Iteration 12 follows `docs/plans/browser-action-control-surface-handoff.md` and makes Browser Action callable from a Vision-like popup/menu while preserving the existing natural-language Browser prompt path.

### iter-12-sprint-01-control-surface-handoff-and-command-contract

Goal: create the control-surface handoff and add the direct command protocol plus deterministic command-to-plan builder.

Dependencies: iter-11 Browser Action plan/session/safety pipeline, shared protocol, renderer Mode/Vision menu pattern.

Expected scope: `docs/plans/browser-action-control-surface-handoff.md`, `browserAction.command` shared protocol type, direct command input schema, daemon command builder, and prompt-classification boundary notes.

Status: complete. `docs/plans/browser-action-control-surface-handoff.md` is now the authoritative iter-12 handoff, shared `BrowserActionDirectCommandInput`/`browserAction.command` protocol exists, and `src/daemon/browser-action/directCommand.ts` maps direct UI commands into deterministic `BrowserActionPlan` steps.

### iter-12-sprint-02-daemon-direct-command-pipeline

Goal: route direct UI requests through the same daemon Browser Action plan/safety/approval/adapter/verify/audit pipeline as prompt-driven requests.

Dependencies: Sprint 01 command builder and existing `BrowserActionSessionManager`.

Expected scope: daemon WebSocket handler for direct commands, session auto-start, adapter status/observe commands, plan execution, approval/progress/result/error broadcasts, Activity/audit records, and smoke coverage.

Status: complete. The daemon handles `browserAction.command`, auto-starts or reuses sessions, observes via extension or selected adapter, executes direct plans through Browser Action safety/policy/approval/adapter/verify/audit paths, emits normalized plan/progress/result/error events, and records Activity/audit summaries.

### iter-12-sprint-03-browser-action-popup-ui

Goal: add a compact Vision-like Browser Action popup/menu near Browser mode controls for direct invocation.

Dependencies: Sprint 02 direct command pipeline, existing `VisionActionMenu` floating-surface pattern, renderer Browser Action state.

Expected scope: Browser Action menu component, Browser mode button anchor/ref, direct action controls for observe/read/click/type/search/scroll/navigate/back/forward/reload/screenshot/status/cancel/policies, adapter selector/status visibility, and renderer smoke coverage.

Status: complete. `BrowserActionMenu` is anchored to the Browser mode button and exposes compact direct controls for adapter status, observe, read, click, type/fill, search, scroll, navigate, back/forward/reload, screenshot, start/cancel, safety mode, adapter selection/status, and quick policies.

### iter-12-sprint-04-verification-and-dogfood-evidence

Goal: close the control-surface iteration with classification smoke, direct-menu smoke, refreshed dogfood evidence, durable context updates, verification, and push.

Dependencies: Sprints 01-03.

Expected scope: new package scripts for direct-menu and prompt-classification smokes, updated E2E dogfood evidence with direct UI command path, handoff/iteration/sprint status/session log/project report updates, full verification, and push when clean.

Status: complete. Added `npm run smoke:browser-action:direct-menu` and `npm run smoke:browser-action:prompt-classification`, expanded `npm run smoke:browser-action:e2e-control`, refreshed `docs/reports/browser-action-e2e-dogfood-evidence-2026-05-08.md`, and ran the full Browser Action/control-surface verification gate.

## Iteration iter-13: Browser Extension Bridge UX

Carryover: Iteration 12 completed the direct Browser Action control surface, but the extension UX was still centered on manual DOM snapshot capture. Iteration 13 follows `docs/plans/browser-extension-bridge-handoff.md` and converts the extension into a first-class Browser Bridge: popup/settings instead of snapshot-on-click, badge heartbeat state, explicit site permission, automatic approved-page observation, command-first polling/execution, and simplified widget Browser UI.

### iter-13-sprint-01-extension-popup-options-and-settings

Goal: replace the extension action click snapshot trigger with a Browser Bridge popup and base-URL settings.

Dependencies: iter-12 Browser Action extension executor and existing package/store metadata.

Expected scope: Manifest V3 `default_popup`, popup HTML/JS, daemon base URL settings, toggles for auto-connect, page context sharing, safe read/scroll, click/type approval, native fallback, debug capture, and options page migration from snapshot URL to base URL.

Status: complete. The extension is now named Codex Widget Browser Bridge, the action opens `popup.html`, default click-to-snapshot behavior is removed, popup/options store a daemon base URL, and debug page capture is secondary behind diagnostics.

### iter-13-sprint-02-badge-heartbeat-and-daemon-status

Goal: make extension connection and permission state visible to the daemon and widget without a manual page capture.

Dependencies: shared protocol and daemon HTTP endpoints.

Expected scope: OFF/IDLE/RUN/ASK/ERR badge states, extension alarms/heartbeat, `/browser-action/extension/heartbeat`, `/browser-action/extension/status`, status normalization, WebSocket event, and renderer state handling.

Status: complete. The service worker refreshes badge/status from startup, install, popup, alarms, health checks, permission state, auto-observe, and command execution. The daemon stores normalized `BrowserExtensionBridgeStatus`, broadcasts `browserExtensionBridge.status`, exposes status over HTTP, and the widget shows connected/permission/restricted/error bridge states.

### iter-13-sprint-03-command-first-extension-channel-and-permission-flow

Goal: remove the required manual snapshot step from normal Browser Action execution.

Dependencies: existing extension typed executor, daemon extension poll/result endpoints, optional host permissions.

Expected scope: automatic approved-site observation, command polling, permission-state poll metadata, command execution with before/after observations, result retry, restricted-page errors, site enable flow, and native host fallback preservation.

Status: complete. The extension polls the daemon while auto-connect is enabled, checks active tab/source/permission, auto-observes approved sites through the internal legacy DOM provider transport, executes queued typed actions without icon clicks, posts results with permission/source metadata, surfaces missing permission and restricted pages, and preserves native host fallback plus legacy `POST /providers/dom/snapshot` compatibility.

### iter-13-sprint-04-widget-simplification-smokes-and-dogfood

Goal: simplify the widget Browser Action UX and close the Browser Bridge work with verification and evidence.

Dependencies: Sprints 01-03, renderer Browser Action menu/panel, existing Browser Action smokes.

Expected scope: rename DOM mode to Browser, hide adapter/debug complexity behind advanced diagnostics, add Browser Bridge status to menu/panel, update extension/store/readme/privacy/review copy, add Browser Bridge smoke/dogfood scripts, refresh reports/context, and run full verification.

Status: complete. The Browser mode button now uses Browser wording, Browser Action menu foregrounds bridge state and direct actions while moving adapters/screenshots under diagnostics, the panel foregrounds bridge status, extension/store/privacy/review docs describe Browser Bridge behavior, `npm run smoke:browser-bridge` and `npm run dogfood:browser-bridge` were added, and full verification passed including `npm run smoke:all` and cargo check.

## Iteration iter-14: Browser Action Semantic Target Pipeline

Carryover: Iteration 13 removed the manual snapshot UX, but Browser Action prompt execution still had a semantic gap: Korean commands like `새 채팅 눌러줘` were planned with the full command phrase as the target, and broad DOM containers could tie with the intended actionable link/button.

### iter-14-sprint-01-vision-style-intent-and-lexicon-layer

Goal: benchmark Vision Context's intent/reference resolver separation and add a dedicated Browser Action intent normalization layer.

Dependencies: iter-13 Browser Bridge, `src/daemon/browser-action/promptTool.ts`, Vision Context `intentResolver`/`referenceResolver` structure.

Expected scope: target/action suffix stripping, Korean command phrase extraction, target alias/compact/token lexicon, and prompt planner wiring.

Status: complete. Added `src/daemon/browser-action/intentResolver.ts` and `targetLexicon.ts`; prompt planning now resolves `새 채팅 눌러줘` into a click action targeting `새 채팅` rather than the full command sentence.

### iter-14-sprint-02-target-resolver-confidence-and-actionable-ranking

Goal: make DOM target resolution favor the actual actionable element over broad page/sidebar containers.

Dependencies: element graph, target resolver, structured Browser Bridge observations.

Expected scope: normalized alias matching, Korean token handling, compact text matching, actionable-role/tag preference, and smoke coverage for exact/ambiguous cases.

Status: complete. `targetResolver` now expands aliases, scores compact Korean labels, accepts short CJK tokens, and caps non-actionable container candidates for text targets so visible links/buttons/inputs win with safety-threshold confidence.

### iter-14-sprint-03-bridge-auto-observe-hardening-and-verification

Goal: keep the snapshotless Browser Bridge pipeline reliable for prompt-driven actions.

Dependencies: browser extension service worker, DOM provider endpoint, Browser Action smokes.

Expected scope: ensure approved-site auto-observe persists current DOM to the daemon without relying on a native-host-only success path, and verify prompt/resolver behavior.

Status: complete. Browser Bridge auto-observe now posts the DOM snapshot to the daemon over HTTP first and falls back to native host only if HTTP fails. Verification passed daemon build, Browser Action core/e2e/prompt-classification smokes, extension smoke, and Browser Bridge smoke.

## Iteration iter-15: Semantic Interface

Carryover: Iteration 14 made Browser Action prompt target extraction and actionable ranking materially better, but the logic still lives inside Browser Action. Iteration 15 follows `docs/plans/semantic-interface-handoff.md` and extracts a reusable daemon-side semantic decision boundary: normalized observations plus typed intent frames become evidence-backed hypotheses, deterministic ranking, pure safety verdicts, redacted traces, and feature-owned executable command proposals. The iteration keeps Browser Action live behavior unchanged until shadow/advisory evidence is available, then gates only low-risk Browser Action families through semantic decisions.

### iter-15-sprint-01-type-surface-golden-traces

Goal: establish the `src/daemon/semantic-interface/` module boundary with frozen v1 types, deterministic ranker, transition grammar, operating profiles, trace/replay, Browser Action adapter conversion, and a golden trace smoke.

Dependencies: `docs/plans/semantic-interface-handoff.md`, iter-14 Browser Action observations/resolver fixtures, existing TypeScript daemon build.

Expected scope: `types.ts`, `index.ts`, `ontology.ts`, `observation.ts`, `intentFrame.ts`, `hypothesis.ts`, `ranker.ts`, `safetyPredicate.ts`, `trace.ts`, `replay.ts`, `transitionGrammar.ts`, `operatingProfile.ts`, `adapters/browserActionAdapter.ts`, fixture/assertion helpers, `scripts/smoke-semantic-interface.mjs`, and `npm run smoke:semantic-interface`. Include the `개념글` ambiguity case plus duplicate-label, i18n-alias, and stale/source-mismatch fixtures.

Status: complete. Added the `src/daemon/semantic-interface/` module with v1 type contracts, ontology/version constants, deterministic hypothesis/ranking, transition grammar, operating profiles, pure safety predicates, redacted trace/replay, Browser Action adapter, fixtures/assertions, and `npm run smoke:semantic-interface`. The smoke covers the `개념글` ambiguity case, duplicate-label abstention, stale snapshot warning, redaction, replay determinism, and initial adversarial classes.

### iter-15-sprint-02-browser-action-shadow-and-redacted-traces

Goal: run semantic decisions beside prompt-driven Browser Action without changing live execution.

Dependencies: Sprint 01 semantic core, Browser Action prompt planning, Activity/report-safe trace projection.

Expected scope: bridge existing Browser Action prompt plans/observations into `IntentFrame` and `SemanticSnapshot`, produce advisory semantic traces for prompt-driven attempts, project `RedactedTraceRecord` for durable sinks, surface stale/source/adapter/redaction warnings, and expand adversarial fixtures to ARIA/visible mismatch, offscreen/occluded, dynamic-id churn, shadow DOM, and nested form scope.

Status: complete. Browser Action target resolution now runs a Semantic Interface advisory beside the existing lexical resolver when an observation is available. Redacted semantic trace metadata is attached to Browser Action safety/audit metadata, while exact/selector/focused/bbox behavior and the existing executor remain feature-owned. The golden suite now covers ARIA/visible mismatch, offscreen/occluded, dynamic-id churn, shadow DOM, and nested form scope.

### iter-15-sprint-03-vision-read-locate-conformance

Goal: prove `semantic-interface` is not Browser-only by converting Vision Context observations/capsule evidence into shared semantic snapshots and read/locate hypotheses.

Dependencies: Sprint 01 replay harness, `src/daemon/vision-context/` TaskCapsule/evidence structures.

Expected scope: `adapters/visionContextAdapter.ts`, Vision fixture replay, shared typed/untyped eval assertions for read/locate, and no core type/ranker changes required by Vision.

Status: complete. Added `adapters/visionContextAdapter.ts` plus Vision fixtures so TaskCapsule evidence converts into shared semantic snapshots and read/locate hypotheses without core type or ranker changes. `npm run smoke:semantic-interface` verifies Vision read/locate conformance.

### iter-15-sprint-04-low-risk-browser-live-gate-and-completion

Goal: selectively use semantic decisions for low-risk Browser Action flows while preserving rollback/advisory mode and closing the production semantic-interface criteria.

Dependencies: Sprints 01-03, Browser Action plan/session manager, safety policy, verification commands.

Expected scope: feature flag or mode gate, live semantic selection for read/locate/filter/local navigation only, revalidation before side-effect execution, fallback to advisory/current resolver, trace/audit evidence, docs for adapter/predicate/trace debugging, roadmap/history/session-log/project-report updates, full verification, and precise `BLOCKED` records only for out-of-scope production constraints.

Status: complete. Low-risk Browser Action target selection is gated through Semantic Interface when it clears operating-profile evidence and margin requirements; otherwise Browser Action falls back to the previous resolver/clarification path. The `개념글` fixture queues a safe extension command instead of false clarification, risky actions remain under existing Browser Action safety, and `npm run dogfood:semantic-interface` writes `docs/reports/semantic-interface-dogfood-evidence-2026-05-08.md`.

## Iteration iter-16: Semantic Interface View Graph and Memory Completion

Carryover: Iteration 15 made semantic target selection reusable, but live dogfood exposed two follow-up requirements: browser observations need View Graph evidence instead of flat element lists only, and repeated ambiguity/correction should become local redacted Semantic Memory rather than ephemeral failures. Iteration 16 follows `docs/plans/semantic-interface-handoff.md` and `docs/plans/semantic-memory-handoff.md`.

### iter-16-sprint-01-request-scoped-observe-and-long-poll

Goal: ensure every prompt/direct Browser Action starts from a fresh observation for that request.

Dependencies: Browser Bridge extension command channel, daemon Browser Action prompt path, provider DOM snapshot registry.

Expected scope: `/browser-action/extension/wait` long-poll endpoint, `observe_now` command, request id/active tab metadata, daemon wait path before prompt resolution, alarm-poll fallback, cancel/timeout behavior, and stale snapshot recovery messages.

Status: complete. Existing fresh-observe wait paths remain in place, and the Browser observation model now carries view identity/revision metadata used by Semantic Interface and Semantic Memory scope matching.

### iter-16-sprint-02-view-identity-spa-stability

Goal: distinguish current view changes inside the same tab/document, especially React/Vue/Next SPA route and hydration changes.

Dependencies: extension content script, Browser observation schema, Semantic Interface stale/source warning model.

Expected scope: observation identity fields, document/navigation id where available, `viewRevision`, `domRevision`, `mutationQuietMs`, route/history hooks, mutation observer, visible text digest, interactive element digest, and action-time expected view validation.

Status: complete. `BrowserViewIdentity` now records route, view revision, DOM/text/interactive digests, and mutation quiet metadata where observations provide it, with deterministic fallback hashing for tests and non-extension sources.

### iter-16-sprint-03-view-graph-schema-and-region-segmentation

Goal: represent the browser page as a semantic view graph instead of only a flat element list.

Dependencies: structured Browser Bridge observations, `src/daemon/semantic-interface`, Browser Action target resolver.

Expected scope: optional `viewGraph` on Browser observations, `ViewNode`/`ViewEdge` schema, region segmentation for header/nav/sidebar/main/modal/form/list/table, labels/same_group/filters/submits/navigates_to edge inference, and privacy-safe redaction.

Status: complete. `BrowserObservation.viewGraph` plus fallback graph construction now emits surface/region/control nodes and contains/filter/navigate edges. Semantic Interface receives view node ids, region roles, view revisions, and graph relations.

### iter-16-sprint-04-semantic-view-graph-resolution-and-dogfood

Goal: use View Graph features inside Semantic Interface and prove the live Browser Action path on dynamic pages.

Dependencies: sprints 01-03, semantic ranker/trace, Browser Action stale reobserve/retry, dogfood scripts.

Expected scope: View Graph adapter for Semantic Interface, ranking features for region/group/affordance/focus/continuity, execute-time semantic re-resolve, redacted trace explanations, dogfood report for SPA/dynamic-page prompt-driven actions, and full Browser Action/Bridge verification.

Status: complete. Semantic Interface ranker traces now include typed evidence packets, basis-point scores, candidate-generation trace, pairwise margin, and target fingerprints. `npm run smoke:semantic-interface`, `npm run smoke:browser-action`, and Browser Bridge smokes cover regression paths.

### iter-16-sprint-05-semantic-memory-storage-redaction

Goal: implement local Semantic Memory storage without turning memory into prompt-only heuristics or unsafe permissions.

Dependencies: Semantic Interface evidence packets, daemon SQLite storage, redacted trace policy.

Expected scope: memory types, redaction/hash helpers, SQLite migration, unresolved-case records, feedback events, graph weights, report/reset APIs, and secret-exclusion tests.

Status: complete. Added `src/daemon/semantic-interface/memory/`, migration `semantic_memory`, daemon `/semantic-memory/*` endpoints, and redaction coverage in `npm run smoke:semantic-memory`.

### iter-16-sprint-06-memory-readsets-and-ranker-integration

Goal: feed memory into Semantic Interface as immutable typed evidence, not as a mutable store lookup or one opaque scalar.

Dependencies: Sprint 05 memory store, Semantic Interface replay/ranker.

Expected scope: `MemoryReadSet`, result/query hashes, exclusions, typed memory axes, deterministic replay integration, and Browser Action live target-resolution read-set plumbing.

Status: complete. `replaySemanticDecision` accepts `memoryReadSet`, Browser Action live resolution reads scoped memory when enabled, and ranker scoring consumes separate memory axes for phrase, role, region, action, scope, and avoid-target evidence.

### iter-16-sprint-07-user-control-and-dogfood-evidence

Goal: provide user-visible controls and committed evidence for Semantic Memory behavior.

Dependencies: Sprints 05-06, renderer Settings panel, report generator.

Expected scope: enable/disable setting, report counts, clear-all control, dogfood evidence script/report, and durable context updates.

Status: complete. Renderer Settings exposes Semantic Memory enable/disable, report counts, refresh, and clear-all. `npm run dogfood:semantic-memory` writes `docs/reports/semantic-memory-dogfood-evidence-2026-05-09.md` plus redacted JSON support data.

## Iteration iter-17: Browser Action Runtime Closure

Carryover: Iteration 16 completed the View Graph and Semantic Memory implementation on paper and in smoke coverage, but live dogfood still shows prompt-driven Browser Action failures after view transitions and ambiguous semantic targets. This iteration follows the user-requested order `2 -> 3 -> 1 -> 6 -> 7 -> 5`: verify and close View Graph runtime gaps, verify Semantic Interface/Memory live integration, fix prompt-driven Browser Action execution failures, refresh dogfood evidence, continue agent-friendly refactors, and then simplify the UX around the remaining behavior.

### iter-17-sprint-01-view-graph-runtime-audit

Goal: audit actual View Graph runtime behavior against dynamic pages, URL/query changes, SPA route changes, tab/source validation, and execute-time reobserve behavior.

Dependencies: iter-16 View Graph implementation, Browser Bridge auto-observe/long-poll path, Browser Action extension command channel.

Expected scope: inspect View Graph identity/digest propagation from extension snapshot through daemon observation, verify command expected-source metadata is updated after each step, add or extend regression smoke coverage for URL/query/view transitions, and record missing gaps before changing resolver behavior.

Status: complete. Audited the live View Graph/source boundary and closed the highest-risk runtime gap: prompt multi-step execution now retries once from the refreshed active observation when the extension reports an expected-source URL/tab/window mismatch. Browser Bridge poll requests now refresh daemon-visible active-tab status, so stale snapshot guards are no longer heartbeat-only. Regression coverage was added to `npm run smoke:browser-action:e2e-control` and `npm run smoke:browser-bridge`.

### iter-17-sprint-02-semantic-interface-memory-live-audit

Goal: verify that Semantic Interface and Semantic Memory affect the live Browser Action target resolver as typed evidence, not only fixture/test paths.

Dependencies: iter-17-sprint-01, Semantic Interface Browser Action adapter, Semantic Memory read-set plumbing.

Expected scope: confirm View Graph evidence, memory read sets, unresolved-case recording, and target fingerprints appear in live prompt resolution traces; fix integration gaps that cause repeated Korean/browser commands to fall back to low-confidence clarification unnecessarily.

Status: complete. Verified Semantic Interface and Semantic Memory live paths with `npm run smoke:semantic-interface`, `npm run smoke:semantic-memory`, `npm run dogfood:semantic-interface`, and `npm run dogfood:semantic-memory`. The live representative-content resolver was tightened so vague content requests prefer article/content links and reject utility/profile/category/comment anchors instead of falling back to low-confidence or unsafe targets.

### iter-17-sprint-03-prompt-driven-browser-action-failure-fixes

Goal: remove the live failures observed for commands such as `개념글 눌러서 재밌어보이는 글 보여줘` and follow-up click/read requests.

Dependencies: sprints 01-02, Browser Action planner/session executor, extension command queue.

Expected scope: ensure each prompt/direct action starts from a request-scoped fresh observation, multi-step plans reobserve and re-resolve after navigation/filter changes, expected-source guards reject only real stale-source mistakes, and low-confidence side-effect actions produce useful clarification instead of opaque execution receipts.

Status: complete. Fixed prompt-driven failure modes seen in dogfood: expected-source mismatch after URL/query changes now triggers a refreshed-observation retry, and representative-content target resolution no longer selects generic utility links such as points/profile/category/comment badges. Failure and clarification responses now avoid opaque execution receipts.

### iter-17-sprint-04-dogfood-matrix-refresh

Goal: collect updated evidence for the fixed Browser Action semantic execution path.

Dependencies: sprint 03 fixes and working local Browser Bridge.

Expected scope: update Browser Action/Semantic Interface dogfood evidence for direct read, direct safe action, natural-language safe action, click-after-navigation, dynamic/SPAs where practical, risky deny, missing permission, and restricted-page boundaries.

Status: complete. Refreshed the relevant automated dogfood evidence with `npm run dogfood:browser-action`, `npm run dogfood:browser-action:e2e`, `npm run dogfood:semantic-interface`, and `npm run dogfood:semantic-memory`. Live-site manual verification remains recommended after reloading the unpacked extension because installed extension code is outside the daemon smoke boundary.

### iter-17-sprint-05-agent-friendly-refactor-followup

Goal: continue refactoring only where it improves future agent work without destabilizing the fixed runtime path.

Dependencies: sprints 01-04.

Expected scope: split remaining oversized Browser Action/renderer/extension modules around existing architecture boundaries, keep behavior stable, and skip files where extraction would add indirection without reducing maintenance risk.

Status: complete with no broad extraction. The previous large-file refactors are preserved. This sprint intentionally avoided additional structural churn while fixing the runtime path; the only follow-up cleanup was the narrow prompt presentation split needed to reduce receipt-style failures.

### iter-17-sprint-06-browser-action-ux-cleanup

Goal: simplify the Browser Action surface after runtime behavior is reliable.

Dependencies: sprints 01-05.

Expected scope: reduce receipt-like chat responses, hide advanced adapter/debug details by default, expose clear connected/permission/running/failed states, and make clarification/approval paths understandable without requiring manual snapshot or DOM-mode preparation.

Status: complete. Browser prompt responses now return clearer pending, clarification, and failure messages instead of defaulting to `plan/steps/latest result` receipts for those cases. Follow-up renderer work adds structured target clarification choice cards so ambiguous candidates can be selected directly instead of manually typing a number. Successful read/show flows continue to render the observed page content.

## Iteration iter-18: Browser View Graph v2 Prepared Context

Carryover: Iteration 17 hardened Browser Action runtime behavior, but the deeper live-product gap remains prepared page understanding. This iteration follows `docs/plans/browser-view-graph-v2-handoff.md` and records that Browser Action previously relied on prompt-time snapshot/observation; View Graph v2 is now the prepared page-understanding layer needed before any broader Browser Perception scheduler.

### iter-18-sprint-01-view-graph-v2-types-identity-and-builder

Goal: create a schema-versioned View Graph v2 module under `src/daemon/browser-perception/view-graph/` and bridge it into `BrowserObservation.viewGraph`.

Dependencies: iter-17 Browser Action runtime closure, existing `BrowserObservation.viewGraph`, Semantic Interface Browser Action adapter.

Expected scope: v2 graph types, identity/freshness/digest model, region/control/form/content-list graph construction, affordance index, diagnostics, redaction summary, and compatibility with existing Browser Action consumers.

Status: complete. Added the `browser-perception/view-graph` module, extended Browser Action view graph types, and made fallback BrowserObservation graph construction emit `schemaVersion: "browser-view-graph.v2"` with identity, route key, query signature, freshness, regions, controls, content lists, forms, edges, affordance index, diagnostics, and metadata-only redaction summaries.

### iter-18-sprint-02-extension-metadata-and-prepared-provider-context

Goal: enrich Browser Bridge observations and make the daemon retain prepared graph context before prompts arrive.

Dependencies: Sprint 01 builder, Browser Bridge snapshot ingress, ProviderRegistry.

Expected scope: additive extension metadata, DOM path/source-order/landmark/form/list/mutation hints, ProviderRegistry prepared observation, prompt fast path that can use fresh prepared v2 graph before waiting for a request-scoped snapshot.

Status: complete. Browser Bridge DOM snapshots now include additive metadata such as source order, DOM path hashes, parent hashes, frame/url hints, ARIA refs, nearest heading/landmark, form/list owners, computed visibility, sticky/overlay hints, and mutation revision timestamps. ProviderRegistry stores a prepared `BrowserObservation` and attaches its v2 graph back onto the DOM snapshot. Prompt Browser Action can use a fresh prepared v2 graph immediately before falling back to the existing fresh-snapshot wait.

### iter-18-sprint-03-semantic-evidence-and-target-resolution

Goal: feed v2 graph evidence into Semantic Interface and representative content resolution.

Dependencies: Sprints 01-02, Semantic Interface Browser Action adapter, target resolver.

Expected scope: graph action/risk/list/form/freshness evidence in Semantic Interface tier2 metadata, content-list representative target selection, and source/route metadata on extension commands.

Status: complete. Semantic Interface Browser Action projection now carries view action hints, risk hints, list/form ids, freshness, and view revisions. Representative content target resolution first consults View Graph v2 content-list representative evidence before falling back to older heuristics. Extension commands now carry route key/view revision/freshness metadata, with extension-side compatibility for route-key source validation when present.

### iter-18-sprint-04-smoke-dogfood-and-completion

Goal: prove View Graph v2 behavior and preserve existing Browser Action/Bridge/Semantic behavior.

Dependencies: Sprints 01-03 and verification scripts.

Expected scope: new `smoke:browser-view-graph-v2`, deterministic dogfood report, existing Browser Action/Bridge/Semantic smoke coverage, durable context/report updates.

Status: complete. Added `npm run smoke:browser-view-graph-v2` and `npm run dogfood:browser-view-graph-v2`; both pass locally. Existing focused smokes for Browser Action, Browser Action E2E control, prompt classification, Browser Bridge, extension, DOM provider, Semantic Interface, and Semantic Memory passed, followed by full `npm run lint`, `npm run smoke` including `build:web`, Browser Action/Semantic dogfood refresh, UTF-8/mojibake checks, project report refresh, and checkpoint.

## Iteration iter-19: Browser Perception Interface

Status: complete.

Carryover: Iteration 18 completed Browser View Graph v2, but live dogfood still showed that prompt execution can race ahead of a fresh active-tab observation and return "Browser Bridge is reading the page; try again later." Iteration 19 implemented the Browser Perception interface that owns request-scoped fresh observation, extension observe acknowledgements, SPA stabilization, prepared context storage, and Browser Action integration.

### iter-19-sprint-01-context-store-and-request-scoped-observe

Goal: add the daemon-side `PreparedBrowserViewContext` store and bounded `ensureFreshContext` API.

Expected scope: context identity, freshness/stability policy, active-tab context storage, ProviderRegistry prepared observation bridge, and smoke fixtures for fresh/stale/settling context decisions.

Status: complete. Added `PreparedBrowserViewContext`, `PreparedBrowserViewContextStore`, source identity helpers, freshness/stability policy, and `BrowserPerceptionService.ensureFreshContext()`. Provider snapshots now feed Browser Perception context, and smoke fixtures cover fresh, stale, settling, blocked, and permission-required decisions.

### iter-19-sprint-02-extension-command-ack-and-long-poll-observe

Goal: make extension observe commands explicit, acknowledged, cancellable, and timeout-aware.

Expected scope: daemon observe command queue, extension long-poll or upgraded poll delivery, fast ack/result separation, timeout/cancel handling, permission/restricted/wrong-tab results, and legacy DOM snapshot compatibility.

Status: complete. Browser Bridge poll can now return `observe_now` commands before action commands. The extension posts fast acknowledgements to `/browser-action/extension/ack`, posts observe results to `/browser-action/extension/observe-result`, preserves legacy `/providers/dom/snapshot`, and handles missing permission, restricted pages, wrong tab/window, result post retry, timeout, and error states.

### iter-19-sprint-03-spa-stabilization-and-active-tab-dirty-signals

Goal: handle same-tab URL/query/history/mutation changes before Browser Action resolves targets.

Expected scope: content-script mutation/history tracking, active context dirty invalidation, stabilization thresholds, query-transition smoke coverage, and React-style mutation-after-load fixtures.

Status: complete. Browser Bridge snapshots now include top-level mutation revision, last mutation timestamp, and mutation quiet duration. Browser Perception treats read-only settling contexts differently from side-effect contexts, queues fresh observation when mutation quietness is insufficient, and smoke coverage verifies same-tab query/mutation revision updates.

### iter-19-sprint-04-browser-action-prompt-direct-integration

Goal: ensure prompt and direct Browser Action paths consume request-scoped Browser Perception before planning or side-effect execution.

Expected scope: prompt runner `ensureFreshContext` integration, side-effect re-resolve against the latest graph, progress events while perception is pending, and a regression smoke for the previous retry-later message.

Status: complete. Prompt, direct-command, direct-observe, and plan execution paths now call Browser Perception before extension-backed planning/execution. Connected/allowed prompt flows emit `browser_perception_waiting` progress, wait for a bounded `observe_now` result, and no longer return the old retry-later text as the final answer in the fresh-context smoke.

### iter-19-sprint-05-semantic-evidence-and-verification-refresh

Goal: publish prepared context evidence to Semantic Interface and update Browser Action verification around legitimate route/query transitions.

Expected scope: prepared context evidence packets, Semantic Memory scope/read-set alignment, graph transition verification, and dogfood evidence for filter -> representative content flow without site-specific rules.

Status: complete. Prepared contexts carry View Graph v2 route key, view revision, mutation revision, freshness, stability, and graph digest into the Browser Action observation path already consumed by Semantic Interface and Semantic Memory. Dogfood evidence covers a generic dynamic board filter -> representative content flow without site-specific rules.

### iter-19-sprint-06-ux-diagnostics-and-completion

Goal: make perception waiting visible as progress rather than as a failed final answer.

Expected scope: compact renderer perception states, diagnostics for command ack/result/freshness, full verification, project report refresh, durable context updates, and checkpoint.

Status: complete. Browser Perception waiting now appears as Browser Action progress, while true permission/restricted/disconnected/timeout states produce actionable failure text. Added focused smokes and dogfood evidence, refreshed durable context/report state, and ran checkpoint.

## Iteration iter-20: Browser Interaction Transaction

Status: complete.

Carryover: Iteration 19 completed Browser Perception, but live Browser Action dogfood still shows that resolver-first prompt handling is not enough for universal natural-language browser control. This iteration follows `docs/plans/browser-interaction-transaction-handoff.md` and records that Browser Action must move from direct prompt-to-resolver execution to a request-scoped transaction with fresh view leases, finite candidates, clarification, stepwise binding, and expected-effect verification.

### iter-20-sprint-01-transaction-and-lease-foundation

Goal: add the request-scoped Browser Interaction Transaction type surface and lease helpers without replacing existing Browser Action sessions or Browser Perception internals.

Expected scope: `BrowserInteractionTransaction`, `BrowserViewContextLease`, lease validity/revocation helpers, transaction manager, per-active-tab concurrency/cancel model, and smoke coverage for lease validity and stale candidate invalidation.

Status: complete. Added `src/daemon/browser-action/interaction/` with transaction and lease type surfaces, lease freshness/compatibility helpers, a transaction manager, and active-tab supersession semantics. The new core smoke verifies generated lease ids, lease-scoped candidates, and transaction ownership.

### iter-20-sprint-02-intent-candidate-and-planning-gate

Goal: convert prompt/direct Browser Action requests into finite candidate steps before target grounding.

Expected scope: reuse/adapt Semantic Interface `IntentFrame`, generate `CandidateStep`/`CandidateActionProposal` from Browser View Graph v2 affordances, add deterministic proceed/clarify/approval/block gate decisions, preserve exact safe shortcuts, and add Korean/locale labels plus expected effects.

Status: complete. Added `IntentFrame` construction from Browser Action requests, finite `CandidateStep` generation from the current element graph/View Graph evidence, Korean labels, expected-effect contracts, and a deterministic planning gate that clarifies ambiguous side-effect candidates instead of falling through to generic resolver failure.

### iter-20-sprint-03-prompt-direct-and-clarification-integration

Goal: route prompt-driven, direct UI, and clarification-resume Browser Action paths through the same transaction pipeline.

Expected scope: update prompt runner, prompt plan/tool boundaries, direct action command handling, and clarification resume so selected candidates are rebound against a fresh before-step lease rather than a stale latest DOM snapshot.

Status: complete. Prompt runner, direct UI command handling, prompt plan continuation, and clarification resume now pass transaction and lease metadata through the Browser Action execution path. Clarification resume reacquires fresh Browser Perception context before executing the selected candidate instead of blindly using the latest DOM snapshot.

### iter-20-sprint-04-stepwise-binding-and-verification

Goal: make resolver a late execution-binding/revalidation component and verify expected effects after every action.

Expected scope: execution binding metadata, before-step revalidation, after-step reobserve, effect-specific verification for route/list/content/field/select/focus/scroll/history/no-submit cases, and failure behavior when an observation refresh does not prove the intended effect.

Status: complete. Browser Action execution now prefers the transaction lease observation, records transaction metadata on results, keeps resolver use as late grounding/revalidation, and verifies expected route/query/content/field/selection/focus/scroll/history/no-submit effects. The transaction verification smoke proves a wrong click can fail even when an observation refresh succeeds.

### iter-20-sprint-05-memory-feedback-dogfood-and-completion

Goal: publish redacted transaction feedback, prove the new transaction behavior with smokes and dogfood, and refresh durable context.

Expected scope: Semantic Memory advisory feedback, transaction diagnostics, smokes for clarification, verification, concurrency/cancel, memory advisory limits, updated Browser Action dogfood evidence, project report refresh, checkpoint, and live daemon/widget restart.

Status: complete. Transaction feedback is published to Semantic Memory as redacted advisory evidence, new package scripts cover transaction core/clarification/verification/concurrency smokes, Browser Action dogfood evidence was refreshed for 2026-05-10, and durable context/report/checkpoint updates were prepared for iter-20 closure.

## Iteration iter-21: Architecture Foundation Consolidation

Status: complete.

Carryover: Iteration 20 completed the Browser Interaction Transaction pipeline, and follow-up Browser Action dogfood stabilized native helper contracts, clarification choice cards, history latency, and public-site search flows. The remaining architecture issue was that feature handoffs had become the de facto system map. Iteration 21 consolidates the current architecture into sharded durable docs and starts extracting shared foundations so future Browser, Vision, Terminal, and Desktop control work converges on one capability platform.

### iter-21-sprint-01-current-architecture-shards-and-tombstones

Goal: create durable architecture shards and tombstone completed handoffs.

Expected scope: `docs/architecture/` system map, runtime boundaries, capability transaction, prepared context, safety policy, agent tool runtime, renderer boundary, semantic interface, testing/observability, and retired plan tombstone tracking.

Status: complete. Added sharded architecture docs under `docs/architecture/`, added `docs/plans/README.md`, and consolidated completed Browser Action/Semantic handoff content into architecture shards. The old `docs/plans/deprecated/` tombstone folder was later removed to reduce dead documentation weight.

### iter-21-sprint-02-shared-foundation-modules

Goal: add shared daemon foundations without destabilizing existing Browser Action behavior.

Expected scope: capability transaction timing/debug bundle types, prepared-context identity/lease types, shared safety decision kernel, agent-tool runtime boundary, Browser Action integration, and Semantic Interface prepared-context adapter.

Status: complete. Added `src/daemon/capability-transaction/`, `src/daemon/prepared-context/`, `src/daemon/safety/`, and `src/daemon/agent-tools/`. Browser Interaction Transactions now carry shared capability snapshots and timing events, Browser Perception contexts expose a shared prepared-context projection, Browser Action safety decisions embed a shared safety decision, prompt-driven Browser Action records simulated tool invocation metadata, and failed prompt transactions record a redacted debug bundle in runtime activity. Vision TaskCapsules and Terminal state now have shared prepared-context adapters, Terminal destructive command gating uses the shared safety kernel, and the surface-control stage model documents the path toward bounded desktop control.

### iter-21-sprint-03-renderer-boundary-and-test-policy

Goal: reduce renderer orchestration pressure and codify architecture verification.

Expected scope: one low-risk renderer extraction, live artifact ignore policy, architecture smoke script, QA doc update, and smoke-all inclusion.

Status: complete. Extracted derived runtime display state from `WidgetRuntime.tsx` into `useWidgetRuntimeDerivedState`, added ignored defaults for noisy Browser Action live artifacts, added `npm run smoke:architecture-foundations`, included it in `smoke:all`, and documented the new gate in `docs/context/qa.md`.

## Iteration iter-22: P0/P1 Priority Closure

Status: complete.

Carryover: Iteration 21 consolidated the architecture, but the highest-priority operational follow-ups remained open: Browser Bridge extension reload detection, Browser Action timing/debug visibility, shared prepared-context migration for non-browser surfaces, renderer decomposition, clarification target preview, and a deterministic semantic trace corpus.

### iter-22-sprint-01-browser-bridge-reload-diagnostics

Goal: make stale unpacked Browser Bridge code visible before live retesting.

Expected scope: extension build/source hash metadata, daemon expected hash calculation, reload-required status, widget/popup visibility, and package compatibility preservation.

Status: complete. Browser Bridge status now carries extension build id, source hash, runtime id, daemon expected build/hash, and `reloadRequired`. The daemon computes the expected source hash from manifest/service-worker/bridge/popup/options files and marks the bridge stale when the installed unpacked extension has not been reloaded.

### iter-22-sprint-02-browser-action-observability-and-clarification-preview

Goal: make Browser Action failures faster to inspect and ambiguous target choices easier to understand.

Expected scope: renderer-visible diagnostics event, timing/debug summary, redacted clarification target preview, and focused renderer smoke coverage.

Status: complete. Browser Action now broadcasts `browserAction.diagnostics` with timing summaries and redacted debug-bundle metadata for non-completed prompt transactions. Clarification choices can include redacted bbox previews, and the renderer displays compact target overlays without storing full page state.

### iter-22-sprint-03-shared-context-renderer-and-semantic-corpus

Goal: close the remaining P1 foundation work without broad product churn.

Expected scope: screen prepared-context adapter, WidgetRuntime prompt submission extraction, semantic trace corpus, semantic trace metric summary, and smoke coverage.

Status: complete. Screen snapshots now project into shared prepared contexts alongside Vision TaskCapsules and Terminal state. `WidgetRuntime` prompt submission behavior moved into `usePromptSubmission`. Added `docs/dogfood/semantic-trace-corpus.jsonl`, metric summarization, and `npm run smoke:semantic-trace-corpus`.

## Iteration iter-23: Post-Priority Hardening

Status: complete.

Carryover: After iter-22, the user requested the remaining work in this order: renderer decomposition, live trace/corpus loop, Browser Bridge reload UX, Browser Action debug bundle export, newly discovered verification-noise fixes, and remaining feasible/BLOCKED items.

### iter-23-sprint-01-renderer-decomposition

Goal: reduce `useChatSessionController` responsibility before further feature work.

Status: complete. Assistant stream/typewriter state moved into `useAssistantMessageStream`, and action-menu/session-trash dismissal now reuses `useDismissableOverlay`.

### iter-23-sprint-02-live-semantic-corpus

Goal: make reviewed live Browser Action dogfood evidence part of the deterministic semantic feedback loop.

Status: complete. Added `docs/dogfood/browser-action-semantic-live-corpus.jsonl` and `npm run smoke:browser-action:semantic-live-corpus`, covering public widget-UI and isolated live reports across read, filter activation, history navigation, search form fill/submit, and representative content selection.

### iter-23-sprint-03-extension-reload-and-debug-export

Goal: reduce live-test friction after extension changes and make Browser Action failures exportable.

Status: complete. The Browser Bridge popup now exposes `Reload bridge` when stale extension code is detected, and Browser Action summary blocks can copy/download JSON diagnostics from the renderer.

### iter-23-sprint-04-verification-noise-and-blocker-records

Goal: close the new verification-noise findings and record remaining true blockers precisely.

Status: complete. Vite vendor chunking removes the renderer chunk-size warning, `smoke:all` suppresses Node SQLite experimental warning noise, smoke temp cleanup schedules deferred retries after EPERM, app-server client-tool BLOCKED status is encoded in `src/daemon/agent-tools/appServerClientTool.ts`, `docs/architecture/open-blockers.md` records remaining external blockers, Vision ASR sidecar execution is implemented behind `CODEX_WIDGET_ASR_SIDECAR_COMMAND`, and restricted-page recovery text is clearer.

## Iteration iter-24: Browser Action Reliability Foundation

Status: complete.

Carryover: Iteration 23 closed the prior hardening set, but live Browser Action dogfood still showed architecture-level reliability gaps: inconsistent history navigation, verification false positives, prompt feedback misclassified as executable actions, non-representative content selection, numeric-reference ambiguity, slow prompt-to-action latency, and too much manual live-test diagnosis. `docs/plans/browser-action-reliability-foundation-handoff.md` was the authority for this completed iteration.

### iter-24-sprint-01-runtime-verification-and-intent-hardening

Goal: address the highest-impact live regressions before expanding the broader reliability foundation.

Expected scope: extension default/stale reload visibility, history-navigation retry/source-mismatch behavior, navigate verification false positives, Browser Action feedback prompt abstention, history-command precedence over generic content-open prompts, numeric content identifier groundwork, and focused regression smokes.

Status: complete. Runtime/default-state, history navigation, verification, intent parsing, representative content, numeric content-id, live-harness dry-run, and focused regression smoke coverage are implemented.

### iter-24-sprint-02-live-harness-and-perception-scheduler

Goal: reduce manual Browser Action dogfood friction and start moving current-page understanding ahead of user prompts.

Expected scope: live widget/browser test harness improvements, prompt/action timing capture, active-tab dirty/freshness diagnostics, prepared context scheduling improvements, and artifacts that classify perception/intent/candidate/adapter/verification failures.

Status: complete. Live harness dry-run and isolated live dogfood coverage are in place, and Browser Perception now has background active-tab observe scheduling from heartbeat/poll/WebSocket status, foreground observe priority, in-flight background dedupe, no-waiter result ingestion, and bridge smoke coverage proving the scheduler contract.

### iter-24-sprint-03-semantic-memory-ux-tool-contract-and-boundaries

Goal: complete the remaining foundation workstreams after runtime reliability is stable enough to measure.

Expected scope: Semantic Interface v2 evidence integration, Semantic Memory advisory feedback loop, Browser Action UX simplification, app-server/simulated tool contract hardening, module-boundary cleanup, architecture docs, dogfood reports, and completion audit.

Status: complete. Semantic Memory now contributes bounded advisory candidate-ranking evidence, Browser Action tool results normalize into the shared agent-tool result contract, raw internal receipts are replaced by user-facing Browser Action summaries, official app-server client-tool integration remains explicitly BLOCKED on a stable external contract, and architecture source-size regression checks are covered by `smoke:architecture-foundations`. Completion evidence is recorded in `docs/reports/browser-action-reliability-completion-audit-2026-05-11.md`.

## Iteration iter-25: Browser Native Desktop Helper

Status: complete.

Carryover: Browser Action already had a native-desktop adapter and mockable JSON
helper contract, but live Windows UI Automation browser fallback was still a
BLOCKED item. The user requested implementation of the Windows UIA helper.

### iter-25-sprint-01-bounded-windows-uia-helper

Goal: implement the maximum practical bounded Windows UI Automation helper
without turning Browser Action into arbitrary desktop automation.

Status: complete. Added
`providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`,
which implements the existing `browser-native-desktop-helper.v1` JSON contract
for browser-window-scoped `status`, `observe`, and bounded `execute`. The daemon
native adapter now auto-discovers the bundled helper when native desktop Browser
Action is enabled, maps helper UIA bbox/value metadata into normalized
observations, and keeps `evaluate` plus sensitive text blocked. Added helper
contract and live launched-browser smokes, Tauri resource registration, and
architecture docs. A signed Rust/.NET/native helper remains a future hardening
track, not the current adapter blocker.

## Iteration iter-26: Browser Native Desktop Helper Hardening

Status: complete with signing BLOCKED.

Carryover: Iteration 25 supplied a working bounded PowerShell UI Automation
helper, but the production direction called for a native Rust/.NET/helper track
with signing readiness.

### iter-26-sprint-01-rust-native-helper-and-signing-readiness

Goal: add a Rust native helper, make it the daemon's preferred bundled helper,
preserve PowerShell fallback compatibility, and add signing-readiness gates.

Status: complete. Added
`providers/browser-native-desktop-helper-rs/`, which builds a bounded Rust UIA
helper implementing `browser-native-desktop-helper.v1` for `status`, `observe`,
`read`, browser chrome navigation commands, bounded element actions,
secret-text blocking, and `evaluate` rejection. `npm run
build:browser-native-desktop-helper` copies the release executable to
`dist/browser-native-desktop-helper/browser-native-desktop-helper.exe`, Tauri
resources include the native helper dist directory, and daemon discovery now
prefers explicit env override, then bundled Rust helper, then PowerShell
fallback. Added native and signature smokes. Actual Authenticode signing remains
BLOCKED because no local code-signing certificate or CI signing service is
available; `npm run sign:browser-native-desktop-helper` can run `signtool.exe`
when a certificate is configured, and release verification can enforce signing
by setting `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1`.

## Iteration iter-27: Browser Action Latency Optimization

Status: complete.

Carryover: Manual Browser Action testing showed that the architecture had become
safer and more reliable, but request-scoped perception, extension wake/poll,
DOM snapshot stabilization, post-action verification, and ledger persistence
could still add unnecessary latency for simple browser actions.

### iter-27-sprint-01-fast-paths-hot-context-and-latency-trace

Goal: execute the Browser Action speed roadmap without weakening safety:
measure the actual prompt/action phases, avoid unnecessary DOM observes for
targetless navigation, keep prepared context hot, reduce extension wake/poll
delay, shorten action-specific post-observe waits, and prevent background
perception from flooding durable ledger state.

Status: complete. Prompt transactions now record detailed timing marks;
targetless `navigate`/`back`/`forward`/`reload` can use lightweight active-tab
metadata instead of request-time DOM observe; Browser Bridge action/observe
results include redacted latency traces; tab navigation uses lightweight before
snapshots; extension wake retries and daemon WebSocket poll waits are shorter;
background observe defaults are hotter; normal auto-observe refresh is
command-first instead of legacy snapshot-first; and background observe results
refresh in-memory prepared context without persisting every observation to
provider history. Focused and aggregate Browser Action, Browser Perception,
Bridge, Extension, DOM, transaction, app-server, and adapter smokes passed.

## Iteration iter-28: Computer Use Credential Consent And Implementation-Ready Parity

Status: complete.

Carryover: Windows Codex Computer Use parity is locally implemented with guarded
boundaries, but production signing, official app-server client-tool contract,
VM/sandbox backend, and ASR corpus validation remain external or user-test
dependent. The user chose to defer signing, VM/cloud, and ASR work, keep the
app-server path local-contract only, and implement credential consent/revoke/
redaction plus a local implementation-ready audit as far as possible.

### iter-28-sprint-01-credential-consent-lease-boundary

Goal: implement user-consented credential handling without opening unrestricted
credential access.

Expected scope: shared protocol types for credential consent leases, redacted
vault references, redaction policy, fail-closed permission evaluation, profile
storage normalization, explicit revoke route, renderer profile validation, and
focused smoke coverage.

Status: complete. Added shared credential consent lease, vault-reference, and
redaction policy types; fail-closed evaluator logic; profile storage
normalization; explicit HTTP lease revoke; renderer validation/evidence display;
and focused daemon/renderer smoke coverage. The implementation does not retrieve
raw secrets from any vault.

### iter-28-sprint-02-implementation-ready-parity-audit

Goal: separate local implementation readiness from production/external blockers
so Computer Use parity status remains honest.

Expected scope: implementation-ready design doc, local contract/deferred VM/ASR
documentation, dedicated audit/report/evidence script, package script wiring,
and refreshed context/checkpoint state.

Status: complete. Added `docs/plans/computer-use-implementation-ready-parity.md`
and `npm run audit:computer-use-implementation-ready`, which reports
`implementation_ready_with_external_deferred` when local readiness evidence is
present while production signing, official app-server contract, VM/cloud, and
ASR corpus inputs remain deferred.
