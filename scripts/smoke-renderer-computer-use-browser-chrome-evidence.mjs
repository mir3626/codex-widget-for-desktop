import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { chromium } from "@playwright/test";
import { WebSocketServer } from "ws";

const now = "2026-05-16T04:40:00.000Z";
const session = {
  sessionId: "computer-browser-chrome-evidence-session",
  userRequest: "Show browser chrome evidence.",
  state: "completed",
  riskClass: "high_risk",
  selectedSurface: {
    kind: "regular_browser_extension",
    displayName: "Current browser profile",
    riskClass: "profile_private_data",
    available: true,
    grantsRequired: ["browser.profile", "browser.chrome"],
    capabilities: ["browser_chrome"]
  },
  evalRunId: "eval-browser-chrome-evidence",
  createdAt: now,
  updatedAt: now
};

const capabilityJobs = [
  browserChromeJob("job-download", "download.verify", {
    output: {
      verified: true,
      downloads: [{ id: 5, filename: "report.pdf", filenameRedacted: true, state: "complete" }]
    },
    metadata: { verification: "computer_session_download_verified", risk: "high", approval: "one_time" }
  }),
  browserChromeJob("job-history", "history.search", {
    output: {
      items: [{ title: "OpenAI", origin: "https://openai.com", url: "https://openai.com/[redacted]", pathRedacted: true }],
      redaction: "url_path_redacted"
    },
    metadata: { verification: "computer_session_history_redacted", risk: "high", approval: "one_time" }
  }),
  browserChromeJob("job-debugger", "debugger.print_to_pdf", {
    output: {
      printed: true,
      artifact: { basename: "page.pdf", pathRedacted: true }
    },
    metadata: { verification: "computer_session_debugger_pdf_printed", risk: "high", approval: "one_time" }
  }),
  browserChromeJob("job-permission", "permission.set", {
    output: {
      permission: { type: "camera", origin: "https://example.test", verifiedSetting: "allow", pathRedacted: true }
    },
    metadata: { verification: "computer_session_browser_permission_setting_applied", risk: "high", approval: "one_time" }
  }),
  browserChromeJob("job-upload", "file_upload.set_files", {
    output: {
      selected: true,
      files: [{ basename: "example.pdf", pathRedacted: true }]
    },
    metadata: { verification: "computer_session_file_upload_set", risk: "high", approval: "one_time" }
  })
];

const observations = [
  {
    id: "obs-download",
    kind: "file",
    source: "browser_chrome_download_verify",
    surface: "regular_browser_extension",
    capturedAt: now,
    capabilityJobId: "job-download",
    evalRunId: session.evalRunId,
    resourceIds: [{ evalResourceId: "resource-download", role: "download_verified_file", retention: "artifact" }],
    summary: "Browser Chrome verified 1 approved download artifact(s).",
    freshness: "fresh",
    metadata: { capabilityKind: "browser_chrome", downloadEvidenceCount: 1 },
    redaction: { credentials: "redacted", localPaths: "basename_only" }
  },
  {
    id: "obs-history",
    kind: "browser",
    source: "browser_chrome_capability",
    surface: "regular_browser_extension",
    capturedAt: now,
    capabilityJobId: "job-history",
    evalRunId: session.evalRunId,
    resourceIds: [],
    summary: "Browser Chrome history search completed.",
    freshness: "fresh",
    metadata: { capabilityKind: "browser_chrome" },
    redaction: { credentials: "redacted", browserHistory: "path_redacted" }
  },
  {
    id: "obs-terminal-delta",
    kind: "file",
    source: "terminal_output_root_diff",
    surface: "pty_workspace",
    capturedAt: now,
    capabilityJobId: "job-terminal-delta",
    evalRunId: session.evalRunId,
    resourceIds: [
      { evalResourceId: "resource-terminal-diff", role: "terminal_diff_artifact", retention: "evidence" },
      { evalResourceId: "resource-terminal-manifest", role: "terminal_output_root_delta_manifest", retention: "evidence" }
    ],
    summary: "Terminal command changed 3 approved output-root path(s).",
    freshness: "fresh",
    metadata: {
      capabilityKind: "terminal",
      createdCount: 1,
      modifiedCount: 1,
      deletedCount: 1,
      rollbackCandidateCount: 1,
      capturedArtifactCount: 2,
      manifestEntryCount: 3
    },
    redaction: { credentials: "redacted", localPaths: "basename_only" }
  }
];

