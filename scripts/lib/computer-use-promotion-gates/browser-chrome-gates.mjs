import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blockedGate, hasSensitiveLiteral, normalizeEvidencePath } from "./shared.mjs";

export function evaluateBrowserBridgeRestrictedReloadBoundaryGate(latestProcessRun, packageJson) {
  const reasons = [];
  if (!latestProcessRun) {
    return blockedGate("browser_bridge_restricted_reload_boundary", "missing_process_validation_evidence", ["missing_30_case_process_validation_evidence"], {});
  }

  const results = Array.isArray(latestProcessRun.data?.results) ? latestProcessRun.data.results : [];
  const byId = new Map(results.map((result) => [result.id, result]));
  const restrictedReload = byId.get("browser.restricted.extensions.reload");
  const restrictedReloadCasePresent = Boolean(restrictedReload);
  const restrictedReloadBlocked = restrictedReload?.success === false &&
    restrictedReload?.status === "blocked" &&
    restrictedReload?.risk === "restricted_surface" &&
    Array.isArray(restrictedReload.steps) &&
    restrictedReload.steps.some((step) =>
      step.kind === "blocked_or_deferred" &&
      step.success === false &&
      /restricted browser pages|security boundary|manual extension UI|extension reload/i.test(String(step.note ?? ""))
    );

  const bridgeSmokeScriptPresent = typeof packageJson?.scripts?.["smoke:browser-bridge"] === "string" &&
    existsSync(join("scripts", "smoke-browser-extension-bridge.mjs"));
  const bridgeSmokeSource = bridgeSmokeScriptPresent
    ? readFileSync(join("scripts", "smoke-browser-extension-bridge.mjs"), "utf8")
    : "";
  const extensionSmokeSource = existsSync(join("scripts", "smoke-browser-extension.mjs"))
    ? readFileSync(join("scripts", "smoke-browser-extension.mjs"), "utf8")
    : "";
  const popupSource = existsSync(join("providers", "browser-dom-extension", "popup.js"))
    ? readFileSync(join("providers", "browser-dom-extension", "popup.js"), "utf8")
    : "";
  const popupHtml = existsSync(join("providers", "browser-dom-extension", "popup.html"))
    ? readFileSync(join("providers", "browser-dom-extension", "popup.html"), "utf8")
    : "";
  const browserActionMenuSource = existsSync(join("src", "renderer", "components", "BrowserActionMenu.tsx"))
    ? readFileSync(join("src", "renderer", "components", "BrowserActionMenu.tsx"), "utf8")
    : "";
  const browserActionPanelSource = existsSync(join("src", "renderer", "components", "BrowserActionPanel.tsx"))
    ? readFileSync(join("src", "renderer", "components", "BrowserActionPanel.tsx"), "utf8")
    : "";
  const extensionActionChannelSource = existsSync(join("providers", "browser-dom-extension", "bridge", "action-channel.js"))
    ? readFileSync(join("providers", "browser-dom-extension", "bridge", "action-channel.js"), "utf8")
    : "";

  const bridgeStatusSmokeCoversReloadRequired = bridgeSmokeSource.includes("reloadRequired === true") &&
    bridgeSmokeSource.includes("stale bridge build heartbeat");
  const bridgeStatusSmokeCoversPermissionNeeded = bridgeSmokeSource.includes('mode: "permission_needed"') &&
    bridgeSmokeSource.includes("needs_site_permission");
  const bridgeStatusSmokeCoversRestricted = bridgeSmokeSource.includes('mode: "restricted"') &&
    bridgeSmokeSource.includes('permission: "restricted"');
  const extensionPopupReloadUxPresent = extensionSmokeSource.includes("Reload bridge") &&
    extensionSmokeSource.includes("chrome.runtime.reload") &&
    extensionSmokeSource.includes('id="reload-extension"') &&
    popupHtml.includes("Reload bridge") &&
    popupSource.includes("chrome.runtime.reload") &&
    popupSource.includes("reloadRequired");
  const rendererRecoveryGuidancePresent = browserActionMenuSource.includes("Reload bridge") &&
    browserActionMenuSource.includes("Restricted page") &&
    browserActionPanelSource.includes("reload needed") &&
    browserActionPanelSource.includes("restrictedBridgeDetail");
  const restrictedBypassBlocked = extensionActionChannelSource.includes("assertTabCanRunBrowserAction") &&
    extensionActionChannelSource.includes("restricted_page") &&
    extensionActionChannelSource.includes("Browser Action is not available on restricted browser pages");
  const smokeAllIncludesBridge = existsSync(join("scripts", "smoke-all.mjs")) &&
    readFileSync(join("scripts", "smoke-all.mjs"), "utf8").includes("smoke-browser-extension-bridge.mjs");

  reasons.push(restrictedReloadCasePresent ? "restricted_reload_fixture_case_present" : "restricted_reload_fixture_case_missing");
  reasons.push(restrictedReloadBlocked ? "restricted_reload_blocked_by_design" : "restricted_reload_not_safely_blocked");
  reasons.push(bridgeSmokeScriptPresent ? "browser_bridge_status_smoke_present" : "browser_bridge_status_smoke_missing");
  reasons.push(bridgeStatusSmokeCoversReloadRequired ? "reload_required_status_smoke_present" : "reload_required_status_smoke_missing");
  reasons.push(bridgeStatusSmokeCoversPermissionNeeded ? "permission_needed_status_smoke_present" : "permission_needed_status_smoke_missing");
  reasons.push(bridgeStatusSmokeCoversRestricted ? "restricted_status_smoke_present" : "restricted_status_smoke_missing");
  reasons.push(extensionPopupReloadUxPresent ? "extension_popup_reload_ux_present" : "extension_popup_reload_ux_missing");
  reasons.push(rendererRecoveryGuidancePresent ? "renderer_recovery_guidance_present" : "renderer_recovery_guidance_missing");
  reasons.push(restrictedBypassBlocked ? "restricted_page_bypass_blocked" : "restricted_page_bypass_guard_missing");
  reasons.push(smokeAllIncludesBridge ? "browser_bridge_smoke_in_smoke_all" : "browser_bridge_smoke_not_in_smoke_all");
  reasons.push("restricted_reload_not_promotable_as_unattended_browser_chrome_mutation");

  const passed = restrictedReloadCasePresent &&
    restrictedReloadBlocked &&
    bridgeSmokeScriptPresent &&
    bridgeStatusSmokeCoversReloadRequired &&
    bridgeStatusSmokeCoversPermissionNeeded &&
    bridgeStatusSmokeCoversRestricted &&
    extensionPopupReloadUxPresent &&
    rendererRecoveryGuidancePresent &&
    restrictedBypassBlocked &&
    smokeAllIncludesBridge;

  return {
    id: "browser_bridge_restricted_reload_boundary",
    evidenceClass: "browser_bridge_boundary",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "blocked_by_design_recovery_guard" : "browser_bridge_boundary_blocked",
    reasons,
    latestEvidencePath: latestProcessRun.path,
    evidencePaths: [
      latestProcessRun.path,
      "scripts/smoke-browser-extension-bridge.mjs",
      "scripts/smoke-browser-extension.mjs",
      "providers/browser-dom-extension/popup.html",
      "providers/browser-dom-extension/popup.js",
      "providers/browser-dom-extension/bridge/action-channel.js",
      "src/renderer/components/BrowserActionMenu.tsx",
      "src/renderer/components/BrowserActionPanel.tsx"
    ],
    metrics: {
      restrictedReloadCasePresent,
      restrictedReloadBlocked,
      bridgeSmokeScriptPresent,
      bridgeStatusSmokeCoversReloadRequired,
      bridgeStatusSmokeCoversPermissionNeeded,
      bridgeStatusSmokeCoversRestricted,
      extensionPopupReloadUxPresent,
      rendererRecoveryGuidancePresent,
      restrictedBypassBlocked,
      smokeAllIncludesBridge,
      unattendedReloadPromotable: false
    }
  };
}

