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
