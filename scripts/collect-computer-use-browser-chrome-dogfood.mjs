#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const DATE = process.env.CODEX_WIDGET_DOGFOOD_DATE ?? formatSeoulDate(new Date());
const runId = `computer-use-browser-chrome-dogfood-${formatKstTimestamp(new Date())}`;
const repoRoot = process.cwd();
const dogfoodPath = join(repoRoot, "docs", "dogfood", `computer-use-browser-chrome-dogfood-${DATE}.json`);
const reportPath = join(repoRoot, "docs", "reports", `computer-use-browser-chrome-dogfood-${DATE}.md`);
const assetDir = join(repoRoot, "docs", "reports", "assets", `computer-use-browser-chrome-dogfood-${DATE}`);
const evidencePath = join(assetDir, "evidence.json");
const sampleLedgerPath = join(repoRoot, "docs", "reports", "assets", "computer-use-browser-chrome-dogfood-runs.jsonl");

await rm(assetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(assetDir, { recursive: true });

const smokeAppData = useSmokeAppData("codex-widget-computer-use-browser-chrome-dogfood");
const downloadPath = join(smokeAppData.dir, "browser-chrome-dogfood-report.pdf");
writeFileSync(downloadPath, "%PDF-1.4\n% browser chrome dogfood download fixture\n", "utf8");

const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];

const scenarios = [
  {
    id: "browser-chrome-download-verify-repeat",
    command: "download.verify",
    repeatCount: 2,
    userScenario: "사용자가 현재 브라우저 다운로드 목록에서 방금 받은 PDF가 완료되었는지 확인하고, 승인된 다운로드 파일 증거를 남기도록 요청한다.",
    architectureWorkflow: [
      "Computer Session starts on the regular_browser_extension surface with an explicit browser chrome permission profile.",
      "A browser_chrome operation requests download.verify with an approved local download path rooted in the scoped profile.",
      "Browser Bridge polling delivers the bounded Browser Chrome command to the extension channel.",
      "The fixture bridge returns redacted download completion metadata, simulating the extension API result without exposing full local paths.",
      "ComputerSessionRuntime stores a blob-backed download_verified_file eval resource, a file observation, DAG verification, and eval-ledger evidence.",
      "The debug bundle links the capability job, DAG node, observation, eval resource, verifier result, and basename-only redaction policy."
    ],
    input: () => ({
      command: "download.verify",
      id: 5,
      expectedState: "complete",
      approvedDownloadPath: downloadPath,
      timeoutMs: 10_000
    }),
    output: () => ({
      verified: true,
      expectedState: "complete",
      downloads: [{
        id: 5,
        url: "https://example.test/browser-chrome-dogfood-report.pdf",
        filename: "browser-chrome-dogfood-report.pdf",
        filenameRedacted: true,
        state: "complete"
      }]
    }),
    metadata: {
      verification: "computer_session_download_verified",
      risk: "high",
      approval: "one_time"
    },
    approve: false,
    expected: {
      resourceRole: "download_verified_file",
      redaction: "basename_only"
    }
  },
  {
    id: "browser-chrome-debugger-print-pdf-repeat",
    command: "debugger.print_to_pdf",
    repeatCount: 2,
    userScenario: "사용자가 현재 탭을 브라우저 debugger 기반 print-to-PDF 명령으로 PDF화할 수 있는지 검증하고, 임의 CDP 실행 없이 고정 명령 증거만 남기도록 요청한다.",
    architectureWorkflow: [
      "Computer Session starts on the regular_browser_extension surface with an explicit high-risk browser chrome profile.",
      "A browser_chrome operation requests the fixed debugger.print_to_pdf command and awaits one-time approval.",
      "The renderer-equivalent approval event allows only the bounded command, not arbitrary CDP evaluation.",
      "Browser Bridge polling delivers debugger.print_to_pdf and the fixture bridge returns minimized PDF metadata.",
      "ComputerSessionRuntime records capability job output, DAG verification, eval-ledger linkage, and redaction evidence.",
      "The debug bundle exposes the fixed command proof and keeps browser-private content out of the dogfood corpus."
    ],
    input: () => ({
      command: "debugger.print_to_pdf",
      printBackground: true,
      timeoutMs: 10_000
    }),
    output: () => ({
      printed: true,
      page: { title: "Example", origin: "https://example.test", pathRedacted: true },
      artifact: { basename: "browser-chrome-dogfood-page.pdf", pathRedacted: true },
      byteLength: 2048
    }),
    metadata: {
      verification: "computer_session_debugger_pdf_printed",
      risk: "high",
      approval: "one_time",
      arbitraryCdpEvalAllowed: false
    },
    approve: true,
    expected: {
      resourceRole: null,
      redaction: "path_redacted"
    }
  }
];

