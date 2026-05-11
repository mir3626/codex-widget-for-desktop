import assert from "node:assert/strict";
import {
  createCapabilityDebugBundle,
  SURFACE_CONTROL_STAGES,
  createCapabilityTimingRecorder
} from "../dist/daemon/capability-transaction/index.js";
import {
  createPreparedContextKey,
  screenSnapshotToPreparedContext,
  taskCapsuleToPreparedContext,
  terminalStateToPreparedContext
} from "../dist/daemon/prepared-context/index.js";
import { createSafetyDecision, decideTerminalCommandSafety } from "../dist/daemon/safety/index.js";
import { createBrowserActionPromptToolInvocation } from "../dist/daemon/agent-tools/index.js";
import { preparedContextToSemanticSnapshot } from "../dist/daemon/semantic-interface/adapters/index.js";

const timing = createCapabilityTimingRecorder();
const started = timing.mark("started", "perceiving");
assert.equal(started.name, "started");
assert.equal(started.phase, "perceiving");

const contextKey = createPreparedContextKey({
  surface: "browser_page",
  sourceId: "extension",
  surfaceId: "window:tab",
  routeKey: "https://example.test/"
});
assert.equal(contextKey.includes("browser_page"), true);
assert.deepEqual(SURFACE_CONTROL_STAGES.slice(0, 2), ["observe", "understand"]);

const semanticSnapshot = preparedContextToSemanticSnapshot({
  context: {
    schemaVersion: "prepared-context.v1",
    identity: {
      surface: "browser_page",
      sourceId: "extension",
      surfaceId: "window:tab",
      url: "https://example.test/",
      title: "Example",
      routeKey: "https://example.test/",
      revision: "view-1",
      digest: "digest-1"
    },
    freshness: "fresh",
    stability: "stable",
    capturedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: new Date(1000).toISOString(),
    redaction: { mode: "metadata_only", persistedFields: ["identity"] },
    diagnostics: {}
  }
});
assert.equal(semanticSnapshot.surface.kind, "browser_page");
assert.equal(semanticSnapshot.entities[0]?.kind, "surface");

const visionContext = taskCapsuleToPreparedContext({
  id: "capsule-1",
  createdAt: new Date(0).toISOString(),
  captureSessionId: "vision-session-1",
  userUtterance: "explain this",
  source: { kind: "screen", appName: "test" },
  resolvedIntent: { kind: "explain_screen", summary: "explain", confidence: 0.9 },
  referents: [],
  alternatives: [],
  evidence: [],
  uncertainties: [],
  instructions: [],
  retention: {
    rawVideo: "delete_after_processing",
    rawAudio: "delete_after_processing",
    derivedFrames: "keep_selected",
    fullFrames: "keep_selected",
    transcript: "keep"
  }
});
assert.equal(visionContext.identity.surface, "screen");

const terminalContext = terminalStateToPreparedContext({
  sessionId: "pty-1",
  cwd: "C:/work",
  shell: "powershell",
  command: "Get-ChildItem",
  outputPreview: "file.txt"
});
assert.equal(terminalContext.identity.surface, "terminal");

const screenContext = screenSnapshotToPreparedContext({
  id: "screen-1",
  source: "display-1",
  title: "Desktop",
  capturedAt: new Date(0).toISOString(),
  description: "screen summary",
  ocrText: "visible text",
  imageHash: "hash-1",
  imageChanged: true,
  imageDiffRatio: 0.4,
  imageDiffThreshold: 0.02,
  imageMeaningfullyChanged: true,
  imageDataUrl: "data:image/png;base64,AAAA"
});
assert.equal(screenContext.identity.surface, "screen");

const safety = createSafetyDecision({
  subjectKind: "browser_action",
  actionFamily: "click",
  decision: "confirm",
  risk: "medium",
  reason: "side effect"
});
assert.equal(safety.redaction.secretValuesPersisted, false);
assert.equal(decideTerminalCommandSafety("Remove-Item -Recurse C:/tmp").decision, "block");

const toolInvocation = createBrowserActionPromptToolInvocation({
  requestId: "request-1",
  sessionId: "session-1",
  utterance: "click the search button",
  promptPlan: {
    id: "plan-1",
    goal: "click search",
    reason: "test",
    mode: "auto_safe_actions",
    source: { kind: "active_tab" },
    adapterId: "extension",
    confidence: 0.9,
    simulatedTool: true,
    steps: [
      {
        action: { type: "read" },
        targetSummary: "page",
        reason: "test"
      }
    ]
  }
});
assert.equal(toolInvocation.capability, "browser_action");
assert.equal(toolInvocation.runtime, "simulated_daemon");

const bundle = createCapabilityDebugBundle({
  capability: "browser_action",
  transactionId: "tx-1",
  requestId: "request-1",
  source: "prompt",
  utterance: "email test@example.com token sk_1234567890123456",
  timings: [started],
  events: [{ phase: "perceiving", at: started.at, summary: "started" }]
});
assert.equal(bundle.schemaVersion, "capability-debug-bundle.v1");
assert.equal(bundle.request.utterancePreview?.includes("test@example.com"), false);
assert.equal(bundle.request.utterancePreview?.includes("sk_1234567890123456"), false);

console.log("architecture foundations smoke ok");
