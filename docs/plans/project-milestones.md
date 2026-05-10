# Project Milestones

## resident-widget-mvp

Goal: keep a small Tauri desktop widget resident on Windows with reliable window controls, prompt/chat UX, streaming Codex responses, session reset, and recoverable daemon lifecycle.

Current progress: 0.96

Evidence:
- Tauri shell, borderless resize, pin, opacity, mascot drag, and model/reasoning controls are implemented.
- Daemon WebSocket streaming works with Codex CLI auth.
- Default runtime now uses daemon-owned `codex app-server` with `exec` fallback.
- Visible chat history is now replayed from daemon-owned SQLite session snapshots; renderer localStorage remains only as a temporary fallback.
- Multi-turn chat layout, GFM tables, prompt resizing, and response action menu placement are covered by a Playwright renderer smoke.
- Response Branch is covered by smoke tests and now creates a new durable internal session tab before sending a one-shot branch seed with the next prompt.
- Iteration 4 Sprint 01 closed the first dogfooding UI polish slice: resize handles are easier to hit, minimum-width model/reason controls no longer overlap, user prompt bubbles use 12px radius, session tabs have clearer active affordance, branch creates a visible new-session toast, and model/reason controls pulse when the active session changes.
- Iteration 4 Sprint 03 improves the artifact/chat UX with inline artifact previews, version accordions, and versioned open requests from both chat and trash surfaces.
- Iteration 4 Sprint 05 makes PTY feel like an intentional widget module by adding an inline guide and a terminal-focused popout entry point on the same daemon port.
- Reconnecting renderer clients receive retained daemon response snapshots, and active requests continue after the original WebSocket closes.
- The widget hides to tray, stays off the taskbar, and exposes resident settings.
- Packaged Tauri builds now supervise the Node daemon and restart it after unexpected exits.
- Native daemon supervisor diagnostics are visible in the renderer status strip and Settings runtime grid.
- Packaged Tauri builds include a bundled daemon JS entry and bundled Node runtime resource for daemon startup.
- Iteration 5 Sprint 04 audited the remaining backlog and found no additional feasible non-dogfood MVP work beyond dogfood-dependent tuning and deferred external release submission.

## durable-codex-runtime

Goal: use a long-lived Codex runtime boundary instead of prompt-injected one-shot calls, while preserving fallback and safe process cleanup.

Current progress: 0.96

Evidence:
- `CodexAppServerBridge` owns process startup, WebSocket JSON-RPC initialization, thread creation, turn streaming, interrupt, and shutdown.
- `CODEX_WIDGET_CODEX_RUNTIME=app-server` is the default with `exec` fallback.
- Approval and user-input request plumbing is first-class widget UI.
- The daemon emits runtime health status for clients, active requests, and app-server state.
- `npm run smoke:app-server` verifies fake app-server thread reuse, streaming deltas, approval forwarding, and rollback behavior.
- `npm run smoke:app-server:live` verifies a logged-in local Codex CLI can run the real app-server path end to end.
- Iteration 4 Sprint 02 adds daemon-owned widget context injection so app-server/exec/proxy turns can answer questions about the widget's controls, modes, provider capabilities, PTY/Vision/DOM use cases, and safety boundaries without replaying full project history.
- Iteration 4 Sprint 05 extends widget context with the Default Dog mascot persona, tone rules, and mascot state hints for Agent responses.
- The native Tauri shell supervises the daemon process with capped restart backoff and shutdown cleanup.
- Renderer code can read native daemon state while WebSocket reconnect is in progress.
- The native shell resolves bundled daemon/runtime resources before falling back to a system `node` command.
- Response Branch uses `session.branch` plus one-shot `branchContext` so branch UI state and app-server/proxy session state do not silently diverge.
- Iteration 5 Sprint 01 persists Codex app-server thread ids per durable widget session and rebinds the bridge before app-server turns/regeneration; fake app-server smoke verifies separate internal sessions keep separate threads and return to the original thread when reopened.
- Agent events are broadcast to connected clients and retained as bounded response snapshots for reconnect replay, reducing coupling between Codex turns and a single renderer socket.
- Vision Context turns can override app-server input with capsule markdown plus selected `localImage` evidence, and fake app-server smoke verifies those image inputs reach `turn/start`.
- Browser Action capabilities are now visible in app-server widget context, and fake app-server plus Browser Action smokes verify the Agent/daemon path sees typed actions, adapter status, approval boundaries, evaluate safeguards, and result/error flow without granting hidden browser side effects.