try {
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timeout);
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });

  const profile = await postJson("/computer-use/autonomy/profiles", {
    name: "Browser Chrome dogfood scoped profile",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 8,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: true,
      browserDomains: ["example.test"],
      filesystem: { readRoots: [smokeAppData.dir], writeRoots: [smokeAppData.dir] },
      commands: { allowPrefixes: [], denyPatterns: ["password", "token", "secret", "cookie", "rm -rf", "format"] },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: false,
      generatedToolExecution: false,
      generatedCode: false,
      credentialAccess: "never",
      riskClasses: ["read_only", "high_risk"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 1
    }
  });
  assert.equal(profile.ok, true);

  const startedAtMs = Date.now();
  const results = [];
  for (const scenario of scenarios) {
    const samples = [];
    for (let iteration = 0; iteration < scenario.repeatCount; iteration += 1) {
      samples.push(await runScenarioIteration({ scenario, iteration, profileId: profile.profile.id }));
    }
    results.push(summarizeScenario(scenario, samples));
  }

  const elapsedMs = Date.now() - startedAtMs;
  const evidence = {
    schemaVersion: "computer-use-browser-chrome-dogfood.v1",
    generatedAt: new Date().toISOString(),
    date: DATE,
    runId,
    evidenceClass: "fixture_bridge_repeated_dogfood",
    promotion: "non_promoting_until_real_extension_live_samples_exist",
    metrics: summarizeMetrics(results, elapsedMs),
    scenarios: results
  };

  mkdirSync(join(repoRoot, "docs", "dogfood"), { recursive: true });
  mkdirSync(join(repoRoot, "docs", "reports"), { recursive: true });
  writeFileSync(dogfoodPath, `${JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    generatedAt: evidence.generatedAt,
    date: evidence.date,
    runId,
    evidenceClass: evidence.evidenceClass,
    promotion: evidence.promotion,
    scenarios: results.map(redactScenarioForDogfood)
  }, null, 2)}\n`, "utf8");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  for (const scenario of results) {
    for (const sample of scenario.samples) {
      await appendFile(sampleLedgerPath, `${JSON.stringify({
        schemaVersion: "computer-use-browser-chrome-dogfood-sample.v1",
        generatedAt: evidence.generatedAt,
        date: DATE,
        runId,
        evidencePath: normalizePath(evidencePath),
        reportPath: normalizePath(reportPath),
        scenario: redactSampleForLedger(scenario, sample)
      })}\n`, "utf8");
    }
  }

  assert.equal(results.every((result) => result.success), true);
  console.log(`computer use browser chrome dogfood evidence written: ${reportPath}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

async function runScenarioIteration({ scenario, iteration, profileId }) {
  const startedAtMs = Date.now();
  const started = await postJson("/computer-use/sessions", {
    userRequest: `${scenario.userScenario} 반복 ${iteration + 1}`,
    requestedSurface: "regular_browser_extension",
    profileId,
    metadata: {
      dogfood: "computer-use-browser-chrome",
      evidenceClass: "fixture_bridge_repeated_dogfood",
      command: scenario.command,
      iteration
    }
  });
  assert.equal(started.ok, true);
  const sessionId = started.result.session.sessionId;
  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    waitMs: 100,
    operation: {
      kind: "browser_chrome",
      input: scenario.input()
    }
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.job.kind, "browser_chrome");
  if (scenario.approve) {
    assert.equal(operation.result.job.status, "awaiting_approval");
    send({ type: "capability.approve", requestId: `approve-${operation.result.job.id}`, jobId: operation.result.job.id });
    await waitFor((event) => event.type === "capability.job" && event.jobId === operation.result.job.id && event.status === "running", `${scenario.command} running`);
  } else {
    assert.equal(operation.result.job.status, "running");
  }

  const command = await pollBrowserBridgeCommand();
  assert.equal(command?.kind, "browser_chrome");
  assert.equal(command?.command, scenario.command);
  assert.equal(command?.jobId, operation.result.job.id);
  await postBrowserChromeResult(command.requestId, scenario.output(), scenario.metadata);
  await waitFor((event) => event.type === "capability.job" && event.jobId === operation.result.job.id && event.status === "completed", `${scenario.command} completed`);

  const jobPayload = await getJson(`/capabilities/jobs/${encodeURIComponent(operation.result.job.id)}`);
  const bundle = await waitForDagNode(sessionId, operation.result.dagNode.id, "completed");
  const evalRun = await getEvalRun(bundle.bundle.evalRun.id);
  await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`, { reason: "browser_chrome_dogfood_cleanup" });
  const cleanupBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  const cleanupReconciled = cleanupBundle.bundle.session.state === "cancelled" ||
    cleanupBundle.bundle.rollbackActions.some((action) => action.kind === "close_surface" && action.status === "completed");

  const elapsedMs = Date.now() - startedAtMs;
  const resourceRoles = bundle.bundle.evalResources.map((resource) => resource.role);
  const linkedObservations = bundle.bundle.observations.filter((observation) => observation.capabilityJobId === operation.result.job.id);
  const success = jobPayload.job.status === "completed" &&
    bundle.bundle.dagNodes.some((node) => node.id === operation.result.dagNode.id && node.status === "completed") &&
    bundle.bundle.dagNodes.some((node) => node.kind === "verification" && node.status === "completed") &&
    bundle.bundle.dagNodes.some((node) => node.kind === "eval_ledger" && node.status === "completed") &&
    hasCompletedCapabilityEvalStep(evalRun, operation.result.job.id) &&
    (!scenario.expected.resourceRole || resourceRoles.includes(scenario.expected.resourceRole)) &&
    hasExpectedRedaction({ scenario, bundle: bundle.bundle, job: jobPayload.job }) &&
    cleanupReconciled;

  return {
    iteration,
    success,
    status: success ? "passed" : "needs_followup",
    elapsedMs,
    p50LatencyMs: elapsedMs,
    p95LatencyMs: elapsedMs,
    sessionId,
    evalRunId: bundle.bundle.evalRun.id,
    dagNodeId: operation.result.dagNode.id,
    capabilityJobId: operation.result.job.id,
    command: scenario.command,
    jobStatus: jobPayload.job.status,
    approvalRequired: scenario.approve,
    outputHash: hashText(JSON.stringify(jobPayload.job.outputJson ?? {})),
    verifierNodeCount: bundle.bundle.dagNodes.filter((node) => node.kind === "verification" && node.status === "completed").length,
    evalLedgerNodeCount: bundle.bundle.dagNodes.filter((node) => node.kind === "eval_ledger" && node.status === "completed").length,
    evalStepCount: evalRun.steps.length,
    resourceRoles,
    observationCount: linkedObservations.length,
    redaction: summarizeRedaction({ scenario, bundle: bundle.bundle, job: jobPayload.job }),
    cleanupRollbackCompleted: cleanupReconciled
  };
}

