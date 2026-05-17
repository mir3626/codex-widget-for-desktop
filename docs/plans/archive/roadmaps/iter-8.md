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