## real-tool-providers

Goal: replace Agent/DOM/Vision/PTY stubs with real desktop/browser/terminal context providers that stream tool events through one widget protocol.

Current progress: 1

Evidence:
- Provider modes and tool-event rendering exist.
- Browser DOM mode accepts live snapshots through the local daemon and injects them into model context.
- An unpacked Chrome/Edge extension can send active-tab DOM snapshots to the daemon, exposes a local-only Options page for daemon URL changes, can use an optional Chrome/Edge native messaging host before falling back to HTTP, and `npm run package:extension` produces a zip package with icon assets. Store listing, privacy notes, review notes, permission rationales, `npm run release:browser-store-packet`, `npm run release:confirm-browser-store`, and `npm run smoke:browser-store` are in place.
- Browser Action now upgrades the DOM provider into a typed, auditable browser actuator path: daemon-owned observations, stable interactive element ids, target resolution, safety policy, approval, extension command polling, Playwright/CDP controlled adapters, native desktop diagnostics, `full_control_dev` evaluate gating, action results, and audit activity are covered by `npm run smoke:browser-action` plus the adapter/evaluate/native smokes.
- Browser Action end-to-end control now connects widget browser prompts to a daemon-owned tool simulation, executes multi-step plans, applies browser-specific saved safety policies, exposes a renderer Browser Action panel, and hardens extension active-tab command metadata/timeouts/restricted-page failures.
- Real Browser Action semantic dogfood evidence is recorded in `docs/reports/browser-action-dogfood-evidence-2026-05-08.md` and `docs/reports/browser-action-e2e-dogfood-evidence-2026-05-08.md`; native desktop executable browser chrome control remains explicitly blocked on a scoped Windows UI Automation/native input helper.
- Screen/Vision mode accepts live snapshots through the local daemon, injects description/OCR context into model requests, and attaches image data to app-server Vision turns.
- Iteration 4 Sprint 04 adds clearer Vision choices between snapshot, local WebM recording, and metadata-only Agent screen share; Agent share cadence/duration controls are persisted and sent through daemon Vision stream metadata.
- Iteration 5 Sprint 02 persists redacted DOM, Vision, and Terminal provider snapshot history and surfaces it in the Activity detail popover.
- Iteration 5 Sprint 03 adds Agent screen-share in-flight frame throttling, skipped-frame diagnostics, duplicate-stop prevention, and effective Vision guardrail metadata for dogfooding analysis.
- A Windows PowerShell helper captures the virtual desktop or Settings/env/visual-drag configured crop rectangles as compressed JPEG data, can run a local OCR command, bundled Tesseract runtime, or auto-detected `tesseract` against an OCR-only upscaled PNG, and posts the result to the Screen/Vision endpoint; the widget can trigger that helper through the daemon protocol.
- The Screen/Vision registry computes image hash/change/diff metadata with configurable thresholding so repeated and below-threshold captures can be treated as unchanged context.
- `npm run build:ocr-runtime`, `npm run ocr:fetch-languages`, and `npm run smoke:ocr-runtime` package and verify a Tesseract-compatible OCR runtime resource slot for installed builds, including standard Windows install discovery, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, tessdata language acquisition/manifesting, and bundled `eng+kor` auto-selection when both language packs exist.
- Terminal/PTY mode executes explicit shell commands, supports a persistent node-pty/ConPTY-backed `/pty` command/raw-input session, drains output after raw input/key writes, streams output as tool events, displays terminal output in a dedicated renderer viewport with direct input controls, and forwards live text/key/mouse input through direct `terminal.input` protocol messages.
- Vision Context Interface now normalizes screen/browser/terminal provider facts into observations, builds `TaskCapsule` context with reference/intent resolution, and sends text plus selected local images to Codex app-server without raw video/audio.
- Final browser store account submission is deferred until after dogfooding; two-hour release soak evidence is recorded in `docs/reports/release-soak-2026-05-05-2h.md`.

