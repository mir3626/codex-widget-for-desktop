# 02 - Current Implementation Inventory

Status: current-state inventory
Date: 2026-05-16

## Initialization State

The downstream project is initialized:

- `docs/context/product.md` exists and describes `codex-widget-for-desktop`.
- `.vibe/agent/sprint-status.json` exists and has
  `project.name = "codex-widget-for-desktop"`.

This means Codex may continue Orchestrator maintenance work. If either file is
missing or template-owned in a future checkout, stop and run the proper
`vibe-init` workflow before product work.

## Worktree State

The current parity implementation is not clean. A future session must run:

```powershell
git status --short
```

and must not revert unrelated dirty files. Many implementation files and new
dogfood assets are uncommitted by design during this migration.

Known dirty areas include:

- Computer Use daemon runtime and protocol files.
- Browser Action and Browser Chrome routes/adapters.
- Capability runtime, eval ledger, perception graph, scoped autonomy.
- Renderer Computer Use and Autonomy Toolsmith panels.
- Smoke/dogfood/promotion scripts.
- Windows parity handoff docs and reports.
- Dogfood JSON/report assets from 2026-05-16.

## Core Source Hotspots

### Shared Protocol

- `src/shared/protocol/computerUse.ts`
  - Computer Session protocol.
  - Surface kinds.
  - `ComputerAction` and `ComputerStructuredOperation`.
  - Operation kinds such as browser action, browser chrome, terminal command,
    toolsmith, native file picker, visual desktop action, future VM.
  - Add optional fields here when daemon/runtime/renderer need typed payloads.

- `src/shared/protocol/researchArchitecture.ts`
  - Shared research architecture schemas.
  - Eval/perception/failure-memory related data shapes.

- `src/shared/protocol.ts`
  - Shared protocol barrel/union integrations.

### Daemon Computer Use Runtime

- `src/daemon/computer-use/sessionRuntime.ts`
  - Main orchestration runtime.
  - Session lifecycle.
  - Surface decision handling.
  - DAG node creation/update/finalization.
  - Permission evaluation.
  - Browser action execution.
  - Browser chrome execution.
  - Terminal/PT Y operation execution.
  - Toolsmith operation execution.
  - Native watch-mode boundaries.
  - Native file picker boundary.
  - Future VM boundary.
  - Windows settings reversible dogfood guards.
  - Debug bundle assembly.
  - Failure memory and verifier recording.

This file is already very large. Prefer extracting helpers only when a slice
needs it and tests can prove behavior is unchanged.

- `src/daemon/computer-use/surfaceManager.ts`
  - Surface registry.
  - Surface required grants.
  - `foreground_desktop_watch` and `future_vm_session` registration.

- `src/daemon/computer-use/effectVerifier.ts`
  - Effect verification logic and audit records.

### Daemon Routes

- `src/daemon/server/http/routes/computerUseSessionRoutes.ts`
  - Computer Session HTTP routes.
  - Session create/list/get.
  - Operation execution.
  - Debug bundle.
  - Rollback.

- `src/daemon/server/http/routes/computerUseEvalRoutes.ts`
  - Eval/promotion route surface.

- `src/daemon/server/http/routes/browserBridgeRoutes.ts`
  - Browser bridge integration.

### Browser Action / Browser Chrome

- `src/daemon/browser-chrome/commandBridge.ts`
  - Browser Chrome command vocabulary and extension bridge execution.
  - Tab groups, bookmarks, downloads, history, debugger, permissions, file
    upload.

- `providers/browser-dom-extension/bridge/browser-chrome.js`
  - Extension-side execution for Browser Chrome commands.

- `providers/browser-dom-extension/manifest.json`
  - Chrome extension permissions for tabGroups/downloads/history/debugger/
    contentSettings.

- `src/daemon/browser-action/*`
  - Intent resolution, prompt planning/running, capability mirror, eval ledger
    integration.

- `src/daemon/browser-action/adapters/nativeDesktop*`
  - Current bounded native browser-window helper path.
  - This is not general foreground desktop watch-mode.

### Capability Runtime

- `src/daemon/capability-runtime/runtime.ts`
  - Capability job execution.
  - Cancellation and resources.