function summarizeScenario(scenario, samples) {
  const latencies = samples.map((sample) => sample.elapsedMs);
  return {
    id: scenario.id,
    command: scenario.command,
    repeatCount: scenario.repeatCount,
    userScenario: scenario.userScenario,
    architectureWorkflow: scenario.architectureWorkflow,
    success: samples.every((sample) => sample.success),
    status: samples.every((sample) => sample.success) ? "passed" : "needs_followup",
    result: {
      sampleCount: samples.length,
      successCount: samples.filter((sample) => sample.success).length,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      resourceRoles: [...new Set(samples.flatMap((sample) => sample.resourceRoles))],
      verifierNodeCount: samples.reduce((sum, sample) => sum + sample.verifierNodeCount, 0),
      evalLedgerNodeCount: samples.reduce((sum, sample) => sum + sample.evalLedgerNodeCount, 0),
      outputHashes: [...new Set(samples.map((sample) => sample.outputHash))],
      redaction: samples.map((sample) => sample.redaction),
      cleanupRollbackCompleted: samples.every((sample) => sample.cleanupRollbackCompleted)
    },
    samples,
    improvementAndFollowUp: "반복 dogfood는 성공했지만 Browser Bridge result를 fixture로 주입한 증거다. 실제 확장 프로그램 live samples와 p95 비교가 있어야 live promotion이 가능하다."
  };
}

