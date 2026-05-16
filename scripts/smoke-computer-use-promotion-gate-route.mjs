#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-promotion-gate-route-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const payload = await getJson("/computer-use/eval/promotion-gate");
  assert.equal(payload.ok, true);
  assert.equal(payload.promotionGate?.schemaVersion, "computer-use-promotion-gate.v1");
  assert.equal(typeof payload.promotionGate?.summary?.overallStatus, "string");
  assert.equal(Array.isArray(payload.promotionGate?.gates), true);
  assert.equal(payload.promotionGate.gates.some((gate) => gate.id === "computer_session_live_web_research"), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "computer_session_browser_prompt_dogfood" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.metrics?.requiredIntentsPresent === true &&
    gate.metrics?.directComputerSessionPromptRoute === true
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "computer_session_browser_prompt_live" &&
    gate.status === "passed" &&
    gate.promotable === true &&
    gate.metrics?.requiredIntentsPresent === true &&
    gate.metrics?.requiredHostsPresent === true &&
    gate.metrics?.directComputerSessionPromptRoute === true
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "browser_action_semantic_live_corpus" &&
    gate.status === "passed" &&
    gate.metrics?.requiredIntentsPresent === true &&
    gate.metrics?.sourceCoveragePresent === true
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "browser_action_recovery_live_corpus" &&
    gate.status === "passed" &&
    gate.metrics?.requiredFailureCoveragePresent === true &&
    gate.metrics?.sourceCoveragePresent === true &&
    gate.metrics?.failureRowsFound >= 4 &&
    gate.metrics?.recoveryRowsFound >= 4
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "scoped_autonomy_self_implementation_breadth" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "fixture_repeated_generated_tool_gate_passed_live_generated_tool_gate_required" &&
    gate.metrics?.allRequiredScenariosPresent === true &&
    gate.metrics?.requiredGeneratedClassesPresent === true &&
    gate.metrics?.generatedToolsActive === true &&
    gate.metrics?.sourceIterationPresent === true &&
    gate.metrics?.rerunMatchedCount >= 4 &&
    gate.metrics?.rerunArtifactMatchedCount >= 4 &&
    gate.metrics?.nativeBlocked === true &&
    gate.metrics?.pathRedactionPresent === true &&
    gate.metrics?.repeatedGeneratedClassesPresent === true &&
    gate.metrics?.repeatedClassSamplesPresent === true &&
    gate.metrics?.latestSampleCount >= 8 &&
    gate.metrics?.p95LatencySampleCount >= 8 &&
    gate.metrics?.samplePathRedactionPresent === true &&
    gate.metrics?.repeatedPromotionReady === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "scoped_autonomy_generated_tool_live_breadth" &&
    gate.status === "passed" &&
    gate.promotable === true &&
    gate.promotionClass === "eligible_for_generated_tool_promotion_review" &&
    gate.metrics?.requiredGeneratedClassesPresent === true &&
    gate.metrics?.repeatedLiveRunsPresent === true &&
    gate.metrics?.latestSampleCount >= 16 &&
    gate.metrics?.p95LatencySampleCount >= 16 &&
    gate.metrics?.webSourceQualityAccepted === true &&
    gate.metrics?.webFallbackCalibration?.accepted === true &&
    gate.metrics?.localDocumentConversionVerified === true &&
    gate.metrics?.terminalCommandVerified === true &&
    gate.metrics?.publicDownloadVerified === true &&
    gate.metrics?.pathRedactionPresent === true
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "scoped_autonomy_npm_dependency_dogfood" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "local_dependency_gate_passed_external_package_policy_required" &&
    gate.metrics?.repeatedSamplesPresent === true &&
    gate.metrics?.packageInstallProvenancePresent === true &&
    gate.metrics?.dependencyPolicyReviewPresent === true &&
    gate.metrics?.dependencyExecutionImportPresent === true &&
    gate.metrics?.evalEvidencePresent === true &&
    gate.metrics?.artifactEvidencePresent === true &&
    gate.metrics?.rerunStabilityPresent === true &&
    gate.metrics?.pathRedactionPresent === true &&
    gate.metrics?.externalPackageInstallPromotable === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "browser_bridge_restricted_reload_boundary" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "blocked_by_design_recovery_guard" &&
    gate.metrics?.restrictedReloadBlocked === true &&
    gate.metrics?.bridgeStatusSmokeCoversReloadRequired === true &&
    gate.metrics?.bridgeStatusSmokeCoversRestricted === true &&
    gate.metrics?.extensionPopupReloadUxPresent === true &&
    gate.metrics?.unattendedReloadPromotable === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "browser_chrome_deep_action_evidence_ux" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "renderer_evidence_ux_gate_passed_live_gate_required" &&
    gate.metrics?.rendererEvidenceSectionPresent === true &&
    gate.metrics?.rendererRedactionSummaryPresent === true &&
    gate.metrics?.smokeCoversDownloadEvidence === true &&
    gate.metrics?.smokeCoversHistoryDebuggerPermissionUpload === true &&
    gate.metrics?.smokeCoversRedactionProof === true &&
    gate.metrics?.arbitraryDebuggerCdpAllowed === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "browser_chrome_repeated_dogfood" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "fixture_bridge_gate_passed_live_extension_gate_required" &&
    gate.metrics?.fixtureBridge === true &&
    gate.metrics?.downloadVerifyCovered === true &&
    gate.metrics?.debuggerPrintPdfCovered === true &&
    gate.metrics?.redactionProofPresent === true &&
    gate.metrics?.cleanupReconciled === true &&
    gate.metrics?.arbitraryDebuggerCdpAllowed === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "browser_chrome_live_extension_dogfood" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "real_extension_local_fixture_gate_passed_public_live_gate_required" &&
    gate.metrics?.realExtensionLocalFixture === true &&
    gate.metrics?.downloadStartVerifyCovered === true &&
    gate.metrics?.debuggerPrintPdfCovered === true &&
    gate.metrics?.redactionProofPresent === true &&
    gate.metrics?.cleanupReconciled === true &&
    gate.metrics?.arbitraryDebuggerCdpAllowed === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "browser_chrome_public_extension_dogfood" &&
    gate.status === "passed" &&
    gate.promotable === true &&
    gate.promotionClass === "public_site_repeated_real_extension_gate_passed" &&
    gate.metrics?.realExtensionPublicSite === true &&
    gate.metrics?.repeatedSamples === true &&
    gate.metrics?.requiredHostsPresent === true &&
    gate.metrics?.downloadStartVerifyCovered === true &&
    gate.metrics?.debuggerPrintPdfCovered === true &&
    gate.metrics?.tabGroupCovered === true &&
    gate.metrics?.historySearchCovered === true &&
    gate.metrics?.permissionSettingCovered === true &&
    ["camera", "microphone", "location"].every((permissionType) => gate.metrics?.permissionTypesCovered?.includes(permissionType)) &&
    gate.metrics?.multiTabGroupCovered === true &&
    gate.metrics?.fileUploadCovered === true &&
    gate.metrics?.profileApprovalCovered === true &&
    gate.metrics?.redactionProofPresent === true &&
    gate.metrics?.cleanupReconciled === true &&
    gate.metrics?.arbitraryDebuggerCdpAllowed === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "renderer_permission_profile_ux" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "renderer_safety_ux_gate_passed_live_gate_required" &&
    gate.metrics?.managerUiPresent === true &&
    gate.metrics?.rendererValidationPresent === true &&
    gate.metrics?.smokeCoversBlockedUnsafeDraft === true &&
    gate.metrics?.smokeCoversSafeCreate === true &&
    gate.metrics?.smokeCoversLifecyclePost === true &&
    gate.metrics?.credentialsAutoGrantAllowed === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "windows_native_watch_boundary" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "blocked_by_design_release_guard" &&
    gate.metrics?.userInputAbortGuardPresent === true &&
    gate.metrics?.userInputAbortSmokePresent === true &&
    gate.metrics?.foregroundWatchExecutorDisabledPresent === true &&
    gate.metrics?.disabledHelperV2CommandContractsPresent === true &&
    Number(gate.metrics?.disabledHelperV2CommandCount ?? 0) >= 5 &&
    gate.metrics?.foregroundWatchExecutorActualInputSent === false &&
    gate.metrics?.releaseReadinessPathsRedacted === true &&
    gate.metrics?.actualInputSent === false &&
    gate.metrics?.mutationPromotable === false
  ), true);
  assert.equal(payload.promotionGate.gates.some((gate) =>
    gate.id === "windows_settings_reversible_dogfood_boundary" &&
    gate.status === "passed" &&
    gate.promotable === false &&
    gate.promotionClass === "blocked_by_design_reversible_fixture_guard" &&
    gate.metrics?.readOnlyCasePresent === true &&
    gate.metrics?.reversibleCasePresent === true &&
    gate.metrics?.blockedBroadMutationPresent === true &&
    gate.metrics?.broadWindowsSettingsMutationPromotable === false
  ), true);
  assert.equal(typeof payload.evidencePath, "string");
  assert.equal(payload.evidencePath.includes("computer-use-promotion-gate"), true);
  assert.equal(typeof payload.reportPath, "string");
  const reportsPayload = await getJson("/computer-use/eval/dogfood-reports?limit=50");
  assert.equal(reportsPayload.ok, true);
  assert.equal(Array.isArray(reportsPayload.reports), true);
  assert.equal(reportsPayload.reports.length > 0, true);
  assert.equal(reportsPayload.reports.some((report) =>
    report.kind === "browser_chrome" &&
    report.reportPath === "docs/reports/computer-use-browser-chrome-public-extension-2026-05-16.md" &&
    report.evidencePath === "docs/reports/assets/computer-use-browser-chrome-public-extension-2026-05-16/evidence.json" &&
    report.dogfoodPath === "docs/dogfood/computer-use-browser-chrome-public-extension-2026-05-16.json"
  ), true);
  const report = reportsPayload.reports.find((candidate) => candidate.reportPath);
  assert.equal(typeof report?.reportPath, "string");
  const reportResponse = await fetch(`${baseUrl}/computer-use/eval/dogfood-reports/content?path=${encodeURIComponent(report.reportPath)}`);
  assert.equal(reportResponse.ok, true);
  assert.match(reportResponse.headers.get("content-type") ?? "", /text\/markdown/);
  const reportText = await reportResponse.text();
  assert.equal(reportText.length > 0, true);
  const blockedTraversal = await fetch(`${baseUrl}/computer-use/eval/dogfood-reports/content?path=${encodeURIComponent("../package.json")}`);
  assert.equal(blockedTraversal.status, 400);
  console.log(`computer use promotion gate route smoke ok on port ${daemon.port}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}
