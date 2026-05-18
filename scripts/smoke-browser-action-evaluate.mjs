import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { buildBrowserObservation, decideBrowserActionSafety, inspectEvaluateCode } from "../dist/daemon/browser-action/index.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-action-evaluate-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];
const snapshot = createSnapshot();

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

  verifyEvaluateSafety(snapshot);
  await postDomSnapshot(snapshot);

  send({ type: "browserAction.start", actionSessionId: "evaluate-normal", mode: "auto_safe_actions" });
  await waitFor((event) => event.type === "browserAction.started" && event.actionSessionId === "evaluate-normal", "normal session");
  send({ type: "browserAction.observe", actionSessionId: "evaluate-normal" });
  await waitFor((event) => event.type === "browserAction.observation" && event.actionSessionId === "evaluate-normal", "normal observation");
  send({
    type: "browserAction.execute",
    actionSessionId: "evaluate-normal",
    action: { type: "evaluate", code: "return document.title;" }
  });
  const normalResult = await waitFor((event) => event.type === "browserAction.result" && event.actionSessionId === "evaluate-normal", "normal evaluate rejection");
  assertEqual(normalResult.result.status, "failed", "normal evaluate status");
  assertEqual(normalResult.result.safety, "block", "normal evaluate safety");

  send({ type: "browserAction.start", actionSessionId: "evaluate-full", mode: "full_control_dev" });
  await waitFor((event) => event.type === "browserAction.started" && event.actionSessionId === "evaluate-full", "full control session");
  send({ type: "browserAction.observe", actionSessionId: "evaluate-full" });
  await waitFor((event) => event.type === "browserAction.observation" && event.actionSessionId === "evaluate-full", "full control observation");
  send({
    type: "browserAction.execute",
    actionSessionId: "evaluate-full",
    requestId: "evaluate-approval",
    action: { type: "evaluate", code: "return document.title;", timeoutMs: 500, resultLimitBytes: 1024 }
  });
  const approval = await waitFor((event) => event.type === "interaction.required" && event.interaction?.requestId === "evaluate-approval", "evaluate approval");
  if (!approval.interaction.body.includes("Code preview:") || !approval.interaction.body.includes("Code SHA-256:")) {
    throw new Error(`Evaluate approval body missing preview/hash: ${approval.interaction.body}`);
  }
  send({ type: "interaction.respond", id: approval.interaction.id, decision: "approve" });
  const queued = await waitFor((event) => event.type === "browserAction.progress" && event.actionSessionId === "evaluate-full" && event.status === "queued", "approved evaluate queued");
  const command = await pollBrowserActionCommand();
  assertEqual(command?.requestId, queued.detail?.requestId, "evaluate queued request id");
  assertEqual(command?.action?.type, "evaluate", "queued evaluate action type");
  await postBrowserActionResult(command.requestId, true, snapshot, snapshot, undefined, { resultPreview: "\"Browser Action Evaluate Smoke\"" });
  const evaluateResult = await waitFor((event) => event.type === "browserAction.result" && event.actionSessionId === "evaluate-full", "evaluate result");
  assertEqual(evaluateResult.result.status, "succeeded", "full control evaluate status");
  if (!evaluateResult.result.codeHash) {
    throw new Error(`Evaluate result did not include audit hash summary: ${JSON.stringify(evaluateResult.result)}`);
  }

  send({
    type: "browserAction.execute",
    actionSessionId: "evaluate-full",
    action: { type: "evaluate", code: "return document.cookie;" }
  });
  const cookieResult = await waitFor(
    (event) => event.type === "browserAction.result" &&
      event.actionSessionId === "evaluate-full" &&
      event.result?.status === "failed" &&
      event.result?.safety === "block" &&
      String(event.result?.reason ?? "").includes("credential safeguard"),
    "credential evaluate block"
  );
  if (!String(cookieResult.result.reason).includes("credential safeguard")) {
    throw new Error(`Credential safeguard reason missing: ${JSON.stringify(cookieResult.result)}`);
  }

  console.log(`browser action evaluate smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

function verifyEvaluateSafety(rawSnapshot) {
  const observation = buildBrowserObservation({ snapshot: rawSnapshot });
  const normal = decideBrowserActionSafety({
    action: { type: "evaluate", code: "return document.title;" },
    mode: "auto_safe_actions",
    targetConfidence: 1,
    target: undefined
  });
  assertEqual(normal.decision, "block", "normal evaluate policy");
  const full = decideBrowserActionSafety({
    action: { type: "evaluate", code: "return document.title;" },
    mode: "full_control_dev",
    targetConfidence: 1,
    target: observation.elements[0]
  });
  assertEqual(full.decision, "confirm", "full control evaluate policy");
  const guarded = inspectEvaluateCode({ code: "return localStorage.getItem('token');" });
  assertEqual(guarded.ok, false, "credential guard");
  const unlockedGuard = inspectEvaluateCode({ code: "return document.cookie;", allowCredentialAccess: true });
  assertEqual(unlockedGuard.ok, true, "credential guard unlock");
  const unlockedSafety = decideBrowserActionSafety({
    action: { type: "evaluate", code: "return document.cookie;", allowCredentialAccess: true },
    mode: "full_control_dev",
    targetConfidence: 1,
    target: observation.elements[0]
  });
  assertEqual(unlockedSafety.decision, "confirm", "credential evaluate unlock still requires approval");
}

function createSnapshot() {
  return {
    url: "https://example.test/evaluate",
    title: "Browser Action Evaluate Smoke",
    readyState: "complete",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    text: "Evaluate smoke page",
    elements: [
      {
        id: "title",
        role: "heading",
        tagName: "h1",
        label: "Evaluate smoke",
        text: "Evaluate smoke",
        selector: "h1",
        bbox: { x: 20, y: 20, w: 200, h: 36 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.9,
        riskHints: []
      }
    ]
  };
}

async function postDomSnapshot(body) {
  const response = await fetch(`${baseUrl}/providers/dom/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
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

async function postBrowserActionResult(requestId, ok, before, after, error, metadata) {
  const response = await fetch(`${baseUrl}/browser-action/extension/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok, before, after, error, metadata })
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