function summarizeMetrics(results, elapsedMs) {
  const samples = results.flatMap((scenario) => scenario.samples);
  const latencies = samples.map((sample) => sample.elapsedMs);
  return {
    scenarioCount: results.length,
    sampleCount: samples.length,
    successCount: samples.filter((sample) => sample.success).length,
    successRate: samples.length ? samples.filter((sample) => sample.success).length / samples.length : 0,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    elapsedMs,
    fixtureBridge: true,
    repeatedSamples: samples.length >= 4,
    commands: [...new Set(results.map((scenario) => scenario.command))],
    downloadVerifyCovered: results.some((scenario) => scenario.command === "download.verify" && scenario.success),
    debuggerPrintPdfCovered: results.some((scenario) => scenario.command === "debugger.print_to_pdf" && scenario.success),
    redactionProofPresent: samples.every((sample) => JSON.stringify(sample.redaction).includes("redacted") || JSON.stringify(sample.redaction).includes("basename_only")),
    cleanupRollbackCompleted: samples.every((sample) => sample.cleanupRollbackCompleted)
  };
}

function hasExpectedRedaction({ scenario, bundle, job }) {
  const serialized = JSON.stringify({ observations: bundle.observations, resources: bundle.evalResources, output: job.outputJson });
  if (scenario.expected.redaction === "basename_only") {
    return serialized.includes("basename_only");
  }
  return serialized.includes("pathRedacted") || serialized.includes("path_redacted");
}

function summarizeRedaction({ scenario, bundle, job }) {
  const observations = bundle.observations.filter((observation) => observation.capabilityJobId === job.id);
  return {
    expected: scenario.expected.redaction,
    observationRedactions: observations.map((observation) => observation.redaction ?? {}),
    outputPathRedacted: JSON.stringify(job.outputJson ?? {}).includes("pathRedacted"),
    localPathPolicy: scenario.expected.redaction === "basename_only" ? "basename_only" : "path_redacted"
  };
}

async function pollBrowserBridgeCommand() {
  const url = new URL(`${baseUrl}/browser-action/extension/poll`);
  url.searchParams.set("permission", "allowed");
  url.searchParams.set("tabId", "1");
  url.searchParams.set("windowId", "1");
  url.searchParams.set("url", "https://example.test/");
  url.searchParams.set("title", "Browser Chrome Dogfood");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Browser Bridge poll failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  return payload.command ?? null;
}

async function postBrowserChromeResult(requestId, output, metadata) {
  const response = await fetch(`${baseUrl}/browser-action/extension/browser-chrome-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok: true, output, metadata })
  });
  if (!response.ok) {
    throw new Error(`Browser Chrome result POST failed (${response.status}): ${await response.text()}`);
  }
}

async function waitForDagNode(sessionId, nodeId, status) {
  const deadline = Date.now() + 5000;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
    const node = bundle.bundle.dagNodes.find((candidate) => candidate.id === nodeId);
    if (node?.status === status) {
      return bundle;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for DAG node ${nodeId} to reach ${status}: ${JSON.stringify(bundle?.bundle?.dagNodes ?? [], null, 2)}`);
}