const httpServer = createHttpServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }
  if (url.pathname === "/computer-use/surfaces") {
    writeJson(response, 200, { ok: true, surfaces: [session.selectedSurface] });
    return;
  }
  if (url.pathname === "/computer-use/sessions" && request.method === "GET") {
    writeJson(response, 200, { ok: true, sessions: [session] });
    return;
  }
  if (url.pathname === "/computer-use/autonomy/profiles" && request.method === "GET") {
    writeJson(response, 200, { ok: true, profiles: [] });
    return;
  }
  if (url.pathname === "/computer-use/eval/promotion-gate") {
    writeJson(response, 200, {
      ok: true,
      promotionGate: {
        schemaVersion: "computer-use-promotion-gate.v1",
        summary: {
          overallStatus: "promotable",
          promotableSlices: ["browser_chrome_public_extension_dogfood"],
          blockedSlices: [],
          passedNonPromotableSlices: ["windows_native_watch_boundary"]
        },
        gates: [
          {
            id: "browser_chrome_public_extension_dogfood",
            status: "passed",
            promotable: true,
            promotionClass: "public_site_repeated_real_extension_gate_passed",
            reasons: ["public_extension_profile_approval_evidence_present", "browser_chrome_public_extension_p95_samples_present"],
            metrics: {
              latestSampleCount: 18,
              p95LatencyMs: 5120,
              publicHosts: ["example.com", "the-internet.herokuapp.com", "www.w3.org"],
              commands: [
                "download.start+download.verify",
                "debugger.print_to_pdf",
                "tab_group.claim+update+release",
                "history.search",
                "permission.get+set+rollback",
                "tab_group.multi_tab_claim+update+release",
                "file_upload.inspect+set_files+clear"
              ],
              permissionTypesCovered: ["camera", "microphone", "location"],
              downloadStartVerifyCovered: true,
              debuggerPrintPdfCovered: true,
              tabGroupCovered: true,
              multiTabGroupCovered: true,
              historySearchCovered: true,
              permissionSettingCovered: true,
              fileUploadCovered: true,
              profileApprovalCovered: true,
              redactionProofPresent: true
            }
          },
          {
            id: "windows_native_watch_boundary",
            status: "passed",
            promotable: false,
            promotionClass: "blocked_by_design_release_guard",
            reasons: [
              "foreground_input_blocked_before_native_helper",
              "native_file_picker_blocked_before_path_disclosure",
              "browser_permission_bubble_blocked_before_native_click",
              "native_helper_release_signing_gate_present",
              "helper_v2_disabled_command_contracts_present"
            ],
            metrics: {
              implementationBoundaryPresent: true,
              foregroundPreflightContractPresent: true,
              activeWindowDriftSmokePresent: true,
              nativeFilePickerBoundaryPresent: true,
              browserPermissionBubbleBoundaryPresent: true,
              releaseSigningDeferred: true,
              foregroundWatchExecutorDisabledPresent: true,
              disabledHelperV2CommandContractsPresent: true,
              disabledHelperV2CommandCount: 5,
              foregroundWatchExecutorActualInputSent: false,
              releaseReadinessPathsRedacted: true,
              actualInputSent: false,
              localFilePathDisclosed: false,
              nativePopupClick: false
            }
          },
          {
            id: "scoped_autonomy_self_implementation_breadth",
            status: "passed",
            promotable: false,
            promotionClass: "fixture_repeated_generated_tool_gate_passed_live_generated_tool_gate_required",
            reasons: [
              "generated_capability_class_breadth_present",
              "rerun_stability_comparisons_present",
              "repeated_generated_tool_samples_present",
              "generated_tool_breadth_p95_samples_present",
              "high_risk_native_gap_blocked_before_materialization",
              "self_implementation_path_redaction_present"
            ],
            metrics: {
              scenarioCount: 5,
              requiredScenarioCount: 5,
              generatedCapabilityClasses: ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"],
              requiredGeneratedClasses: ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"],
              requiredGeneratedClassesPresent: true,
              generatedToolsActive: true,
              sourceIterationPresent: true,
              rerunMatchedCount: 4,
              rerunArtifactMatchedCount: 4,
              latestSampleCount: 8,
              p95LatencyMs: 420,
              repeatedGeneratedClassesPresent: true,
              repeatedClassSamplesPresent: true,
              p95LatencySampleCount: 8,
              samplePathRedactionPresent: true,
              nativeBlocked: true,
              pathRedactionPresent: true,
              repeatedPromotionReady: false
            }
          },
          {
            id: "scoped_autonomy_generated_tool_live_breadth",
            status: "passed",
            promotable: true,
            promotionClass: "eligible_for_generated_tool_promotion_review",
            reasons: [
              "repeated_live_generated_tool_runs_present",
              "live_generated_tool_p95_samples_present",
              "web_research_live_source_quality_accepted",
              "local_document_conversion_live_verified",
              "terminal_generated_tool_live_command_verified",
              "browser_download_verify_public_download_verified"
            ],
            metrics: {
              latestSampleCount: 16,
              executeSampleCount: 8,
              p95LatencyMs: 3810,
              generatedCapabilityClasses: ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"],
              requiredGeneratedClasses: ["browser_download_verify", "local_document_conversion", "terminal_generated_tool", "web_research_to_pdf"],
              requiredGeneratedClassesPresent: true,
              repeatedLiveRunsPresent: true,
              webSourceQualityAccepted: true,
              webFallbackCalibration: { accepted: true },
              localDocumentConversionVerified: true,
              terminalCommandVerified: true,
              publicDownloadVerified: true,
              pathRedactionPresent: true
            }
          }
        ]
      }
    });
    return;
  }
  if (url.pathname === "/computer-use/eval/dogfood-reports") {
    writeJson(response, 200, {
      ok: true,
      reports: [
        {
          id: "computer-use-browser-chrome-public-extension-2026-05-16",
          title: "Browser Chrome Public Extension",
          date: "2026-05-16",
          kind: "browser_chrome",
          reportPath: "docs/reports/computer-use-browser-chrome-public-extension-2026-05-16.md",
          evidencePath: "docs/reports/assets/computer-use-browser-chrome-public-extension-2026-05-16/evidence.json",
          dogfoodPath: "docs/dogfood/computer-use-browser-chrome-public-extension-2026-05-16.json"
        },
        {
          id: "scoped-autonomy-generated-tool-live-breadth-2026-05-16",
          title: "Toolsmith Generated Tool Live Breadth",
          date: "2026-05-16",
          kind: "toolsmith",
          reportPath: "docs/reports/scoped-autonomy-generated-tool-live-breadth-2026-05-16.md",
          evidencePath: "docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-2026-05-16/evidence.json"
        }
      ]
    });
    return;
  }
  if (url.pathname === `/computer-use/sessions/${encodeURIComponent(session.sessionId)}/debug-bundle`) {
    writeJson(response, 200, {
      ok: true,
      bundle: {
        schemaVersion: "computer-session-debug-bundle.v1",
        session,
        evalRun: { id: session.evalRunId, status: "completed", taskSuccess: true, createdAt: now, updatedAt: now },
        dagNodes: [],
        promptRuns: [],
        capabilityJobs,
        observations,
        perceptionGraphs: [],
        evalResources: [
          {
            id: "resource-download",
            runId: session.evalRunId,
            role: "download_verified_file",
            retention: "artifact",
            redaction: { localPaths: "basename_only" },
            createdAt: now
          },
          {
            id: "resource-terminal-manifest",
            runId: session.evalRunId,
            role: "terminal_output_root_delta_manifest",
            retention: "evidence",
            redaction: { mode: "terminal_artifact_delta_manifest_path_redacted" },
            createdAt: now
          },
          {
            id: "resource-terminal-diff",
            runId: session.evalRunId,
            role: "terminal_diff_artifact",
            retention: "evidence",
            redaction: { mode: "artifact_path_redacted", basename: "terminal-artifact.txt" },
            createdAt: now
          }
        ],
        actionFeedbacks: [],
        failureMemory: [],
        rollbackActions: [{
          id: "rollback-terminal",
          kind: "delete_artifact",
          label: "Terminal-created artifact deletion requires explicit confirmation",
          status: "blocked",
          riskClass: "destructive_local_change",
          createdAt: now,
          reason: "terminal_artifact_delete_confirmation_required",
          metadata: {
            source: "terminal_output_root_diff",
            capabilityJobId: "job-terminal-delta",
            terminalArtifactTargetCount: 1,
            terminalArtifactTargets: [{
              basename: "terminal-artifact.txt",
              size: 20,
              sha256: "abc123",
              change: "created",
              pathHash: "redacted-path-hash"
            }]
          }
        }],
        safetyDecisions: [],
        freshnessSummary: { total: observations.length, fresh: observations.length, stale: 0, missingTimestamp: 0 }
      }
    });
    return;
  }
  writeJson(response, 404, { ok: false, error: `Unhandled smoke route ${url.pathname}` });
});

