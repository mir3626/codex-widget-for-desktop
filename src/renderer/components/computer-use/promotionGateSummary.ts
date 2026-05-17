type PromotionGateSummary = {
  schemaVersion: string;
  generatedAt?: string;
  summary?: {
    overallStatus?: string;
    promotableSlices?: string[];
    blockedSlices?: string[];
    passedNonPromotableSlices?: string[];
  };
  gates?: Array<{
    id: string;
    status: string;
    promotable?: boolean;
    promotionClass?: string;
    reasons?: string[];
    metrics?: Record<string, unknown>;
  }>;
};

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function statusTone(status: string): string {
  if (status === "completed" || status === "passed" || status === "active" || status === "approved") return "ok";
  if (status === "failed" || status === "blocked" || status === "denied" || status === "expired") return "bad";
  if (status === "running" || status === "awaiting_approval") return "warn";
  return "muted";
}

export function summarizePromotionGate(gate: NonNullable<PromotionGateSummary["gates"]>[number]): string {
  const metrics = gate.metrics ?? {};
  const p95 = typeof metrics.p95LatencyMs === "number" ? `p95 ${metrics.p95LatencyMs}ms` : "";
  const fallback = metrics.browserFallbackTransportCalibrated === true ? "fallback calibrated" : metrics.fallbackOnly === true ? "fallback pending" : "";
  const reason = gate.reasons?.at(-1) ?? gate.promotionClass ?? "gate";
  const gateClass = gate.promotable
    ? "eligible"
    : gate.promotionClass === "blocked_by_design_release_guard"
      ? "release guard"
      : gate.promotionClass;
  return [gateClass, p95, fallback, reason].filter(Boolean).join(" · ");
}

export function summarizeBrowserChromePublicExtensionProof(promotionGate: PromotionGateSummary | null): {
  sampleCount: string;
  p95Latency: string;
  hosts: string;
  profileApproval: string;
  coverage: string;
  permissionTypes: string;
  redaction: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "browser_chrome_public_extension_dogfood");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const publicHosts = readStringArray(metrics.publicHosts);
  const commands = readStringArray(metrics.commands);
  const permissionTypes = readStringArray(metrics.permissionTypesCovered);
  const sampleCount = typeof metrics.latestSampleCount === "number"
    ? metrics.latestSampleCount
    : typeof metrics.sampleCount === "number"
      ? metrics.sampleCount
      : 0;
  const coverageFlags = [
    ["download", metrics.downloadStartVerifyCovered === true],
    ["pdf", metrics.debuggerPrintPdfCovered === true],
    ["tabs", metrics.tabGroupCovered === true && metrics.multiTabGroupCovered === true],
    ["history", metrics.historySearchCovered === true],
    ["permissions", metrics.permissionSettingCovered === true],
    ["upload", metrics.fileUploadCovered === true]
  ];
  const covered = coverageFlags.filter(([, ok]) => ok).map(([label]) => label);
  return {
    sampleCount: sampleCount ? `${sampleCount}` : "unknown",
    p95Latency: typeof metrics.p95LatencyMs === "number" ? `${metrics.p95LatencyMs}ms` : "unknown",
    hosts: publicHosts.length ? `${publicHosts.length}` : "unknown",
    profileApproval: metrics.profileApprovalCovered === true ? "proved" : "missing",
    coverage: covered.length ? `${covered.join(" + ")} covered` : `${commands.length} commands`,
    permissionTypes: permissionTypes.length ? `permissions ${permissionTypes.join(", ")}` : "permissions unknown",
    redaction: metrics.redactionProofPresent === true ? "redaction proved" : "redaction pending",
    promotable: gate.promotable === true
  };
}

