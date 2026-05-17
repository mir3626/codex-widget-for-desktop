#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(".");
const date = process.env.COMPUTER_USE_PARITY_AUDIT_DATE || localDateString();
const evidenceDir = join(root, "docs", "reports", "assets", `windows-codex-computer-use-parity-audit-${date}`);
const evidencePath = join(evidenceDir, "evidence.json");
const reportPath = join(root, "docs", "reports", `windows-codex-computer-use-parity-audit-${date}.md`);

const packageJson = readJson("package.json") ?? {};
const packageScripts = packageJson.scripts ?? {};
const promotionGate = readPromotionGate();
const checks = [
  ...checkRequiredDocs(),
  ...checkProtocolSessionRuntime(),
  ...checkSurfacesPermissionsSafety(),
  ...checkObservationPerceptionAction(),
  ...checkBrowserToolTerminalSlices(),
  ...checkNativeWatchMode(),
  ...checkEvalDebugUxDogfood(),
  ...checkMigrationVerification()
];

const summary = summarizeChecks(checks);
const evidence = {
  schemaVersion: "windows-codex-computer-use-parity-audit.v1",
  generatedAt: new Date().toISOString(),
  date,
  objectiveFiles: requiredPlanDocs(),
  promotionGateStatus: promotionGate?.summary?.overallStatus ?? "unavailable",
  summary,
  checks,
  openExternalBlockers: [
    "official_app_server_custom_client_tool_contract",
    "production_authenticode_certificate_or_ci_signing_service",
    "unrestricted_credential_flow_or_credential_vault",
    "authenticated_browser_profile_cookie_default_access",
    "signed_watch_mode_helper_v2_for_foreground_native_input",
    "signed_file_picker_helper_v2_for_native_file_picker",
    "real_vm_rdp_windows_sandbox_backend",
    "gpu_asr_validation",
    "human_microphone_asr_corpus_benchmark"
  ]
};

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
writeFileSync(reportPath, renderReport(evidence), "utf8");

console.log(`windows codex computer use parity audit: ${summary.status}`);
for (const [status, count] of Object.entries(summary.counts)) {
  console.log(`${status}: ${count}`);
}
console.log(`evidence: ${relativePath(evidencePath)}`);
console.log(`report: ${relativePath(reportPath)}`);

if (summary.counts.missing > 0) {
  process.exitCode = 1;
}

function checkRequiredDocs() {
  return requiredPlanDocs().map((path) => {
    const exists = existsSync(path);
    const size = exists ? statSync(path).size : 0;
    return check({
      id: `doc:${path.replaceAll("\\", "/")}`,
      requirement: "Required parity handoff document exists and is non-empty.",
      status: exists && size > 0 ? "passed" : "missing",
      evidence: [path],
      notes: exists ? `${size} bytes` : "document missing"
    });
  });
}

function checkProtocolSessionRuntime() {
  const protocol = readText("src/shared/protocol/computerUse.ts");
  const runtime = readText("src/daemon/computer-use/sessionRuntime.ts");
  const routes = readText("src/daemon/server/http/routes/computerUseSessionRoutes.ts");
  const storageTypes = readText("src/daemon/storage/types.ts");
  const storageRuntime = readText("src/daemon/storage/computerUseSessions.ts");
  const storageMigration = readText("src/daemon/storage/migrations/v7ComputerUseSessionSnapshots.ts");
  const sessionSmoke = readText("scripts/smoke-computer-use-session.mjs");
  return [
    containsCheck("runtime:computer-structured-operation", protocol, [
      "browser_action",
      "browser_chrome",
      "terminal",
      "toolsmith",
      "native_file_picker_action",
      "browser_permission_bubble_action",
      "visual_desktop_action"
    ], "ComputerStructuredOperation covers browser, chrome, terminal, toolsmith, native picker, permission bubble, and visual desktop actions.", ["src/shared/protocol/computerUse.ts"]),
    containsCheck("runtime:session-dag-debug-bundle", runtime, [
      "CapabilityDagRuntime",
      "exportDebugBundle",
      "reconcileCompletedCapabilityDagNodes",
      "upsertSessionOperationFollowupDagNodes"
    ], "Computer Session runtime owns DAG execution, debug bundle export, and final job-to-DAG reconciliation.", ["src/daemon/computer-use/sessionRuntime.ts"]),
    containsCheck("runtime:http-routes", routes, [
      "/computer-use/sessions",
      "debug-bundle",
      "browser-action-prompt",
      "/profile"
    ], "Computer Session HTTP routes expose sessions, operations, debug bundles, prompt execution, and profile attachment.", ["src/daemon/server/http/routes/computerUseSessionRoutes.ts"]),
    containsCheck("runtime:session-storage-snapshot", [storageTypes, storageRuntime, storageMigration, runtime, sessionSmoke].join("\n"), [
      "computer_use_sessions",
      "ComputerUseSessionSnapshot",
      "upsertComputerUseSessionSnapshot",
      "readComputerUseSessionSnapshot",
      "listComputerUseSessionSnapshots",
      "hydratePersistedSessions",
      "persistSessionState",
      "reconcileHydratedSession",
      "runtime_restart_reconciliation",
      "computer_session_runtime_restarted",
      "resumedRuntime"
    ], "Computer Session runtime persists session snapshots, hydrates debug-bundle state after runtime recreation, and fail-closed reconciles interrupted active sessions.", [
      "src/daemon/storage/migrations/v7ComputerUseSessionSnapshots.ts",
      "src/daemon/storage/computerUseSessions.ts",
      "src/daemon/computer-use/sessionRuntime.ts",
      "scripts/smoke-computer-use-session.mjs"
    ])
  ];
}

