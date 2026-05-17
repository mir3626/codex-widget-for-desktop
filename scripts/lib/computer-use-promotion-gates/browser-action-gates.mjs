import { readBrowserActionReportRow } from "./readers.mjs";
import { blockedGate, hasSensitiveLiteral, percentile } from "./shared.mjs";

export function evaluateComputerSessionBrowserPromptDogfoodGate(runs) {
  const requiredIntents = [
    "read_current_page",
    "search_form_fill_submit",
    "representative_content_selection",
    "navigation"
  ];
  const reasons = [];
  const latest = runs.at(-1) ?? null;
  if (!latest) {
    return blockedGate("computer_session_browser_prompt_dogfood", "missing_fixture_evidence", ["missing_computer_session_browser_prompt_dogfood"], {});
  }
  const scenarios = Array.isArray(latest.data?.scenarios) ? latest.data.scenarios : [];
  const successes = scenarios.filter((scenario) => scenario.success === true);
  const intentClasses = new Set(scenarios.map((scenario) => scenario.intentClass).filter(Boolean));
  const requiredIntentsPresent = requiredIntents.every((intent) => intentClasses.has(intent));
  const promptRouteEvidence = latest.data?.metrics?.directComputerSessionPromptRoute === true &&
    scenarios.every((scenario) => Array.isArray(scenario.architectureWorkflow) && scenario.architectureWorkflow.join("\n").includes("browser-action-prompt"));
  const allPromptRunsCompleted = scenarios.every((scenario) =>
    scenario.result?.promptRunStatus === "completed" &&
    Number(scenario.result?.completedStepCount ?? 0) === Number(scenario.result?.stepCount ?? -1) &&
    Number(scenario.result?.stepCount ?? 0) >= 1
  );
  const allDagEvidencePresent = scenarios.every((scenario) =>
    Number(scenario.result?.verificationNodeCount ?? 0) >= 1 &&
    Number(scenario.result?.evalLedgerNodeCount ?? 0) >= 1 &&
    Number(scenario.result?.promptPlanEvalStepCount ?? 0) >= 1 &&
    Number(scenario.result?.promptStepEvalStepCount ?? 0) >= 1
  );
  const allObservationEvidencePresent = scenarios.every((scenario) =>
    Number(scenario.result?.browserDomObservationCount ?? 0) >= 1 &&
    (scenario.intentClass === "read_current_page" || Number(scenario.result?.perceptionGraphCount ?? 0) >= 1) &&
    Number(scenario.result?.actionFeedbackCount ?? 0) >= 1
  );
  const allCleanupPresent = scenarios.every((scenario) => scenario.result?.cleanupRollbackCompleted === true);
  const elapsedValues = scenarios.map((scenario) => Number(scenario.result?.elapsedMs)).filter((value) => Number.isFinite(value));
  const noSensitiveLiteral = scenarios.every((scenario) => !hasSensitiveLiteral(scenario));

  reasons.push(scenarios.length >= 4 ? "fixture_prompt_case_count_present" : "insufficient_fixture_prompt_cases");
  reasons.push(successes.length === scenarios.length && scenarios.length > 0 ? "all_fixture_prompt_cases_succeeded" : "fixture_prompt_case_failure_present");
  reasons.push(requiredIntentsPresent ? "required_prompt_intent_coverage_present" : "missing_prompt_intent_coverage");
  reasons.push(promptRouteEvidence ? "direct_computer_session_prompt_route_evidence_present" : "missing_direct_prompt_route_evidence");
  reasons.push(allPromptRunsCompleted ? "all_prompt_runs_completed" : "prompt_run_incomplete");
  reasons.push(allDagEvidencePresent ? "prompt_dag_and_eval_evidence_present" : "prompt_dag_or_eval_evidence_missing");
  reasons.push(allObservationEvidencePresent ? "prompt_observation_graph_feedback_present" : "prompt_observation_graph_feedback_missing");
  reasons.push(allCleanupPresent ? "isolated_browser_cleanup_evidence_present" : "isolated_browser_cleanup_evidence_missing");
  reasons.push(noSensitiveLiteral ? "redacted_prompt_dogfood_only" : "sensitive_literal_detected");
  reasons.push(elapsedValues.length >= scenarios.length ? "latency_samples_present" : "latency_samples_missing");
  reasons.push("fixture_prompt_dogfood_needs_live_public_site_gate_before_promotion");

  const passed = scenarios.length >= 4 &&
    successes.length === scenarios.length &&
    requiredIntentsPresent &&
    promptRouteEvidence &&
    allPromptRunsCompleted &&
    allDagEvidencePresent &&
    allObservationEvidencePresent &&
    allCleanupPresent &&
    noSensitiveLiteral &&
    elapsedValues.length >= scenarios.length;

  return {
    id: "computer_session_browser_prompt_dogfood",
    evidenceClass: "fixture_prompt_dogfood",
    status: passed ? "passed" : "blocked",
    promotable: false,
    promotionClass: passed ? "fixture_gate_passed_live_gate_required" : "fixture_gate_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: runs.map((run) => run.path),
    metrics: {
      caseCount: scenarios.length,
      successCount: successes.length,
      intentCount: intentClasses.size,
      requiredIntentsPresent,
      promptRouteEvidence,
      p95LatencyMs: elapsedValues.length ? percentile(elapsedValues, 0.95) : undefined,
      fixtureBacked: latest.data?.metrics?.fixtureBacked === true,
      directComputerSessionPromptRoute: latest.data?.metrics?.directComputerSessionPromptRoute === true,
      promotable: false
    }
  };
}