export function summarizeToolsmithSelfImplementationProof(promotionGate: PromotionGateSummary | null): {
  status: string;
  scenarios: string;
  classes: string;
  samples: string;
  p95Latency: string;
  reruns: string;
  paths: string;
  coverage: string;
  nativeBoundary: string;
  promotionGuard: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "scoped_autonomy_self_implementation_breadth");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const generatedClasses = readStringArray(metrics.generatedCapabilityClasses);
  const requiredClasses = readStringArray(metrics.requiredGeneratedClasses);
  const scenarioCount = typeof metrics.scenarioCount === "number" ? metrics.scenarioCount : 0;
  const requiredScenarioCount = typeof metrics.requiredScenarioCount === "number" ? metrics.requiredScenarioCount : 0;
  const rerunMatchedCount = typeof metrics.rerunMatchedCount === "number" ? metrics.rerunMatchedCount : 0;
  const rerunArtifactMatchedCount = typeof metrics.rerunArtifactMatchedCount === "number" ? metrics.rerunArtifactMatchedCount : 0;
  const sampleCount = typeof metrics.latestSampleCount === "number" ? metrics.latestSampleCount : 0;
  const p95LatencyMs = typeof metrics.p95LatencyMs === "number" ? metrics.p95LatencyMs : undefined;
  const classesReady = metrics.requiredGeneratedClassesPresent === true && metrics.generatedToolsActive === true;
  const sourceRevision = metrics.sourceIterationPresent === true;
  const nativeBlocked = metrics.nativeBlocked === true;
  const pathRedaction = metrics.pathRedactionPresent === true && (metrics.samplePathRedactionPresent !== false);
  const repeatedReady = metrics.repeatedPromotionReady === true;
  const repeatedSamples = metrics.repeatedClassSamplesPresent === true && sampleCount >= 6;
  return {
    status: gate.promotable ? "eligible" : gate.status === "passed" ? "guarded" : gate.status,
    scenarios: scenarioCount && requiredScenarioCount ? `${scenarioCount}/${requiredScenarioCount}` : `${scenarioCount || "unknown"}`,
    classes: generatedClasses.length ? `${generatedClasses.length}` : `${requiredClasses.length || "unknown"}`,
    samples: sampleCount ? `${sampleCount}` : "pending",
    p95Latency: p95LatencyMs !== undefined ? `${p95LatencyMs}ms` : "pending",
    reruns: `${rerunMatchedCount}/${rerunArtifactMatchedCount}`,
    paths: pathRedaction ? "redacted" : "review",
    coverage: classesReady
      ? `${generatedClasses.join(" + ")} covered`
      : "generated tool breadth pending",
    nativeBoundary: nativeBlocked ? "native high-risk blocked" : "native boundary pending",
    promotionGuard: repeatedReady ? "live breadth ready" : repeatedSamples ? "fixture repeated only" : sourceRevision ? "fixture breadth only" : (gate.promotionClass ?? "guarded"),
    promotable: gate.promotable === true
  };
}

export function summarizeToolsmithGeneratedToolLiveBreadthProof(promotionGate: PromotionGateSummary | null): {
  status: string;
  samples: string;
  p95Latency: string;
  classes: string;
  runs: string;
  coverage: string;
  sourceProof: string;
  redaction: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "scoped_autonomy_generated_tool_live_breadth");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const generatedClasses = readStringArray(metrics.generatedCapabilityClasses);
  const requiredClasses = readStringArray(metrics.requiredGeneratedClasses);
  const sampleCount = typeof metrics.latestSampleCount === "number" ? metrics.latestSampleCount : 0;
  const p95LatencyMs = typeof metrics.p95LatencyMs === "number" ? metrics.p95LatencyMs : undefined;
  const executeSampleCount = typeof metrics.executeSampleCount === "number" ? metrics.executeSampleCount : 0;
  const proofFlags = [
    ["web", metrics.webSourceQualityAccepted === true],
    ["local conversion", metrics.localDocumentConversionVerified === true],
    ["terminal", metrics.terminalCommandVerified === true],
    ["download", metrics.publicDownloadVerified === true]
  ];
  const covered = proofFlags.filter(([, ok]) => ok).map(([label]) => label);
  return {
    status: gate.promotable ? "eligible" : gate.status === "passed" ? "guarded" : gate.status,
    samples: sampleCount ? `${sampleCount}` : "pending",
    p95Latency: p95LatencyMs !== undefined ? `${p95LatencyMs}ms` : "pending",
    classes: generatedClasses.length ? `${generatedClasses.length}` : `${requiredClasses.length || "unknown"}`,
    runs: executeSampleCount ? `${executeSampleCount}` : "pending",
    coverage: covered.length ? `${covered.join(" + ")} live covered` : "live breadth pending",
    sourceProof: metrics.webFallbackCalibration && typeof metrics.webFallbackCalibration === "object" && (metrics.webFallbackCalibration as Record<string, unknown>).accepted === true
      ? "web fallback calibrated"
      : "web calibration pending",
    redaction: metrics.pathRedactionPresent === true ? "redaction proved" : "redaction pending",
    promotable: gate.promotable === true
  };
}