const wsServer = new WebSocketServer({ server: httpServer });
wsServer.on("connection", (socket) => {
  socket.send(JSON.stringify({
    type: "connected",
    daemon: {
      port: daemonPort,
      model: "mock",
      liveModel: true,
      auth: { mode: "mock", configured: true, authenticated: true, signInAvailable: false, signInMethod: null }
    }
  }));
  socket.send(JSON.stringify({
    type: "session.snapshot",
    snapshot: {
      activeSessionId: "renderer-browser-chrome-chat",
      sessions: [{
        id: "renderer-browser-chrome-chat",
        title: "Renderer Browser Chrome evidence",
        status: "active",
        createdAt: now,
        updatedAt: now,
        activeModel: "gpt-5.5",
        activeReasoning: "xhigh",
        activeMode: "agent",
        messageCount: 0
      }],
      trashedSessions: [],
      messages: []
    }
  }));
  socket.send(JSON.stringify({
    type: "ledger.snapshot",
    snapshot: { sessionId: "renderer-browser-chrome-chat", artifacts: [], activities: [], providerSnapshots: [] }
  }));
});

await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const daemonAddress = httpServer.address();
if (!daemonAddress || typeof daemonAddress === "string") {
  throw new Error("Fake daemon did not bind to a TCP port.");
}
const daemonPort = daemonAddress.port;