function checkSurfacesPermissionsSafety() {
  const surfaceManager = readText("src/daemon/computer-use/surfaceManager.ts");
  const permissionProfile = readText("src/daemon/scoped-autonomy/permissionProfile.ts");
  const renderer = readText("src/renderer/components/ComputerUseSessionsPanel.tsx");
  return [
    containsCheck("surface:surface-manager", surfaceManager, [
      "isolated_browser",
      "regular_browser_extension",
      "tool_workspace",
      "pty_workspace",
      "foreground_desktop_watch",
      "future_vm_session"
    ], "Surface manager exposes all parity execution surfaces.", ["src/daemon/computer-use/surfaceManager.ts"]),
    containsCheck("permission:profile-evaluator", permissionProfile, [
      "credential",
      "risk_class",
      "browser_automation",
      "filesystem_read",
      "filesystem_write",
      "generated_tool_execution"
    ], "Permission evaluator covers credential denial, risk classes, browser automation, file paths, and generated tool execution.", ["src/daemon/scoped-autonomy/permissionProfile.ts"]),
    containsCheck("renderer:profile-ux", renderer, [
      "Permission profiles",
      "Draft blocked",
      "One-time",
      "credential"
    ], "Renderer exposes permission profile management and one-time profile creation from blocked runs.", ["src/renderer/components/ComputerUseSessionsPanel.tsx"])
  ];
}

function checkObservationPerceptionAction() {
  const perception = readText("src/daemon/perception-graph/index.ts");
  const runtime = readText("src/daemon/computer-use/sessionRuntime.ts");
  const screenObservationRuntime = readText("src/daemon/computer-use/screenObservationRuntime.ts");
  const operationRouting = readText("src/daemon/computer-use/operationRouting.ts");
  const sessionSmoke = readText("scripts/smoke-computer-use-session.mjs");
  const roiRuntimeSource = [runtime, screenObservationRuntime, sessionSmoke].join("\n");
  const actionFallbackSource = [runtime, operationRouting, sessionSmoke].join("\n");
  return [
    containsCheck("perception:graph-sources", perception, [
      "buildPerceptionGraphFromBrowserObservation",
      "buildPerceptionGraphFromNativeObservation",
      "buildPerceptionGraphFromOcr",
      "buildPerceptionGraphFromScreenObservation"
    ], "Perception graph accepts Browser DOM, native/UIA, OCR, and screen observations.", ["src/daemon/perception-graph/index.ts"]),
    containsCheck("perception:roi-cascade-evidence", roiRuntimeSource, [
      "screenTileCache",
      "previousTileHashes",
      "roi",
      "perceptionGraphId"
    ], "Computer Session records ROI/tile cache and graph evidence in observation/action flows.", [
      "src/daemon/computer-use/sessionRuntime.ts",
      "src/daemon/computer-use/screenObservationRuntime.ts",
      "scripts/smoke-computer-use-session.mjs"
    ]),
    containsCheck("action:freshness-and-feedback", runtime, [
      "evaluateOperationFreshnessRequirement",
      "recordBrowserActionFeedback",
      "browser_action_${input.phase}_observation",
      "pre_action",
      "post_action"
    ], "Action execution records freshness checks and before/after feedback evidence.", ["src/daemon/computer-use/sessionRuntime.ts"]),
    containsCheck("action:browser-adapter-fallback", actionFallbackSource, [
      "computer-session-browser-action-adapter-fallback.v1",
      "browser_action_adapter_fallback",
      "createBrowserActionAdapterFallbackPlan",
      "disableAdapterFallback",
      "adapterFallbackAttempt",
      "extension_injected_dom",
      "fallbackCalls"
    ], "Browser Action execution can reroute one retryable adapter failure to a bounded alternate browser adapter with DAG/eval/debug evidence.", [
      "src/daemon/computer-use/sessionRuntime.ts",
      "src/daemon/computer-use/operationRouting.ts",
      "scripts/smoke-computer-use-session.mjs"
    ])
  ];
}