export function evaluateComputerSessionBrowserPromptLiveGate(runs, sampleLedger) {
  const requiredIntents = [
    "read_current_page",
    "search_form_fill_submit",
    "representative_content_selection",
    "navigation"
  ];
  const reasons = [];
  if (!runs.length && !sampleLedger.samples.length) {
    return blockedGate("computer_session_browser_prompt_live", "missing_live_evidence", ["missing_computer_session_browser_prompt_live_evidence"], {});
  }
  const sampleEvidencePaths = new Set(sampleLedger.samples.map((sample) => sample.evidencePath).filter(Boolean));
  const scenarioRuns = runs.flatMap((run) => {
    if (sampleEvidencePaths.has(run.path)) {
      return [];
    }
    const scenarios = Array.isArray(run.data?.scenarios) ? run.data.scenarios : [];
    return scenarios.map((scenario) => ({ run, scenario }));
  }).concat(sampleLedger.samples.map((sample) => ({
    run: {
      path: sample.evidencePath ?? sampleLedger.path,
      data: sample
    },
    scenario: sample.scenario
  })));
  const successes = scenarioRuns.filter((item) => item.scenario?.success === true);
  const intentClasses = new Set(scenarioRuns.map((item) => item.scenario?.intentClass).filter(Boolean));
  const hosts = new Set(scenarioRuns.map((item) => item.scenario?.sourceHost ?? item.scenario?.result?.sourceHost).filter(Boolean));
  const runIds = new Set(sampleLedger.samples.map((sample) => sample.runId).filter(Boolean));
  const requiredIntentsPresent = requiredIntents.every((intent) => intentClasses.has(intent));
  const requiredHostsPresent = hosts.has("example.com") && hosts.has("wikipedia.org") && hosts.has("iana.org");
  const repeatedRunsPresent = runIds.size >= 2 || scenarioRuns.length >= requiredIntents.length * 2;
  const promptRouteEvidence = scenarioRuns.every((item) =>
    Array.isArray(item.scenario?.architectureWorkflow) &&
    item.scenario.architectureWorkflow.join("\n").includes("browser-action-prompt")
  );
  const allPromptRunsCompleted = scenarioRuns.every((item) =>
    item.scenario?.result?.promptRunStatus === "completed" &&
    Number(item.scenario?.result?.completedStepCount ?? 0) === Number(item.scenario?.result?.stepCount ?? -1) &&
    Number(item.scenario?.result?.stepCount ?? 0) >= 1
  );
  const allDagEvidencePresent = scenarioRuns.every((item) =>
    Number(item.scenario?.result?.verificationNodeCount ?? 0) >= 1 &&
    Number(item.scenario?.result?.evalLedgerNodeCount ?? 0) >= 1 &&
    Number(item.scenario?.result?.promptPlanEvalStepCount ?? 0) >= 1 &&
    Number(item.scenario?.result?.promptStepEvalStepCount ?? 0) >= 1
  );
  const allObservationEvidencePresent = scenarioRuns.every((item) =>
    Number(item.scenario?.result?.browserDomObservationCount ?? 0) >= 1 &&
    (item.scenario?.intentClass === "read_current_page" || Number(item.scenario?.result?.perceptionGraphCount ?? 0) >= 1) &&
    Number(item.scenario?.result?.actionFeedbackCount ?? 0) >= 1
  );
  const allCleanupPresent = scenarioRuns.every((item) => item.scenario?.result?.cleanupRollbackCompleted === true);
  const allPublic = scenarioRuns.every((item) => item.scenario?.result?.redaction?.urls === "public_url_metadata_only" || item.scenario?.result?.sourceHost);
  const elapsedValues = scenarioRuns.map((item) => Number(item.scenario?.result?.elapsedMs ?? item.scenario?.result?.p95LatencyMs)).filter((value) => Number.isFinite(value));
  const noSensitiveLiteral = scenarioRuns.every((item) => !hasSensitiveLiteral(item.scenario));

  reasons.push(scenarioRuns.length >= requiredIntents.length * 2 ? "repeated_live_prompt_samples_present" : "insufficient_live_prompt_samples");
  reasons.push(successes.length === scenarioRuns.length && scenarioRuns.length > 0 ? "all_live_prompt_cases_succeeded" : "live_prompt_case_failure_present");
  reasons.push(requiredIntentsPresent ? "required_live_prompt_intent_coverage_present" : "missing_live_prompt_intent_coverage");
  reasons.push(requiredHostsPresent ? "public_site_host_coverage_present" : "missing_public_site_host_coverage");
  reasons.push(repeatedRunsPresent ? "repeated_live_runs_present" : "single_live_run_only");
  reasons.push(promptRouteEvidence ? "direct_computer_session_prompt_route_evidence_present" : "missing_direct_prompt_route_evidence");
  reasons.push(allPromptRunsCompleted ? "all_live_prompt_runs_completed" : "live_prompt_run_incomplete");
  reasons.push(allDagEvidencePresent ? "live_prompt_dag_and_eval_evidence_present" : "live_prompt_dag_or_eval_evidence_missing");
  reasons.push(allObservationEvidencePresent ? "live_prompt_observation_graph_feedback_present" : "live_prompt_observation_graph_feedback_missing");
  reasons.push(allCleanupPresent ? "isolated_browser_cleanup_evidence_present" : "isolated_browser_cleanup_evidence_missing");
  reasons.push(allPublic ? "public_url_metadata_only" : "public_site_metadata_missing");
  reasons.push(noSensitiveLiteral ? "redacted_live_prompt_corpus_only" : "sensitive_literal_detected");
  reasons.push(elapsedValues.length >= scenarioRuns.length ? "p95_latency_samples_present" : "p95_latency_samples_missing");

  const promotable = scenarioRuns.length >= requiredIntents.length * 2 &&
    successes.length === scenarioRuns.length &&
    requiredIntentsPresent &&
    requiredHostsPresent &&
    repeatedRunsPresent &&
    promptRouteEvidence &&
    allPromptRunsCompleted &&
    allDagEvidencePresent &&
    allObservationEvidencePresent &&
    allCleanupPresent &&
    allPublic &&
    noSensitiveLiteral &&
    elapsedValues.length >= scenarioRuns.length;

  return {
    id: "computer_session_browser_prompt_live",
    evidenceClass: "live_prompt",
    status: promotable ? "passed" : "blocked",
    promotable,
    promotionClass: promotable ? "eligible_for_promotion_review" : "live_gate_blocked",
    reasons,
    latestEvidencePath: runs.at(-1)?.path,
    evidencePaths: runs.map((run) => run.path),
    sampleLedgerPath: sampleLedger.path,
    metrics: {
      liveSampleCount: scenarioRuns.length,
      successCount: successes.length,
      runCount: runIds.size || runs.length,
      intentCount: intentClasses.size,
      sourceHostCount: hosts.size,
      requiredIntentsPresent,
      requiredHostsPresent,
      p95LatencySampleCount: elapsedValues.length,
      p95LatencyMs: elapsedValues.length ? percentile(elapsedValues, 0.95) : undefined,
      directComputerSessionPromptRoute: promptRouteEvidence,
      fixtureBacked: false,
      livePublicSite: true
    }
  };
}

