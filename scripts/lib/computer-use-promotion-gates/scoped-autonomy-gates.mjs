import { blockedGate, evaluateGeneratedToolLiveWebFallbackCalibration, hasWindowsAbsolutePath, normalizeEvidencePath, percentile, readGeneratedToolSampleCapability } from "./shared.mjs";

export function evaluateScopedAutonomySelfImplementationBreadthGate(runs, sampleLedger) {
  const reasons = [];
  const latest = runs.at(-1);
  if (!latest) {
    return blockedGate("scoped_autonomy_self_implementation_breadth", "missing_self_implementation_dogfood", ["missing_self_implementation_dogfood"], {});
  }
  const data = latest.data ?? {};
  const scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id).filter(Boolean));
  const requiredScenarioIds = [
    "self-implementation-full-dag-web-pdf",
    "self-implementation-local-document-conversion",
    "self-implementation-terminal-generated-tool",
    "self-implementation-browser-download-verify",
    "self-implementation-native-windows-blocked"
  ];
  const generatedCapabilityClasses = new Set(data.metrics?.generatedCapabilityClasses ?? scenarios
    .map((scenario) => scenario.result?.capability)
    .filter(Boolean));
  const requiredGeneratedClasses = ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"];
  const allRequiredScenariosPresent = requiredScenarioIds.every((id) => scenarioIds.has(id));
  const allScenariosSucceeded = scenarios.length >= requiredScenarioIds.length && scenarios.every((scenario) => scenario.success === true);
  const requiredGeneratedClassesPresent = requiredGeneratedClasses.every((capability) => generatedCapabilityClasses.has(capability));
  const rerunMatchedCount = Number(data.metrics?.rerunMatchedCount ?? scenarios.filter((scenario) => scenario.result?.rerunMatched === true).length);
  const rerunArtifactMatchedCount = Number(data.metrics?.rerunArtifactMatchedCount ?? scenarios.filter((scenario) => scenario.result?.rerunArtifactMatched === true).length);
  const nativeBlocked = scenarios.some((scenario) =>
    scenario.id === "self-implementation-native-windows-blocked" &&
    scenario.success === true &&
    scenario.result?.requestedCapability === "native_windows_workflow" &&
    Array.isArray(scenario.result?.missingRequirements) &&
    scenario.result.missingRequirements.some((requirement) => requirement.type === "os_mutation")
  );
  const schemaValid = data.schemaVersion === "scoped-autonomy-self-implementation-dogfood.v1";
  const pathRedactionPresent = data.redaction?.rawPathsRedacted === true &&
    data.redaction?.repoPathsRelative === true &&
    Number(data.redaction?.absolutePathLeakCount ?? 1) === 0;
  const sourceIterationPresent = Array.isArray(data.tools) &&
    data.tools.some((tool) => tool.capability === "web_research_to_pdf" && Number(tool.manifest?.provenance?.iterations ?? 0) >= 2);
  const generatedToolsActive = Array.isArray(data.tools) &&
    requiredGeneratedClasses.every((capability) => data.tools.some((tool) => tool.capability === capability && (tool.status === "active" || tool.status === "smoke_passed")));
  const repeatedSamples = (sampleLedger?.samples ?? [])
    .filter((sample) => sample?.schemaVersion === "scoped-autonomy-generated-tool-breadth-sample.v1")
    .filter((sample) => sample.evidenceClass === "fixture_repeated_generated_tool")
    .filter((sample) => requiredGeneratedClasses.includes(readGeneratedToolSampleCapability(sample)));
  const sampleCountByClass = Object.fromEntries(requiredGeneratedClasses.map((capability) => [
    capability,
    repeatedSamples.filter((sample) => readGeneratedToolSampleCapability(sample) === capability).length
  ]));
  const repeatedGeneratedClasses = new Set(repeatedSamples.map(readGeneratedToolSampleCapability).filter(Boolean));
  const repeatedGeneratedClassesPresent = requiredGeneratedClasses.every((capability) => repeatedGeneratedClasses.has(capability));
  const repeatedClassSamplesPresent = requiredGeneratedClasses.every((capability) => Number(sampleCountByClass[capability] ?? 0) >= 2);
  const p95LatencySamples = repeatedSamples
    .map((sample) => Number(sample.sample?.elapsedMs ?? sample.scenario?.result?.elapsedMs))
    .filter(Number.isFinite);
  const repeatedRerunMatchedCount = repeatedSamples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.matched === true).length;
  const repeatedRerunArtifactMatchedCount = repeatedSamples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.artifactMatched === true).length;
  const samplePathRedactionPresent = repeatedSamples.length > 0 &&
    repeatedSamples.every((sample) => Number(sample.redaction?.absolutePathLeakCount ?? 1) === 0 && !hasWindowsAbsolutePath(JSON.stringify(sample)));
  const repeatedPromotionReady = false;

  reasons.push(schemaValid ? "scoped_autonomy_self_implementation_schema_valid" : "scoped_autonomy_self_implementation_schema_invalid");
  reasons.push(allRequiredScenariosPresent ? "required_self_implementation_scenarios_present" : "missing_self_implementation_scenarios");
  reasons.push(allScenariosSucceeded ? "all_self_implementation_scenarios_succeeded" : "self_implementation_scenario_failure_present");
  reasons.push(requiredGeneratedClassesPresent ? "generated_capability_class_breadth_present" : "generated_capability_class_breadth_missing");
  reasons.push(generatedToolsActive ? "generated_tools_active_after_smoke" : "generated_tools_not_active_after_smoke");
  reasons.push(sourceIterationPresent ? "failed_smoke_revision_iteration_present" : "failed_smoke_revision_iteration_missing");
  reasons.push(rerunMatchedCount >= 4 ? "rerun_stability_comparisons_present" : "rerun_stability_comparisons_missing");
  reasons.push(rerunArtifactMatchedCount >= 4 ? "rerun_artifact_stability_present" : "rerun_artifact_stability_missing");
  reasons.push(nativeBlocked ? "high_risk_native_gap_blocked_before_materialization" : "high_risk_native_gap_boundary_missing");
  reasons.push(pathRedactionPresent ? "self_implementation_path_redaction_present" : "self_implementation_path_redaction_missing");
  reasons.push(repeatedGeneratedClassesPresent ? "repeated_generated_tool_class_coverage_present" : "repeated_generated_tool_class_coverage_missing");
  reasons.push(repeatedClassSamplesPresent ? "repeated_generated_tool_samples_present" : "repeated_generated_tool_samples_missing");
  reasons.push(p95LatencySamples.length >= 8 ? "generated_tool_breadth_p95_samples_present" : "generated_tool_breadth_p95_samples_missing");
  reasons.push(samplePathRedactionPresent ? "generated_tool_sample_path_redaction_present" : "generated_tool_sample_path_redaction_missing");
  reasons.push("fixture_breadth_needs_repeated_live_generated_tool_gate_before_promotion");

  const passed =
    schemaValid &&
    allRequiredScenariosPresent &&
    allScenariosSucceeded &&
    requiredGeneratedClassesPresent &&
    generatedToolsActive &&
    sourceIterationPresent &&
    rerunMatchedCount >= 4 &&
    rerunArtifactMatchedCount >= 4 &&
    nativeBlocked &&
    pathRedactionPresent &&
    repeatedGeneratedClassesPresent &&
    repeatedClassSamplesPresent &&
    p95LatencySamples.length >= 8 &&
    samplePathRedactionPresent;

  return {
    id: "scoped_autonomy_self_implementation_breadth",
    evidenceClass: "fixture_repeated_breadth",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "fixture_repeated_generated_tool_gate_passed_live_generated_tool_gate_required" : "fixture_repeated_generated_tool_gate_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: [latest.path, sampleLedger?.path].filter(Boolean),
    sampleLedgerPath: sampleLedger?.path,
    metrics: {
      scenarioCount: scenarios.length,
      requiredScenarioCount: requiredScenarioIds.length,
      allRequiredScenariosPresent,
      allScenariosSucceeded,
      generatedCapabilityClasses: [...generatedCapabilityClasses].sort(),
      requiredGeneratedClasses,
      requiredGeneratedClassesPresent,
      generatedToolsActive,
      sourceIterationPresent,
      rerunMatchedCount,
      rerunArtifactMatchedCount,
      nativeBlocked,
      pathRedactionPresent,
      latestSampleCount: repeatedSamples.length,
      sampleLedgerCount: sampleLedger?.samples?.length ?? 0,
      repeatedGeneratedClasses: [...repeatedGeneratedClasses].sort(),
      repeatedGeneratedClassesPresent,
      sampleCountByClass,
      repeatedClassSamplesPresent,
      p95LatencySampleCount: p95LatencySamples.length,
      p95LatencyMs: p95LatencySamples.length ? percentile(p95LatencySamples, 0.95) : undefined,
      repeatedRerunMatchedCount,
      repeatedRerunArtifactMatchedCount,
      samplePathRedactionPresent,
      repeatedPromotionReady
    }
  };
}