function checkBrowserToolTerminalSlices() {
  const runtime = readText("src/daemon/computer-use/sessionRuntime.ts");
  const terminalArtifactDelta = readText("src/daemon/computer-use/terminalArtifactDelta.ts");
  const terminalSafetyPolicy = readText("src/daemon/computer-use/terminalSafetyPolicy.ts");
  const terminalSmoke = readText("scripts/smoke-computer-use-terminal-parity.mjs");
  const toolsmithRuntime = readText("src/daemon/scoped-autonomy/toolsmithRuntime.ts");
  const toolsmithRedaction = readText("src/daemon/scoped-autonomy/toolsmithRedaction.ts");
  const toolsmithDependencies = readText("src/daemon/scoped-autonomy/toolsmithDependencies.ts");
  const localDocumentConversion = readText("src/daemon/scoped-autonomy/tool-templates/localDocumentConversion.ts");
  const npmDependencySmoke = readText("scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs");
  const npmDependencyDogfood = readText("scripts/collect-scoped-autonomy-npm-dependency-dogfood.mjs");
  const generatedToolLiveBreadthDogfood = readText("scripts/collect-scoped-autonomy-generated-tool-live-breadth-dogfood.mjs");
  const selfImplementationDogfood = readText("scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs");
  const promotionGate = readText("scripts/gate-computer-use-promotion.mjs");
  const terminalSource = [runtime, terminalArtifactDelta, terminalSafetyPolicy, terminalSmoke].join("\n");
  const toolsmithSource = [toolsmithRuntime, toolsmithRedaction, toolsmithDependencies].join("\n");
  return [
    packageScriptCheck("slice:browser-parity-smoke", "smoke:computer-use-browser-parity", "Browser parity smoke is registered."),
    packageScriptCheck("slice:browser-live-dogfood", "dogfood:computer-use-browser-live", "Browser live dogfood collector is registered."),
    packageScriptCheck("slice:browser-chrome-public-dogfood", "dogfood:computer-use-browser-chrome-public-extension", "Public real-extension Browser Chrome dogfood is registered."),
    gateCheck("gate:browser-chrome-public-extension", "browser_chrome_public_extension_dogfood", "passed", "Public real-extension Browser Chrome promotion gate has passed evidence."),
    packageScriptCheck("slice:terminal-parity", "smoke:computer-use-terminal-parity", "Terminal parity smoke is registered."),
    containsCheck("slice:terminal-artifact-delta-manifest", terminalSource, [
      "computer-session-terminal-artifact-delta.v1",
      "terminal_output_root_delta_manifest",
      "readTerminalArtifactRollbackTargets",
      "hasTerminalShellControlOperator",
      "terminal_command_shell_chaining_boundary",
      "stdoutTruncated",
      "terminal_helper_bounded_output",
      "terminal_artifact_deletion_requires_explicit_delete_confirmation",
      "createdCount",
      "modifiedCount",
      "deletedCount",
      "terminalRollback"
    ], "Terminal output-root tracking records path-redacted create/modify/delete delta manifests and keeps generated artifact deletion behind explicit rollback confirmation.", [
      "src/daemon/computer-use/sessionRuntime.ts",
      "src/daemon/computer-use/terminalArtifactDelta.ts",
      "src/daemon/computer-use/terminalSafetyPolicy.ts",
      "scripts/smoke-computer-use-terminal-parity.mjs"
    ]),
    packageScriptCheck("slice:toolsmith-artifact", "smoke:computer-use-toolsmith-artifact", "Toolsmith artifact smoke is registered."),
    packageScriptCheck("slice:scoped-autonomy-self-implementation", "smoke:scoped-autonomy-self-implementation", "Scoped autonomy self-implementation smoke is registered."),
    packageScriptCheck("slice:scoped-autonomy-self-implementation-dogfood", "dogfood:scoped-autonomy-self-implementation", "Scoped autonomy self-implementation breadth dogfood is registered."),
    packageScriptCheck("slice:scoped-autonomy-generated-tool-live-breadth", "dogfood:scoped-autonomy-generated-tool-live-breadth", "Scoped autonomy generated-tool live breadth dogfood is registered."),
    packageScriptCheck("slice:scoped-autonomy-generated-tool-live-breadth-smoke", "smoke:scoped-autonomy-generated-tool-live-breadth", "Scoped autonomy generated-tool live breadth smoke is registered."),
    packageScriptCheck("slice:scoped-autonomy-npm-dependency-dogfood", "dogfood:scoped-autonomy-npm-dependency", "Scoped autonomy npm dependency dogfood is registered."),
    packageScriptCheck("slice:scoped-autonomy-npm-dependency-dogfood-smoke", "smoke:scoped-autonomy-npm-dependency-dogfood", "Scoped autonomy npm dependency dogfood smoke is registered."),
    containsCheck("slice:scoped-autonomy-npm-dependency-redaction", [toolsmithSource, npmDependencySmoke].join("\n"), [
      "redactPathLikeString",
      "file:<redacted>",
      "hasAbsolutePathLeak",
      "completed dependency prepare output must not expose absolute local paths",
      "dependency prepare eval step must not expose absolute local paths"
    ], "Scoped autonomy npm dependency preparation redacts package file paths from tool-run and eval evidence.", [
      "src/daemon/scoped-autonomy/toolsmithRuntime.ts",
      "src/daemon/scoped-autonomy/toolsmithRedaction.ts",
      "scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs"
    ]),
    containsCheck("slice:scoped-autonomy-npm-dependency-execution", [toolsmithSource, npmDependencySmoke].join("\n"), [
      "CODEX_WIDGET_TOOL_DEPENDENCY_ROOT",
      "installedPackages",
      "toolsmith-npm-dependency-execute.v1",
      "dependencyImported",
      "generated tool execution eval step must not expose dependency workspace paths"
    ], "Scoped autonomy npm dependency preparation installs isolated node_modules and generated tool execution can consume it without leaking workspace paths.", [
      "src/daemon/scoped-autonomy/toolsmithRuntime.ts",
      "src/daemon/scoped-autonomy/toolsmithDependencies.ts",
      "scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs"
    ]),
    containsCheck("slice:scoped-autonomy-npm-package-allowlist-policy", [toolsmithSource, npmDependencySmoke, npmDependencyDogfood, promotionGate].join("\n"), [
      "packageAllowlist",
      "toolsmith-dependency-policy-review.v1",
      "dependencyPolicyReviewPresent",
      "npmPackageRequirementValue",
      "External npm package installation requires an exact package allowlist grant.",
      "external npm dependency prepare should require exact package allowlist grant",
      "npm:codex-widget-local-npm-probe@1.3.0"
    ], "Scoped autonomy npm dependency policy blocks external registry packages before install unless an exact package allowlist grant is present.", [
      "src/shared/protocol/scopedAutonomy.ts",
      "src/daemon/scoped-autonomy/permissionProfile.ts",
      "src/daemon/scoped-autonomy/toolsmithRuntime.ts",
      "src/daemon/scoped-autonomy/toolsmithDependencies.ts",
      "scripts/smoke-scoped-autonomy-npm-dependency-prepare.mjs"
    ]),
    containsCheck("slice:scoped-autonomy-local-document-conversion", [toolsmithRuntime, localDocumentConversion, selfImplementationDogfood, generatedToolLiveBreadthDogfood, promotionGate].join("\n"), [
      "local_document_conversion.v1",
      "stage_not_required_for_capability",
      "self-implementation-local-document-conversion",
      "sourceSha256",
      "local_document_conversion"
    ], "Scoped autonomy local document conversion is a dedicated generated-tool slice with skipped web stages, artifact evidence, and promotion-gate coverage.", [
      "src/daemon/scoped-autonomy/toolsmithRuntime.ts",
      "src/daemon/scoped-autonomy/tool-templates/localDocumentConversion.ts",
      "scripts/collect-scoped-autonomy-self-implementation-dogfood.mjs",
      "scripts/gate-computer-use-promotion.mjs"
    ]),
    gateCheck("gate:scoped-autonomy-self-implementation-breadth", "scoped_autonomy_self_implementation_breadth", "passed", "Scoped autonomy self-implementation breadth gate has passed repeated fixture evidence for web/PDF, local document conversion, terminal generated tools, download verification, native blocking, rerun stability, and p95 samples."),
    gateCheck("gate:scoped-autonomy-generated-tool-live-breadth", "scoped_autonomy_generated_tool_live_breadth", "passed", "Scoped autonomy generated-tool live breadth gate has passed repeated live/local-live evidence for web/PDF, local document conversion, terminal generated tools, download verification, rerun stability, p95 samples, and redaction."),
    gateCheck("gate:scoped-autonomy-npm-dependency-dogfood", "scoped_autonomy_npm_dependency_dogfood", "passed", "Scoped autonomy npm dependency dogfood gate has passed repeated package-consuming generated-tool execution evidence with installed package provenance, eval/resource proof, rerun stability, and redaction.")
  ];
}