export function evaluateBrowserActionSemanticCorpusGate(corpus) {
  const requiredIntents = [
    "read_current_page",
    "filter_or_tab_activation",
    "history_navigation",
    "search_form_fill_submit",
    "representative_content_selection"
  ];
  const reasons = [];
  if (!corpus.entries.length) {
    return blockedGate("browser_action_semantic_live_corpus", "missing_live_corpus", ["missing_browser_action_semantic_live_corpus"], {});
  }
  const rows = corpus.entries.map((entry) => ({
    entry,
    row: readBrowserActionReportRow(entry.reportPath, entry.scenarioId)
  }));
  const ids = new Set();
  const duplicateIds = [];
  for (const entry of corpus.entries) {
    if (ids.has(entry.id)) {
      duplicateIds.push(entry.id);
    }
    ids.add(entry.id);
  }
  const intentClasses = new Set(corpus.entries.map((entry) => entry.intentClass).filter(Boolean));
  const sources = new Set(corpus.entries.map((entry) => entry.source).filter(Boolean));
  const reports = new Set(corpus.entries.map((entry) => entry.reportPath).filter(Boolean));
  const allRowsFound = rows.every((item) => item.row !== null);
  const allExpectedPass = rows.every((item) => item.entry.expectStatus === "pass");
  const allReportRowsPass = rows.every((item) => item.row?.status === "pass");
  const modeMatches = rows.every((item) => item.row?.mode === item.entry.mode);
  const requiredIntentsPresent = requiredIntents.every((intent) => intentClasses.has(intent));
  const sourceCoveragePresent = sources.has("live-widget-ui") && sources.has("live-isolated");
  const noSensitiveLiteral = corpus.entries.every((entry) => !hasSensitiveLiteral(entry));
  const elapsedValues = rows.map((item) => Number(item.row?.elapsedMs)).filter((value) => Number.isFinite(value));
  const p95LatencyMs = elapsedValues.length ? percentile(elapsedValues, 0.95) : undefined;

  reasons.push(corpus.entries.length >= 10 ? "reviewed_live_case_count_present" : "insufficient_reviewed_live_cases");
  reasons.push(duplicateIds.length === 0 ? "no_duplicate_corpus_ids" : "duplicate_corpus_ids");
  reasons.push(allRowsFound ? "all_report_rows_found" : "missing_report_rows");
  reasons.push(allExpectedPass && allReportRowsPass ? "all_reviewed_cases_passed" : "reviewed_case_failure_present");
  reasons.push(modeMatches ? "report_modes_match_corpus" : "report_mode_mismatch");
  reasons.push(requiredIntentsPresent ? "required_intent_coverage_present" : "missing_required_intent_coverage");
  reasons.push(sourceCoveragePresent ? "widget_and_isolated_sources_present" : "missing_widget_or_isolated_source");
  reasons.push(noSensitiveLiteral ? "redacted_corpus_only" : "sensitive_literal_detected");
  reasons.push(elapsedValues.length >= corpus.entries.length ? "latency_samples_present" : "latency_samples_missing");

  const promotable = corpus.entries.length >= 10 &&
    duplicateIds.length === 0 &&
    allRowsFound &&
    allExpectedPass &&
    allReportRowsPass &&
    modeMatches &&
    requiredIntentsPresent &&
    sourceCoveragePresent &&
    noSensitiveLiteral &&
    elapsedValues.length >= corpus.entries.length;

  return {
    id: "browser_action_semantic_live_corpus",
    evidenceClass: "live",
    status: promotable ? "passed" : "blocked",
    promotable,
    promotionClass: promotable ? "eligible_for_promotion_review" : "live_gate_blocked",
    reasons,
    latestEvidencePath: corpus.path,
    evidencePaths: [...reports],
    metrics: {
      caseCount: corpus.entries.length,
      reportCount: reports.size,
      intentCount: intentClasses.size,
      sourceCount: sources.size,
      p95LatencyMs,
      requiredIntentsPresent,
      sourceCoveragePresent,
      reportRowsFound: rows.filter((item) => item.row !== null).length,
      duplicateIds
    }
  };
}