export function evaluateRendererPermissionProfileUxGate(packageJson) {
  const reasons = [];
  const panelPath = join("src", "renderer", "components", "ComputerUseSessionsPanel.tsx");
  const permissionHelpersPath = join("src", "renderer", "components", "computer-use", "permissionEvidenceHelpers.ts");
  const smokePath = join("scripts", "smoke-renderer-computer-use-profile-draft.mjs");
  const smokeAllPath = join("scripts", "smoke-all.mjs");
  const panelSource = existsSync(panelPath) ? readFileSync(panelPath, "utf8") : "";
  const permissionHelpersSource = existsSync(permissionHelpersPath) ? readFileSync(permissionHelpersPath, "utf8") : "";
  const smokeSource = existsSync(smokePath) ? readFileSync(smokePath, "utf8") : "";
  const smokeAllSource = existsSync(smokeAllPath) ? readFileSync(smokeAllPath, "utf8") : "";
  const rendererProfileSource = `${panelSource}\n${permissionHelpersSource}`;

  const smokeScriptPresent = typeof packageJson?.scripts?.["smoke:renderer-computer-use-profile-draft"] === "string" &&
    existsSync(smokePath);
  const smokeAllIncludesProfileSmoke = smokeAllSource.includes("smoke-renderer-computer-use-profile-draft.mjs");
  const managerUiPresent = panelSource.includes("Permission profile manager") &&
    panelSource.includes("Computer Use permission profile JSON editor") &&
    panelSource.includes("Managed permission profile");
  const allProfileListPresent = panelSource.includes("/computer-use/autonomy/profiles?limit=50") &&
    panelSource.includes("activeProfiles");
  const lifecycleControlsPresent = panelSource.includes("updateManagedProfileStatus") &&
    panelSource.includes("Disable selected permission profile") &&
    panelSource.includes("Expire selected permission profile");
  const rendererValidationPresent = rendererProfileSource.includes("validateManagedProfileDraft") &&
    rendererProfileSource.includes("Credential access must remain never.") &&
    rendererProfileSource.includes("Persistent profiles cannot add high-risk");
  const smokeCoversBlockedUnsafeDraft = smokeSource.includes("Unsafe persistent profile") &&
    smokeSource.includes("Profile draft blocked") &&
    smokeSource.includes('credentialAccess: "ask"');
  const smokeCoversSafeCreate = smokeSource.includes("profile-managed-renderer") &&
    smokeSource.includes("managedCreatedProfileBody") &&
    smokeSource.includes("Profile created: Computer Use one-time profile");
  const smokeCoversLifecyclePost = smokeSource.includes("Disable selected permission profile") &&
    smokeSource.includes("updatedProfileBody?.status");

  reasons.push(smokeScriptPresent ? "renderer_profile_smoke_present" : "renderer_profile_smoke_missing");
  reasons.push(smokeAllIncludesProfileSmoke ? "renderer_profile_smoke_in_smoke_all" : "renderer_profile_smoke_not_in_smoke_all");
  reasons.push(managerUiPresent ? "profile_manager_ui_present" : "profile_manager_ui_missing");
  reasons.push(allProfileListPresent ? "profile_manager_lists_all_profiles_but_session_uses_active" : "profile_list_or_active_filter_missing");
  reasons.push(lifecycleControlsPresent ? "profile_lifecycle_controls_present" : "profile_lifecycle_controls_missing");
  reasons.push(rendererValidationPresent ? "renderer_profile_validation_blocks_credential_persistent_high_risk" : "renderer_profile_validation_missing");
  reasons.push(smokeCoversBlockedUnsafeDraft ? "smoke_blocks_unsafe_persistent_credential_draft" : "smoke_unsafe_draft_block_missing");
  reasons.push(smokeCoversSafeCreate ? "smoke_creates_safe_one_time_profile" : "smoke_safe_profile_create_missing");
  reasons.push(smokeCoversLifecyclePost ? "smoke_covers_profile_lifecycle_post" : "smoke_profile_lifecycle_post_missing");

  const passed = smokeScriptPresent &&
    smokeAllIncludesProfileSmoke &&
    managerUiPresent &&
    allProfileListPresent &&
    lifecycleControlsPresent &&
    rendererValidationPresent &&
    smokeCoversBlockedUnsafeDraft &&
    smokeCoversSafeCreate &&
    smokeCoversLifecyclePost;

  return {
    id: "renderer_permission_profile_ux",
    evidenceClass: "renderer_smoke",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "renderer_safety_ux_gate_passed_live_gate_required" : "renderer_safety_ux_blocked",
    reasons,
    latestEvidencePath: "scripts/smoke-renderer-computer-use-profile-draft.mjs",
    evidencePaths: [
      "src/renderer/components/ComputerUseSessionsPanel.tsx",
      "src/renderer/components/computer-use/permissionEvidenceHelpers.ts",
      "scripts/smoke-renderer-computer-use-profile-draft.mjs",
      "scripts/smoke-all.mjs"
    ],
    metrics: {
      smokeScriptPresent,
      smokeAllIncludesProfileSmoke,
      managerUiPresent,
      allProfileListPresent,
      lifecycleControlsPresent,
      rendererValidationPresent,
      smokeCoversBlockedUnsafeDraft,
      smokeCoversSafeCreate,
      smokeCoversLifecyclePost,
      credentialsAutoGrantAllowed: false,
      persistentHighRiskAutoGrantAllowed: false
    }
  };
}

