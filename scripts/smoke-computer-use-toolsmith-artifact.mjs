#!/usr/bin/env node
import assert from "node:assert/strict";
import { join } from "node:path";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-toolsmith-artifact-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const outputRoot = join(smokeAppData.dir, "outputs");

try {
  const profile = await postJson("/computer-use/autonomy/profiles", {
    name: "Computer Use Toolsmith smoke",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 3,
    grants: {
      network: true,
      networkDomains: ["example.com", "openai.com", "*.openai.com", "127.0.0.1"],
      browserAutomation: true,
      browserDomains: ["example.com", "openai.com", "*.openai.com", "127.0.0.1"],
      filesystem: {
        readRoots: [smokeAppData.dir],
        writeRoots: [smokeAppData.dir]
      },
      commands: {
        allowPrefixes: ["node"],
        denyPatterns: ["password", "token", "secret", "cookie", "rm -rf", "format"]
      },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      credentialAccess: "never",
      riskClasses: ["read_only", "reversible", "side_effect"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 3
    }
  });
  assert.equal(profile.ok, true);

  const started = await postJson("/computer-use/sessions", {
    userRequest: "OpenAI Codex 지원 명령어 내용을 조사해서 PDF 파일로 만들어줘",
    requestedSurface: "tool_workspace",
    profileId: profile.profile.id,
    metadata: {
      createsLocalArtifact: true,
      requiresGeneratedTool: true
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.selectedSurface.kind, "tool_workspace");
  const sessionId = started.result.session.sessionId;

  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "toolsmith",
      input: {
        goal: "OpenAI Codex 지원 명령어 내용을 조사해서 PDF 파일로 만들어줘",
        permissionProfileId: profile.profile.id,
        outputRoot,
        title: "Codex command support smoke report",
        urls: ["https://example.com/codex", "http://127.0.0.1:9/codex"],
        sourceDocuments: [
          {
            title: "Codex command support fixture",
            url: "https://example.com/codex",
            text: "Codex CLI supports command-line workflows, repository inspection, patch generation, test execution, and terminal-based verification."
          }
        ],
        browserFallbackDocuments: [
          {
            title: "Browser-captured Codex command support fallback",
            url: "http://127.0.0.1:9/codex",
            text: "Browser fallback evidence captured Codex command support details after direct HTTP fetch was unavailable.",
            capture: {
              command: "debugger.print_to_pdf",
              pdfSha256: "fixture-browser-fallback-pdf-sha256",
              pdfByteLength: 5120,
              dataOmitted: true
            }
          }
        ]
      }
    },
    waitMs: 30000
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.dagNode.status, "completed");

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assertFollowupDagNodes(bundle, operation.result.dagNode.id);
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.kind === "file" &&
    observation.source === "toolsmith_scoped_autonomy" &&
    observation.metadata?.artifactCount >= 2
  ), true);
  const toolsmithObservation = bundle.bundle.observations.find((observation) =>
    observation.kind === "file" &&
    observation.source === "toolsmith_scoped_autonomy"
  );
  assert.equal(toolsmithObservation?.metadata?.sourceSummary?.sourceCount >= 2, true);
  assert.equal(toolsmithObservation?.metadata?.sourceSummary?.rows?.some((row) =>
    (row.url === "http://127.0.0.1:9/codex" || row.url === "127.0.0.1") &&
    row.browserFallback === true
  ), true, JSON.stringify(toolsmithObservation?.metadata?.sourceSummary, null, 2));
  assert.equal(bundle.bundle.evalResources.some((resource) => resource.role === "toolsmith_pdf"), true);
  assert.equal(bundle.bundle.evalResources.some((resource) => resource.role === "toolsmith_report"), true);
  const blockedRollback = bundle.bundle.rollbackActions.find((action) => action.kind === "delete_artifact" && action.status === "blocked");
  assert.ok(blockedRollback);
  const reportResources = bundle.bundle.evalResources.filter((resource) => resource.role === "toolsmith_report");
  const reportResource = reportResources[0];
  const pdfResource = bundle.bundle.evalResources.find((resource) => resource.role === "toolsmith_pdf");
  assert.ok(reportResource?.blobId);
  assert.ok(pdfResource?.blobId);

  const reportContents = [];
  for (const resource of reportResources) {
    reportContents.push(await getText(`/computer-use/eval/runs/${encodeURIComponent(bundle.bundle.evalRun.id)}/resources/${encodeURIComponent(resource.id)}/content`));
  }
  const reportContent = reportContents.join("\n\n--- report resource ---\n\n");
  assert.match(reportContent, /Codex/);
  assert.match(reportContent, /Browser fallback/);
  const pdfContent = await getBytes(`/computer-use/eval/runs/${encodeURIComponent(bundle.bundle.evalRun.id)}/resources/${encodeURIComponent(pdfResource.id)}/content?download=1`);
  assert.equal(pdfContent.contentType, "application/pdf");
  assert.equal(Buffer.from(pdfContent.bytes).subarray(0, 4).toString("utf8"), "%PDF");

  const autonomyRuns = await getJson(`/computer-use/autonomy/runs?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(autonomyRuns.ok, true);
  assert.equal(autonomyRuns.runs.some((run) => run.status === "completed" && run.sessionId === sessionId), true);
  const autonomyRun = autonomyRuns.runs.find((run) => run.status === "completed" && run.sessionId === sessionId);
  const autonomyDetail = await getJson(`/computer-use/autonomy/runs/${encodeURIComponent(autonomyRun.id)}`);
  assert.equal(autonomyDetail.ok, true);
  const executableRun = autonomyDetail.toolRuns.findLast((toolRun) => toolRun.status === "completed" && toolRun.mode === "execute");
  assert.ok(executableRun, "completed execute tool run should be available for rerun");
  const rerun = await postJson("/computer-use/autonomy/rerun", { toolRunId: executableRun.id });
  assert.equal(rerun.ok, true);
  assert.equal(rerun.toolRun.status, "completed", rerun.toolRun.lastError);
  const sessionRollback = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/rollback-actions/${encodeURIComponent(blockedRollback.id)}`, {
    includeUserArtifacts: false
  });
  assert.equal(sessionRollback.ok, true);
  assert.equal(["completed", "skipped"].includes(sessionRollback.rollbackAction.status), true);
  assert.equal(sessionRollback.rollbackAction.metadata.includeUserArtifacts, false);
  assert.equal(typeof sessionRollback.rollbackAction.metadata.rollbackToolRunId, "string");
  const rollbackBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(rollbackBundle.bundle.rollbackActions.some((action) => action.id === blockedRollback.id && ["completed", "skipped"].includes(action.status)), true);
  const rollback = await postJson("/computer-use/autonomy/rollback", { autonomyRunId: autonomyRun.id, includeUserArtifacts: false });
  assert.equal(rollback.ok, true);
  assert.equal(rollback.toolRun.status, "completed", rollback.toolRun.lastError);

  console.log(`computer use toolsmith artifact smoke ok on port ${daemon.port}`);
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