function checkNativeWatchMode() {
  const protocol = readText("src/shared/protocol/computerUse.ts");
  const runtime = readText("src/daemon/computer-use/sessionRuntime.ts");
  const helper = readText("providers/browser-native-desktop-helper-rs/src/main.rs");
  const adapter = readText("src/daemon/browser-action/adapters/nativeDesktopAdapter.ts");
  const helperClient = readText("src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts");
  const helperNativeSmoke = readText("scripts/smoke-browser-native-desktop-helper-native.mjs");
  const helperContractProbe = readText("scripts/lib/browser-native-desktop-helper-contract.mjs");
  const signingReadinessSmoke = readText("scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs");
  const releaseReadiness = readText("scripts/release-readiness.mjs");
  const adapterSmoke = readText("scripts/smoke-browser-action-native.mjs");
  const nativeWatchSmoke = readText("scripts/smoke-computer-use-native-watch-boundary.mjs");
  return [
    packageScriptCheck("native:watch-boundary-smoke", "smoke:computer-use-native-watch-boundary", "Native watch boundary smoke is registered."),
    gateReasonCheck("native:foreground-input-boundary", "windows_native_watch_boundary", "foreground_input_blocked_before_native_helper", "Foreground input is blocked before native helper execution."),
    gateReasonCheck("native:foreground-preflight-contract", "windows_native_watch_boundary", "foreground_watch_preflight_contract_present", "Foreground watch preflight contract covers target identity, surface lock, and timeout guards."),
    gateReasonCheck("native:active-window-drift-boundary", "windows_native_watch_boundary", "foreground_watch_active_window_drift_abort_smoke_present", "Active-window drift abort is smoke-covered before native input."),
    gateReasonCheck("native:file-picker-boundary", "windows_native_watch_boundary", "native_file_picker_blocked_before_path_disclosure", "Native file picker blocks before local path disclosure."),
    gateReasonCheck("native:permission-bubble-boundary", "windows_native_watch_boundary", "browser_permission_bubble_blocked_before_native_click", "Browser permission bubble native-click blocks before native input."),
    gateReasonCheck("native:signing-deferred", "windows_native_watch_boundary", "native_helper_release_signing_gate_present", "Unsigned helper release signing gate is explicit."),
    gateReasonCheck("native:helper-v2-disabled-command-gate", "windows_native_watch_boundary", "helper_v2_disabled_command_contracts_present", "Helper-v2-only commands have disabled contract evidence in release readiness."),
    packageScriptCheck("native:signing-readiness-smoke", "smoke:browser-native-desktop-helper:signing-readiness", "Native helper signing-readiness smoke is registered."),
    containsCheck("native:helper-contract-release-readiness", [helperContractProbe, signingReadinessSmoke, releaseReadiness].join("\n"), [
      "browser-native-desktop-helper-contract-readiness.v1",
      "probeBrowserNativeDesktopHelperContract",
      "browser-native-helper-contract",
      "browser-native-desktop-helper-foreground-watch-executor.v1",
      "foreground_watch_execute",
      "foregroundWatchExecutor",
      "disabledHelperV2Commands",
      "browser-native-desktop-helper-v2-disabled-command.v1",
      "helper-v2-disabled-${command}-no-input",
      "nativePopupClick",
      "localFilePathDisclosed",
      "watch-preflight-monitor",
      "monitorSampleCount",
      "pathsRedacted",
      "sanitizeDetail",
      "helper contract report must not contain absolute repository paths"
    ], "Release readiness verifies helper manifest, observe-only watch preflight, and bounded monitor evidence before signing/manual release gates.", [
      "scripts/lib/browser-native-desktop-helper-contract.mjs",
      "scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs",
      "scripts/release-readiness.mjs"
    ]),
    containsCheck("native:helper-v2-disabled-command-contracts", [helper, adapter, helperContractProbe, signingReadinessSmoke, helperNativeSmoke, releaseReadiness].join("\n"), [
      "browser-native-desktop-helper-v2-disabled-command.v1",
      "disabledHelperV2Commands",
      "helperV2DisabledContracts",
      "disabledCommandContractsPresent",
      "browser-native-desktop-helper-v2-disabled-contract-probe.v1",
      "file_picker_select",
      "browser_permission_popup_click",
      "capture_screenshot",
      "localFilePathDisclosed",
      "nativePopupClick",
      "screenshotCaptured",
      "clipboardContentLogged",
      "disabledV2Commands"
    ], "Helper-v2-only commands return explicit disabled contracts with no input/path/permission/screenshot/clipboard side effects before signing gates.", [
      "providers/browser-native-desktop-helper-rs/src/main.rs",
      "src/daemon/browser-action/adapters/nativeDesktopAdapter.ts",
      "scripts/lib/browser-native-desktop-helper-contract.mjs",
      "scripts/smoke-browser-native-desktop-helper-signing-readiness.mjs",
      "scripts/smoke-browser-native-desktop-helper-native.mjs",
      "scripts/release-readiness.mjs"
    ]),
    containsCheck("native:foreground-watch-preflight-contract-artifacts", [protocol, runtime, nativeWatchSmoke].join("\n"), [
      "ForegroundWatchPreflightState",
      "ForegroundWatchExecutorState",
      "targetIdentityAsserted",
      "surfaceLockArmed",
      "timeoutArmed",
      "buildDisabledForegroundWatchExecutorState",
      "foregroundWatchExecutor",
      "target_identity_check",
      "surface_lock",
      "timeout_guard",
      "foreground_watch_active_window_drift_abort"
    ], "Foreground watch preflight is a shared protocol contract and records identity, lock, timeout, user-input, and drift abort proof.", [
      "src/shared/protocol/computerUse.ts",
      "src/daemon/computer-use/sessionRuntime.ts",
      "scripts/smoke-computer-use-native-watch-boundary.mjs"
    ]),
    containsCheck("native:helper-v2-capability-manifest", [helper, adapter, helperClient, helperNativeSmoke, adapterSmoke].join("\n"), [
      "browser-native-desktop-helper-capability-manifest.v2",
      "helper_capability_manifest",
      "watch_preflight",
      "readNativeDesktopHelperCapabilityManifest",
      "helperV2Boundary",
      "nativeInputEnabled",
      "actualInputSentForGuardedCommands",
      "helperSideWatchPreflightPresent",
      "helperSideContinuousMonitorPresent",
      "helperSideGuards",
      "monitorMs",
      "foreground_watch_execute",
      "browser-native-desktop-helper-foreground-watch-executor.v1",
      "file_picker_select",
      "browser_permission_popup_click"
    ], "Native helper status exposes a helper-v2 capability manifest while keeping guarded input disabled.", [
      "providers/browser-native-desktop-helper-rs/src/main.rs",
      "src/daemon/browser-action/adapters/nativeDesktopAdapter.ts",
      "src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts",
      "scripts/smoke-browser-native-desktop-helper-native.mjs",
      "scripts/smoke-browser-action-native.mjs"
    ])
  ];
}