export function evaluateBrowserChromeDeepActionEvidenceUxGate(packageJson) {
  const reasons = [];
  const panelPath = join("src", "renderer", "components", "ComputerUseSessionsPanel.tsx");
  const permissionHelpersPath = join("src", "renderer", "components", "computer-use", "permissionEvidenceHelpers.ts");
  const smokePath = join("scripts", "smoke-renderer-computer-use-browser-chrome-evidence.mjs");
  const smokeAllPath = join("scripts", "smoke-all.mjs");
  const panelSource = existsSync(panelPath) ? readFileSync(panelPath, "utf8") : "";
  const permissionHelpersSource = existsSync(permissionHelpersPath) ? readFileSync(permissionHelpersPath, "utf8") : "";
  const smokeSource = existsSync(smokePath) ? readFileSync(smokePath, "utf8") : "";
  const smokeAllSource = existsSync(smokeAllPath) ? readFileSync(smokeAllPath, "utf8") : "";
  const rendererEvidenceSource = `${panelSource}\n${permissionHelpersSource}`;

  const smokeScriptPresent = typeof packageJson?.scripts?.["smoke:renderer-computer-use-browser-chrome-evidence"] === "string" &&
    existsSync(smokePath);
  const smokeAllIncludesEvidenceSmoke = smokeAllSource.includes("smoke-renderer-computer-use-browser-chrome-evidence.mjs");
  const rendererEvidenceSectionPresent = panelSource.includes("Browser Chrome evidence") &&
    panelSource.includes("collectBrowserChromeEvidenceRows") &&
    permissionHelpersSource.includes("summarizeBrowserChromeRedaction");
  const rendererCoversDeepCommands = rendererEvidenceSource.includes("download.verify") ||
    (rendererEvidenceSource.includes("download.") && rendererEvidenceSource.includes("history.") && rendererEvidenceSource.includes("debugger.") && rendererEvidenceSource.includes("file_upload."));
  const rendererRedactionSummaryPresent = rendererEvidenceSource.includes("basename-only redacted") &&
    rendererEvidenceSource.includes("history/path redacted") &&
    rendererEvidenceSource.includes("local path redacted");
  const smokeCoversDownloadEvidence = smokeSource.includes("download.verify") &&
    smokeSource.includes("download_verified_file") &&
    smokeSource.includes("basename-only redacted");
  const smokeCoversHistoryDebuggerPermissionUpload = smokeSource.includes("history.search") &&
    smokeSource.includes("debugger.print_to_pdf") &&
    smokeSource.includes("permission.set") &&
    smokeSource.includes("file_upload.set_files");
  const smokeCoversRedactionProof = (smokeSource.includes("history/path redacted") || smokeSource.includes("history\\/path redacted")) &&
    smokeSource.includes("pathRedacted") &&
    smokeSource.includes("localPaths: \"basename_only\"");

  reasons.push(smokeScriptPresent ? "browser_chrome_renderer_evidence_smoke_present" : "browser_chrome_renderer_evidence_smoke_missing");
  reasons.push(smokeAllIncludesEvidenceSmoke ? "browser_chrome_renderer_evidence_smoke_in_smoke_all" : "browser_chrome_renderer_evidence_smoke_not_in_smoke_all");
  reasons.push(rendererEvidenceSectionPresent ? "renderer_browser_chrome_evidence_section_present" : "renderer_browser_chrome_evidence_section_missing");
  reasons.push(rendererCoversDeepCommands ? "renderer_browser_chrome_deep_command_summaries_present" : "renderer_browser_chrome_deep_command_summaries_missing");
  reasons.push(rendererRedactionSummaryPresent ? "renderer_browser_chrome_redaction_summary_present" : "renderer_browser_chrome_redaction_summary_missing");
  reasons.push(smokeCoversDownloadEvidence ? "smoke_covers_download_artifact_evidence" : "smoke_download_artifact_evidence_missing");
  reasons.push(smokeCoversHistoryDebuggerPermissionUpload ? "smoke_covers_history_debugger_permission_upload_evidence" : "smoke_deep_action_evidence_missing");
  reasons.push(smokeCoversRedactionProof ? "smoke_covers_path_redaction_proof" : "smoke_path_redaction_proof_missing");

  const passed = smokeScriptPresent &&
    smokeAllIncludesEvidenceSmoke &&
    rendererEvidenceSectionPresent &&
    rendererCoversDeepCommands &&
    rendererRedactionSummaryPresent &&
    smokeCoversDownloadEvidence &&
    smokeCoversHistoryDebuggerPermissionUpload &&
    smokeCoversRedactionProof;

  return {
    id: "browser_chrome_deep_action_evidence_ux",
    evidenceClass: "renderer_smoke",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "renderer_evidence_ux_gate_passed_live_gate_required" : "renderer_evidence_ux_blocked",
    reasons,
    latestEvidencePath: "scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs",
    evidencePaths: [
      "src/renderer/components/ComputerUseSessionsPanel.tsx",
      "src/renderer/components/computer-use/permissionEvidenceHelpers.ts",
      "scripts/smoke-renderer-computer-use-browser-chrome-evidence.mjs",
      "scripts/smoke-all.mjs"
    ],
    metrics: {
      smokeScriptPresent,
      smokeAllIncludesEvidenceSmoke,
      rendererEvidenceSectionPresent,
      rendererCoversDeepCommands,
      rendererRedactionSummaryPresent,
      smokeCoversDownloadEvidence,
      smokeCoversHistoryDebuggerPermissionUpload,
      smokeCoversRedactionProof,
      arbitraryDebuggerCdpAllowed: false,
      localPathEvidencePolicy: "basename_or_path_redacted"
    }
  };
}

