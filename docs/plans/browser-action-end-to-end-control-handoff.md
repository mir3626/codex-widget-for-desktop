# Browser Action End-to-End Control Handoff

Status: implemented through `iter-12`; native desktop helper contract is implemented, while live Windows executable UI Automation helper validation remains precisely `BLOCKED`
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Primary dependency: `docs/plans/browser-action-interface-handoff.md`
Current baseline: Iteration `iter-10` completed the production Browser Action interface module, including extension typed actions, Playwright and CDP adapters, native desktop diagnostics boundary, `full_control_dev` evaluate gating, smokes, and first real dogfood evidence.
Primary goal: turn Browser Action from a production daemon interface into a user-visible, prompt-driven browser control experience inside the widget.

## 0. Why This Handoff Exists

The Browser Action Interface now has a real daemon-side actuator core, but the user-facing path is still incomplete:

```text
User prompt -> Agent intent -> Browser Action plan -> approval UI -> adapter execution -> verification -> Agent response
```

The current system proves the adapter/protocol/action machinery through smokes and dogfood scripts. The next work must make that machinery first-class in the live widget so the user can operate browser pages naturally through prompts.

This handoff is authoritative for that end-to-end completion work. It is not a replacement for `browser-action-interface-handoff.md`; it builds on it.

## 1. Product Goal

The product goal is:

```text
Use the widget prompt to safely operate the current browser page.
```

Example user prompts:

- "현재 페이지에서 Learn more 링크 눌러줘."
- "검색창에 codex app-server 입력하고 검색해줘."
- "이 GitHub issue 제목 입력칸만 바꿔줘. 제출은 하지 마."
- "문서 페이지에서 billing 설정을 찾아서 펼쳐줘."
- "이 페이지에서 삭제/결제/제출 같은 위험 액션은 무조건 먼저 물어봐."

The feature should feel like browser computer-use inside the widget, while preserving the Browser Action rule that the normal abstraction is typed, auditable action execution, not arbitrary JavaScript.

## 2. Existing Baseline

Implemented already:

- `src/daemon/browser-action/` core module:
  - sessions
  - observations
  - element graph
  - target resolver
  - safety policy
  - adapter registry/status
  - direct adapter execution
  - stale reobserve/retry
  - audit summaries
  - `full_control_dev` evaluate guard
- Browser extension:
  - snapshot compatibility preserved
  - structured elements
  - typed action execution
  - extension poll/result loop
- Adapters:
  - extension active-tab path
  - Playwright controlled-browser path
  - CDP remote-debugging path
  - Windows native desktop diagnostics boundary
- Protocol:
  - `browserAction.start`
  - `browserAction.adapters`
  - `browserAction.observe`
  - `browserAction.execute`
  - `browserAction.cancel`
  - progress/result/error events
- Verification:
  - `npm run smoke:browser-action`
  - `npm run smoke:browser-action:playwright`
  - `npm run smoke:browser-action:cdp`
  - `npm run smoke:browser-action:evaluate`
  - `npm run smoke:browser-action:native`
  - extension/native-host/DOM/app-server smokes
  - first dogfood report at `docs/reports/browser-action-dogfood-evidence-2026-05-08.md`

Completed in `iter-11`:

- Natural browser prompts can route through a deterministic daemon-side Browser Action tool simulation when a stable Codex app-server custom-tool contract is unavailable.
- Renderer now exposes a thin Browser Action cockpit with adapter status, session controls, safety mode, latest observation, plan/progress/result/error summaries, cancel, and browser-specific policy controls.
- Extension active-tab commands include expected source metadata and expiry; the extension reports actual tab metadata, retries result posts, and surfaces restricted-page/source-mismatch failures.
- Multi-step `BrowserActionPlan` execution supports step-level safety, approval pauses, extension waits, direct adapter execution, reobserve/verify summaries, failure, and cancellation boundaries.
- Browser-specific saved policies are stored in daemon settings by action family, origin, risk class, mode, expiry/revocation, and are applied before execution without persisting secret values.
- Managed Playwright and CDP operating modes remain functional and visible through adapter diagnostics/smokes; unavailable CDP endpoint state is reported explicitly.
- Real E2E dogfood evidence exists at `docs/reports/browser-action-e2e-dogfood-evidence-2026-05-08.md`.