## resident-desktop-readiness

Goal: make the widget practical as a daily resident desktop utility: tray/autostart, resource budget, crash recovery, and install/release checklist.

Current progress: 0.94

Evidence:
- Dev hot services, daemon lifecycle, tray menu, and start-at-login toggle exist.
- `npm run build` produces release exe plus MSI and NSIS installer bundles.
- `npm run smoke:resident` verifies idle runtime health and RSS budget.
- `npm run smoke:resident-soak` adds a short resident runtime sample, ping/pong health, and RSS growth gate.
- `npm run smoke:all` provides a serial readiness gate that avoids parallel build races across provider smokes.
- `npm run smoke:screen-capture:live` verifies the widget-protocol screen capture request path.
- `npm run smoke:screen-helper:ocr` verifies the helper OCR command hook.
- `npm run smoke:ocr-runtime` verifies OCR runtime packaging and bundled OCR command resolution.
- `npm run smoke:pty-runtime` verifies native node-pty runtime packaging and daemon PTY runtime resolution.
- Runtime status exposes app-server start count and latest error in the widget settings panel.
- `npm run smoke:tauri-supervisor` covers native supervisor restart backoff and actual child restart after exit.
- `npm run smoke:node-runtime` verifies bundled Node can run the dependency-bundled daemon entry.
- `npm run smoke:release-resources` verifies generated MSI/NSIS scripts include the bundled daemon/runtime and provider helper resources.
- `npm run smoke:release-launch` verifies the release exe can start hidden and expose the daemon WebSocket on `127.0.0.1:4128`.
- `npm run smoke:release-install` verifies the NSIS installer can silently install, launch the installed app with its bundled daemon, force-kill the bundled daemon and observe native restart supervision, force-kill the app process and observe daemon orphan cleanup, silently uninstall, and leave no install directory, uninstall entry, product install key, or desktop shortcut.
- `npm run smoke:release-msi-install` verifies the MSI installer can silently install into a per-user test directory, launch the installed app with its bundled daemon, silently uninstall, and leave no install directory, uninstall entry, or desktop shortcut.
- `npm run release:verify` runs the full live release gate and reports release artifact sizes.
- `npm run release:readiness` audits current release artifacts, browser store metadata/package/submission packet readiness, latest soak report evidence, and manual release blockers.
- `npm run release:soak` builds the release app and runs a longer hidden release-exe soak with runtime samples, ping/pong health checks, daemon process detection, process-tree working-set limits, and JSON evidence report output for manual/multi-hour runs.
- A two-hour release soak passed on 2026-05-05 with 1,439 runtime samples, 3,587 pong responses, 358.5 MB ending working set, and -54.0 MB growth; evidence is recorded in `docs/reports/release-soak-2026-05-05-2h.md`.
- Native crash-recovery UX is surfaced through renderer diagnostics; final browser store account submission is deferred until after dogfooding.
- Iteration 5 keeps the dogfooding path inside `npm run smoke:all`; remaining long-run Vision CPU/memory tuning depends on additional real use rather than a missing implementation hook.

## durable-product-state

Goal: make sessions, tabs, branches, trash, artifacts, provider snapshots, activity logs, preferences, and future theme/mascot/module metadata durable through daemon-owned SQLite plus a file-backed blob store.

Current progress: 0.99

