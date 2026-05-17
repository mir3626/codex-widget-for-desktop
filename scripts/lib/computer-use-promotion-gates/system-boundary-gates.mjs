import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blockedGate } from "./shared.mjs";

export function evaluateWindowsNativeWatchBoundaryGate(latestProcessRun, deferredGates, packageJson, releaseReadiness) {
  const reasons = [];
  if (!latestProcessRun) {
    return blockedGate("windows_native_watch_boundary", "missing_process_validation_evidence", ["missing_30_case_process_validation_evidence"], {});
  }

  const results = Array.isArray(latestProcessRun.data?.results) ? latestProcessRun.data.results : [];
  const byId = new Map(results.map((result) => [result.id, result]));
  const readOnlyObserve = byId.get("windows.settings.theme.read");
  const highRiskReject = byId.get("windows.network.reset.reject");
  const blockedWorkflowIds = [
    "browser.permission.camera-popup",
    "browser.file-picker.upload-resume",
    "windows.settings.night-light.toggle",
    "windows.notepad.open.type-draft",
    "windows.file-explorer.create-rename-folder",
    "windows.notification.permission-popup"
  ];
  const blockedWorkflows = blockedWorkflowIds.map((id) => byId.get(id)).filter(Boolean);
  const missingBlockedWorkflowIds = blockedWorkflowIds.filter((id) => !byId.has(id));
  const blockedWorkflowsSafe = blockedWorkflows.every((result) =>
    result.success === false &&
    (result.status === "blocked" || result.status === "needs_followup") &&
    Array.isArray(result.steps) &&
    result.steps.some((step) =>
      step.kind === "blocked_or_deferred" &&
      step.success === false &&
      /not\s+.*implemented|deferred|outside the current bounded helper|current bounded helper contract|not yet a bounded native workflow|unsupported system mutation|rollback|proof/i.test(String(step.note ?? ""))
    )
  );
  const readOnlyObservePresent = readOnlyObserve?.success === true &&
    readOnlyObserve?.status === "passed" &&
    Array.isArray(readOnlyObserve.steps) &&
    readOnlyObserve.steps.some((step) => step.kind === "desktop_observe" && step.success === true);
  const highRiskRejected = highRiskReject?.success === true &&
    highRiskReject?.status === "passed" &&
    Array.isArray(highRiskReject.steps) &&
    highRiskReject.steps.some((step) => step.kind === "windows_high_risk_rejection" && step.success === true);
  const signingGate = deferredGates?.gates?.["browser-native-helper-signing"];
  const releaseSigningDeferred = signingGate?.status === "deferred" &&
    /unsigned native helpers remain development-only/i.test(String(signingGate.reason ?? ""));
  const smokeScriptPresent = typeof packageJson?.scripts?.["smoke:computer-use-native-watch-boundary"] === "string" &&
    existsSync(join("scripts", "smoke-computer-use-native-watch-boundary.mjs"));
  const smokeAllIncludesBoundary = existsSync(join("scripts", "smoke-all.mjs")) &&
    readFileSync(join("scripts", "smoke-all.mjs"), "utf8").includes("smoke-computer-use-native-watch-boundary.mjs");
  const sessionRuntimeSource = existsSync(join("src", "daemon", "computer-use", "sessionRuntime.ts"))
    ? readFileSync(join("src", "daemon", "computer-use", "sessionRuntime.ts"), "utf8")
    : "";
  const foregroundPreconditionsSource = existsSync(join("src", "daemon", "computer-use", "foregroundPreconditions.ts"))
    ? readFileSync(join("src", "daemon", "computer-use", "foregroundPreconditions.ts"), "utf8")
    : "";
  const computerUseProtocolSource = existsSync(join("src", "shared", "protocol", "computerUse.ts"))
    ? readFileSync(join("src", "shared", "protocol", "computerUse.ts"), "utf8")
    : "";
  const nativeWatchSmokeSource = existsSync(join("scripts", "smoke-computer-use-native-watch-boundary.mjs"))
    ? readFileSync(join("scripts", "smoke-computer-use-native-watch-boundary.mjs"), "utf8")
    : "";
  const nativeBoundarySource = `${sessionRuntimeSource}\n${foregroundPreconditionsSource}`;
  const implementationBoundaryPresent = nativeBoundarySource.includes("foreground_watch_mode_v2_not_available") &&
    nativeBoundarySource.includes("actualInputSent: false");
  const foregroundPreflightContractPresent = computerUseProtocolSource.includes("ForegroundWatchPreflightState") &&
    nativeBoundarySource.includes("targetIdentityAsserted") &&
    nativeBoundarySource.includes("surfaceLockArmed") &&
    nativeBoundarySource.includes("timeoutArmed") &&
    nativeBoundarySource.includes("target_identity_check") &&
    nativeBoundarySource.includes("surface_lock") &&
    nativeBoundarySource.includes("timeout_guard");
  const userInputAbortGuardPresent = nativeBoundarySource.includes("foreground_watch_user_input_abort") &&
    nativeBoundarySource.includes("foreground_watch_preflight") &&
    nativeBoundarySource.includes("userInputDetected") &&
    nativeBoundarySource.includes("abortOnUserInputArmed");
  const userInputAbortSmokePresent = nativeWatchSmokeSource.includes("foreground_watch_user_input_abort") &&
    nativeWatchSmokeSource.includes("userInputDetected") &&
    nativeWatchSmokeSource.includes("abortOnUserInputArmed") &&
    nativeWatchSmokeSource.includes("actualInputSent, false");
  const activeWindowDriftGuardPresent = nativeBoundarySource.includes("foreground_watch_active_window_drift_abort") &&
    nativeBoundarySource.includes("activeWindowDriftDetected") &&
    nativeBoundarySource.includes("active_window_assertion");
  const activeWindowDriftSmokePresent = nativeWatchSmokeSource.includes("foreground_watch_active_window_drift_abort") &&
    nativeWatchSmokeSource.includes("activeWindowDriftDetected") &&
    nativeWatchSmokeSource.includes("active_window_assertion");
  const nativeFilePickerBoundaryPresent = sessionRuntimeSource.includes("native_file_picker_helper_v2_not_available") &&
    sessionRuntimeSource.includes("localFilePathDisclosed: false") &&
    sessionRuntimeSource.includes("native_file_picker_preconditions");
  const nativeFilePickerSmokePresent = nativeWatchSmokeSource.includes("native_file_picker_action") &&
    nativeWatchSmokeSource.includes("localFilePathDisclosed") &&
    nativeWatchSmokeSource.includes("native_file_picker_helper_v2_not_available");
  const browserPermissionBubbleBoundaryPresent = sessionRuntimeSource.includes("browser_permission_bubble_helper_v2_not_available") &&
    sessionRuntimeSource.includes("nativePopupClick: false") &&
    sessionRuntimeSource.includes("browser_permission_bubble_preconditions");
  const browserPermissionBubbleSmokePresent = nativeWatchSmokeSource.includes("browser_permission_bubble_action") &&
    nativeWatchSmokeSource.includes("nativePopupClick") &&
    nativeWatchSmokeSource.includes("browser_permission_bubble_helper_v2_not_available");
  const foregroundWatchExecutor = releaseReadiness?.nativeHelperContract?.evidence?.foregroundWatchExecutor;
  const disabledHelperV2Commands = Array.isArray(releaseReadiness?.nativeHelperContract?.evidence?.disabledHelperV2Commands)
    ? releaseReadiness.nativeHelperContract.evidence.disabledHelperV2Commands
    : [];
  const foregroundWatchExecutorDisabledPresent =
    releaseReadiness?.nativeHelperContract?.schemaVersion === "browser-native-desktop-helper-contract-readiness.v1" &&
    foregroundWatchExecutor?.schemaVersion === "browser-native-desktop-helper-foreground-watch-executor.v1" &&
    foregroundWatchExecutor?.enabled === false &&
    foregroundWatchExecutor?.supported === false &&
    foregroundWatchExecutor?.dryRunOnly === true &&
    foregroundWatchExecutor?.actualInputSent === false &&
    foregroundWatchExecutor?.signedHelperV2Available === false &&
    foregroundWatchExecutor?.releaseGate === "browser-native-helper-signing";
  const disabledHelperV2CommandContractsPresent = ["capture_screenshot", "file_picker_select", "browser_permission_popup_click", "clipboard_set_scoped", "menu_command"].every((command) => {
    const evidence = disabledHelperV2Commands.find((entry) => entry?.command === command);
    if (!evidence ||
      evidence.schemaVersion !== "browser-native-desktop-helper-v2-disabled-command.v1" ||
      evidence.enabled !== false ||
      evidence.supported !== false ||
      evidence.dryRunOnly !== true ||
      evidence.actualInputSent !== false ||
      evidence.signedHelperV2Available !== false ||
      evidence.releaseGate !== "browser-native-helper-signing") {
      return false;
    }
    if (command === "file_picker_select") {
      return evidence.localFilePathDisclosed === false;
    }
    if (command === "browser_permission_popup_click") {
      return evidence.nativePopupClick === false && evidence.permissionChanged === false;
    }
    if (command === "capture_screenshot") {
      return evidence.screenshotCaptured === false;
    }
    if (command === "clipboard_set_scoped") {
      return evidence.clipboardContentLogged === false;
    }
    return true;
  });
  const releaseReadinessPathsRedacted = releaseReadiness?.pathsRedacted === true;

  reasons.push(readOnlyObservePresent ? "read_only_desktop_observe_allowed" : "read_only_desktop_observe_missing");
  reasons.push(highRiskRejected ? "high_risk_windows_mutation_rejected" : "high_risk_windows_mutation_rejection_missing");
  reasons.push(missingBlockedWorkflowIds.length === 0 ? "bounded_native_workflow_fixture_cases_present" : "bounded_native_workflow_fixture_cases_missing");
  reasons.push(blockedWorkflowsSafe ? "unsupported_native_mutations_blocked_by_design" : "unsupported_native_mutation_boundary_missing");
  reasons.push(releaseSigningDeferred ? "native_helper_release_signing_gate_present" : "native_helper_release_signing_gate_missing");
  reasons.push(smokeScriptPresent ? "native_watch_boundary_smoke_present" : "native_watch_boundary_smoke_missing");
  reasons.push(smokeAllIncludesBoundary ? "native_watch_boundary_in_smoke_all" : "native_watch_boundary_not_in_smoke_all");
  reasons.push(implementationBoundaryPresent ? "foreground_input_blocked_before_native_helper" : "foreground_input_boundary_implementation_missing");
  reasons.push(foregroundPreflightContractPresent ? "foreground_watch_preflight_contract_present" : "foreground_watch_preflight_contract_missing");
  reasons.push(userInputAbortGuardPresent ? "foreground_watch_user_input_abort_guard_present" : "foreground_watch_user_input_abort_guard_missing");
  reasons.push(userInputAbortSmokePresent ? "foreground_watch_user_input_abort_smoke_present" : "foreground_watch_user_input_abort_smoke_missing");
  reasons.push(activeWindowDriftGuardPresent ? "foreground_watch_active_window_drift_abort_guard_present" : "foreground_watch_active_window_drift_abort_guard_missing");
  reasons.push(activeWindowDriftSmokePresent ? "foreground_watch_active_window_drift_abort_smoke_present" : "foreground_watch_active_window_drift_abort_smoke_missing");
  reasons.push(nativeFilePickerBoundaryPresent ? "native_file_picker_blocked_before_path_disclosure" : "native_file_picker_boundary_missing");
  reasons.push(nativeFilePickerSmokePresent ? "native_file_picker_boundary_smoke_present" : "native_file_picker_boundary_smoke_missing");
  reasons.push(browserPermissionBubbleBoundaryPresent ? "browser_permission_bubble_blocked_before_native_click" : "browser_permission_bubble_boundary_missing");
  reasons.push(browserPermissionBubbleSmokePresent ? "browser_permission_bubble_boundary_smoke_present" : "browser_permission_bubble_boundary_smoke_missing");
  reasons.push(foregroundWatchExecutorDisabledPresent ? "foreground_watch_executor_disabled_contract_present" : "foreground_watch_executor_disabled_contract_missing");
  reasons.push(disabledHelperV2CommandContractsPresent ? "helper_v2_disabled_command_contracts_present" : "helper_v2_disabled_command_contracts_missing");
  reasons.push(releaseReadinessPathsRedacted ? "native_helper_release_readiness_paths_redacted" : "native_helper_release_readiness_path_redaction_missing");
  reasons.push("foreground_desktop_mutation_not_promotable_until_signed_watch_mode_helper_v2");

  const passed = readOnlyObservePresent &&
    highRiskRejected &&
    missingBlockedWorkflowIds.length === 0 &&
    blockedWorkflowsSafe &&
    releaseSigningDeferred &&
    smokeScriptPresent &&
    smokeAllIncludesBoundary &&
    implementationBoundaryPresent &&
    foregroundPreflightContractPresent &&
    userInputAbortGuardPresent &&
    userInputAbortSmokePresent &&
    activeWindowDriftGuardPresent &&
    activeWindowDriftSmokePresent &&
    nativeFilePickerBoundaryPresent &&
    nativeFilePickerSmokePresent &&
    browserPermissionBubbleBoundaryPresent &&
    browserPermissionBubbleSmokePresent &&
    foregroundWatchExecutorDisabledPresent &&
    disabledHelperV2CommandContractsPresent &&
    releaseReadinessPathsRedacted;

  return {
    id: "windows_native_watch_boundary",
    evidenceClass: "safety_boundary",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "blocked_by_design_release_guard" : "safety_boundary_blocked",
    reasons,
    latestEvidencePath: latestProcessRun.path,
    evidencePaths: [
      latestProcessRun.path,
      "docs/release/deferred-gates.json",
      "dist/reports/release-readiness-latest.json",
      "scripts/smoke-computer-use-native-watch-boundary.mjs"
    ],
    metrics: {
      readOnlyObservePresent,
      highRiskRejected,
      blockedWorkflowCount: blockedWorkflows.length,
      expectedBlockedWorkflowCount: blockedWorkflowIds.length,
      missingBlockedWorkflowIds,
      releaseSigningDeferred,
      smokeScriptPresent,
      smokeAllIncludesBoundary,
      implementationBoundaryPresent,
      foregroundPreflightContractPresent,
      userInputAbortGuardPresent,
      userInputAbortSmokePresent,
      activeWindowDriftGuardPresent,
      activeWindowDriftSmokePresent,
      nativeFilePickerBoundaryPresent,
      nativeFilePickerSmokePresent,
      browserPermissionBubbleBoundaryPresent,
      browserPermissionBubbleSmokePresent,
      foregroundWatchExecutorDisabledPresent,
      disabledHelperV2CommandContractsPresent,
      disabledHelperV2CommandCount: disabledHelperV2Commands.length,
      foregroundWatchExecutorEnabled: foregroundWatchExecutor?.enabled === true,
      foregroundWatchExecutorActualInputSent: foregroundWatchExecutor?.actualInputSent === true,
      releaseReadinessPathsRedacted,
      actualInputSent: false,
      nativePopupClick: false,
      localFilePathDisclosed: false,
      mutationPromotable: false
    }
  };
}

