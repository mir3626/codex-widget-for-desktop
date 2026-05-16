# Windows Codex Computer Use Parity Audit

Generated: 2026-05-16T11:05:48.262Z

Status: implemented_with_guarded_boundaries

## Summary

- total: 68
- passed: 61
- guarded: 7
- blocked: 0
- missing: 0
- promotion gate: promotable

## Checklist

| Status | ID | Requirement | Evidence | Notes |
|---|---|---|---|---|
| passed | `doc:docs/plans/windows-codex-computer-use-parity-handoff.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity-handoff.md | 41766 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/00-overview.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/00-overview.md | 8504 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/01-contract-session-runtime.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/01-contract-session-runtime.md | 7801 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/02-surfaces-permissions-safety.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/02-surfaces-permissions-safety.md | 8218 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/03-observation-perception-action.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/03-observation-perception-action.md | 8883 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/04-browser-tool-terminal-slices.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/04-browser-tool-terminal-slices.md | 10414 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md | 18904 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md | 11775 bytes |
| passed | `doc:docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md` | Required parity handoff document exists and is non-empty. | docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md | 63469 bytes |
| passed | `runtime:computer-structured-operation` | ComputerStructuredOperation covers browser, chrome, terminal, toolsmith, native picker, permission bubble, and visual desktop actions. | src/shared/protocol/computerUse.ts | markers: 7 |
| passed | `runtime:session-dag-debug-bundle` | Computer Session runtime owns DAG execution, debug bundle export, and final job-to-DAG reconciliation. | src/daemon/computer-use/sessionRuntime.ts | markers: 4 |
| passed | `runtime:http-routes` | Computer Session HTTP routes expose sessions, operations, debug bundles, prompt execution, and profile attachment. | src/daemon/server/http/routes/computerUseSessionRoutes.ts | markers: 4 |
| passed | `runtime:session-storage-snapshot` | Computer Session runtime persists session snapshots, hydrates debug-bundle state after runtime recreation, and fail-closed reconciles interrupted active sessions. | src/daemon/storage/migrations/v7ComputerUseSessionSnapshots.ts<br>src/daemon/storage/computerUseSessions.ts<br>src/daemon/computer-use/sessionRuntime.ts<br>scripts/smoke-computer-use-session.mjs | markers: 11 |
| passed | `surface:surface-manager` | Surface manager exposes all parity execution surfaces. | src/daemon/computer-use/surfaceManager.ts | markers: 6 |
| passed | `permission:profile-evaluator` | Permission evaluator covers credential denial, risk classes, browser automation, file paths, and generated tool execution. | src/daemon/scoped-autonomy/permissionProfile.ts | markers: 6 |
| passed | `renderer:profile-ux` | Renderer exposes permission profile management and one-time profile creation from blocked runs. | src/renderer/components/ComputerUseSessionsPanel.tsx | markers: 4 |
| passed | `perception:graph-sources` | Perception graph accepts Browser DOM, native/UIA, OCR, and screen observations. | src/daemon/perception-graph/index.ts | markers: 4 |
| passed | `perception:roi-cascade-evidence` | Computer Session records ROI/tile cache and graph evidence in observation/action flows. | src/daemon/computer-use/sessionRuntime.ts | markers: 4 |
| passed | `action:freshness-and-feedback` | Action execution records freshness checks and before/after feedback evidence. | src/daemon/computer-use/sessionRuntime.ts | markers: 5 |
| passed | `action:browser-adapter-fallback` | Browser Action execution can reroute one retryable adapter failure to a bounded alternate browser adapter with DAG/eval/debug evidence. | src/daemon/computer-use/sessionRuntime.ts<br>scripts/smoke-computer-use-session.mjs | markers: 7 |
| passed | `slice:browser-parity-smoke` | Browser parity smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-computer-use-browser-parity.mjs |
| passed | `slice:browser-live-dogfood` | Browser live dogfood collector is registered. | package.json | npm run build:daemon && node scripts/collect-computer-use-browser-live-dogfood.mjs |
| passed | `slice:browser-chrome-public-dogfood` | Public real-extension Browser Chrome dogfood is registered. | package.json | npm run build:daemon && node scripts/collect-computer-use-browser-chrome-public-extension-dogfood.mjs |
| passed | `gate:browser-chrome-public-extension` | Public real-extension Browser Chrome promotion gate has passed evidence. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | passed; promotable=true |
| passed | `slice:terminal-parity` | Terminal parity smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-computer-use-terminal-parity.mjs |
| passed | `slice:terminal-artifact-delta-manifest` | Terminal output-root tracking records path-redacted create/modify/delete delta manifests and keeps generated artifact deletion behind explicit rollback confirmation. | src/daemon/computer-use/sessionRuntime.ts<br>scripts/smoke-computer-use-terminal-parity.mjs | markers: 12 |
| passed | `slice:toolsmith-artifact` | Toolsmith artifact smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-computer-use-toolsmith-artifact.mjs |
| passed | `slice:scoped-autonomy-self-implementation` | Scoped autonomy self-implementation smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-scoped-autonomy-self-implementation.mjs |
| passed | `slice:scoped-autonomy-self-implementation-dogfood` | Scoped autonomy self-implementation breadth dogfood is registered. | package.json | npm run build:daemon && node scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs |
| passed | `slice:scoped-autonomy-generated-tool-live-breadth` | Scoped autonomy generated-tool live breadth dogfood is registered. | package.json | npm run build:daemon && node scripts/collect-scoped-autonomy-generated-tool-live-breadth-dogfood.mjs |
| passed | `slice:scoped-autonomy-generated-tool-live-breadth-smoke` | Scoped autonomy generated-tool live breadth smoke is registered. | package.json | node scripts/smoke-scoped-autonomy-generated-tool-live-breadth.mjs |
| passed | `slice:scoped-autonomy-npm-dependency-dogfood` | Scoped autonomy npm dependency dogfood is registered. | package.json | npm run build:daemon && node scripts/collect-scoped-autonomy-npm-dependency-dogfood.mjs |
| passed | `slice:scoped-autonomy-npm-dependency-dogfood-smoke` | Scoped autonomy npm dependency dogfood smoke is registered. | package.json | node scripts/smoke-scoped-autonomy-npm-dependency-dogfood.mjs |
| passed | `slice:scoped-autonomy-npm-dependency-redaction` | Scoped autonomy npm dependency preparation redacts package file paths from tool-run and eval evidence. | src/daemon/scoped-autonomy/toolsmithRuntime.ts<br>scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs | markers: 5 |
| passed | `slice:scoped-autonomy-npm-dependency-execution` | Scoped autonomy npm dependency preparation installs isolated node_modules and generated tool execution can consume it without leaking workspace paths. | src/daemon/scoped-autonomy/toolsmithRuntime.ts<br>scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs | markers: 5 |
| passed | `slice:scoped-autonomy-npm-package-allowlist-policy` | Scoped autonomy npm dependency policy blocks external registry packages before install unless an exact package allowlist grant is present. | src/shared/protocol/scopedAutonomy.ts<br>src/daemon/scoped-autonomy/permissionProfile.ts<br>src/daemon/scoped-autonomy/toolsmithRuntime.ts<br>scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs | markers: 7 |
| passed | `slice:scoped-autonomy-local-document-conversion` | Scoped autonomy local document conversion is a dedicated generated-tool slice with skipped web stages, artifact evidence, and promotion-gate coverage. | src/daemon/scoped-autonomy/toolsmithRuntime.ts<br>scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs<br>scripts/gate-computer-use-promotion.mjs | markers: 5 |
| passed | `gate:scoped-autonomy-self-implementation-breadth` | Scoped autonomy self-implementation breadth gate has passed repeated fixture evidence for web/PDF, local document conversion, terminal generated tools, download verification, native blocking, rerun stability, and p95 samples. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | passed; promotable=false |
| passed | `gate:scoped-autonomy-generated-tool-live-breadth` | Scoped autonomy generated-tool live breadth gate has passed repeated live/local-live evidence for web/PDF, local document conversion, terminal generated tools, download verification, rerun stability, p95 samples, and redaction. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | passed; promotable=true |
| passed | `gate:scoped-autonomy-npm-dependency-dogfood` | Scoped autonomy npm dependency dogfood gate has passed repeated package-consuming generated-tool execution evidence with installed package provenance, eval/resource proof, rerun stability, and redaction. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | passed; promotable=false |
| passed | `native:watch-boundary-smoke` | Native watch boundary smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-computer-use-native-watch-boundary.mjs |
| guarded | `native:foreground-input-boundary` | Foreground input is blocked before native helper execution. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | foreground_input_blocked_before_native_helper |
| guarded | `native:foreground-preflight-contract` | Foreground watch preflight contract covers target identity, surface lock, and timeout guards. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | foreground_watch_preflight_contract_present |
| guarded | `native:active-window-drift-boundary` | Active-window drift abort is smoke-covered before native input. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | foreground_watch_active_window_drift_abort_smoke_present |
| guarded | `native:file-picker-boundary` | Native file picker blocks before local path disclosure. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | native_file_picker_blocked_before_path_disclosure |
| guarded | `native:permission-bubble-boundary` | Browser permission bubble native-click blocks before native input. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | browser_permission_bubble_blocked_before_native_click |
| guarded | `native:signing-deferred` | Unsigned helper release signing gate is explicit. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | native_helper_release_signing_gate_present |
| guarded | `native:helper-v2-disabled-command-gate` | Helper-v2-only commands have disabled contract evidence in release readiness. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | helper_v2_disabled_command_contracts_present |
| passed | `native:signing-readiness-smoke` | Native helper signing-readiness smoke is registered. | package.json | npm run build:browser-native-desktop-helper && node scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs |
| passed | `native:helper-contract-release-readiness` | Release readiness verifies helper manifest, observe-only watch preflight, and bounded monitor evidence before signing/manual release gates. | scripts/lib/browser-native-desktop-helper-contract.mjs<br>scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs<br>scripts/release-readiness.mjs | markers: 16 |
| passed | `native:helper-v2-disabled-command-contracts` | Helper-v2-only commands return explicit disabled contracts with no input/path/permission/screenshot/clipboard side effects before signing gates. | providers/browser-native-desktop-helper-rs/src/main.rs<br>src/daemon/browser-action/adapters/nativeDesktopAdapter.ts<br>scripts/lib/browser-native-desktop-helper-contract.mjs<br>scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs<br>scripts/smoke-browser-native-desktop-helper-native.mjs<br>scripts/release-readiness.mjs | markers: 13 |
| passed | `native:foreground-watch-preflight-contract-artifacts` | Foreground watch preflight is a shared protocol contract and records identity, lock, timeout, user-input, and drift abort proof. | src/shared/protocol/computerUse.ts<br>src/daemon/computer-use/sessionRuntime.ts<br>scripts/smoke-computer-use-native-watch-boundary.mjs | markers: 11 |
| passed | `native:helper-v2-capability-manifest` | Native helper status exposes a helper-v2 capability manifest while keeping guarded input disabled. | providers/browser-native-desktop-helper-rs/src/main.rs<br>src/daemon/browser-action/adapters/nativeDesktopAdapter.ts<br>src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts<br>scripts/smoke-browser-native-desktop-helper-native.mjs<br>scripts/smoke-browser-action-native.mjs | markers: 15 |
| passed | `eval:promotion-gate` | Computer Use promotion gate writer is registered. | package.json | node scripts/gate-computer-use-promotion.mjs |
| passed | `eval:promotion-gate-route` | Promotion gate route smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-computer-use-promotion-gate-route.mjs |
| passed | `eval:debug-bundle` | Debug bundle smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-computer-use-debug-bundle.mjs |
| passed | `eval:renderer-browser-evidence` | Renderer Browser Chrome evidence smoke is registered. | package.json | node scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs |
| passed | `eval:dogfood-report-links` | Daemon and renderer expose latest dogfood/report/evidence links through a redacted repo-relative route. | src/daemon/server/http/routes/computerUseEvalRoutes.ts<br>src/renderer/components/ComputerUseSessionsPanel.tsx | markers: 6 |
| passed | `renderer:proof-panels` | Renderer exposes dedicated public-extension, Toolsmith breadth, native-boundary, and terminal artifact-delta proof panels. | src/renderer/components/ComputerUseSessionsPanel.tsx | markers: 16 |
| passed | `gate:future-vm-boundary` | Future VM/sandbox boundary is represented as a non-promoting gate. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | passed; promotable=false |
| passed | `gate:windows-settings-boundary` | Windows settings reversible dogfood boundary is represented as a non-promoting gate. | scripts/gate-computer-use-promotion.mjs<br>docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json | passed; promotable=false |
| passed | `verify:lint` | Lint/typecheck command is registered. | package.json | tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json |
| passed | `verify:build-daemon` | Daemon build command is registered. | package.json | tsc -p tsconfig.node.json |
| passed | `verify:build-web` | Web build command is registered. | package.json | npm run build:browser-native-desktop-helper && npm run build:daemon && npm run build:daemon-bundle && npm run build:renderer && npm run build:node-runtime && npm run build:ocr-runtime && npm run build:pty-runtime |
| passed | `verify:smoke-all` | Aggregate smoke command is registered. | package.json | node scripts/smoke-all.mjs |
| passed | `verify:architecture-foundations` | Architecture foundation smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-architecture-foundations.mjs |
| passed | `verify:capability-runtime` | Capability runtime smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-capability-runtime.mjs |
| passed | `verify:vision-context` | Vision context smoke is registered. | package.json | npm run build:daemon && node scripts/smoke-vision-context.mjs |

## Open External Blockers

- `official_app_server_custom_client_tool_contract`
- `production_authenticode_certificate_or_ci_signing_service`
- `unrestricted_credential_flow_or_credential_vault`
- `authenticated_browser_profile_cookie_default_access`
- `signed_watch_mode_helper_v2_for_foreground_native_input`
- `signed_file_picker_helper_v2_for_native_file_picker`
- `real_vm_rdp_windows_sandbox_backend`
- `gpu_asr_validation`
- `human_microphone_asr_corpus_benchmark`

This audit is evidence-oriented. Guarded boundaries are intentionally not treated as completed native execution.