Completed in `iter-12`:

- Added `docs/plans/browser-action-control-surface-handoff.md` as the direct invocation handoff.
- Added shared `browserAction.command` protocol and daemon direct command handling.
- Direct UI commands now reuse the same BrowserActionPlan, safety, approval, adapter, verification, audit, and Activity pipeline as natural-language Browser prompts.
- Renderer has a Vision-like Browser Action popup anchored to the Browser mode button, with direct controls for observe/read/click/type/search/scroll/navigate/back/forward/reload/screenshot/status/session/policy actions.
- Prompt classification now keeps informational Browser Action questions in normal Agent context.
- New smokes cover direct-menu rendering/request dispatch and prompt classification.
- E2E dogfood evidence now includes direct UI-style observe, read, and safe action evidence.

Precisely blocked after `iter-11`:

- Windows executable UI Automation/browser-chrome control is blocked on supplying and validating a scoped helper process. The attempted path is bounded browser-window enumeration through PowerShell `Get-Process`; the implemented daemon boundary now supports `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER` for a typed JSON helper contract, timeout/error normalization, and mock-covered execute evidence. Required external scope remains a signed Rust/.NET/PowerShell UIA/native input helper with cancellation, browser-window scoping, sensitive-field redaction, approval, and audit integration.
- First-class Codex app-server custom Browser Action tools remain blocked on a stable app-server custom-tool/client-tool contract. The implemented fallback is daemon-owned prompt/tool simulation with visible protocol events, approval, action result, Activity audit, and chat response.

## 3. Non-Negotiable Rules

- Do not make arbitrary JavaScript the default action abstraction.
- Keep `evaluate` restricted to explicit `full_control_dev` mode with approval preview, code hash, timeout, result limit, audit metadata, and credential safeguards.
- Browser Action adapters emit normalized observations/results only; they must not render final prompts.
- Prompt-driven Browser Action must not create hidden side effects.
- Low-confidence read/scroll may proceed with uncertainty; low-confidence side-effect actions must clarify.
- Submit, delete, send, post, publish, pay, purchase, auth, password, token, file upload, download, cross-origin side effects, permission prompts, and destructive actions require confirmation unless a safe explicit saved policy covers them.
- Never persist password/token/payment/cookie/credential values.
- Keep implementation aligned with the existing Tauri + React + Node daemon architecture.
- Keep Korean/UTF-8 encoding intact.

## 4. Workstream 1: Agent Tool Contract

Goal: connect natural user prompts to daemon Browser Action requests.

Required design:

- Determine the best current integration path:
  - stable Codex app-server custom tool/client-tool contract if available
  - otherwise daemon-owned simulated tool route with explicit command parsing and visible Browser Action events
- Add an Agent-visible Browser Action capability that can:
  - ask for current observation
  - propose a typed action or multi-step plan
  - request user approval when needed
  - execute through daemon Browser Action
  - return verified result summaries to the chat
- Avoid prompt-only claims. Prefer protocol/tool simulation when a real custom tool path is not stable.

Acceptance:

- A user prompt can request a safe read/scroll/click/type action and produce a Browser Action protocol request.
- The action result is visible in chat and Activity.
- Risky prompt requests produce approval/clarification before execution.
- Fake app-server or live-compatible smoke proves request -> approval -> action -> result -> Agent response flow.
- If Codex app-server cannot expose custom tools, document `BLOCKED` with the attempted path and keep a deterministic daemon-side fallback.

## 5. Workstream 2: Renderer Browser Action UX

Goal: make Browser Action visible, controllable, and debuggable in the widget.

Required UI:

- Adapter status surface:
  - extension
  - Playwright
  - CDP
  - native desktop