export function evaluateWindowsSettingsReversibleDogfoodBoundaryGate(packageJson) {
  const reasons = [];
  const smokeScriptPresent = typeof packageJson?.scripts?.["smoke:computer-use-windows-settings"] === "string" &&
    existsSync(join("scripts", "smoke-computer-use-windows-settings.mjs"));
  const smokeAllIncludesWindowsSettings = existsSync(join("scripts", "smoke-all.mjs")) &&
    readFileSync(join("scripts", "smoke-all.mjs"), "utf8").includes("smoke-computer-use-windows-settings.mjs");
  const smokeSource = smokeScriptPresent
    ? readFileSync(join("scripts", "smoke-computer-use-windows-settings.mjs"), "utf8")
    : "";
  const sessionRuntimeSource = existsSync(join("src", "daemon", "computer-use", "sessionRuntime.ts"))
    ? readFileSync(join("src", "daemon", "computer-use", "sessionRuntime.ts"), "utf8")
    : "";
  const terminalSafetyPolicySource = existsSync(join("src", "daemon", "computer-use", "terminalSafetyPolicy.ts"))
    ? readFileSync(join("src", "daemon", "computer-use", "terminalSafetyPolicy.ts"), "utf8")
    : "";
  const terminalBoundarySource = `${sessionRuntimeSource}\n${terminalSafetyPolicySource}`;

  const readOnlyCasePresent = smokeSource.includes("reg query HKCU\\\\Environment") &&
    smokeSource.includes("windowsSettingsReadOnly");
  const blockedBroadMutationPresent = smokeSource.includes("HKCU\\\\Environment /v CODEX_WIDGET_BLOCKED_SMOKE") &&
    smokeSource.includes("terminal_command_destructive_boundary");
  const reversibleCasePresent = smokeSource.includes("HKCU\\\\Software\\\\CodexWidgetComputerUseSmoke") &&
    smokeSource.includes("reversibleWindowsSetting") &&
    smokeSource.includes("registryValueExists") &&
    smokeSource.includes("reversibleSetCommand") &&
    smokeSource.includes("reversibleDeleteCommand");
  const reversibleGrantGatePresent = smokeSource.includes("osMutation: true") &&
    smokeSource.includes('riskClasses: ["high_risk"]') &&
    smokeSource.includes("allowPrefixes: [reversibleSetCommand, reversibleQueryCommand, reversibleDeleteCommand]");
  const runtimeBoundaryPresent = terminalBoundarySource.includes("readBoundedReversibleRegistryMutation") &&
    terminalBoundarySource.includes("allowBoundedReversibleRegistryMutation") &&
    terminalBoundarySource.includes("bounded_hkcu_app_registry_reversible") &&
    terminalBoundarySource.includes("HKCU\\\\Software\\\\CodexWidgetComputerUseSmoke") &&
    terminalBoundarySource.includes("terminal_command_destructive_boundary");
  const observationEvidencePresent = terminalBoundarySource.includes("readTerminalObservationEvidence") &&
    smokeSource.includes("observation.metadata?.reversibleRegistryMutation?.action");

  reasons.push(smokeScriptPresent ? "windows_settings_smoke_present" : "windows_settings_smoke_missing");
  reasons.push(smokeAllIncludesWindowsSettings ? "windows_settings_smoke_in_smoke_all" : "windows_settings_smoke_not_in_smoke_all");
  reasons.push(readOnlyCasePresent ? "read_only_registry_observe_case_present" : "read_only_registry_observe_case_missing");
  reasons.push(reversibleCasePresent ? "bounded_reversible_registry_case_present" : "bounded_reversible_registry_case_missing");
  reasons.push(reversibleGrantGatePresent ? "reversible_registry_profile_gate_present" : "reversible_registry_profile_gate_missing");
  reasons.push(runtimeBoundaryPresent ? "runtime_bounded_registry_guard_present" : "runtime_bounded_registry_guard_missing");
  reasons.push(observationEvidencePresent ? "reversible_registry_observation_evidence_present" : "reversible_registry_observation_evidence_missing");
  reasons.push(blockedBroadMutationPresent ? "broad_windows_settings_mutation_blocked" : "broad_windows_settings_mutation_block_missing");
  reasons.push("broad_windows_settings_mutation_not_promotable_until_signed_helper_and_product_rollback_policy");

  const passed = smokeScriptPresent &&
    smokeAllIncludesWindowsSettings &&
    readOnlyCasePresent &&
    reversibleCasePresent &&
    reversibleGrantGatePresent &&
    runtimeBoundaryPresent &&
    observationEvidencePresent &&
    blockedBroadMutationPresent;

  return {
    id: "windows_settings_reversible_dogfood_boundary",
    evidenceClass: "windows_settings_boundary",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "blocked_by_design_reversible_fixture_guard" : "windows_settings_boundary_blocked",
    reasons,
    latestEvidencePath: "scripts/smoke-computer-use-windows-settings.mjs",
    evidencePaths: [
      "scripts/smoke-computer-use-windows-settings.mjs",
      "src/daemon/computer-use/sessionRuntime.ts",
      "src/daemon/computer-use/terminalSafetyPolicy.ts",
      "scripts/smoke-all.mjs"
    ],
    metrics: {
      readOnlyCasePresent,
      reversibleCasePresent,
      reversibleGrantGatePresent,
      runtimeBoundaryPresent,
      observationEvidencePresent,
      blockedBroadMutationPresent,
      smokeAllIncludesWindowsSettings,
      broadWindowsSettingsMutationPromotable: false
    }
  };
}