Evidence:
- Iteration 3 scopes a daemon-owned SQLite storage foundation instead of continuing to expand renderer-only localStorage.
- The accepted storage boundary keeps renderer focused on UI/interaction while daemon owns sessions, messages, app-server runtime metadata, provider snapshots, artifacts, and activity logs.
- Sensitive OAuth/Codex credentials are explicitly excluded from SQLite; large artifacts, screenshots, and recordings are planned for blob files referenced by DB metadata.
- The storage foundation is implemented with SQLite migrations, WAL/foreign-key setup, app-data/blob path resolution, daemon runtime diagnostics, `/storage/health`, and `npm run smoke:storage`.
- The initial migration creates tables for sessions, tabs, messages, runtime threads, provider snapshots, Vision streams, PTY sessions/events, blobs, artifacts, trash, activity logs, preferences, theme packs, mascot presets, personas, and future feature modules.
- `iter-3-sprint-02-session-tabs-trash` adds daemon-owned session snapshots, SQLite-backed messages, internal renderer tabs, New chat session creation, branch-to-new-session behavior, session trash/restore, and per-session model/reasoning/mode restore.
- `npm run smoke:storage` now covers session prepare/complete, branch, trash, and restore; daemon smoke verifies branch snapshots create a second durable session and replay the selected source pair.
- `iter-3-sprint-03-artifact-activity-ledger` adds daemon-owned artifact/activity protocol, tool-output and app-server file-change persistence, blob-backed generated/before/after/diff snapshots, click-to-open artifact files, a chat artifact accordion, a trash-session artifact viewer, and activity one-line/detail UI.
- `npm run smoke:storage`, `node scripts\smoke-daemon.mjs`, and `npm run smoke:renderer-chat` now cover artifact persistence, tool-output ledger creation, and trash-session artifact rendering.
- `iter-3-sprint-04-vision-streaming-and-ux-foundation` adds a Vision popup for snapshot/WebM recording/Agent screen stream, daemon-owned `vision_streams` metadata, blob-backed WebM recording preservation, metadata-only Agent screen sharing with low-frequency frame delivery to the Vision snapshot endpoint, guardrails, and status-aware mascot hooks.
- `npm run smoke:storage`, `node scripts\smoke-daemon.mjs`, `npm run smoke:renderer-chat`, and `npm run smoke:all` now cover the Vision recording/streaming foundation.
- Iteration 4 is active after the product owner clarified that `/goal` means repeated `/vibe-iterate` work until the categorized dogfooding backlog is closed, not stopping at the Iteration 3 foundation.
- `iter-4-sprint-03-artifact-rendering-and-version-browser` upgrades the ledger into a richer artifact surface: daemon snapshots now expose bounded text/image previews, version availability, current-version metadata, and versioned open targets; the renderer displays file type icons, full filename/meta rows, preview cards, and version accordions from both chat and trash.
- `npm run smoke:storage` verifies artifact preview content plus versioned open-path resolution, and `npm run smoke:renderer-chat` verifies trash artifact previews plus versioned open requests.
- `iter-4-sprint-04-vision-voice-interactive-loop` adds retained Vision stream consent/retention/cadence metadata, local cadence and duration controls, outside-click menu dismissal, and a browser SpeechRecognition-based voice prompt boundary.
- `iter-4-sprint-05-pty-popup-and-mascot-persona` adds PTY guide/popout affordances and Default Dog persona/tone context without changing the existing direct PTY input contract.
- `iter-5-sprint-01-durable-app-server-thread-rebinding` persists and rebinds app-server runtime thread metadata per durable session.
- `iter-5-sprint-02-provider-snapshot-history-ui` adds provider snapshot history to ledger snapshots and the Activity detail popover.
- `iter-5-sprint-03-vision-resource-and-retention-tuning` adds skipped-frame diagnostics, duplicate-stop prevention, media/frame cleanup on terminal Vision states, and effective guardrail metadata.
- `iter-5-sprint-04-completion-audit-and-readiness-update` closes the current durable product-state iteration by aligning roadmap, milestones, handoff, session log, project report, and remaining risk classification.
- Remaining durable-product-state follow-up is dogfood-dependent: longer screen-share CPU/memory tuning and eventual browser store account submission after dogfooding.
- Iteration 8 adds a durable module boundary for future Vision Context state: capture sessions, timeline events, selected evidence, retention policy, and capsule summaries are daemon-owned concepts, with raw media explicitly excluded from durable storage.
- Iteration 9 adds a durable Browser Action module boundary: action sessions, normalized browser observations, element graphs, target resolutions, safety decisions, queued extension commands, verification results, and audit summaries are daemon-owned concepts, while full sensitive page state and credentials remain outside durable storage.
- Iteration 10 completes the production Browser Action interface expansion: adapter registry/status, direct controlled-adapter execution, stale reobserve/retry, Playwright/CDP smokes, native diagnostics boundary, full_control_dev evaluate approval/credential safeguards, and real dogfood evidence.
- Iteration 11 completes the prompt-driven Browser Action E2E control layer: deterministic daemon-side prompt/tool simulation, executable BrowserActionPlan lifecycle, browser-specific saved policies, renderer cockpit, hardened extension command channel, and a real E2E dogfood matrix with CDP/native unavailable evidence where appropriate.