const vite = await createViteServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false }
});
await vite.listen();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 560, height: 900 } });

try {
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Vite did not expose a local URL.");
  }
  await page.goto(`${baseUrl}?daemonPort=${daemonPort}`);
  await page.getByRole("button", { name: "Activity details" }).click();
  const section = page.getByLabel("Browser Chrome evidence", { exact: true });
  await section.getByText("Browser Chrome").waitFor();
  const sectionText = await section.textContent();
  assert.match(sectionText ?? "", /download\.verify/);
  assert.match(sectionText ?? "", /Download verified with approved artifact evidence\./);
  assert.match(sectionText ?? "", /basename-only redacted/);
  assert.match(sectionText ?? "", /download_verified_file/);
  assert.match(sectionText ?? "", /history\.search/);
  assert.match(sectionText ?? "", /history\/path redacted/);
  assert.match(sectionText ?? "", /debugger\.print_to_pdf/);
  assert.match(sectionText ?? "", /Fixed debugger command evidence recorded\./);
  assert.match(sectionText ?? "", /permission\.set/);
  assert.match(sectionText ?? "", /file_upload\.set_files/);
  const terminalDelta = page.getByLabel("Terminal artifact delta evidence", { exact: true });
  await terminalDelta.getByText("Terminal artifact deltas").waitFor();
  const terminalDeltaText = await terminalDelta.textContent();
  assert.match(terminalDeltaText ?? "", /Created1/);
  assert.match(terminalDeltaText ?? "", /Modified1/);
  assert.match(terminalDeltaText ?? "", /Deleted1/);
  assert.match(terminalDeltaText ?? "", /Rollback1/);
  assert.match(terminalDeltaText ?? "", /created 1, modified 1, deleted 1/);
  assert.match(terminalDeltaText ?? "", /terminal_output_root_delta_manifest/);
  assert.match(terminalDeltaText ?? "", /rollback paths redacted/);
  const proof = page.getByLabel("Browser Chrome public extension proof", { exact: true });
  await proof.getByText("Public extension proof").waitFor();
  const proofText = await proof.textContent();
  assert.match(proofText ?? "", /Samples18/);
  assert.match(proofText ?? "", /p955120ms/);
  assert.match(proofText ?? "", /Hosts3/);
  assert.match(proofText ?? "", /Profileproved/);
  assert.match(proofText ?? "", /download \+ pdf \+ tabs \+ history \+ permissions \+ upload covered/);
  assert.match(proofText ?? "", /permissions camera, microphone, location/);
  assert.match(proofText ?? "", /redaction proved/);
  const toolsmithProof = page.getByLabel("Toolsmith self-implementation breadth proof", { exact: true });
  await toolsmithProof.getByText("Toolsmith breadth proof").waitFor();
  const toolsmithProofText = await toolsmithProof.textContent();
  assert.match(toolsmithProofText ?? "", /Scenarios5\/5/);
  assert.match(toolsmithProofText ?? "", /Classes4/);
  assert.match(toolsmithProofText ?? "", /Samples8/);
  assert.match(toolsmithProofText ?? "", /p95420ms/);
  assert.match(toolsmithProofText ?? "", /Reruns4\/4/);
  assert.match(toolsmithProofText ?? "", /Pathsredacted/);
  assert.match(toolsmithProofText ?? "", /browser_download_verify \+ local_document_conversion \+ terminal_generated_tool \+ web_research_to_pdf covered/);
  assert.match(toolsmithProofText ?? "", /native high-risk blocked/);
  assert.match(toolsmithProofText ?? "", /fixture repeated only/);
  const toolsmithLiveProof = page.getByLabel("Toolsmith generated-tool live breadth proof", { exact: true });
  await toolsmithLiveProof.getByText("Toolsmith live breadth proof").waitFor();
  const toolsmithLiveProofText = await toolsmithLiveProof.textContent();
  assert.match(toolsmithLiveProofText ?? "", /Samples16/);
  assert.match(toolsmithLiveProofText ?? "", /p953810ms/);
  assert.match(toolsmithLiveProofText ?? "", /Classes4/);
  assert.match(toolsmithLiveProofText ?? "", /Runs8/);
  assert.match(toolsmithLiveProofText ?? "", /eligible/);
  assert.match(toolsmithLiveProofText ?? "", /web \+ local conversion \+ terminal \+ download live covered/);
  assert.match(toolsmithLiveProofText ?? "", /web fallback calibrated/);
  assert.match(toolsmithLiveProofText ?? "", /redaction proved/);
  const nativeProof = page.getByLabel("Computer Use native boundary proof", { exact: true });
  await nativeProof.getByText("Native boundary proof").waitFor();
  const nativeProofText = await nativeProof.textContent();
  assert.match(nativeProofText ?? "", /Inputblocked/);
  assert.match(nativeProofText ?? "", /Pickerblocked/);
  assert.match(nativeProofText ?? "", /Popupblocked/);
  assert.match(nativeProofText ?? "", /Signingdeferred/);
  assert.match(nativeProofText ?? "", /Preflighttyped/);
  assert.match(nativeProofText ?? "", /Driftproved/);
  assert.match(nativeProofText ?? "", /Executordisabled/);
  assert.match(nativeProofText ?? "", /Helper v2disabled \(5\)/);
  assert.match(nativeProofText ?? "", /foreground input \+ file picker \+ permission popup before input/);
  assert.match(nativeProofText ?? "", /paths and popup clicks hidden/);
  assert.match(nativeProofText ?? "", /release guard active/);
  const dogfoodLinks = page.getByLabel("Computer Use dogfood report links", { exact: true });
  await dogfoodLinks.getByText("Dogfood reports").waitFor();
  const dogfoodText = await dogfoodLinks.textContent();
  assert.match(dogfoodText ?? "", /Reports2/);
  assert.match(dogfoodText ?? "", /Evidence2/);
  assert.match(dogfoodText ?? "", /Dogfood1/);
  assert.match(dogfoodText ?? "", /Latest2026-05-16/);
  assert.match(dogfoodText ?? "", /Browser Chrome Public Extension/);
  assert.match(dogfoodText ?? "", /docs\/reports\/computer-use-browser-chrome-public-extension-2026-05-16\.md/);
  assert.match(dogfoodText ?? "", /Toolsmith Generated Tool Live Breadth/);

  console.log(`renderer Browser Chrome evidence smoke ok on vite ${baseUrl} daemon ${daemonPort}`);
} finally {
  await browser.close();
  await vite.close();
  await new Promise((resolve) => wsServer.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
}

function browserChromeJob(id, command, outputJson) {
  return {
    id,
    transactionId: `${id}:transaction`,
    sessionId: session.sessionId,
    kind: "browser_chrome",
    status: "completed",
    priority: "normal",
    requestedBy: "computer_session",
    inputJson: { command, timeoutMs: 10000 },
    inputBlobIds: [],
    outputJson,
    outputBlobIds: [],
    timeoutMs: 10000,
    deadlineAt: now,
    retryCount: 0,
    maxRetries: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now
  };
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json"
  });
  if (status === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(body));
}