- Active Browser Action session state:
  - page title/URL
  - observation freshness
  - selected adapter
  - safety mode
- Action approval UI:
  - action type
  - target summary
  - target confidence
  - risk reason
  - expected effect
  - evaluate code preview/hash in `full_control_dev`
- Action timeline:
  - observe
  - resolve
  - approval
  - execute
  - reobserve
  - verify
  - cancel/error
- Result evidence:
  - before/after URL/title
  - verification status
  - redacted target/action summary
  - optional screenshot asset when captured

Acceptance:

- The user can start/cancel a Browser Action session from the UI.
- Adapter status and unavailable reasons are visible.
- Approval UI is usable for risky actions and evaluate preview.
- Results and failures are visible without opening logs.
- UI remains thin: daemon owns semantics and safety decisions.

## 6. Workstream 3: Extension Action Channel Stability

Goal: make the active-tab extension path reliable enough for real usage.

Required behavior:

- Preserve existing snapshot button behavior and package compatibility.
- Prevent active-tab mismatch:
  - command must include expected tab/window/source metadata where practical
  - extension must report actual tab URL/title before execution
  - daemon must fail or reobserve on mismatch
- Handle Manifest V3 service worker lifetime:
  - polling should not silently miss queued actions
  - result post failures should be retried or surfaced
- Improve frame/shadow DOM handling where practical:
  - identify unsupported frames
  - report frame boundary errors clearly
  - do not bypass browser security
- Normalize restricted page errors:
  - `chrome://`
  - extension pages
  - Web Store pages
  - PDF viewer
  - injection-denied pages

Acceptance:

- Extension smoke covers tab/source mismatch, result-post failure, unsupported page, and command timeout behavior.
- Existing `npm run smoke:extension`, `npm run smoke:browser-native-host`, and `npm run smoke:dom` continue to pass.
- Failed extension actions produce visible Browser Action errors, not silent no-ops.

## 7. Workstream 4: Managed Browser and CDP Operating Model

Goal: make controlled-browser and CDP operation understandable and usable.

Required design:

- Decide adapter modes:
  - active tab via extension
  - managed controlled browser via Playwright or launched Chrome/Edge
  - attach to existing CDP endpoint
- Provide setup/status diagnostics:
  - browser binary found/missing
  - CDP endpoint configured/unconfigured
  - profile path and privacy warnings
  - remote debugging not enabled
- Add managed launch path where practical:
  - start a controlled browser/profile
  - navigate to URL
  - expose its observation/action path to the widget
  - stop/cleanup managed process
- Keep user's default profile safe:
  - do not silently attach to or inspect default profile storage
  - avoid cookie/credential extraction

Acceptance:

- User can choose or understand which adapter is controlling the page.
- Playwright/managed browser smoke proves open -> observe -> action -> verify.
- CDP smoke proves configured attach -> observe -> action -> verify.
- Unavailable CDP/managed browser states are visible in renderer and Activity.

## 8. Workstream 5: Multi-Step Plan Execution

Goal: execute browser tasks as auditable plans, not isolated one-off actions.

Required model:

- `BrowserActionPlan`
- plan steps with:
  - action
  - target summary
  - safety decision
  - expected state
  - status
  - retry/reobserve policy
- plan lifecycle:
  - proposed
  - awaiting approval
  - running
  - paused
  - completed
  - failed
  - cancelled

Required execution:

- Step-level observe/resolve/safety/execute/verify.
- Approval can be:
  - per risky step
  - whole-plan approval for a set of safe steps
  - blocked for destructive/credential actions unless explicit.
- Stop/cancel must interrupt pending and future steps.
- Reobserve/retry once for stale targets when high-confidence recovery is possible.

Acceptance:

- A plan like `type search text -> click search -> verify results` works on a deterministic page.
- A plan pauses for risky step approval.
- A denied step does not execute later steps.
- A stale target reobserve/retry path is covered.
- Plan timeline and final summary are visible in chat/Activity.

## 9. Workstream 6: Browser Safety Permission Policy

