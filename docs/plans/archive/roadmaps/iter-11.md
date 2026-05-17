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