function checkEvalDebugUxDogfood() {
  const renderer = readText("src/renderer/components/ComputerUseSessionsPanel.tsx");
  const permissionEvidenceHelpers = readText("src/renderer/components/computer-use/permissionEvidenceHelpers.ts");
  const promotionGateSummary = readText("src/renderer/components/computer-use/promotionGateSummary.ts");
  const evalRoutes = readText("src/daemon/server/http/routes/computerUseEvalRoutes.ts");
  const rendererProofSource = [renderer, permissionEvidenceHelpers, promotionGateSummary].join("\n");
  return [
    packageScriptCheck("eval:promotion-gate", "gate:computer-use-promotion", "Computer Use promotion gate writer is registered."),
    packageScriptCheck("eval:promotion-gate-route", "smoke:computer-use-promotion-gate-route", "Promotion gate route smoke is registered."),
    packageScriptCheck("eval:debug-bundle", "smoke:computer-use-debug-bundle", "Debug bundle smoke is registered."),
    packageScriptCheck("eval:renderer-browser-evidence", "smoke:renderer-computer-use-browser-chrome-evidence", "Renderer Browser Chrome evidence smoke is registered."),
    containsCheck("eval:dogfood-report-links", [evalRoutes, renderer].join("\n"), [
      "/computer-use/eval/dogfood-reports",
      "listLatestDogfoodReports",
      "resolveDogfoodReportPath",
      "Computer Use dogfood report links",
      "Dogfood reports",
      "openDogfoodReport"
    ], "Daemon and renderer expose latest dogfood/report/evidence links through a redacted repo-relative route.", [
      "src/daemon/server/http/routes/computerUseEvalRoutes.ts",
      "src/renderer/components/ComputerUseSessionsPanel.tsx"
    ]),
    containsCheck("renderer:proof-panels", rendererProofSource, [
      "Public extension proof",
      "Toolsmith breadth proof",
      "Toolsmith live breadth proof",
      "Samples",
      "p95",
      "Native boundary proof",
      "Browser Chrome public extension proof",
      "Toolsmith self-implementation breadth proof",
      "Computer Use native boundary proof",
      "Terminal artifact deltas",
      "collectTerminalDeltaEvidenceRows",
      "terminal_output_root_delta_manifest",
      "rollback paths redacted",
      "scoped_autonomy_self_implementation_breadth",
      "foregroundWatchExecutorDisabledPresent",
      "Executor"
    ], "Renderer exposes dedicated public-extension, Toolsmith breadth, native-boundary, and terminal artifact-delta proof panels.", [
      "src/renderer/components/ComputerUseSessionsPanel.tsx",
      "src/renderer/components/computer-use/permissionEvidenceHelpers.ts",
      "src/renderer/components/computer-use/promotionGateSummary.ts"
    ]),
    gateCheck("gate:future-vm-boundary", "future_vm_sandbox_boundary", "passed", "Future VM/sandbox boundary is represented as a non-promoting gate."),
    gateCheck("gate:windows-settings-boundary", "windows_settings_reversible_dogfood_boundary", "passed", "Windows settings reversible dogfood boundary is represented as a non-promoting gate.")
  ];
}