async function getEvalRun(runId) {
  return await getJson(`/computer-use/eval/runs/${encodeURIComponent(runId)}`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

function send(message) {
  socket.send(JSON.stringify(message));
}

function waitFor(predicate, label, timeoutMs = 12_000) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for ${label}. Recent events: ${JSON.stringify(events.slice(-10), null, 2)}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

function renderReport(evidence) {
  const lines = [
    "# Computer Use Browser Chrome Dogfood",
    "",
    `- generatedAt: \`${evidence.generatedAt}\``,
    `- runId: \`${evidence.runId}\``,
    `- evidenceClass: \`${evidence.evidenceClass}\``,
    `- sample count: \`${evidence.metrics.sampleCount}\``,
    `- success rate: \`${evidence.metrics.successRate}\``,
    `- p95 latency: \`${evidence.metrics.p95LatencyMs}ms\``,
    `- promotion: \`${evidence.promotion}\``,
    "",
    "| Scenario | Command | Samples | Success | p95 | Evidence | Follow-up |",
    "|---|---|---:|---|---:|---|---|"
  ];
  for (const scenario of evidence.scenarios) {
    lines.push(`| ${scenario.id} | ${scenario.command} | ${scenario.result.sampleCount} | ${scenario.success ? "pass" : "fail"} | ${scenario.result.p95LatencyMs} | ${scenario.result.resourceRoles.join(", ") || "job-output"} | ${scenario.improvementAndFollowUp} |`);
  }
  lines.push("", `Raw evidence: docs/reports/assets/computer-use-browser-chrome-dogfood-${evidence.date}/evidence.json`, "");
  return `${lines.join("\n")}\n`;
}

function redactScenarioForDogfood(scenario) {
  return {
    id: scenario.id,
    command: scenario.command,
    repeatCount: scenario.repeatCount,
    userScenario: scenario.userScenario,
    architectureWorkflow: scenario.architectureWorkflow,
    success: scenario.success,
    status: scenario.status,
    result: {
      sampleCount: scenario.result.sampleCount,
      successCount: scenario.result.successCount,
      p95LatencyMs: scenario.result.p95LatencyMs,
      resourceRoles: scenario.result.resourceRoles,
      verifierNodeCount: scenario.result.verifierNodeCount,
      evalLedgerNodeCount: scenario.result.evalLedgerNodeCount,
      cleanupRollbackCompleted: scenario.result.cleanupRollbackCompleted,
      redaction: scenario.result.redaction.map((item) => ({
        expected: item.expected,
        localPathPolicy: item.localPathPolicy,
        outputPathRedacted: item.outputPathRedacted
      }))
    },
    improvementAndFollowUp: scenario.improvementAndFollowUp
  };
}

function redactSampleForLedger(scenario, sample) {
  return {
    id: scenario.id,
    command: scenario.command,
    iteration: sample.iteration,
    success: sample.success,
    elapsedMs: sample.elapsedMs,
    p95LatencyMs: sample.p95LatencyMs,
    resourceRoles: sample.resourceRoles,
    outputHash: sample.outputHash,
    verifierNodeCount: sample.verifierNodeCount,
    evalLedgerNodeCount: sample.evalLedgerNodeCount,
    cleanupRollbackCompleted: sample.cleanupRollbackCompleted,
    redaction: {
      expected: sample.redaction.expected,
      localPathPolicy: sample.redaction.localPathPolicy,
      outputPathRedacted: sample.redaction.outputPathRedacted
    }
  };
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function hasCompletedCapabilityEvalStep(evalRun, capabilityJobId) {
  return evalRun.steps.some((step) =>
    step.status === "completed" &&
    step.capabilityJobId === capabilityJobId &&
    (step.kind === "browser_chrome_observation" || step.kind === "browser_chrome")
  );
}

function percentile(values, fraction) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatSeoulDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function formatKstTimestamp(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}
