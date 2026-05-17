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