function checkMigrationVerification() {
  return [
    packageScriptCheck("verify:lint", "lint", "Lint/typecheck command is registered."),
    packageScriptCheck("verify:build-daemon", "build:daemon", "Daemon build command is registered."),
    packageScriptCheck("verify:build-web", "build:web", "Web build command is registered."),
    packageScriptCheck("verify:smoke-all", "smoke:all", "Aggregate smoke command is registered."),
    packageScriptCheck("verify:architecture-foundations", "smoke:architecture-foundations", "Architecture foundation smoke is registered."),
    packageScriptCheck("verify:capability-runtime", "smoke:capability-runtime", "Capability runtime smoke is registered."),
    packageScriptCheck("verify:vision-context", "smoke:vision-context", "Vision context smoke is registered.")
  ];
}

function containsCheck(id, text, needles, requirement, evidence) {
  const missing = needles.filter((needle) => !text.includes(needle));
  return check({
    id,
    requirement,
    status: missing.length ? "missing" : "passed",
    evidence,
    notes: missing.length ? `missing markers: ${missing.join(", ")}` : `markers: ${needles.length}`
  });
}

function packageScriptCheck(id, scriptName, requirement) {
  const value = packageScripts[scriptName];
  return check({
    id,
    requirement,
    status: typeof value === "string" && value.trim() ? "passed" : "missing",
    evidence: ["package.json"],
    notes: typeof value === "string" ? value : "script missing"
  });
}