## semantic-interface

Goal: provide a reusable daemon-side semantic decision interface that turns normalized observations and intent frames into deterministic, auditable hypotheses without becoming an executor or prompt-only planner.

Current progress: 1

Evidence:
- Iteration 15 created `src/daemon/semantic-interface/` with ontology/version constants, intent frames, deterministic hypotheses/ranking, transition grammar, operating profiles, pure safety predicates, trace/replay, redacted trace projection, Browser Action adapter/resolver, Vision Context adapter, and golden/adversarial smoke coverage.
- Iteration 16 upgraded the ranker contract to typed basis-point `CandidateEvidencePacket` evidence, `CandidateGenerationTrace`, pairwise margins, target fingerprints, and richer ranker traces.
- Browser Action observations now carry `BrowserViewGraph` identity/node/edge data, and Semantic Interface maps view node id, region role, graph relation, and view revision evidence into hypotheses.
- `npm run smoke:semantic-interface` covers Browser Action ambiguity, stale/source warnings, typed evidence/ranker traces, Vision read/locate conformance, redaction, deterministic replay, and adversarial fixture classes.
- `docs/reports/semantic-interface-dogfood-evidence-2026-05-08.md` records committed dogfood evidence.

## semantic-memory

Goal: let the local widget improve interpretation from unresolved cases, clarifications, corrections, and repeated instructions through redacted deterministic memory while never granting permissions or bypassing feature-owned safety.

Current progress: 1

Evidence:
- Iteration 16 added `src/daemon/semantic-interface/memory/` with redaction/hash helpers, SQLite-backed memory graph storage, unresolved cases, feedback events, weighted graph deltas, immutable `MemoryReadSet` projections, reports, reset, and ranker memory-axis mapping.
- Storage migration `semantic_memory` creates local memory nodes, edges, unresolved-case, and feedback-event tables without storing full page state or secret values.
- Daemon endpoints cover settings, report, unresolved, feedback, read, and reset paths; renderer Settings exposes enable/disable, counts, refresh, and clear-all controls.
- Browser Action live target resolution reads scoped memory when enabled, records unresolved target cases on clarification, and attaches memory read-set provenance to safety metadata.
- `npm run smoke:semantic-memory` covers redaction, settings, daemon endpoints, read-set hashes, blocked-edge exclusion, Browser Action live read-set plumbing, reset/report, and replay integration.
- `docs/reports/semantic-memory-dogfood-evidence-2026-05-09.md` records redacted dogfood evidence.

## browser-view-graph-v2

Goal: provide Browser Action with a prepared, deterministic, auditable page-understanding model before prompts execute, so target resolution can use view identity, freshness, regions, controls, content lists, forms, affordances, and privacy-safe graph evidence instead of prompt-time DOM matching alone.

Current progress: 1

Evidence:
- Iteration 18 added `src/daemon/browser-perception/view-graph/` with schema-versioned View Graph v2 construction.
- `BrowserObservation.viewGraph` now emits v2 identity, route key, query signature, freshness, regions, controls, content lists, forms, edges, affordance index, diagnostics, and redaction summaries.
- Browser Bridge snapshots include additive DOM path/source order/ARIA/heading/landmark/form/list/visibility/mutation metadata without changing the typed-action abstraction or enabling arbitrary JavaScript as a default action surface.
- ProviderRegistry stores a prepared BrowserObservation and attaches its v2 graph to the DOM snapshot so prompt/direct Browser Action can use fresh prepared graph evidence before falling back to request-time snapshot wait.
- Semantic Interface Browser Action projection receives view action hints, risk hints, list/form ids, freshness, and view revision metadata.
- Representative content target resolution prefers View Graph v2 content-list representative evidence before older heuristics.
- `npm run smoke:browser-view-graph-v2` covers schema shape, stable keys, prepared provider graph attachment, Semantic Interface projection, content-list evidence, forms, redaction, and diagnostics.
- `docs/reports/browser-view-graph-v2-dogfood-evidence-2026-05-10.md` records deterministic dogfood evidence for the generic filter -> reobserve -> representative content flow.