export function evaluateBrowserChromeRepeatedDogfoodGate(runs, sampleLedger) {
  const reasons = [];
  const latest = runs.at(-1) ?? null;
  if (!latest) {
    return blockedGate("browser_chrome_repeated_dogfood", "missing_browser_chrome_dogfood_evidence", ["missing_browser_chrome_dogfood_evidence"], {});
  }

  const metrics = latest.data?.metrics ?? {};
  const scenarios = Array.isArray(latest.data?.scenarios) ? latest.data.scenarios : [];
  const latestRunId = latest.data?.runId;
  const latestSamples = sampleLedger.samples.filter((sample) => latestRunId
    ? sample.runId === latestRunId
    : normalizeEvidencePath(sample.evidencePath).endsWith(normalizeEvidencePath(latest.path))
  );
  const commandSet = new Set([
    ...scenarios.map((scenario) => scenario.command).filter(Boolean),
    ...latestSamples.map((sample) => sample.scenario?.command).filter(Boolean)
  ]);
  const successfulSamples = latestSamples.filter((sample) => sample.scenario?.success === true);
  const successfulScenarioCount = scenarios.filter((scenario) => scenario.success === true).length;
  const p95Values = latestSamples
    .map((sample) => Number(sample.scenario?.p95LatencyMs ?? sample.scenario?.elapsedMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  const redactionSamples = latestSamples.map((sample) => JSON.stringify(sample.scenario?.redaction ?? {}));

  const schemaValid = latest.data?.schemaVersion === "computer-use-browser-chrome-dogfood.v1";
  const fixtureBridge = metrics.fixtureBridge === true && latest.data?.evidenceClass === "fixture_bridge_repeated_dogfood";
  const repeatedSamples = metrics.repeatedSamples === true && Number(metrics.sampleCount ?? 0) >= 4 && latestSamples.length >= 4;
  const successRatePerfect = Number(metrics.successRate ?? 0) === 1 &&
    Number(metrics.successCount ?? 0) === Number(metrics.sampleCount ?? -1) &&
    successfulScenarioCount === scenarios.length &&
    successfulSamples.length >= Number(metrics.sampleCount ?? 0);
  const downloadVerifyCovered = metrics.downloadVerifyCovered === true &&
    commandSet.has("download.verify") &&
    scenarios.some((scenario) =>
      scenario.command === "download.verify" &&
      scenario.success === true &&
      Array.isArray(scenario.result?.resourceRoles) &&
      scenario.result.resourceRoles.includes("download_verified_file")
    );
  const debuggerPrintPdfCovered = metrics.debuggerPrintPdfCovered === true &&
    commandSet.has("debugger.print_to_pdf") &&
    scenarios.some((scenario) => scenario.command === "debugger.print_to_pdf" && scenario.success === true);
  const redactionProofPresent = metrics.redactionProofPresent === true &&
    redactionSamples.some((sample) => sample.includes("basename_only")) &&
    redactionSamples.some((sample) => sample.includes("path_redacted") || sample.includes("pathRedacted"));
  const cleanupReconciled = metrics.cleanupRollbackCompleted === true &&
    scenarios.every((scenario) => scenario.result?.cleanupRollbackCompleted === true) &&
    latestSamples.every((sample) => sample.scenario?.cleanupRollbackCompleted === true);
  const verifierAndEvalEvidencePresent = scenarios.every((scenario) =>
    Number(scenario.result?.verifierNodeCount ?? 0) >= Number(scenario.result?.sampleCount ?? 1) &&
    Number(scenario.result?.evalLedgerNodeCount ?? 0) >= Number(scenario.result?.sampleCount ?? 1)
  );
  const noSensitiveLiteral = !hasSensitiveLiteral(latest.data) && latestSamples.every((sample) => !hasSensitiveLiteral(sample));
  const p95Present = Number(metrics.p95LatencyMs ?? 0) > 0 && p95Values.length >= latestSamples.length;

  reasons.push(schemaValid ? "browser_chrome_dogfood_schema_valid" : "browser_chrome_dogfood_schema_invalid");
  reasons.push(fixtureBridge ? "fixture_bridge_evidence_class_present" : "fixture_bridge_evidence_class_missing");
  reasons.push(repeatedSamples ? "repeated_browser_chrome_samples_present" : "insufficient_browser_chrome_samples");
  reasons.push(successRatePerfect ? "all_browser_chrome_samples_succeeded" : "browser_chrome_sample_failure_present");
  reasons.push(downloadVerifyCovered ? "download_verify_resource_evidence_present" : "download_verify_resource_evidence_missing");
  reasons.push(debuggerPrintPdfCovered ? "debugger_print_to_pdf_evidence_present" : "debugger_print_to_pdf_evidence_missing");
  reasons.push(redactionProofPresent ? "download_and_debugger_redaction_proof_present" : "redaction_proof_missing");
  reasons.push(cleanupReconciled ? "browser_chrome_cleanup_reconciled" : "browser_chrome_cleanup_not_reconciled");
  reasons.push(verifierAndEvalEvidencePresent ? "browser_chrome_verifier_and_eval_nodes_present" : "browser_chrome_verifier_or_eval_nodes_missing");
  reasons.push(noSensitiveLiteral ? "redacted_browser_chrome_dogfood_only" : "sensitive_literal_detected");
  reasons.push(p95Present ? "browser_chrome_p95_samples_present" : "browser_chrome_p95_samples_missing");
  reasons.push("fixture_bridge_dogfood_needs_real_extension_live_gate_before_promotion");

  const passed = schemaValid &&
    fixtureBridge &&
    repeatedSamples &&
    successRatePerfect &&
    downloadVerifyCovered &&
    debuggerPrintPdfCovered &&
    redactionProofPresent &&
    cleanupReconciled &&
    verifierAndEvalEvidencePresent &&
    noSensitiveLiteral &&
    p95Present;

  return {
    id: "browser_chrome_repeated_dogfood",
    evidenceClass: "fixture_bridge_repeated_dogfood",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "fixture_bridge_gate_passed_live_extension_gate_required" : "fixture_bridge_gate_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: runs.map((run) => run.path),
    sampleLedgerPath: sampleLedger.path,
    metrics: {
      schemaValid,
      fixtureBridge,
      sampleCount: Number(metrics.sampleCount ?? latestSamples.length),
      latestSampleCount: latestSamples.length,
      successCount: Number(metrics.successCount ?? successfulSamples.length),
      latestSuccessfulSampleCount: successfulSamples.length,
      successRate: Number(metrics.successRate ?? 0),
      p95LatencyMs: Number(metrics.p95LatencyMs ?? 0),
      commandCount: commandSet.size,
      commands: [...commandSet],
      downloadVerifyCovered,
      debuggerPrintPdfCovered,
      redactionProofPresent,
      cleanupReconciled,
      verifierAndEvalEvidencePresent,
      arbitraryDebuggerCdpAllowed: false,
      promotable: false
    }
  };
}

export function evaluateBrowserChromeLiveExtensionDogfoodGate(runs, sampleLedger) {
  const reasons = [];
  const latest = runs.at(-1) ?? null;
  if (!latest) {
    return blockedGate("browser_chrome_live_extension_dogfood", "missing_browser_chrome_live_extension_evidence", ["missing_browser_chrome_live_extension_evidence"], {});
  }

  const metrics = latest.data?.metrics ?? {};
  const scenarios = Array.isArray(latest.data?.scenarios) ? latest.data.scenarios : [];
  const latestRunId = latest.data?.runId;
  const latestSamples = sampleLedger.samples.filter((sample) => latestRunId
    ? sample.runId === latestRunId
    : normalizeEvidencePath(sample.evidencePath).endsWith(normalizeEvidencePath(latest.path))
  );
  const commandSet = new Set([
    ...scenarios.map((scenario) => scenario.command).filter(Boolean),
    ...latestSamples.map((sample) => sample.scenario?.command).filter(Boolean)
  ]);
  const successfulSamples = latestSamples.filter((sample) => sample.scenario?.success === true);
  const p95Values = latestSamples
    .map((sample) => Number(sample.scenario?.p95LatencyMs ?? sample.scenario?.elapsedMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  const redactionText = [
    ...scenarios.map((scenario) => JSON.stringify(scenario.result?.redaction ?? {})),
    ...latestSamples.map((sample) => JSON.stringify(sample.scenario?.redaction ?? {}))
  ].join("\n");

  const schemaValid = latest.data?.schemaVersion === "computer-use-browser-chrome-live-extension-dogfood.v1";
  const realExtensionLocalFixture = latest.data?.evidenceClass === "real_extension_local_fixture" &&
    latest.data?.extension?.browserApiExecution === true &&
    metrics.realExtension === true &&
    metrics.localFixture === true;
  const samplesPresent = Number(metrics.sampleCount ?? 0) >= 2 && latestSamples.length >= 2;
  const successRatePerfect = Number(metrics.successRate ?? 0) === 1 &&
    Number(metrics.successCount ?? 0) === Number(metrics.sampleCount ?? -1) &&
    scenarios.every((scenario) => scenario.success === true) &&
    successfulSamples.length >= Number(metrics.sampleCount ?? 0);
  const downloadStartVerifyCovered = metrics.downloadVerifyCovered === true &&
    commandSet.has("download.start+download.verify") &&
    scenarios.some((scenario) =>
      scenario.command === "download.start+download.verify" &&
      scenario.success === true &&
      Array.isArray(scenario.result?.resourceRoles) &&
      scenario.result.resourceRoles.includes("download_verified_file")
    );
  const debuggerPrintPdfCovered = metrics.debuggerPrintPdfCovered === true &&
    commandSet.has("debugger.print_to_pdf") &&
    scenarios.some((scenario) =>
      scenario.command === "debugger.print_to_pdf" &&
      scenario.success === true &&
      Number(scenario.result?.byteLength ?? 0) > 0 &&
      scenario.result?.dataOmitted === true
    );
  const redactionProofPresent = metrics.redactionProofPresent === true &&
    redactionText.includes("basename_only") &&
    redactionText.includes("rawPdfBytesInReport") &&
    redactionText.includes("arbitraryCdpEvalAllowed");
  const cleanupReconciled = metrics.cleanupReconciled === true &&
    scenarios.every((scenario) => scenario.result?.cleanupReconciled === true) &&
    latestSamples.every((sample) => sample.scenario?.cleanupReconciled === true);
  const verifierAndEvalEvidencePresent = scenarios.every((scenario) =>
    Number(scenario.result?.verifierNodeCount ?? 0) >= 1 &&
    Number(scenario.result?.evalLedgerNodeCount ?? 0) >= 1
  );
  const noSensitiveLiteral = !hasSensitiveLiteral(latest.data) && latestSamples.every((sample) => !hasSensitiveLiteral(sample));
  const p95Present = Number(metrics.p95LatencyMs ?? 0) > 0 && p95Values.length >= latestSamples.length;

  reasons.push(schemaValid ? "browser_chrome_live_extension_schema_valid" : "browser_chrome_live_extension_schema_invalid");
  reasons.push(realExtensionLocalFixture ? "real_extension_local_fixture_evidence_present" : "real_extension_local_fixture_evidence_missing");
  reasons.push(samplesPresent ? "browser_chrome_live_extension_samples_present" : "insufficient_browser_chrome_live_extension_samples");
  reasons.push(successRatePerfect ? "all_browser_chrome_live_extension_samples_succeeded" : "browser_chrome_live_extension_sample_failure_present");
  reasons.push(downloadStartVerifyCovered ? "real_extension_download_start_verify_evidence_present" : "real_extension_download_start_verify_evidence_missing");
  reasons.push(debuggerPrintPdfCovered ? "real_extension_debugger_print_to_pdf_evidence_present" : "real_extension_debugger_print_to_pdf_evidence_missing");
  reasons.push(redactionProofPresent ? "real_extension_redaction_proof_present" : "real_extension_redaction_proof_missing");
  reasons.push(cleanupReconciled ? "real_extension_cleanup_reconciled" : "real_extension_cleanup_not_reconciled");
  reasons.push(verifierAndEvalEvidencePresent ? "real_extension_verifier_and_eval_nodes_present" : "real_extension_verifier_or_eval_nodes_missing");
  reasons.push(noSensitiveLiteral ? "redacted_browser_chrome_live_extension_only" : "sensitive_literal_detected");
  reasons.push(p95Present ? "browser_chrome_live_extension_p95_samples_present" : "browser_chrome_live_extension_p95_samples_missing");
  reasons.push("real_extension_local_fixture_needs_public_site_repeated_gate_before_promotion");

  const passed = schemaValid &&
    realExtensionLocalFixture &&
    samplesPresent &&
    successRatePerfect &&
    downloadStartVerifyCovered &&
    debuggerPrintPdfCovered &&
    redactionProofPresent &&
    cleanupReconciled &&
    verifierAndEvalEvidencePresent &&
    noSensitiveLiteral &&
    p95Present;

  return {
    id: "browser_chrome_live_extension_dogfood",
    evidenceClass: "real_extension_local_fixture",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "real_extension_local_fixture_gate_passed_public_live_gate_required" : "real_extension_local_fixture_gate_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: runs.map((run) => run.path),
    sampleLedgerPath: sampleLedger.path,
    metrics: {
      schemaValid,
      realExtensionLocalFixture,
      sampleCount: Number(metrics.sampleCount ?? latestSamples.length),
      latestSampleCount: latestSamples.length,
      successCount: Number(metrics.successCount ?? successfulSamples.length),
      latestSuccessfulSampleCount: successfulSamples.length,
      successRate: Number(metrics.successRate ?? 0),
      p95LatencyMs: Number(metrics.p95LatencyMs ?? 0),
      commands: [...commandSet],
      permissionTypesCovered: Array.isArray(metrics.permissionTypesCovered) ? metrics.permissionTypesCovered : [],
      downloadStartVerifyCovered,
      debuggerPrintPdfCovered,
      redactionProofPresent,
      cleanupReconciled,
      verifierAndEvalEvidencePresent,
      arbitraryDebuggerCdpAllowed: false,
      localFixture: true,
      promotable: false
    }
  };
}

export function evaluateBrowserChromePublicExtensionDogfoodGate(runs, sampleLedger) {
  const reasons = [];
  const latest = runs.at(-1) ?? null;
  if (!latest) {
    return blockedGate("browser_chrome_public_extension_dogfood", "missing_browser_chrome_public_extension_evidence", ["missing_browser_chrome_public_extension_evidence"], {});
  }

  const metrics = latest.data?.metrics ?? {};
  const scenarios = Array.isArray(latest.data?.scenarios) ? latest.data.scenarios : [];
  const latestRunId = latest.data?.runId;
  const latestSamples = sampleLedger.samples.filter((sample) => latestRunId
    ? sample.runId === latestRunId
    : normalizeEvidencePath(sample.evidencePath).endsWith(normalizeEvidencePath(latest.path))
  );
  const commandSet = new Set([
    ...scenarios.map((scenario) => scenario.command).filter(Boolean),
    ...latestSamples.map((sample) => sample.scenario?.command).filter(Boolean)
  ]);
  const successfulSamples = latestSamples.filter((sample) => sample.scenario?.success === true);
  const hosts = new Set([
    ...(Array.isArray(metrics.publicHosts) ? metrics.publicHosts : []),
    ...scenarios.map((scenario) => scenario.result?.sourceHost).filter(Boolean),
    ...latestSamples.map((sample) => sample.scenario?.sourceHost).filter(Boolean)
  ]);
  const p95Values = latestSamples
    .map((sample) => Number(sample.scenario?.p95LatencyMs ?? sample.scenario?.elapsedMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  const redactionText = [
    ...scenarios.map((scenario) => JSON.stringify(scenario.result?.redaction ?? {})),
    ...latestSamples.map((sample) => JSON.stringify(sample.scenario?.redaction ?? {}))
  ].join("\n");
  const evidenceText = JSON.stringify(latest.data);

  const schemaValid = latest.data?.schemaVersion === "computer-use-browser-chrome-public-extension-dogfood.v1";
  const realExtensionPublicSite = latest.data?.evidenceClass === "real_extension_public_site_repeated" &&
    latest.data?.extension?.browserApiExecution === true &&
    metrics.realExtension === true &&
    metrics.publicSite === true &&
    metrics.localFixture === false;
  const repeatedSamples = metrics.repeatedSamples === true && Number(metrics.sampleCount ?? 0) >= 18 && latestSamples.length >= 18;
  const requiredHostsPresent = metrics.requiredHostsPresent === true &&
    hosts.has("example.com") &&
    hosts.has("www.w3.org") &&
    hosts.has("the-internet.herokuapp.com");
  const successRatePerfect = Number(metrics.successRate ?? 0) === 1 &&
    Number(metrics.successCount ?? 0) === Number(metrics.sampleCount ?? -1) &&
    scenarios.every((scenario) => scenario.success === true) &&
    successfulSamples.length >= Number(metrics.sampleCount ?? 0);
  const downloadStartVerifyCovered = metrics.downloadVerifyCovered === true &&
    commandSet.has("download.start+download.verify") &&
    scenarios.filter((scenario) => scenario.command === "download.start+download.verify").length >= 2 &&
    scenarios.some((scenario) =>
      scenario.command === "download.start+download.verify" &&
      scenario.success === true &&
      scenario.result?.sourceHost === "www.w3.org" &&
      typeof scenario.result?.sourceUrlHash === "string" &&
      Array.isArray(scenario.result?.resourceRoles) &&
      scenario.result.resourceRoles.includes("download_verified_file")
    );
  const debuggerPrintPdfCovered = metrics.debuggerPrintPdfCovered === true &&
    commandSet.has("debugger.print_to_pdf") &&
    scenarios.filter((scenario) => scenario.command === "debugger.print_to_pdf").length >= 2 &&
    scenarios.some((scenario) =>
      scenario.command === "debugger.print_to_pdf" &&
      scenario.success === true &&
      scenario.result?.sourceHost === "example.com" &&
      typeof scenario.result?.sourceUrlHash === "string" &&
      Number(scenario.result?.byteLength ?? 0) > 0 &&
      scenario.result?.dataOmitted === true
    );
  const tabGroupCovered = metrics.tabGroupCovered === true &&
    commandSet.has("tab_group.claim+update+release") &&
    scenarios.filter((scenario) => scenario.command === "tab_group.claim+update+release").length >= 2 &&
    scenarios.some((scenario) =>
      scenario.command === "tab_group.claim+update+release" &&
      scenario.success === true &&
      scenario.result?.sourceHost === "example.com" &&
      typeof scenario.result?.sourceUrlHash === "string" &&
      Number.isInteger(Number(scenario.result?.groupId)) &&
      Number(scenario.result?.releaseCount ?? 0) >= 1
    );
  const historySearchCovered = metrics.historySearchCovered === true &&
    commandSet.has("history.search") &&
    scenarios.filter((scenario) => scenario.command === "history.search").length >= 2 &&
    scenarios.some((scenario) =>
      scenario.command === "history.search" &&
      scenario.success === true &&
      scenario.result?.sourceHost === "example.com" &&
      typeof scenario.result?.sourceUrlHash === "string" &&
      Number(scenario.result?.historyItemCount ?? 0) >= 1 &&
      Number(scenario.result?.matchingHostCount ?? 0) >= 1 &&
      Number(scenario.result?.pathRedactedCount ?? -1) === Number(scenario.result?.historyItemCount ?? -2) &&
      scenario.result?.approval === "one_time" &&
      scenario.result?.risk === "high"
    );
  const permissionSettingCovered = metrics.permissionSettingCovered === true &&
    commandSet.has("permission.get+set+rollback") &&
    scenarios.filter((scenario) => scenario.command === "permission.get+set+rollback").length >= 6 &&
    ["camera", "microphone", "location"].every((permissionType) => scenarios.some((scenario) =>
      scenario.command === "permission.get+set+rollback" &&
      scenario.success === true &&
      scenario.result?.sourceHost === "example.com" &&
      scenario.result?.permissionHost === "example.com" &&
      scenario.result?.permissionType === permissionType &&
      scenario.result?.permissionPattern === "host_scoped_wildcard" &&
      scenario.result?.appliedSetting === "block" &&
      scenario.result?.verifiedAfterSet === "block" &&
      scenario.result?.rollbackSetting === scenario.result?.initialSetting &&
      scenario.result?.verifiedAfterRollback === scenario.result?.initialSetting &&
      scenario.result?.approval === "one_time" &&
      scenario.result?.risk === "high" &&
      scenario.result?.nativePopupClick === false &&
      scenario.result?.popupWorkflow === "content_settings_api"
    ));
  const multiTabGroupCovered = metrics.multiTabGroupCovered === true &&
    commandSet.has("tab_group.multi_tab_claim+update+release") &&
    scenarios.filter((scenario) => scenario.command === "tab_group.multi_tab_claim+update+release").length >= 2 &&
    scenarios.some((scenario) =>
      scenario.command === "tab_group.multi_tab_claim+update+release" &&
      scenario.success === true &&
      scenario.result?.sourceHost === "example.com" &&
      typeof scenario.result?.sourceUrlHash === "string" &&
      Number.isInteger(Number(scenario.result?.groupId)) &&
      Number(scenario.result?.tabCount ?? 0) === 2 &&
      Number(scenario.result?.releaseCount ?? 0) >= 2
    );
  const fileUploadCovered = metrics.fileUploadCovered === true &&
    commandSet.has("file_upload.inspect+set_files+clear") &&
    hosts.has("the-internet.herokuapp.com") &&
    scenarios.filter((scenario) => scenario.command === "file_upload.inspect+set_files+clear").length >= 2 &&
    scenarios.some((scenario) =>
      scenario.command === "file_upload.inspect+set_files+clear" &&
      scenario.success === true &&
      scenario.result?.sourceHost === "the-internet.herokuapp.com" &&
      typeof scenario.result?.sourceUrlHash === "string" &&
      Number(scenario.result?.inputCount ?? 0) >= 1 &&
      scenario.result?.targetInputFound === true &&
      Number(scenario.result?.selectedFileCount ?? 0) === 1 &&
      Array.isArray(scenario.result?.selectedBasenames) &&
      scenario.result.selectedBasenames.some((name) => /^codex-public-upload-\d+\.txt$/.test(String(name))) &&
      scenario.result?.clearStatus === "files_cleared" &&
      scenario.result?.approval === "one_time" &&
      scenario.result?.risk === "high" &&
      scenario.result?.pathRedacted === true &&
      scenario.result?.submitClicked === false
    );
  const profileApproval = latest.data?.profileApproval && typeof latest.data.profileApproval === "object"
    ? latest.data.profileApproval
    : {};
  const profileApprovalCovered = metrics.profileApprovalCovered === true &&
    profileApproval.success === true &&
    profileApproval.profileScope === "one_time" &&
    Array.isArray(profileApproval.missingGrantTypes) &&
    profileApproval.missingGrantTypes.includes("browser_automation") &&
    profileApproval.missingGrantTypes.includes("risk_class") &&
    profileApproval.attachedDecisionPresent === true &&
    profileApproval.attachedEvalStepPresent === true &&
    profileApproval.cleanupReconciled === true;
  const redactionProofPresent = metrics.redactionProofPresent === true &&
    redactionText.includes("basename_only") &&
    redactionText.includes("dogfood_owned_tab") &&
    redactionText.includes("dogfood_owned_multi_tab") &&
    redactionText.includes("one_time_fresh_profile_path_redacted") &&
    redactionText.includes("dogfood_fresh_profile_only") &&
    redactionText.includes("host_only_no_path") &&
    redactionText.includes("restored_to_initial_setting") &&
    redactionText.includes("not_submitted") &&
    redactionText.includes("rawPdfBytesInReport") &&
    redactionText.includes("arbitraryCdpEvalAllowed") &&
    redactionText.includes("public_url_hash_only") &&
    latest.data?.publicTargets?.urls === "hashed_only" &&
    !evidenceText.includes("https://");
  const cleanupReconciled = metrics.cleanupReconciled === true &&
    scenarios.every((scenario) => scenario.result?.cleanupReconciled === true) &&
    latestSamples.every((sample) => sample.scenario?.cleanupReconciled === true);
  const verifierAndEvalEvidencePresent = scenarios.every((scenario) =>
    Number(scenario.result?.verifierNodeCount ?? 0) >= 1 &&
    Number(scenario.result?.evalLedgerNodeCount ?? 0) >= 1
  );
  const noSensitiveLiteral = !hasSensitiveLiteral(latest.data) && latestSamples.every((sample) => !hasSensitiveLiteral(sample));
  const p95Present = Number(metrics.p95LatencyMs ?? 0) > 0 && p95Values.length >= latestSamples.length;

  reasons.push(schemaValid ? "browser_chrome_public_extension_schema_valid" : "browser_chrome_public_extension_schema_invalid");
  reasons.push(realExtensionPublicSite ? "real_extension_public_site_evidence_present" : "real_extension_public_site_evidence_missing");
  reasons.push(repeatedSamples ? "browser_chrome_public_extension_repeated_samples_present" : "insufficient_browser_chrome_public_extension_samples");
  reasons.push(requiredHostsPresent ? "browser_chrome_public_hosts_present" : "browser_chrome_public_hosts_missing");
  reasons.push(successRatePerfect ? "all_browser_chrome_public_extension_samples_succeeded" : "browser_chrome_public_extension_sample_failure_present");
  reasons.push(downloadStartVerifyCovered ? "public_extension_download_start_verify_evidence_present" : "public_extension_download_start_verify_evidence_missing");
  reasons.push(debuggerPrintPdfCovered ? "public_extension_debugger_print_to_pdf_evidence_present" : "public_extension_debugger_print_to_pdf_evidence_missing");
  reasons.push(tabGroupCovered ? "public_extension_tab_group_claim_release_evidence_present" : "public_extension_tab_group_claim_release_evidence_missing");
  reasons.push(historySearchCovered ? "public_extension_history_search_redacted_evidence_present" : "public_extension_history_search_redacted_evidence_missing");
  reasons.push(permissionSettingCovered ? "public_extension_permission_setting_rollback_evidence_present" : "public_extension_permission_setting_rollback_evidence_missing");
  reasons.push(multiTabGroupCovered ? "public_extension_multi_tab_group_evidence_present" : "public_extension_multi_tab_group_evidence_missing");
  reasons.push(fileUploadCovered ? "public_extension_file_upload_evidence_present" : "public_extension_file_upload_evidence_missing");
  reasons.push(profileApprovalCovered ? "public_extension_profile_approval_evidence_present" : "public_extension_profile_approval_evidence_missing");
  reasons.push(redactionProofPresent ? "public_extension_redaction_proof_present" : "public_extension_redaction_proof_missing");
  reasons.push(cleanupReconciled ? "public_extension_cleanup_reconciled" : "public_extension_cleanup_not_reconciled");
  reasons.push(verifierAndEvalEvidencePresent ? "public_extension_verifier_and_eval_nodes_present" : "public_extension_verifier_or_eval_nodes_missing");
  reasons.push(noSensitiveLiteral ? "redacted_browser_chrome_public_extension_only" : "sensitive_literal_detected");
  reasons.push(p95Present ? "browser_chrome_public_extension_p95_samples_present" : "browser_chrome_public_extension_p95_samples_missing");

  const passed = schemaValid &&
    realExtensionPublicSite &&
    repeatedSamples &&
    requiredHostsPresent &&
    successRatePerfect &&
    downloadStartVerifyCovered &&
    debuggerPrintPdfCovered &&
    tabGroupCovered &&
    historySearchCovered &&
    permissionSettingCovered &&
    multiTabGroupCovered &&
    fileUploadCovered &&
    profileApprovalCovered &&
    redactionProofPresent &&
    cleanupReconciled &&
    verifierAndEvalEvidencePresent &&
    noSensitiveLiteral &&
    p95Present;

  return {
    id: "browser_chrome_public_extension_dogfood",
    evidenceClass: "real_extension_public_site_repeated",
    status: passed ? "passed" : "blocked",
    promotable: passed,
    promotionClass: passed ? "public_site_repeated_real_extension_gate_passed" : "public_site_repeated_real_extension_gate_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: runs.map((run) => run.path),
    sampleLedgerPath: sampleLedger.path,
    metrics: {
      schemaValid,
      realExtensionPublicSite,
      repeatedSamples,
      requiredHostsPresent,
      sampleCount: Number(metrics.sampleCount ?? latestSamples.length),
      latestSampleCount: latestSamples.length,
      successCount: Number(metrics.successCount ?? successfulSamples.length),
      latestSuccessfulSampleCount: successfulSamples.length,
      successRate: Number(metrics.successRate ?? 0),
      p95LatencyMs: Number(metrics.p95LatencyMs ?? 0),
      publicHosts: [...hosts].sort(),
      commands: [...commandSet],
      permissionTypesCovered: Array.isArray(metrics.permissionTypesCovered) ? metrics.permissionTypesCovered : [],
      downloadStartVerifyCovered,
      debuggerPrintPdfCovered,
      tabGroupCovered,
      historySearchCovered,
      permissionSettingCovered,
      multiTabGroupCovered,
      fileUploadCovered,
      profileApprovalCovered,
      redactionProofPresent,
      cleanupReconciled,
      verifierAndEvalEvidencePresent,
      arbitraryDebuggerCdpAllowed: false,
      localFixture: false,
      promotable: passed
    }
  };
}