async function getText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.text();
}

async function getBytes(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return {
    contentType: response.headers.get("content-type"),
    bytes: new Uint8Array(await response.arrayBuffer())
  };
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

function assertFollowupDagNodes(bundle, actionNodeId) {
  const verification = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:verification`);
  const ledger = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:eval_ledger`);
  const storeArtifact = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:store_artifact`);
  const verifyArtifact = bundle.bundle.dagNodes.find((node) => node.id === `${actionNodeId}:verify_artifact`);
  assert.equal(verification?.kind, "verification");
  assert.equal(verification?.status, "completed");
  assert.equal(ledger?.kind, "eval_ledger");
  assert.equal(ledger?.status, "completed");
  assert.equal(storeArtifact?.kind, "store_artifact");
  assert.equal(storeArtifact?.status, "completed");
  assert.equal(verifyArtifact?.kind, "verify_artifact");
  assert.equal(verifyArtifact?.status, "completed");
  assert.equal(verifyArtifact?.output?.verification?.status, "passed");
  assert.equal(verifyArtifact?.output?.verifiedArtifactCount >= 1, true);
  assert.equal(bundle.bundle.evalRun && bundle.bundle.evalResources.some((resource) =>
    resource.stepId &&
    bundle.bundle.evalRun.id === resource.runId
  ), true);
}