export function evaluateFutureVmSandboxBoundaryGate(packageJson) {
  const reasons = [];
  const sessionRuntimeSource = existsSync(join("src", "daemon", "computer-use", "sessionRuntime.ts"))
    ? readFileSync(join("src", "daemon", "computer-use", "sessionRuntime.ts"), "utf8")
    : "";
  const surfaceManagerSource = existsSync(join("src", "daemon", "computer-use", "surfaceManager.ts"))
    ? readFileSync(join("src", "daemon", "computer-use", "surfaceManager.ts"), "utf8")
    : "";
  const smokeAllSource = existsSync(join("scripts", "smoke-all.mjs"))
    ? readFileSync(join("scripts", "smoke-all.mjs"), "utf8")
    : "";
  const smokeSource = existsSync(join("scripts", "smoke-computer-use-vm-sandbox-boundary.mjs"))
    ? readFileSync(join("scripts", "smoke-computer-use-vm-sandbox-boundary.mjs"), "utf8")
    : "";

  const surfaceRegistered = surfaceManagerSource.includes("future_vm_session") &&
    surfaceManagerSource.includes("vm.session_backend") &&
    surfaceManagerSource.includes("vm.lifecycle_cleanup");
  const runtimeBoundaryPresent = sessionRuntimeSource.includes("future_vm_session_backend_not_available") &&
    sessionRuntimeSource.includes("vmCreated: false") &&
    sessionRuntimeSource.includes("hostMutationAllowed: false") &&
    sessionRuntimeSource.includes("future_vm_session_preconditions");
  const smokeScriptPresent = typeof packageJson?.scripts?.["smoke:computer-use-vm-sandbox-boundary"] === "string" &&
    existsSync(join("scripts", "smoke-computer-use-vm-sandbox-boundary.mjs"));
  const smokeAllIncludesBoundary = smokeAllSource.includes("smoke-computer-use-vm-sandbox-boundary.mjs");
  const smokeCoversNoVmCreation = smokeSource.includes("future_vm_session_backend_not_available") &&
    smokeSource.includes("vmCreated") &&
    smokeSource.includes("hostMutationAllowed") &&
    smokeSource.includes("capabilityJobs.length, 0");

  reasons.push(surfaceRegistered ? "future_vm_surface_registered_with_vm_grants" : "future_vm_surface_or_grants_missing");
  reasons.push(runtimeBoundaryPresent ? "future_vm_session_blocked_before_backend_creation" : "future_vm_boundary_implementation_missing");
  reasons.push(smokeScriptPresent ? "future_vm_boundary_smoke_present" : "future_vm_boundary_smoke_missing");
  reasons.push(smokeAllIncludesBoundary ? "future_vm_boundary_in_smoke_all" : "future_vm_boundary_not_in_smoke_all");
  reasons.push(smokeCoversNoVmCreation ? "future_vm_smoke_asserts_no_vm_or_host_mutation" : "future_vm_smoke_no_creation_assertion_missing");
  reasons.push("future_vm_not_promotable_until_backend_isolation_lifecycle_exists");

  const passed = surfaceRegistered &&
    runtimeBoundaryPresent &&
    smokeScriptPresent &&
    smokeAllIncludesBoundary &&
    smokeCoversNoVmCreation;

  return {
    id: "future_vm_sandbox_boundary",
    evidenceClass: "safety_boundary",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "blocked_by_design_release_guard" : "safety_boundary_blocked",
    reasons,
    latestEvidencePath: "scripts/smoke-computer-use-vm-sandbox-boundary.mjs",
    evidencePaths: [
      "src/daemon/computer-use/surfaceManager.ts",
      "src/daemon/computer-use/sessionRuntime.ts",
      "scripts/smoke-computer-use-vm-sandbox-boundary.mjs",
      "scripts/smoke-all.mjs"
    ],
    metrics: {
      surfaceRegistered,
      runtimeBoundaryPresent,
      smokeScriptPresent,
      smokeAllIncludesBoundary,
      smokeCoversNoVmCreation,
      vmCreated: false,
      hostMutationAllowed: false,
      vmPromotable: false
    }
  };
}