export function evaluateScopedAutonomyGeneratedToolLiveBreadthGate(runs, sampleLedger) {
  const requiredGeneratedClasses = ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"];
  const reasons = [];
  const latest = runs.at(-1);
  if (!latest) {
    return blockedGate("scoped_autonomy_generated_tool_live_breadth", "missing_generated_tool_live_breadth", ["missing_generated_tool_live_breadth"], {});
  }
  const data = latest.data ?? {};
  const scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
  const schemaValid = data.schemaVersion === "scoped-autonomy-generated-tool-live-breadth-dogfood.v1";
  const successfulScenarios = scenarios.filter((scenario) => scenario.success === true);
  const generatedCapabilityClasses = new Set([
    ...(Array.isArray(data.metrics?.generatedCapabilityClasses) ? data.metrics.generatedCapabilityClasses : []),
    ...scenarios.map((scenario) => scenario.capability).filter(Boolean)
  ]);
  const requiredGeneratedClassesPresent = requiredGeneratedClasses.every((capability) => generatedCapabilityClasses.has(capability));
  const liveSamples = (sampleLedger?.samples ?? [])
    .filter((sample) => sample?.schemaVersion === "scoped-autonomy-generated-tool-live-breadth-sample.v1")
    .filter((sample) => sample.evidenceClass === "live_generated_tool_breadth")
    .filter((sample) => normalizeEvidencePath(sample.evidencePath) === latest.path)
    .filter((sample) => sample.generatedAt === data.generatedAt)
    .filter((sample) => requiredGeneratedClasses.includes(readGeneratedToolSampleCapability(sample)));
  const executeSamples = liveSamples.filter((sample) => sample.sample?.mode === "execute");
  const sampleCountByClass = Object.fromEntries(requiredGeneratedClasses.map((capability) => [
    capability,
    executeSamples.filter((sample) => readGeneratedToolSampleCapability(sample) === capability).length
  ]));
  const repeatedLiveRunsPresent = requiredGeneratedClasses.every((capability) => Number(sampleCountByClass[capability] ?? 0) >= 2);
  const p95LatencySamples = liveSamples
    .map((sample) => Number(sample.sample?.elapsedMs ?? sample.scenario?.result?.elapsedMs))
    .filter(Number.isFinite);
  const allSamplesSucceeded = liveSamples.length > 0 && liveSamples.every((sample) => sample.sample?.status === "completed" && sample.scenario?.success === true);
  const rerunMatchedCount = liveSamples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.matched === true).length;
  const rerunArtifactMatchedCount = liveSamples.filter((sample) => sample.sample?.mode === "rerun" && sample.sample?.artifactMatched === true).length;
  const webScenarios = scenarios.filter((scenario) => scenario.capability === "web_research_to_pdf");
  const localConversionScenarios = scenarios.filter((scenario) => scenario.capability === "local_document_conversion");
  const terminalScenarios = scenarios.filter((scenario) => scenario.capability === "terminal_generated_tool");
  const downloadScenarios = scenarios.filter((scenario) => scenario.capability === "browser_download_verify");
  const webSourceQualityAccepted = webScenarios.length >= 2 &&
    webScenarios.every((scenario) =>
      scenario.result?.sourceQualityReview === "accepted" &&
      Number(scenario.result?.validLiveSourceCount ?? 0) >= 2 &&
      scenario.result?.browserFallbackCalibration?.status === "accepted"
    );
  const webFallbackCalibration = evaluateGeneratedToolLiveWebFallbackCalibration(webScenarios);
  const terminalCommandVerified = terminalScenarios.length >= 2 &&
    terminalScenarios.every((scenario) => scenario.result?.stdoutStartsWithVersion === true);
  const localDocumentConversionVerified = localConversionScenarios.length >= 2 &&
    localConversionScenarios.every((scenario) =>
      scenario.result?.localConversionReview?.status === "accepted" &&
      scenario.result?.localConversionReview?.sourceSha256 &&
      scenario.result?.localConversionReview?.pdfSha256 &&
      Number(scenario.result?.localConversionReview?.skippedWebStages ?? 0) >= 3
    );
  const publicDownloadVerified = downloadScenarios.length >= 2 &&
    downloadScenarios.every((scenario) =>
      scenario.result?.publicDownload?.ok === true &&
      scenario.result?.verification?.ok === true &&
      Number(scenario.result?.publicDownload?.bytes ?? 0) >= 100
    );
  const pathRedactionPresent = data.redaction?.rawPathsRedacted === true &&
    data.redaction?.repoPathsRelative === true &&
    Number(data.redaction?.absolutePathLeakCount ?? 1) === 0 &&
    liveSamples.every((sample) => Number(sample.redaction?.absolutePathLeakCount ?? 1) === 0 && !hasWindowsAbsolutePath(JSON.stringify(sample)));

  reasons.push(schemaValid ? "generated_tool_live_breadth_schema_valid" : "generated_tool_live_breadth_schema_invalid");
  reasons.push(requiredGeneratedClassesPresent ? "generated_tool_live_class_breadth_present" : "generated_tool_live_class_breadth_missing");
  reasons.push(successfulScenarios.length === scenarios.length && scenarios.length >= 8 ? "all_generated_tool_live_scenarios_succeeded" : "generated_tool_live_scenario_failure_or_missing");
  reasons.push(repeatedLiveRunsPresent ? "repeated_live_generated_tool_runs_present" : "repeated_live_generated_tool_runs_missing");
  reasons.push(allSamplesSucceeded ? "all_live_generated_tool_samples_succeeded" : "live_generated_tool_sample_failure_present");
  reasons.push(p95LatencySamples.length >= 16 ? "live_generated_tool_p95_samples_present" : "live_generated_tool_p95_samples_missing");
  reasons.push(webSourceQualityAccepted ? "web_research_live_source_quality_accepted" : "web_research_live_source_quality_missing");
  reasons.push(webFallbackCalibration.accepted ? "web_research_browser_fallback_calibrated" : "web_research_browser_fallback_calibration_missing");
  reasons.push(localDocumentConversionVerified ? "local_document_conversion_live_verified" : "local_document_conversion_live_missing");
  reasons.push(terminalCommandVerified ? "terminal_generated_tool_live_command_verified" : "terminal_generated_tool_live_command_missing");
  reasons.push(publicDownloadVerified ? "browser_download_verify_public_download_verified" : "browser_download_verify_public_download_missing");
  reasons.push(rerunMatchedCount >= 8 ? "live_generated_tool_rerun_stability_present" : "live_generated_tool_rerun_stability_missing");
  reasons.push(rerunArtifactMatchedCount >= 8 ? "live_generated_tool_artifact_stability_present" : "live_generated_tool_artifact_stability_missing");
  reasons.push(pathRedactionPresent ? "live_generated_tool_path_redaction_present" : "live_generated_tool_path_redaction_missing");

  const promotable =
    schemaValid &&
    requiredGeneratedClassesPresent &&
    successfulScenarios.length === scenarios.length &&
    scenarios.length >= 8 &&
    repeatedLiveRunsPresent &&
    allSamplesSucceeded &&
    p95LatencySamples.length >= 16 &&
    webSourceQualityAccepted &&
    webFallbackCalibration.accepted &&
    localDocumentConversionVerified &&
    terminalCommandVerified &&
    publicDownloadVerified &&
    rerunMatchedCount >= 8 &&
    rerunArtifactMatchedCount >= 8 &&
    pathRedactionPresent;

  return {
    id: "scoped_autonomy_generated_tool_live_breadth",
    evidenceClass: "live_generated_tool_breadth",
    status: promotable ? "passed" : "blocked",
    promotable,
    promotionClass: promotable ? "eligible_for_generated_tool_promotion_review" : "live_generated_tool_breadth_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: [latest.path, sampleLedger?.path].filter(Boolean),
    sampleLedgerPath: sampleLedger?.path,
    metrics: {
      scenarioCount: scenarios.length,
      successCount: successfulScenarios.length,
      generatedCapabilityClasses: [...generatedCapabilityClasses].sort(),
      requiredGeneratedClasses,
      requiredGeneratedClassesPresent,
      latestSampleCount: liveSamples.length,
      sampleLedgerCount: sampleLedger?.samples?.length ?? 0,
      executeSampleCount: executeSamples.length,
      sampleCountByClass,
      repeatedLiveRunsPresent,
      p95LatencySampleCount: p95LatencySamples.length,
      p95LatencyMs: p95LatencySamples.length ? percentile(p95LatencySamples, 0.95) : undefined,
      rerunMatchedCount,
      rerunArtifactMatchedCount,
      webSourceQualityAccepted,
      webFallbackCalibration,
      localDocumentConversionVerified,
      terminalCommandVerified,
      publicDownloadVerified,
      pathRedactionPresent,
      promotable
    }
  };
}

