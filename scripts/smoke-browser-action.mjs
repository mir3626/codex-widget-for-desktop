import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import {
  BrowserActionAdapterRegistry,
  BrowserActionSessionManager,
  buildBrowserObservation,
  buildElementGraph,
  decideBrowserActionSafety,
  resolveTarget
} from "../dist/daemon/browser-action/index.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-action-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];
const beforeSnapshot = createSnapshot("before");
const afterSnapshot = createSnapshot("after");

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

  verifyResolverAndSafety(beforeSnapshot);
  await verifyStaleReobserveRetry(beforeSnapshot, afterSnapshot);

  await postDomSnapshot(beforeSnapshot);
  send({ type: "browserAction.start", actionSessionId: "browser-action-smoke", mode: "auto_safe_actions" });
  await waitFor((event) => event.type === "browserAction.started" && event.actionSessionId === "browser-action-smoke", "browser action started");

  send({ type: "browserAction.observe", actionSessionId: "browser-action-smoke" });
  const observation = await waitFor((event) => event.type === "browserAction.observation", "browser action observation");
  assertEqual(observation.observationSummary.elements, beforeSnapshot.elements.length, "observation element count");

  send({
    type: "browserAction.execute",
    actionSessionId: "browser-action-smoke",
    action: { type: "read", reason: "smoke" }
  });
  const readResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.action === "read", "read result");
  assertEqual(readResult.result.status, "succeeded", "read status");

  send({
    type: "browserAction.execute",
    actionSessionId: "browser-action-smoke",
    action: { type: "click", target: { kind: "element_id", id: "open-details" } }
  });
  const queued = await waitFor((event) => event.type === "browserAction.progress" && event.status === "queued", "click queued");
  const command = await pollBrowserActionCommand();
  assertEqual(command?.requestId, queued.detail?.requestId, "queued command request id");
  assertEqual(command?.target?.id, "open-details", "queued command target");
  await postBrowserActionResult(command.requestId, true, beforeSnapshot, afterSnapshot);
  const clickResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.action === "click", "click result");
  assertEqual(clickResult.result.status, "succeeded", "click status");

  send({
    type: "browserAction.execute",
    actionSessionId: "browser-action-smoke",
    requestId: "browser-action-approval-smoke",
    action: { type: "click", target: { kind: "element_id", id: "delete-repo" } }
  });
  const approval = await waitFor((event) => event.type === "interaction.required" && event.interaction?.title === "Browser action approval", "browser action approval");
  send({ type: "interaction.respond", id: approval.interaction.id, decision: "approve" });
  const approvedQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.status === "queued" &&
      event.detail?.action === "click" &&
      event.detail?.requestId !== command.requestId,
    "approved command queued"
  );
  const approvedCommand = await pollBrowserActionCommand();
  assertEqual(approvedCommand?.requestId, approvedQueued.detail?.requestId, "approved command request id");
  assertEqual(approvedCommand?.target?.id, "delete-repo", "approved command target");
  await postBrowserActionResult(approvedCommand.requestId, true, beforeSnapshot, createSnapshot("deleted"));
  const approvedResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.id === approvedCommand.resultId, "approved result");
  assertEqual(approvedResult.result.status, "succeeded", "approved result status");

  send({
    type: "browserAction.execute",
    actionSessionId: "browser-action-smoke",
    action: { type: "click", target: { kind: "text", text: "Delete", role: "button" } },
    targetHint: "Delete"
  });
  const clarifyResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.status === "needs_clarification", "ambiguous destructive clarification");
  assertEqual(clarifyResult.result.safety, "clarify", "ambiguous safety decision");

  const emptyPoll = await pollBrowserActionCommand();
  assertEqual(emptyPoll, null, "poll is empty after completed commands");

  const ledger = [...events].reverse().find((event) => event.type === "ledger.snapshot");
  const browserActivity = ledger?.snapshot?.activities?.find((activity) => activity.category === "browser-action");
  if (!browserActivity) {
    throw new Error(`Browser action audit activity was not recorded: ${JSON.stringify(ledger)}`);
  }

  console.log(`browser action smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

function verifyResolverAndSafety(snapshot) {
  const observation = buildBrowserObservation({ snapshot });
  const graph = buildElementGraph({
    observationId: observation.id,
    focusedElementId: observation.focusedElementId,
    elements: observation.elements
  });
  assertEqual(resolveTarget({ graph, target: { kind: "element_id", id: "open-details" } }).primary?.id, "open-details", "exact target");
  assertEqual(resolveTarget({ graph, target: { kind: "text", text: "Open details", role: "button" } }).primary?.id, "open-details", "role/text target");
  assertEqual(resolveTarget({ graph, target: { kind: "focused" } }).primary?.id, "search-box", "focused target");
  assertEqual(resolveTarget({ graph, target: { kind: "bbox", bbox: { x: 22, y: 86, w: 100, h: 36 } } }).primary?.id, "open-details", "bbox target");
  const ambiguous = resolveTarget({ graph, target: { kind: "text", text: "Save", role: "button" } });
  if (ambiguous.confidence >= 0.75 || ambiguous.alternatives.length < 1) {
    throw new Error(`Ambiguous target should produce alternatives and reduced confidence: ${JSON.stringify(ambiguous)}`);
  }
  const fallback = resolveTarget({ graph });
  if (fallback.confidence > 0.55) {
    throw new Error(`No-hint target should be low confidence: ${JSON.stringify(fallback)}`);
  }
  const readSafety = decideBrowserActionSafety({ action: { type: "read" }, mode: "auto_safe_actions", targetConfidence: 0, target: undefined });
  assertEqual(readSafety.decision, "allow", "read safety");
  const readOnlySafety = decideBrowserActionSafety({
    action: { type: "click", target: { kind: "element_id", id: "open-details" } },
    mode: "read_only",
    targetConfidence: 0.98,
    target: observation.elements.find((element) => element.id === "open-details")
  });
  assertEqual(readOnlySafety.decision, "block", "read-only click safety");
  const askBeforeSafety = decideBrowserActionSafety({
    action: { type: "click", target: { kind: "element_id", id: "open-details" } },
    mode: "ask_before_action",
    targetConfidence: 0.98,
    target: observation.elements.find((element) => element.id === "open-details")
  });
  assertEqual(askBeforeSafety.decision, "confirm", "ask-before-action safety");
  const deleteSafety = decideBrowserActionSafety({
    action: { type: "click", target: { kind: "element_id", id: "delete-repo" } },
    mode: "auto_safe_actions",
    targetConfidence: 0.98,
    target: observation.elements.find((element) => element.id === "delete-repo")
  });
  assertEqual(deleteSafety.decision, "confirm", "destructive click safety");
  const lowConfidenceClickSafety = decideBrowserActionSafety({
    action: { type: "click", target: { kind: "text", text: "Open" } },
    mode: "auto_safe_actions",
    targetConfidence: 0.55,
    target: observation.elements.find((element) => element.id === "open-details")
  });
  assertEqual(lowConfidenceClickSafety.decision, "clarify", "low-confidence click safety");
  const lowConfidenceDeleteSafety = decideBrowserActionSafety({
    action: { type: "click", target: { kind: "text", text: "Delete" } },
    mode: "auto_safe_actions",
    targetConfidence: 0.62,
    target: observation.elements.find((element) => element.id === "delete-repo")
  });
  assertEqual(lowConfidenceDeleteSafety.decision, "clarify", "low-confidence destructive safety");
}

async function verifyStaleReobserveRetry(beforeSnapshot, afterSnapshot) {
  let observeCount = 0;
  let executeCount = 0;
  const retryAdapter = {
    id: "retry-smoke",
    label: "Retry smoke adapter",
    capabilities: ["observe_dom", "click"],
    async isAvailable() {
      return true;
    },
    async observe(input) {
      observeCount += 1;
      return buildBrowserObservation({ source: input.session.source, snapshot: afterSnapshot });
    },
    async execute(input) {
      executeCount += 1;
      if (executeCount === 1) {
        return { requestId: "retry-smoke", adapterId: "retry-smoke", ok: false, before: beforeSnapshot, error: "Target not found" };
      }
      return { requestId: "retry-smoke", adapterId: "retry-smoke", ok: true, before: input.observation, after: afterSnapshot };
    }
  };
  const manager = new BrowserActionSessionManager(new BrowserActionAdapterRegistry([retryAdapter]));
  const session = manager.start({ id: "browser-action-stale-retry", source: { kind: "controlled_browser", url: beforeSnapshot.url } });
  manager.observe({ actionSessionId: session.id, snapshot: beforeSnapshot });
  const execution = await manager.execute({
    actionSessionId: session.id,
    adapterId: "retry-smoke",
    snapshot: beforeSnapshot,
    action: { type: "click", target: { kind: "element_id", id: "open-details" } }
  });
  assertEqual(execution.result.status, "succeeded", "stale retry status");
  assertEqual(observeCount, 1, "stale retry reobserve count");
  assertEqual(executeCount, 2, "stale retry execute count");
}

function createSnapshot(state) {
  return {
    url: `https://example.test/browser-action/${state}`,
    title: "Browser Action Smoke",
    readyState: "complete",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: state === "after" ? 120 : 0, devicePixelRatio: 1 },
    focusedElementId: "search-box",
    selection: "",
    text: state === "after" ? "Details opened after safe click" : "Browser action test page with controls",
    elements: [
      {
        id: "search-box",
        role: "textbox",
        tagName: "input",
        label: "Search docs",
        value: "",
        selector: "#search",
        bbox: { x: 20, y: 20, w: 260, h: 36 },
        visible: true,
        enabled: true,
        editable: true,
        inputType: "search",
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "open-details",
        role: "button",
        tagName: "button",
        label: "Open details",
        text: "Open details",
        selector: "#open-details",
        bbox: { x: 20, y: 84, w: 140, h: 40 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "delete-repo",
        role: "button",
        tagName: "button",
        label: "Delete repo",
        text: "Delete",
        selector: "#delete-repo",
        bbox: { x: 180, y: 84, w: 140, h: 40 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: ["delete"]
      },
      {
        id: "delete-archive",
        role: "button",
        tagName: "button",
        label: "Delete archive",
        text: "Delete",
        selector: "#delete-archive",
        bbox: { x: 340, y: 84, w: 140, h: 40 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: ["delete"]
      },
      {
        id: "save-draft",
        role: "button",
        tagName: "button",
        label: "Save",
        text: "Save",
        selector: "#save-draft",
        bbox: { x: 20, y: 144, w: 120, h: 36 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.92,
        riskHints: []
      },
      {
        id: "save-copy",
        role: "button",
        tagName: "button",
        label: "Save",
        text: "Save",
        selector: "#save-copy",
        bbox: { x: 160, y: 144, w: 120, h: 36 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.92,
        riskHints: []
      }
    ]
  };
}

async function postDomSnapshot(snapshot) {
  const response = await fetch(`${baseUrl}/providers/dom/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  if (!response.ok) {
    throw new Error(`DOM snapshot POST failed (${response.status}).`);
  }
}

async function pollBrowserActionCommand() {
  const response = await fetch(`${baseUrl}/browser-action/extension/poll`);
  if (!response.ok) {
    throw new Error(`Browser Action poll failed (${response.status}).`);
  }
  const payload = await response.json();
  return payload.command ?? null;
}

async function postBrowserActionResult(requestId, ok, before, after, error) {
  const response = await fetch(`${baseUrl}/browser-action/extension/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok, before, after, error })
  });
  if (!response.ok) {
    throw new Error(`Browser Action result POST failed (${response.status}).`);
  }
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
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => event.type).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
