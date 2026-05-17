import { blockedGate, check, evaluateBrowserFallbackTransportCalibration, percentile, readLiveLatency, readLiveSourceStats } from "./shared.mjs";

export function evaluateProcessValidationGate(latest, previous) {
  const reasons = [];
  const metrics = latest?.data?.metrics ?? {};
  const summary = latest?.data?.summary ?? {};
  const previousMetrics = previous?.data?.metrics ?? {};
  const statusChecks = [];

  if (!latest) {
    reasons.push("missing_30_case_process_validation_evidence");
    return blockedGate("fixture_30_case_process_validation", "missing_evidence", reasons, {});
  }
  statusChecks.push(check(summary.total === 30, "scenario_count_30", "scenario_count_not_30"));
  statusChecks.push(check(Number(summary.unexpectedFailures ?? 0) === 0, "no_unexpected_failures", "unexpected_failures_present"));
  statusChecks.push(check(Number(metrics.runs ?? 0) >= 30, "eval_runs_recorded", "insufficient_eval_runs"));
  if (previous) {
    statusChecks.push(check(Number(metrics.taskSuccessRate ?? 0) >= Number(previousMetrics.taskSuccessRate ?? 0), "task_success_not_regressed", "task_success_regressed"));
    statusChecks.push(check(Number(metrics.p95LatencyMs ?? Infinity) <= Number(previousMetrics.p95LatencyMs ?? Infinity), "p95_latency_not_regressed", "p95_latency_regressed"));
    statusChecks.push(check(Number(metrics.unsafeActionRejectionRate ?? 0) <= Number(previousMetrics.unsafeActionRejectionRate ?? 0), "unsafe_rejection_not_regressed", "unsafe_rejection_regressed"));
  } else {
    statusChecks.push({ ok: false, pass: "", fail: "previous_fixture_baseline_missing" });
  }

  for (const item of statusChecks) {
    reasons.push(item.ok ? item.pass : item.fail);
  }
  const failed = statusChecks.filter((item) => !item.ok);
  const fixtureGatePassed = failed.length === 0;
  return {
    id: "fixture_30_case_process_validation",
    evidenceClass: "fixture",
    status: fixtureGatePassed ? "passed" : "blocked",
    promotable: false,
    promotionClass: fixtureGatePassed ? "fixture_gate_passed_live_gate_required" : "fixture_gate_blocked",
    reasons: [
      ...reasons,
      "fixture_success_never_promotes_live_computer_use_without_live_trace_gate"
    ],
    latestEvidencePath: latest.path,
    baselineEvidencePath: previous?.path,
    metrics: {
      taskSuccessRate: metrics.taskSuccessRate,
      proofRate: metrics.proofRate,
      p95LatencyMs: metrics.p95LatencyMs,
      p95PerceptionLatencyMs: metrics.p95PerceptionLatencyMs,
      unsafeActionRejectionRate: metrics.unsafeActionRejectionRate,
      previousP95LatencyMs: previousMetrics.p95LatencyMs,
      previousTaskSuccessRate: previousMetrics.taskSuccessRate
    }
  };
}

export function evaluateLiveTaskBenchmarkHarnessGate(runs) {
  const latest = runs.at(-1);
  const reasons = [];
  if (!latest) {
    return blockedGate("live_task_benchmark_harness", "missing_live_task_benchmark_evidence", ["missing_live_task_benchmark_evidence"], {});
  }
  const data = latest.data ?? {};
  const metrics = data.metrics ?? {};
  const gate = data.promotionGate ?? {};
  const corpus = data.corpus ?? {};
  const taskCount = Number(metrics.taskCount ?? 0);
  const successRate = Number(metrics.successRate ?? 0);
  const rollbackCoverage = Number(metrics.rollbackCoverage ?? 0);
  const evidenceCoverage = Number(metrics.evidenceCoverage ?? 0);
  const fixtureOnly = corpus.fixtureOnly === true;
  reasons.push(data.schemaVersion === "computer-use-live-task-benchmark.v1" ? "live_task_benchmark_schema_present" : "live_task_benchmark_schema_missing");
  reasons.push(taskCount >= 3 ? "windows_browser_terminal_task_fixture_present" : "insufficient_task_fixture_count");
  reasons.push(successRate >= 1 ? "all_benchmark_tasks_succeeded" : "benchmark_task_failure_present");
  reasons.push(rollbackCoverage >= 1 ? "rollback_coverage_complete" : "rollback_coverage_incomplete");
  reasons.push(evidenceCoverage >= 1 ? "evidence_coverage_complete" : "evidence_coverage_incomplete");
  reasons.push(fixtureOnly ? "fixture_corpus_requires_user_captured_live_data_for_promotion" : "user_captured_live_corpus_present");
  const passed = data.schemaVersion === "computer-use-live-task-benchmark.v1" &&
    taskCount >= 3 &&
    successRate >= 1 &&
    rollbackCoverage >= 1 &&
    evidenceCoverage >= 1;
  return {
    id: "live_task_benchmark_harness",
    evidenceClass: fixtureOnly ? "fixture_live_task_harness" : "live_task_benchmark",
    status: passed ? "passed" : "blocked",
    promotable: gate.promotable === true && !fixtureOnly,
    promotionClass: fixtureOnly ? "fixture_gate_passed_live_data_required" : gate.promotable === true ? "eligible_for_promotion_review" : "live_task_gate_blocked",
    reasons,
    latestEvidencePath: latest.path,
    evidencePaths: runs.map((run) => run.path),
    metrics: {
      taskCount,
      successRate,
      p95LatencyMs: metrics.p95LatencyMs,
      rollbackCoverage,
      evidenceCoverage,
      fixtureOnly
    }
  };
}