export function evaluateBrowserActionRecoveryCorpusGate(corpus) {
  const requiredFailureClasses = ["permission_missing", "wrong_effect", "latency_regression"];
  const reasons = [];
  if (!corpus.entries.length) {
    return blockedGate("browser_action_recovery_live_corpus", "missing_recovery_corpus", ["missing_browser_action_recovery_live_corpus"], {});
  }
  const rows = corpus.entries.map((entry) => ({
    entry,
    failureRow: readBrowserActionReportRow(entry.failureReportPath, entry.scenarioId),
    recoveryRow: readBrowserActionReportRow(entry.recoveryReportPath, entry.scenarioId)
  }));
  const ids = new Set();
  const duplicateIds = [];
  for (const entry of corpus.entries) {
    if (ids.has(entry.id)) {
      duplicateIds.push(entry.id);
    }
    ids.add(entry.id);
  }
  const failureClasses = new Set(corpus.entries.map((entry) => entry.failureClass).filter(Boolean));
  const sources = new Set(corpus.entries.map((entry) => entry.source).filter(Boolean));
  const reports = new Set(corpus.entries.flatMap((entry) => [entry.failureReportPath, entry.recoveryReportPath]).filter(Boolean));
  const allRowsFound = rows.every((item) => item.failureRow !== null && item.recoveryRow !== null);
  const allFailuresRecorded = rows.every((item) =>
    item.failureRow?.status === "fail" &&
    item.failureRow?.failureClass === item.entry.failureClass
  );
  const allRecoveriesPassed = rows.every((item) => item.recoveryRow?.status === "pass");
  const modeMatches = rows.every((item) => item.recoveryRow?.mode === item.entry.mode);
  const requiredFailureCoveragePresent = requiredFailureClasses.every((failureClass) => failureClasses.has(failureClass));
  const sourceCoveragePresent = sources.has("live-widget-ui") && sources.has("live-isolated");
  const noSensitiveLiteral = corpus.entries.every((entry) => !hasSensitiveLiteral(entry));
  const recoveryEvidencePresent = corpus.entries.every((entry) =>
    Array.isArray(entry.recoveryEvidence) &&
    entry.recoveryEvidence.length > 0 &&
    Array.isArray(entry.calibrationImpact) &&
    entry.calibrationImpact.length > 0
  );
  const failureLatencies = rows.map((item) => Number(item.failureRow?.elapsedMs)).filter((value) => Number.isFinite(value));
  const recoveryLatencies = rows.map((item) => Number(item.recoveryRow?.elapsedMs)).filter((value) => Number.isFinite(value));

  reasons.push(corpus.entries.length >= 4 ? "reviewed_recovery_case_count_present" : "insufficient_recovery_cases");
  reasons.push(duplicateIds.length === 0 ? "no_duplicate_recovery_ids" : "duplicate_recovery_ids");
  reasons.push(allRowsFound ? "all_failure_and_recovery_rows_found" : "missing_failure_or_recovery_rows");
  reasons.push(allFailuresRecorded ? "all_failure_rows_preserved" : "failure_row_mismatch");
  reasons.push(allRecoveriesPassed ? "all_recovery_rows_passed" : "recovery_failure_present");
  reasons.push(modeMatches ? "recovery_modes_match_corpus" : "recovery_mode_mismatch");
  reasons.push(requiredFailureCoveragePresent ? "required_failure_class_coverage_present" : "missing_failure_class_coverage");
  reasons.push(sourceCoveragePresent ? "widget_and_isolated_recovery_sources_present" : "missing_recovery_source_coverage");
  reasons.push(noSensitiveLiteral ? "redacted_recovery_corpus_only" : "sensitive_literal_detected");
  reasons.push(recoveryEvidencePresent ? "recovery_evidence_and_calibration_present" : "recovery_evidence_or_calibration_missing");
  reasons.push(recoveryLatencies.length >= corpus.entries.length && failureLatencies.length >= corpus.entries.length ? "failure_and_recovery_latency_samples_present" : "failure_or_recovery_latency_samples_missing");

  const promotable = corpus.entries.length >= 4 &&
    duplicateIds.length === 0 &&
    allRowsFound &&
    allFailuresRecorded &&
    allRecoveriesPassed &&
    modeMatches &&
    requiredFailureCoveragePresent &&
    sourceCoveragePresent &&
    noSensitiveLiteral &&
    recoveryEvidencePresent &&
    recoveryLatencies.length >= corpus.entries.length &&
    failureLatencies.length >= corpus.entries.length;

  return {
    id: "browser_action_recovery_live_corpus",
    evidenceClass: "live_recovery",
    status: promotable ? "passed" : "blocked",
    promotable,
    promotionClass: promotable ? "eligible_for_recovery_calibration_review" : "recovery_gate_blocked",
    reasons,
    latestEvidencePath: corpus.path,
    evidencePaths: [...reports],
    metrics: {
      caseCount: corpus.entries.length,
      reportCount: reports.size,
      failureClassCount: failureClasses.size,
      sourceCount: sources.size,
      requiredFailureCoveragePresent,
      sourceCoveragePresent,
      failureRowsFound: rows.filter((item) => item.failureRow !== null).length,
      recoveryRowsFound: rows.filter((item) => item.recoveryRow !== null).length,
      p95FailureLatencyMs: failureLatencies.length ? percentile(failureLatencies, 0.95) : undefined,
      p95RecoveryLatencyMs: recoveryLatencies.length ? percentile(recoveryLatencies, 0.95) : undefined,
      duplicateIds
    }
  };
}