Goal: make Browser Action permissive enough for a personal widget while preserving auditable safeguards.

Required policy:

- Browser-specific permission records:
  - action family
  - domain/origin scope
  - target risk class
  - safety mode
  - expiry or revocation
- Integrate with existing execution permissions where possible, but avoid flattening all browser actions into generic shell approvals.
- Support:
  - always ask
  - allow safe read/scroll
  - allow safe click/type on this origin
  - deny destructive actions
  - require confirmation for submit/delete/pay/auth/file actions
- Redaction guarantees:
  - do not persist typed password/token/payment values
  - audit stores target/action summaries, not secret data.

Acceptance:

- Saved Browser Action policies affect future actions predictably.
- Policies are visible/editable in Settings or Browser Action UI.
- Destructive and credential-sensitive actions still require confirmation unless a safe explicit policy exists.
- Tests prove secrets are redacted from audit/history.

## 10. Workstream 7: Windows UI Automation Helper

Goal: add a bounded Windows fallback for browser chrome and restricted-page workflows.

Scope boundary:

- This is not general arbitrary desktop computer-use yet.
- It is a Browser Action fallback for browser windows, browser chrome, permission prompts, file picker boundaries, and pages where DOM injection/CDP cannot act.

Possible implementation paths:

- Windows UI Automation helper process
- bounded native input helper
- screen/Vision Context + UIA hybrid targeting
- OCR fallback for browser chrome labels

Required capabilities:

- enumerate browser windows
- find browser chrome controls where available
- focus browser window
- bounded click/type/hotkey only when target/risk policy allows
- report unsupported state clearly
- stop/cancel in-flight actions
- audit without storing screenshots or sensitive text by default
- route typed helper requests through a deterministic JSON contract when `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER` is configured

Acceptance:

- Helper availability diagnostics are visible.
- Unit/smoke coverage proves:
  - unavailable path
  - browser window enumeration
  - configured helper observe/execute contract
  - cancellation
  - safety block/confirm decisions
  - no arbitrary desktop action outside Browser Action scope
- If live executable control requires Rust/.NET/PowerShell helper scope expansion beyond the typed contract, record `BLOCKED` with attempted path and required helper design.

## 11. Workstream 8: Real Dogfood Matrix

Goal: prove Browser Action quality on realistic tasks, not only deterministic smokes.

Dogfood matrix should include:

- public documentation search/read
- real website link expansion/navigation
- non-submitting form fill
- settings page expand/collapse
- GitHub issue or repo read task
- GitHub field edit up to pre-submit state
- controlled browser task with screenshot evidence
- CDP configured attach task
- extension active-tab task
- risky action approval/deny test
- restricted page unsupported-boundary test

Evidence requirements:

- report path:
  - `docs/reports/browser-action-e2e-dogfood-evidence-<date>.md`
- supporting assets where needed:
  - redacted JSON transcript
  - screenshots only when safe
- record:
  - initial observation
  - plan
  - target resolution
  - safety decision
  - action transcript
  - verification result
  - failure notes
  - whether the task was semantically successful

Acceptance:

- At least one real extension active-tab dogfood task.
- At least one real Playwright/managed browser dogfood task.
- At least one CDP dogfood task or precise unavailable evidence.
- At least one risky-action approval/deny task.
- At least one prompt-driven Agent Browser Action task.
- Semantic acceptance is not marked complete based only on type/build/smoke checks.

## 12. Workstream 9: Request-Scoped Fresh Observation and View Graph

Goal: make prompt-driven Browser Action accurate on tab switches, same-tab navigation, SPAs, hydration drift, and duplicate-label pages.

This is now a required production workstream. Periodic DOM polling and "latest snapshot" are insufficient because a user prompt can arrive while the daemon still holds a previous page, previous route, or pre-hydration view. Browser Action must first obtain a request-scoped current observation, then validate and execute against that view.

Required transport:

- Add a long-poll command channel for the extension:
  - extension opens `/browser-action/extension/wait`
  - daemon holds until `observe_now`, action, cancel, or timeout
  - extension immediately opens the next wait request after each response
  - existing alarm polling remains a fallback
- Do not make WebSocket the only production command path. MV3 service-worker suspension makes always-on sockets fragile; WebSocket can be added later as an optional fast path.

Required fresh observation:

- Prompt/direct Browser Action starts with `observe_now`.
- The observation must include tab/window/document/view identity, URL/title, ready state, capture time, and mutation stability where available.
- Daemon must reject or wait on mismatched observations instead of resolving against stale DOM.
- Same-tab navigation and SPA route changes must invalidate stale observations even when `tabId` remains unchanged.

Required View Graph:

- Extension maintains a current-view semantic graph:
  - regions: header, nav, sidebar, main, modal, form, list, table
  - nodes: controls, fields, links, content items, rows, cards
  - edges: contains, labels, same_group, filters, submits, navigates_to
  - state: focus, route revision, DOM revision, mutation quietness
- Content script tracks:
  - `history.pushState`
  - `history.replaceState`
  - `popstate`
  - `hashchange`
  - DOM mutations
  - focus/selection/form value changes
- Snapshot carries digests:
  - route digest
  - visible text digest
  - interactive element digest
  - optional layout digest

Required execution contract:

- Browser Action commands carry:
  - selected node id
  - original semantic target reference
  - expected view identity
  - expected digest
- Extension checks current view identity before executing.
- If stale, extension returns `stale_view` or `stale_target`.
- Daemon reobserves and re-resolves once for safe recoverable actions.
- Low-confidence side-effect actions still clarify.

Acceptance:

- Tab switch immediately followed by a prompt does not use the previous tab snapshot.
- Same-tab navigation immediately followed by a prompt waits for or requests the new document/view.
- React/SPA fixture route changes invalidate stale observations even without full reload.
- Duplicate visible labels resolve by region/affordance, not just text.
- Modal/form/list fixtures prove View Graph edges improve target choice.
- Dogfood evidence includes at least one real or local SPA task with route/mutation-driven view changes.

## 13. Recommended Implementation Order

1. Agent Tool Contract
2. Renderer Browser Action UX
3. Multi-Step Plan Execution
4. Browser Safety Permission Policy
5. Extension Action Channel Stability
6. Request-Scoped Fresh Observation and View Graph
7. Managed Browser and CDP Operating Model
8. Windows UI Automation Helper
9. Real Dogfood Matrix

Reasoning:

- The product value appears when prompts can drive actions.
- UI and plan execution must exist before broader dogfood can be meaningful.
- Extension stability must include request-scoped fresh observation and View Graph before real dynamic pages are reliable.
- Managed/CDP stability can then be hardened against real workflows.
- Windows UI Automation should stay bounded by Browser Action semantics.
- Dogfood evidence should close the loop only after the live path exists.

## 13.1 Iteration iter-11 Completion Record

Workstream status:

1. Agent Tool Contract: implemented through deterministic daemon-side prompt/tool simulation. Stable app-server custom tools are `BLOCKED` on upstream contract availability, but prompt -> plan -> action -> Agent response is covered by `npm run smoke:browser-action:e2e-control`.
2. Renderer Browser Action UX: implemented as `BrowserActionPanel` embedded in browser mode with adapter status, start/observe/cancel, safety mode, policy controls, plan/progress/result/error summaries, and existing approval cards for risky/evaluate actions.
3. Extension Action Channel Stability: implemented source matching, expected/actual tab metadata, command expiry, restricted-page errors, result-post retry, and smoke markers while preserving snapshot packaging compatibility.
4. Managed Browser and CDP Operating Model: Playwright controlled-browser and CDP remote-debugging adapters remain functional through existing smokes; renderer adapter status now exposes unavailable reasons.
5. Multi-Step Plan Execution: implemented `executePlan` with step statuses, safety/policy decisions, approval/extension pauses, direct-adapter execution, result ids, reobserve/verify events, failure, and cancellation boundaries.
6. Browser Safety Permission Policy: implemented browser-specific policies under daemon app settings with allow/ask/deny by action family, origin, risk, mode, expiry, revocation, and secret redaction helpers.
7. Windows UI Automation Helper: bounded diagnostics plus the native helper JSON contract are implemented; executable live browser chrome/restricted-page fallback is `BLOCKED` until a scoped helper executable is supplied and validated, with attempted path and required helper scope recorded in native adapter diagnostics and smoke coverage.
8. Real Dogfood Matrix: implemented `npm run dogfood:browser-action:e2e`, producing prompt-driven, extension-channel, risky-deny, non-submit-fill, real Playwright navigation, CDP-unavailable, native-boundary, and restricted-page evidence.

