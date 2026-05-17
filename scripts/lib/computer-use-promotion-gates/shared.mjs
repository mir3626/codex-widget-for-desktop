

export function blockedGate(id, promotionClass, reasons, metrics) {
  return {
    id,
    evidenceClass: "unknown",
    status: "blocked",
    promotable: false,
    promotionClass,
    reasons,
    metrics
  };
}

export function summarizeGates(gates) {
  const promotable = gates.filter((gate) => gate.promotable);
  const blocked = gates.filter((gate) => gate.status === "blocked");
  const passedNonPromotable = gates.filter((gate) => gate.status === "passed" && !gate.promotable);
  return {
    overallStatus: blocked.length > 0 ? "blocked" : promotable.length > 0 ? "promotable" : "passed_no_promotable_slices",
    promotableSlices: promotable.map((gate) => gate.id),
    blockedSlices: blocked.map((gate) => gate.id),
    passedNonPromotableSlices: passedNonPromotable.map((gate) => gate.id),
    noSingleRunPromotion: gates.every((gate) => gate.reasons.includes("single_live_run_only") ? !gate.promotable : true)
  };
}

export function hasSensitiveLiteral(entry) {
  return /\b(password|token|cookie|payment|secret|credential)\b/i.test(JSON.stringify(entry));
}

export function readLiveLatency(scenario, document) {
  const direct = Number(scenario?.result?.p95LatencyMs ?? scenario?.result?.elapsedMs ?? document?.metrics?.p95LatencyMs);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const evalElapsed = Number(document?.debugBundle?.evalRun?.elapsedMs);
  return Number.isFinite(evalElapsed) ? evalElapsed : Number.NaN;
}

export function readLiveSourceStats(scenario) {
  const result = scenario?.result && typeof scenario.result === "object" ? scenario.result : {};
  const rows = [
    ...readRows(result.statuses),
    ...readRows(result.sourceSummary?.rows)
  ];
  const browserCaptures = readRows(result.browserFallbackCaptures);
  const directFetchedSourceCount = rows.filter((row) =>
    String(row.status) === "200" &&
    row.browserFallback !== true &&
    Number(row.chars ?? 0) > 300
  ).length;
  const fallbackRows = rows.filter((row) =>
    (row.browserFallback === true || String(row.status) === "browser_fallback") &&
    Number(row.chars ?? 0) > 300
  ).length;
  const fallbackCaptureCount = Math.max(
    fallbackRows,
    Number(result.validBrowserCaptureCount ?? 0),
    Number(result.browserFallbackCount ?? 0),
    browserCaptures.filter((row) => Number(row.chars ?? 0) > 300).length
  );
  const declaredValidSourceCount = Math.max(
    Number(result.validLiveSourceCount ?? 0),
    Number(result.validSourceSummaryCount ?? 0),
    Number(result.validBrowserCaptureCount ?? 0)
  );
  const validLiveSourceCount = Math.max(declaredValidSourceCount, directFetchedSourceCount + fallbackRows, fallbackCaptureCount);
  return {
    validLiveSourceCount,
    directFetchedSourceCount,
    fallbackSourceCount: fallbackCaptureCount,
    fallbackOnly: validLiveSourceCount > 0 && directFetchedSourceCount === 0 && fallbackCaptureCount > 0
  };
}

export function evaluateBrowserFallbackTransportCalibration(scenarioRuns) {
  const calibratedRuns = scenarioRuns
    .map((item) => item.scenario?.result?.browserFallbackCalibration)
    .filter((calibration) =>
      calibration &&
      calibration.status === "accepted" &&
      Array.isArray(calibration.captures) &&
      calibration.captures.length >= 2
    );
  const hashOccurrences = new Map();
  for (const calibration of calibratedRuns) {
    const seenInRun = new Set();
    for (const capture of calibration.captures) {
      if (!capture.urlHash || !capture.textSha256 || Number(capture.chars ?? 0) <= 300) {
        continue;
      }
      const key = `${capture.urlHash}:${capture.textSha256}`;
      if (seenInRun.has(key)) {
        continue;
      }
      seenInRun.add(key);
      hashOccurrences.set(key, (hashOccurrences.get(key) ?? 0) + 1);
    }
  }
  const repeatedStableCaptures = [...hashOccurrences.values()].filter((count) => count >= 2).length;
  const accepted = calibratedRuns.length >= 2 && repeatedStableCaptures >= 2;
  return {
    schemaVersion: "browser-fallback-transport-calibration-gate.v1",
    accepted,
    calibratedRunCount: calibratedRuns.length,
    repeatedStableCaptureCount: repeatedStableCaptures,
    requiredCalibratedRunCount: 2,
    requiredRepeatedStableCaptureCount: 2,
    reason: accepted ? "browser_fallback_capture_hashes_stable_across_repeated_runs" : "insufficient_repeated_stable_browser_fallback_hashes"
  };
}