export function evaluateLiveWebResearchGate(id, runs, sampleLedger) {
  const reasons = [];
  if (!runs.length && !sampleLedger.samples.length) {
    return blockedGate(id, "missing_live_evidence", ["missing_live_evidence"], {});
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
  const p95Values = scenarioRuns
    .map((item) => readLiveLatency(item.scenario, item.run.data))
    .filter((value) => Number.isFinite(value));
  const sourceQualityAccepted = scenarioRuns.some((item) => item.scenario?.result?.sourceQualityReview === "accepted" || item.run.data?.sourceQualityReview === "accepted");
  const sourceStats = scenarioRuns.map((item) => readLiveSourceStats(item.scenario));
  const maxValidSources = sourceStats.reduce((max, value) => Math.max(max, value.validLiveSourceCount), 0);
  const fallbackOnly = sourceStats.some((stats) => stats.fallbackOnly);
  const fallbackCalibration = evaluateBrowserFallbackTransportCalibration(scenarioRuns);

  reasons.push(successes.length === scenarioRuns.length && scenarioRuns.length > 0 ? "all_live_runs_succeeded" : "live_run_failure_or_missing_success");
  reasons.push(scenarioRuns.length >= 2 ? "repeated_live_runs_present" : "single_live_run_only");
  reasons.push(p95Values.length >= 2 ? "p95_latency_samples_present" : "p95_latency_samples_missing");
  reasons.push(sourceQualityAccepted ? "source_quality_review_accepted" : "source_quality_review_missing");
  reasons.push(maxValidSources >= 2 ? "live_source_evidence_present" : "insufficient_live_source_evidence");
  if (fallbackOnly) {
    reasons.push(fallbackCalibration.accepted ? "browser_fallback_transport_calibrated" : "browser_fallback_only_requires_more_calibration");
  }

  const promotable =
    scenarioRuns.length >= 2 &&
    successes.length === scenarioRuns.length &&
    p95Values.length >= 2 &&
    sourceQualityAccepted &&
    maxValidSources >= 2 &&
    (!fallbackOnly || fallbackCalibration.accepted);

  return {
    id,
    evidenceClass: "live",
    status: promotable ? "passed" : "blocked",
    promotable,
    promotionClass: promotable ? "eligible_for_promotion_review" : "live_gate_blocked",
    reasons,
    latestEvidencePath: runs.at(-1)?.path,
    evidencePaths: runs.map((run) => run.path),
    sampleLedgerPath: sampleLedger.path,
    metrics: {
      liveRunCount: scenarioRuns.length,
      successCount: successes.length,
      sampleLedgerCount: sampleLedger.samples.length,
      p95LatencySampleCount: p95Values.length,
      p95LatencyMs: p95Values.length ? percentile(p95Values, 0.95) : undefined,
      maxValidLiveSourceCount: maxValidSources,
      fallbackOnly,
      browserFallbackTransportCalibrated: fallbackCalibration.accepted,
      browserFallbackCalibration: fallbackCalibration,
      directFetchedSourceCount: sourceStats.reduce((sum, stats) => sum + stats.directFetchedSourceCount, 0),
      fallbackSourceCount: sourceStats.reduce((sum, stats) => sum + stats.fallbackSourceCount, 0)
    }
  };
}