Post-`iter-15` required expansion:

- Workstream 9 is open and required. Dogfood showed that latest-snapshot semantics can still use the wrong page after tab switches or before SPA/page updates settle. This must be addressed with request-scoped fresh observation, long-poll delivery, document/view identity, View Graph, and execute-time stale-view validation before Browser Action is considered production-accurate on dynamic sites.

New evidence:

- `scripts/smoke-browser-action-e2e-control.mjs`
- `scripts/smoke-browser-action-renderer.mjs`
- `scripts/collect-browser-action-e2e-dogfood-evidence.mjs`
- `docs/reports/browser-action-e2e-dogfood-evidence-2026-05-08.md`
- `docs/reports/assets/browser-action-e2e-dogfood-2026-05-08/evidence.json`
- `docs/reports/assets/browser-action-e2e-dogfood-2026-05-08/example-com-before.png`

## 13. Verification Gate

Required commands unless a workstream records a precise `BLOCKED` item:

```text
npm run lint
npm run build:web
npm run smoke
npm run smoke:browser-action
npm run smoke:browser-action:playwright
npm run smoke:browser-action:cdp
npm run smoke:browser-action:evaluate
npm run smoke:browser-action:native
npm run smoke:browser-action:e2e-control
npm run smoke:browser-action:renderer
npm run smoke:extension
npm run smoke:browser-native-host
npm run smoke:dom
npm run smoke:app-server
npm run dogfood:browser-action
npm run dogfood:browser-action:e2e
new prompt-driven Browser Action smokes
new multi-step plan smokes
new Browser Action renderer UX smoke
new extension channel robustness smokes
new Browser Action policy smokes
new Windows UIA/native helper smokes where implemented
applicable cargo checks for touched Tauri/Rust code
UTF-8/mojibake checks
npm run vibe:checkpoint
```

## 14. Completion Criteria

This goal is complete only when:

- The widget prompt can initiate Browser Action through a real or deterministic simulated Agent tool path.
- Browser Action UI exposes adapter status, session state, approval, progress, result, error, and cancel.
- Extension active-tab action channel is robust against tab/source mismatch, unsupported pages, timeouts, and result-post failures.
- Managed browser/CDP operation is documented, testable, and visible to the user.
- Multi-step Browser Action plans execute with step-level safety, approval, retry, verification, and cancellation.
- Browser-specific saved safety policies exist and are tested.
- Windows UI Automation/native fallback is implemented to the maximum practical Browser Action scope, or precise `BLOCKED` records identify required helper scope.
- A real dogfood matrix proves prompt-driven and adapter-driven semantic usefulness.
- All durable context files reflect the final state:
  - `.vibe/agent/handoff.md`
  - `.vibe/agent/session-log.md`
  - `.vibe/agent/sprint-status.json`
  - `.vibe/agent/iteration-history.json`
  - `docs/plans/sprint-roadmap.md`
  - `docs/plans/project-milestones.md`
  - `docs/reports/project-report.html`

## 15. Stop Conditions

- Stop only when all eight workstreams are implemented and verified, or when a real blocker requires scope expansion.
- If blocked, record:
  - item
  - reason
  - attempted path
  - required scope expansion
  - verification evidence for the blocked state
- Do not silently downgrade production requirements to MVP.