export function summarizeNativeBoundaryProof(promotionGate: PromotionGateSummary | null): {
  status: string;
  foregroundInput: string;
  filePicker: string;
  permissionBubble: string;
  signing: string;
  preflight: string;
  driftAbort: string;
  executor: string;
  helperV2: string;
  coverage: string;
  redaction: string;
  releaseGuard: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "windows_native_watch_boundary");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const reasons = gate.reasons ?? [];
  const foregroundInputBlocked = metrics.implementationBoundaryPresent === true || reasons.includes("foreground_input_blocked_before_native_helper");
  const filePickerBlocked = metrics.nativeFilePickerBoundaryPresent === true || reasons.includes("native_file_picker_blocked_before_path_disclosure");
  const permissionBubbleBlocked = metrics.browserPermissionBubbleBoundaryPresent === true || reasons.includes("browser_permission_bubble_blocked_before_native_click");
  const signingDeferred = metrics.releaseSigningDeferred === true || reasons.includes("native_helper_release_signing_gate_present");
  const preflightContract = metrics.foregroundPreflightContractPresent === true || reasons.includes("foreground_watch_preflight_contract_present");
  const driftAbort = metrics.activeWindowDriftSmokePresent === true || reasons.includes("foreground_watch_active_window_drift_abort_smoke_present");
  const executorDisabled = metrics.foregroundWatchExecutorDisabledPresent === true || reasons.includes("foreground_watch_executor_disabled_contract_present");
  const disabledHelperV2Contracts = metrics.disabledHelperV2CommandContractsPresent === true || reasons.includes("helper_v2_disabled_command_contracts_present");
  const disabledHelperV2CommandCount = typeof metrics.disabledHelperV2CommandCount === "number" ? metrics.disabledHelperV2CommandCount : undefined;
  const actualInputSent = metrics.actualInputSent === true;
  const executorActualInputSent = metrics.foregroundWatchExecutorActualInputSent === true;
  const localPathDisclosed = metrics.localFilePathDisclosed === true;
  const nativePopupClick = metrics.nativePopupClick === true;
  const coverage = [
    foregroundInputBlocked ? "foreground input" : "",
    filePickerBlocked ? "file picker" : "",
    permissionBubbleBlocked ? "permission popup" : ""
  ].filter(Boolean).join(" + ");
  return {
    status: gate.status === "passed" ? "guarded" : gate.status,
    foregroundInput: foregroundInputBlocked && !actualInputSent ? "blocked" : "unknown",
    filePicker: filePickerBlocked && !localPathDisclosed ? "blocked" : "unknown",
    permissionBubble: permissionBubbleBlocked && !nativePopupClick ? "blocked" : "unknown",
    signing: signingDeferred ? "deferred" : "unknown",
    preflight: preflightContract ? "typed" : "unknown",
    driftAbort: driftAbort && !actualInputSent ? "proved" : "unknown",
    executor: executorDisabled && !executorActualInputSent ? "disabled" : "unknown",
    helperV2: disabledHelperV2Contracts ? `disabled${disabledHelperV2CommandCount ? ` (${disabledHelperV2CommandCount})` : ""}` : "unknown",
    coverage: coverage ? `${coverage} before input` : "native boundary evidence",
    redaction: localPathDisclosed || nativePopupClick ? "review evidence" : "paths and popup clicks hidden",
    releaseGuard: gate.promotionClass === "blocked_by_design_release_guard" ? "release guard active" : (gate.promotionClass ?? "guarded"),
    promotable: gate.promotable === true
  };
}

export function promotionGateLabel(gate: NonNullable<PromotionGateSummary["gates"]>[number]): string {
  if (gate.promotable) return "eligible";
  if (gate.status === "passed") return "guarded";
  return gate.status;
}

export function promotionGateTone(gate: NonNullable<PromotionGateSummary["gates"]>[number]): string {
  if (gate.promotable) return "ok";
  if (gate.status === "passed") return "warn";
  return statusTone(gate.status);
}