function gateCheck(id, gateId, expectedStatus, requirement) {
  const gate = findGate(gateId);
  return check({
    id,
    requirement,
    status: gate?.status === expectedStatus ? "passed" : "missing",
    evidence: ["scripts/gate-computer-use-promotion.mjs", "docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json"],
    notes: gate ? `${gate.status}; promotable=${gate.promotable}` : "gate missing"
  });
}

function gateReasonCheck(id, gateId, reason, requirement) {
  const gate = findGate(gateId);
  const present = Array.isArray(gate?.reasons) && gate.reasons.includes(reason);
  return check({
    id,
    requirement,
    status: present ? "guarded" : "missing",
    evidence: ["scripts/gate-computer-use-promotion.mjs", "docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json"],
    notes: present ? reason : `reason missing: ${reason}`
  });
}

function check(input) {
  return {
    id: input.id,
    requirement: input.requirement,
    status: input.status,
    evidence: input.evidence ?? [],
    notes: input.notes ?? ""
  };
}

function findGate(id) {
  return promotionGate?.gates?.find((gate) => gate.id === id) ?? null;
}

function readPromotionGate() {
  const result = spawnSync(process.execPath, ["scripts/gate-computer-use-promotion.mjs", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    return {
      summary: { overallStatus: "unavailable" },
      gates: [],
      error: [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return {
      summary: { overallStatus: "unavailable" },
      gates: [],
      error: error instanceof Error ? error.message : "invalid promotion gate JSON"
    };
  }
}

function summarizeChecks(items) {
  const counts = {
    passed: 0,
    guarded: 0,
    blocked: 0,
    missing: 0
  };
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return {
    status: counts.missing > 0 ? "missing_requirements" : counts.blocked > 0 || counts.guarded > 0 ? "implemented_with_guarded_boundaries" : "passed",
    counts,
    total: items.length
  };
}

function renderReport(evidence) {
  const lines = [
    "# Windows Codex Computer Use Parity Audit",
    "",
    `Generated: ${evidence.generatedAt}`,
    "",
    `Status: ${evidence.summary.status}`,
    "",
    "## Summary",
    "",
    `- total: ${evidence.summary.total}`,
    `- passed: ${evidence.summary.counts.passed}`,
    `- guarded: ${evidence.summary.counts.guarded}`,
    `- blocked: ${evidence.summary.counts.blocked}`,
    `- missing: ${evidence.summary.counts.missing}`,
    `- promotion gate: ${evidence.promotionGateStatus}`,
    "",
    "## Checklist",
    "",
    "| Status | ID | Requirement | Evidence | Notes |",
    "|---|---|---|---|---|"
  ];
  for (const item of evidence.checks) {
    lines.push(`| ${item.status} | \`${item.id}\` | ${escapeTable(item.requirement)} | ${escapeTable(item.evidence.join("<br>"))} | ${escapeTable(item.notes)} |`);
  }
  lines.push(
    "",
    "## Open External Blockers",
    "",
    ...evidence.openExternalBlockers.map((blocker) => `- \`${blocker}\``),
    "",
    "This audit is evidence-oriented. Guarded boundaries are intentionally not treated as completed native execution."
  );
  return `${lines.join("\n")}\n`;
}

function requiredPlanDocs() {
  return [
    "docs/plans/windows-codex-computer-use-parity-handoff.md",
    "docs/plans/windows-codex-computer-use-parity/00-overview.md",
    "docs/plans/windows-codex-computer-use-parity/01-contract-session-runtime.md",
    "docs/plans/windows-codex-computer-use-parity/02-surfaces-permissions-safety.md",
    "docs/plans/windows-codex-computer-use-parity/03-observation-perception-action.md",
    "docs/plans/windows-codex-computer-use-parity/04-browser-tool-terminal-slices.md",
    "docs/plans/windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md",
    "docs/plans/windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md",
    "docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md"
  ];
}

function readText(path) {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return "";
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch {
    return null;
  }
}

function relativePath(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).replaceAll("\\", "/") : path.replaceAll("\\", "/");
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function localDateString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
