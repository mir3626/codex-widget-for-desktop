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