export function readRows(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

export function readGeneratedToolSampleCapability(sample) {
  return String(sample?.sample?.capability ?? sample?.scenario?.result?.capability ?? "");
}

export function hasWindowsAbsolutePath(text) {
  return /(^|[^A-Za-z])[A-Z]:[\\/]/.test(String(text ?? ""));
}

export function evaluateGeneratedToolLiveWebFallbackCalibration(webScenarios) {
  const hashOccurrences = new Map();
  for (const scenario of webScenarios) {
    const captures = Array.isArray(scenario.result?.browserFallbackCalibration?.captures)
      ? scenario.result.browserFallbackCalibration.captures
      : Array.isArray(scenario.result?.sourceHashes)
        ? scenario.result.sourceHashes
        : [];
    const seenInScenario = new Set();
    for (const capture of captures) {
      if (!capture.urlHash || !capture.textSha256 || Number(capture.chars ?? 0) <= 300) {
        continue;
      }
      const key = `${capture.urlHash}:${capture.textSha256}`;
      if (seenInScenario.has(key)) {
        continue;
      }
      seenInScenario.add(key);
      hashOccurrences.set(key, (hashOccurrences.get(key) ?? 0) + 1);
    }
  }
  const repeatedStableCaptureCount = [...hashOccurrences.values()].filter((count) => count >= 2).length;
  const accepted = webScenarios.length >= 2 && repeatedStableCaptureCount >= 2;
  return {
    schemaVersion: "generated-tool-live-web-fallback-calibration.v1",
    accepted,
    webRunCount: webScenarios.length,
    repeatedStableCaptureCount,
    requiredWebRunCount: 2,
    requiredRepeatedStableCaptureCount: 2,
    reason: accepted ? "web_generated_tool_capture_hashes_stable_across_repeated_runs" : "insufficient_repeated_stable_web_generated_tool_capture_hashes"
  };
}

export function check(ok, pass, fail) {
  return { ok, pass, fail };
}

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

export function normalizeEvidencePath(value) {
  return typeof value === "string" ? value.replace(/\\/g, "/") : "";
}

export function renderReport(evidence) {
  const lines = [
    "# Computer Use Promotion Gate",
    "",
    `Generated: ${evidence.generatedAt}`,
    `Overall status: \`${evidence.summary.overallStatus}\``,
    "",
    "## Gates",
    ""
  ];
  for (const gate of evidence.gates) {
    lines.push(`### ${gate.id}`);
    lines.push("");
    lines.push(`- status: \`${gate.status}\``);
    lines.push(`- promotable: \`${gate.promotable}\``);
    lines.push(`- class: \`${gate.promotionClass}\``);
    if (gate.latestEvidencePath) {
      lines.push(`- latest evidence: \`${gate.latestEvidencePath}\``);
    }
    lines.push(`- reasons: ${gate.reasons.map((reason) => `\`${reason}\``).join(", ")}`);
    lines.push(`- metrics: \`${JSON.stringify(gate.metrics)}\``);
    lines.push("");
  }
  lines.push("## Rule");
  lines.push("");
  lines.push("Fixture success can pass fixture readiness, but it cannot promote live computer-use behavior without repeated live trace evidence, p95 latency samples, accepted source-quality review, non-fallback calibration where required, and no safety regression.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function localDateString() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
