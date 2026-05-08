# Browser Action Control Surface Handoff

Status: implemented through `iter-12`
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Baseline handoffs:
- `docs/plans/browser-action-interface-handoff.md`
- `docs/plans/browser-action-end-to-end-control-handoff.md`

## 0. Purpose

`iter-11` completed the daemon-side prompt/tool simulation and Browser Action E2E baseline. The remaining product gap is the direct user control surface: Browser Action should be callable from a compact popup/menu, similar to the Vision menu, and natural-language Browser mode prompts should continue to use the same daemon plan/safety/approval/adapter/verify/audit path.

This document is authoritative for `iter-12`.

## 1. Product Goal

Browser Action must be usable in two first-class ways:

1. Direct UI invocation from a Vision-like popup near Browser mode controls.
2. Natural-language execution from Browser mode prompts.

Both paths must normalize into `BrowserActionPlan` execution. The UI must stay thin: the daemon owns semantics, safety, approval, adapter selection, verification, and audit records.

## 2. Direct UI Contract

The renderer sends deterministic direct commands to the daemon. The daemon either returns adapter/status data, observes the page, or builds and executes a `BrowserActionPlan`.

Required direct command families:

- adapter status
- observe current page
- read page
- click target
- type/fill target
- search
- scroll
- navigate URL
- back
- forward
- reload
- screenshot
- start/cancel session
- saved safety policy controls
- adapter setup/status diagnostics for extension, Playwright, CDP, and native desktop

`full_control_dev` evaluate remains hidden by default. It is available only through the existing explicit full-control path with approval preview, hash, timeout, result limit, and credential safeguards.

## 3. Natural-Language Contract

Browser mode prompts may request Browser Action tasks naturally. Prompt parsing must cover:

- direct action requests
- adapter hints
- target hints
- safe form-fill requests
- navigation/search/read tasks
- risky-action clarification

Informational prompts such as "what can Browser Action do?" and "브라우저 액션 기능 알려줘" must stay in the normal Agent/app-server context and must not execute browser actions.

## 4. Renderer UX

The UI should mirror the Vision popup pattern:

- anchored to the Browser mode button or adjacent Browser control
- compact, not a dashboard
- direct action icon/button rows
- adapter selector and status list
- target/text/URL fields sized for widget width
- start/cancel/session controls
- policy quick controls
- result/progress/errors remain visible through existing Browser Action panel and Activity records

The existing Browser Action panel may remain as the status/result cockpit, but direct invocation belongs in the popup/menu.

## 5. Daemon/Protocol Requirements

Add protocol support for direct UI commands where missing. Direct UI commands must:

- reuse existing `BrowserActionSessionManager`
- reuse `BrowserActionPlan` execution
- reuse saved browser policy checks
- reuse approval events for risky actions
- reuse extension queue/result and direct adapter execution
- broadcast the same normalized `browserAction.plan`, `browserAction.progress`, `browserAction.result`, and `browserAction.error` events
- record audit/activity summaries without sensitive page state

## 6. Adapter Requirements

- Extension path works from current snapshot/observe state.
- Playwright direct actions are callable where available.
- CDP direct actions expose configured/unavailable state clearly.
- Native Windows fallback exposes diagnostics and retains the existing UIA helper `BLOCKED` boundary until a helper exists.

## 7. Safety Requirements

- No hidden side effects.
- Low-confidence read/scroll may proceed with uncertainty.
- Low-confidence side-effect actions clarify.
- Submit/delete/send/post/publish/pay/purchase/auth/password/token/file upload/download/cross-origin side effects/permission prompts require confirmation unless an explicit safe policy covers them.
- Never persist password/token/payment/cookie/credential values.
- `evaluate` remains explicit `full_control_dev` only.

## 8. Acceptance Criteria

- Browser Action has a Vision-like popup/menu for direct invocation.
- Direct UI actions can start a session, observe, read, execute safe actions, request approval for risky actions, cancel, and show result/error/progress through existing Browser Action surfaces.
- Natural-language Browser mode prompts can execute Browser Action tasks without manual protocol use.
- Informational Browser Action prompts are not misclassified as execution.
- Adapter status and unavailable reasons are visible for extension, Playwright, CDP, and native fallback.
- Direct UI and natural-language paths both use daemon Browser Action plan/safety/approval/adapter/verify/audit pipeline.
- Renderer smoke proves the popup renders and sends direct action requests.
- Daemon smoke proves direct UI request -> plan -> approval/execute -> result.
- Prompt smoke proves classification boundaries.
- Existing extension snapshot behavior and Browser Action adapter smokes remain passing.
- Dogfood evidence is updated with direct UI observe/read, direct UI safe action, natural-language safe action, risky approval/deny, CDP status, Playwright action, and extension active-tab action.

## 9. Planned Sprints

### iter-12-sprint-01-control-surface-handoff-and-command-contract

Create this handoff, append roadmap/iteration state, add direct command protocol/types, and add deterministic command-to-plan builders.

Status: complete.

### iter-12-sprint-02-daemon-direct-command-pipeline

Handle `browserAction.command` in the daemon by reusing session start, observe, plan execution, policies, approval, extension queue, adapter execution, result, audit, and Activity paths.

Status: complete.

### iter-12-sprint-03-browser-action-popup-ui

Add the Vision-like Browser Action menu near Browser mode controls with direct controls and adapter/status/policy visibility.

Status: complete.

### iter-12-sprint-04-verification-and-dogfood-evidence

Add direct-menu and prompt-classification smokes, refresh E2E dogfood evidence, update durable context, run required verification, and push if verification passes.

Status: complete.

## 9.1 Iteration iter-12 Completion Record

Implemented:

- Shared `browserAction.command` protocol and `BrowserActionDirectCommandInput`.
- Daemon direct command builder in `src/daemon/browser-action/directCommand.ts`.
- Daemon WebSocket command handler that starts or reuses sessions, observes through extension/adapter paths, builds `BrowserActionPlan`, executes via existing safety/policy/approval/adapter/verify/audit pipeline, and broadcasts normalized plan/progress/result/error events.
- Vision-like `BrowserActionMenu` anchored to the Browser mode button.
- Direct menu controls for adapter status, observe, read, click, type/fill, search, scroll, navigate, back, forward, reload, screenshot, start/cancel, safety mode, and quick policy changes.
- Prompt-classification hardening so informational Browser Action questions stay out of execution.
- Direct-menu renderer smoke and prompt-classification smoke.
- Updated E2E control smoke and dogfood evidence with direct UI observe/read/safe-action coverage.

Verification evidence:

- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-action:renderer`
- `npm run smoke:browser-action:direct-menu`
- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-action:playwright`
- `npm run smoke:browser-action:cdp`
- `npm run smoke:browser-action:evaluate`
- `npm run smoke:browser-action:native`
- `npm run smoke:extension`
- `npm run smoke:browser-native-host`
- `npm run smoke:dom`
- `npm run smoke:app-server`
- `npm run dogfood:browser-action`
- `npm run dogfood:browser-action:e2e`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`

Still precisely blocked from prior Browser Action scope:

- First-class Codex app-server custom Browser Action tools remain blocked on a stable app-server custom tool/client-tool contract.
- Executable Windows UI Automation/browser-chrome fallback remains blocked on a scoped helper process.

## 10. Completion/BLOCKED Rules

This iteration is complete only when direct UI invocation and natural-language Browser Action execution are both implemented and verified. If a production requirement depends on unavailable OS APIs, browser restrictions, unstable Codex app-server custom tools, or external setup, record `BLOCKED` with item, reason, attempted path, required scope expansion, and verification evidence.
