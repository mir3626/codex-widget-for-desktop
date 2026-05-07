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