- `src/daemon/capability-runtime/safety.ts`
  - Safety classifications and approvals.

- `src/daemon/capability-runtime/verification.ts`
  - Capability verification records.

- `src/daemon/capabilities/registerCapabilities.ts`
  - Capability registration.

### Eval, Perception, Storage

- `src/daemon/computer-use-eval/index.ts`
  - Eval ledger storage/records.

- `src/daemon/computer-use-eval/verifierAudit.ts`
  - Verifier audit helpers.

- `src/daemon/perception-graph/index.ts`
  - Evidence graph schema and merge/arbitration.

- `src/daemon/storage/storage.ts`
- `src/daemon/storage/types.ts`
- `src/daemon/storage/blobs.ts`
  - SQLite/blob-backed storage.

### Toolsmith / Scoped Autonomy

- `src/daemon/scoped-autonomy/toolsmithRuntime.ts`
  - Scoped YOLO generated/reviewed tool materialization.
  - Smoke execution.
  - Rerun comparison.
  - Artifact contracts and rollback data.

### Renderer

- `src/renderer/components/ComputerUseSessionsPanel.tsx`
  - Computer Use panel.
  - Session/surface state.
  - Promotion gates.
  - blocked grant chips.
  - artifacts/source quality.
  - rollback actions.

- `src/renderer/components/AutonomyToolsmithPanel.tsx`
  - Toolsmith run details.
  - Stability/rerun/dependency/artifact/rollback summaries.

- `src/renderer/WidgetRuntime.tsx`
- `src/renderer/WidgetRuntimeView.tsx`
- `src/renderer/components/ActivityLog.tsx`
  - Renderer event wiring and Activity details integration.

- `src/renderer/styles/activity-capability.css`
  - Computer Use/Toolsmith panel styling.

## Current Implemented Slices

The current dirty implementation materially includes:

- shared Computer Session protocol,
- session runtime skeleton and execution paths,
- execution surface manager,
- daemon HTTP routes,
- renderer Computer Use panel,
- Browser Action prompt execution through Computer Session,
- isolated Playwright browser surface,
- Browser Chrome deep commands:
  - tab groups,
  - bookmarks,
  - downloads,
  - history,
  - debugger inspect/screenshot/print-to-PDF,
  - file upload inspect/set/clear boundaries,
  - site permissions get/set,
- terminal/PT Y command execution with profile-gated commands,
- Toolsmith web research/artifact integration,
- Toolsmith rerun comparison and renderer history rows,
- session debug bundle,
- perception graph-backed Browser Action target evidence,
- screen observe ROI/tile/cache evidence,
- native browser-window UIA graph evidence,
- broad visual desktop action boundary,
- native file picker boundary,
- future VM boundary,
- Windows settings read-only and bounded reversible HKCU app-registry dogfood,
- session-level effect verifier and recovery records,
- rollback route for safe/generated artifacts,
- browser native helper release-readiness diagnostics,
- promotion gate route and renderer summary.
- renderer one-time permission profile draft preview for blocked runs.
- renderer selected-profile detail and Disable/Expire lifecycle controls.
- renderer selected-profile exact domain/command/write-root grant detail list.
- renderer permission profile manager with all-profile listing, safe one-time
  creation, edit/save, Disable/Expire lifecycle actions, and draft validation
  that blocks credential and persistent high-risk grants.
- renderer Browser Chrome evidence section for download/history/debugger/
  permission/file-upload command rows with redaction and resource summaries.

## Recent Verified Slices

### Autonomy Toolsmith Rerun History UX

Files:

- `src/renderer/components/AutonomyToolsmithPanel.tsx`
- `src/renderer/styles/activity-capability.css`
- `scripts/smoke-renderer-autonomy-rerun-history.mjs`
- `package.json`
- `scripts/smoke-all.mjs`

Evidence:

- renderer shows historical `toolsmith-rerun-comparison.v1` rows.
- smoke fakes daemon payloads and verifies UI rendering.

### Windows Settings Reversible Dogfood

Files:

- `src/daemon/computer-use/sessionRuntime.ts`
- `scripts/smoke-computer-use-windows-settings.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- Windows parity docs.

Behavior:

- Read-only `reg query HKCU\Environment` observation is allowed with redacted
  evidence.
- Broad `reg add HKCU\Environment ...` remains blocked.
- Exact-command reversible smoke path under
  `HKCU\Software\CodexWidgetComputerUseSmoke` can set/query/delete an app-owned
  value when the profile grants `osMutation: true`, `riskClasses:
  ["high_risk"]`, and exact command allowlist.
- Promotion gate includes `windows_settings_reversible_dogfood_boundary`,
  passed but non-promoting.

### Renderer One-Time Profile Draft Preview

Files:

- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `src/renderer/styles/activity-capability.css`
- `scripts/smoke-renderer-computer-use-profile-draft.mjs`
- `package.json`
- `scripts/smoke-all.mjs`

Behavior:

- Blocked runs show the one-time profile draft before attachment.
- The draft displays one-time scope, max use count, credential policy, risk
  classes, browser grants, exact command count, and write-root count.
- Renderer-created profiles continue to derive grants only from missing
  requirements and keep credential access denied.
- Computer Use now also includes a permission profile manager. It lists all
  profiles, keeps new-session selection limited to active profiles, creates a
  safe one-time profile from a validated JSON draft, supports edit/save through
  the profile route, and exposes Disable/Expire lifecycle actions.
- Renderer-side validation blocks credential access and persistent high-risk
  profile drafts before POST.
- Smoke verifies the rendered draft, POSTed one-time profile payload, selected
  profile detail card, exact domain/command/write-root grants, unsafe draft
  blocking, safe one-time manager creation, and lifecycle POST wiring.
- Promotion gate includes `renderer_permission_profile_ux` as a passed but
  non-promoting renderer safety UX gate.

### Renderer Browser Chrome Evidence UX

Files:

- `src/renderer/components/ComputerUseSessionsPanel.tsx`
- `scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs`
- `scripts/gate-computer-use-promotion.mjs`
- `scripts/smoke-computer-use-promotion-gate-route.mjs`
- `package.json`
- `scripts/smoke-all.mjs`

Behavior:

- The Computer Use panel now renders a Browser Chrome evidence section from
  daemon-owned capability jobs, observations, and eval resources.
- Rows show command, status, risk class, verifier label, redaction summary, and
  linked resource roles.
- Download verification surfaces `download_verified_file` evidence with
  basename-only local path redaction.
- History, debugger, permission, and file-upload rows show redaction/minimized
  output summaries without exposing raw paths or browser-private content.
- `smoke:renderer-computer-use-browser-chrome-evidence` verifies the UI using a
  fake daemon bundle covering download, history, debugger print-to-PDF,
  permission mutation, and file upload.
- Promotion gate includes `browser_chrome_deep_action_evidence_ux` as a passed
  but non-promoting renderer evidence UX gate.

## Current Verification Baseline

Recent aggregate verification passed with known notes:

- `npm run lint`
- `npm run smoke:all`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate-route`
- `git diff --check` with known CRLF warnings only.
- UTF/mojibake scan found no mojibake in changed text files.
- No `.cs` files were touched in the recent slices.
- `npm run vibe:checkpoint` passed.

Known non-failing output:

- unsigned browser-native helper development allowance,
- occasional Windows temp cleanup deferred retry,
- CRLF normalization warnings for already-dirty files:
  - `.vibe/agent/session-log.md`
  - `src/daemon/server.ts`
  - `src/daemon/storage/storage.ts`

## Current Gaps

Do not claim these are finished:

- Signed helper v2 is not implemented.
- Native foreground input remains blocked.
- Native file picker selection remains blocked.
- Browser permission bubble visual clicking remains blocked.
- Actual VM/sandbox backend remains blocked.
- Authenticated browser profile/cookie access remains blocked.
- Official app-server custom client tool contract remains blocked.
- Production signing certificate/service remains blocked.
- More live browser dogfood traces are still needed for promotion confidence.

Recently closed gap:

- User-input abort for foreground watch-mode now exists as a non-executing
  preflight boundary with `foreground_watch_user_input_abort` evidence,
  `actualInputSent: false`, smoke coverage, and promotion-gate checks. It is
  not helper v2 foreground input execution.