export function evaluateScopedAutonomyNpmDependencyDogfoodGate(runs, sampleLedger) {
  const reasons = [];
  const latest = runs.at(-1);
  if (!latest) {
    return blockedGate("scoped_autonomy_npm_dependency_dogfood", "missing_npm_dependency_dogfood", ["missing_npm_dependency_dogfood"], {});
  }
  const data = latest.data ?? {};
  const scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
  const schemaValid = data.schemaVersion === "scoped-autonomy-npm-dependency-dogfood.v1";
  const successfulScenarios = scenarios.filter((scenario) => scenario.success === true);
  const samples = (sampleLedger?.samples ?? [])
    .filter((sample) => sample?.schemaVersion === "scoped-autonomy-npm-dependency-sample.v1")
    .filter((sample) => sample.evidenceClass === "local_npm_dependency")
    .filter((sample) => normalizeEvidencePath(sample.evidencePath) === latest.path)
    .filter((sample) => sample.generatedAt === data.generatedAt);
  const executeSamples = samples.filter((sample) => sample.sample?.mode === "execute");
  const rerunSamples = samples.filter((sample) => sample.sample?.mode === "rerun");
  const p95LatencySamples = samples.map((sample) => Number(sample.sample?.elapsedMs)).filter(Number.isFinite);
  const packageInstallProvenancePresent = data.metrics?.packageInstallProvenancePresent === true &&
    scenarios.every((scenario) =>
      scenario.result?.packageInstallPerformed === true &&
      Number(scenario.result?.installedPackageCount ?? 0) >= 1 &&
      Array.isArray(scenario.result?.installedPackages) &&
      scenario.result.installedPackages.some((dependency) => dependency.packageJson?.sha256)
    );
  const dependencyPolicyReviewPresent = data.metrics?.dependencyPolicyReviewPresent === true &&
    scenarios.every((scenario) =>
      scenario.result?.dependencyPolicyReview?.schemaVersion === "toolsmith-dependency-policy-review.v1" &&
      scenario.result?.dependencyPolicyReview?.reviewOutcome === "passed_local_or_allowlisted_dependency_policy" &&
      scenario.result?.dependencyPolicyReview?.installIsolation?.ignoreScripts === true &&
      scenario.result?.dependencyPolicyReview?.installIsolation?.shell === false
    );
  const dependencyExecutionImportPresent = data.metrics?.dependencyExecutionImportPresent === true &&
    scenarios.every((scenario) =>
      scenario.result?.dependencyWorkspaceProvided === true &&
      scenario.result?.dependencyImported === true &&
      scenario.result?.probeValue === true
    ) &&
    executeSamples.every((sample) => sample.sample?.dependencyImported === true);
  const evalEvidencePresent = data.metrics?.evalEvidencePresent === true &&
    scenarios.every((scenario) =>
      scenario.result?.evalDependencyStepStatus === "completed" &&
      scenario.result?.evalExecuteStepStatus === "completed"
    );
  const artifactEvidencePresent = data.metrics?.artifactEvidencePresent === true &&
    scenarios.every((scenario) =>
      scenario.result?.artifactStored === true &&
      Number(scenario.result?.evalResourceCount ?? 0) >= 1
    );
  const rerunStabilityPresent = data.metrics?.rerunStabilityPresent === true &&
    rerunSamples.length >= 2 &&
    rerunSamples.every((sample) => sample.sample?.matched === true && sample.sample?.artifactMatched === true);
  const pathRedactionPresent = data.redaction?.rawPathsRedacted === true &&
    data.redaction?.repoPathsRelative === true &&
    Number(data.redaction?.absolutePathLeakCount ?? 1) === 0 &&
    samples.every((sample) => Number(sample.redaction?.absolutePathLeakCount ?? 1) === 0 && !hasWindowsAbsolutePath(JSON.stringify(sample)));
  const repeatedSamplesPresent = scenarios.length >= 2 &&
    executeSamples.length >= 2 &&
    rerunSamples.length >= 2 &&
    samples.every((sample) => sample.sample?.status === "completed");

  reasons.push(schemaValid ? "npm_dependency_dogfood_schema_valid" : "npm_dependency_dogfood_schema_invalid");
  reasons.push(successfulScenarios.length === scenarios.length && scenarios.length >= 2 ? "all_npm_dependency_scenarios_succeeded" : "npm_dependency_scenario_failure_or_missing");
  reasons.push(repeatedSamplesPresent ? "repeated_npm_dependency_samples_present" : "repeated_npm_dependency_samples_missing");
  reasons.push(p95LatencySamples.length >= 4 ? "npm_dependency_p95_samples_present" : "npm_dependency_p95_samples_missing");
  reasons.push(packageInstallProvenancePresent ? "npm_dependency_package_install_provenance_present" : "npm_dependency_package_install_provenance_missing");
  reasons.push(dependencyPolicyReviewPresent ? "npm_dependency_policy_review_present" : "npm_dependency_policy_review_missing");
  reasons.push(dependencyExecutionImportPresent ? "npm_dependency_execution_import_present" : "npm_dependency_execution_import_missing");
  reasons.push(evalEvidencePresent ? "npm_dependency_eval_evidence_present" : "npm_dependency_eval_evidence_missing");
  reasons.push(artifactEvidencePresent ? "npm_dependency_artifact_evidence_present" : "npm_dependency_artifact_evidence_missing");
  reasons.push(rerunStabilityPresent ? "npm_dependency_rerun_stability_present" : "npm_dependency_rerun_stability_missing");
  reasons.push(pathRedactionPresent ? "npm_dependency_path_redaction_present" : "npm_dependency_path_redaction_missing");
  reasons.push("external_package_install_policy_required_before_promotion");

  const passed =
    schemaValid &&
    successfulScenarios.length === scenarios.length &&
    scenarios.length >= 2 &&
    repeatedSamplesPresent &&
    p95LatencySamples.length >= 4 &&
    packageInstallProvenancePresent &&
    dependencyPolicyReviewPresent &&
    dependencyExecutionImportPresent &&
    evalEvidencePresent &&
    artifactEvidencePresent &&
    rerunStabilityPresent &&
    pathRedactionPresent;

  return {
    id: "scoped_autonomy_npm_dependency_dogfood",
    evidenceClass: "local_npm_dependency",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "local_dependency_gate_passed_external_package_policy_required" : "local_dependency_gate_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: [latest.path, sampleLedger?.path].filter(Boolean),
    sampleLedgerPath: sampleLedger?.path,
    metrics: {
      scenarioCount: scenarios.length,
      successCount: successfulScenarios.length,
      latestSampleCount: samples.length,
      sampleLedgerCount: sampleLedger?.samples?.length ?? 0,
      executeSampleCount: executeSamples.length,
      rerunSampleCount: rerunSamples.length,
      p95LatencySampleCount: p95LatencySamples.length,
      p95LatencyMs: p95LatencySamples.length ? percentile(p95LatencySamples, 0.95) : undefined,
      repeatedSamplesPresent,
      packageInstallProvenancePresent,
      dependencyPolicyReviewPresent,
      dependencyExecutionImportPresent,
      evalEvidencePresent,
      artifactEvidencePresent,
      rerunStabilityPresent,
      pathRedactionPresent,
      externalPackageInstallPromotable: false
    }
  };
}
