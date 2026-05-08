import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { planBrowserActionFromPrompt } from "../dist/daemon/browser-action/index.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-browser-action-e2e-control-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];
const waiters = [];
const beforeSnapshot = createSnapshot("before");
const afterSnapshot = createSnapshot("after");

try {
  verifyPromptPlanner();
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

  await postDomSnapshot(beforeSnapshot);
  send({ type: "browserAction.policy.list" });
  await waitFor((event) => event.type === "browserAction.policies", "initial policy event");
  send({
    type: "ask",
    id: "prompt-browser-action-read",
    text: "현재 페이지 읽어줘",
    mode: "browser"
  });
  const promptPlan = await waitFor((event) => event.type === "browserAction.plan" && event.actionSessionId.includes("prompt-browser-action-read"), "prompt-driven browser action plan");
  assertEqual(promptPlan.plan.status, "completed", "prompt read plan completed");
  const promptAnswer = await waitFor((event) => event.type === "message.completed" && event.id === "prompt-browser-action-read", "prompt browser action answer");
  if (!promptAnswer.text.includes("Browser Action E2E test page") || !promptAnswer.text.includes("https://example.test/browser-action-e2e/before")) {
    throw new Error(`Prompt Browser Action answer did not summarize the observed page: ${promptAnswer.text}`);
  }

  send({
    type: "browserAction.command",
    requestId: "direct-read-request",
    command: {
      id: "direct-read-plan",
      kind: "read",
      adapterId: "extension",
      sessionId: "browser-action-e2e-control-session",
      mode: "auto_safe_actions"
    }
  });
  const directRead = await waitFor((event) => event.type === "browserAction.result" && event.result?.plan?.id === "direct-read-plan", "direct read result");
  assertEqual(directRead.result.plan.status, "completed", "direct read command plan");

  send({
    type: "browserAction.policy.set",
    policy: {
      decision: "allow",
      actionFamily: "safe_click_type",
      origin: beforeSnapshot.url,
      targetRisk: "low",
      mode: "any",
      note: "Allow safe click/type on deterministic smoke origin."
    }
  });
  const policies = await waitFor((event) => event.type === "browserAction.policies" && event.policies.some((policy) => policy.actionFamily === "safe_click_type"), "policy set");
  assertEqual(policies.policies[0].decision, "allow", "policy decision");

  send({ type: "browserAction.start", actionSessionId: "e2e-plan-session", mode: "ask_before_action", source: { kind: "active_tab", url: beforeSnapshot.url, title: beforeSnapshot.title } });
  await waitFor((event) => event.type === "browserAction.started" && event.actionSessionId === "e2e-plan-session", "plan session started");
  send({ type: "browserAction.observe", actionSessionId: "e2e-plan-session" });
  await waitFor((event) => event.type === "browserAction.observation" && event.actionSessionId === "e2e-plan-session", "plan observation");
  send({
    type: "browserAction.plan",
    actionSessionId: "e2e-plan-session",
    plan: {
      id: "e2e-safe-plan",
      goal: "Open details after safe policy",
      adapterId: "extension",
      steps: [
        {
          id: "click-details",
          action: { type: "click", target: { kind: "element_id", id: "open-details" } },
          targetSummary: "Open details"
        }
      ],
      confidence: 0.9
    }
  });
  const queued = await waitFor((event) => event.type === "browserAction.progress" && event.status === "plan_paused_for_extension", "plan queued for extension");
  const command = await pollBrowserActionCommand();
  assertEqual(command?.requestId, queued.detail?.requestId, "plan command request id");
  if (!command?.expectedSource?.url) {
    throw new Error(`Queued command is missing expected source metadata: ${JSON.stringify(command)}`);
  }
  if (!command?.expiresAt) {
    throw new Error(`Queued command is missing expiry metadata: ${JSON.stringify(command)}`);
  }
  assertExtensionPickupWindow(command);
  await postBrowserActionResult(command.requestId, true, beforeSnapshot, afterSnapshot);
  const extensionResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.action === "click", "extension action result");
  assertEqual(extensionResult.result.status, "succeeded", "extension action status");

  send({
    type: "browserAction.command",
    requestId: "direct-click-request",
    command: {
      id: "direct-click-plan",
      kind: "click",
      actionSessionId: "e2e-plan-session",
      adapterId: "extension",
      targetText: "Open details"
    }
  });
  const directQueued = await waitFor((event) => event.type === "browserAction.progress" && event.status === "direct_paused_for_extension", "direct click queued");
  const directCommand = await pollBrowserActionCommand();
  assertEqual(directCommand?.requestId, directQueued.detail?.requestId, "direct command request id");
  assertExtensionPickupWindow(directCommand);
  await postBrowserActionResult(directCommand.requestId, true, beforeSnapshot, afterSnapshot);
  const directClickResult = await waitFor(
    (event) =>
      event.type === "browserAction.result" &&
      event.result?.action === "click" &&
      event.result?.status === "succeeded" &&
      event.result?.id !== extensionResult.result.id,
    "direct click result"
  );
  assertEqual(directClickResult.result.verification, "passed", "direct click verification");


  send({
    type: "browserAction.policy.set",
    policy: {
      decision: "deny",
      actionFamily: "all",
      origin: beforeSnapshot.url,
      targetRisk: "destructive",
      mode: "any",
      note: "Deny destructive smoke actions."
    }
  });
  await waitFor((event) => event.type === "browserAction.policies" && event.policies.some((policy) => policy.decision === "deny"), "deny policy set");
  send({
    type: "browserAction.execute",
    actionSessionId: "e2e-plan-session",
    action: { type: "click", target: { kind: "element_id", id: "delete-repo" } }
  });
  const blocked = await waitFor((event) => event.type === "browserAction.result" && event.result?.status === "failed", "destructive denied result");
  assertEqual(blocked.result.safety, "block", "destructive policy block");

  console.log(`browser action e2e control smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

function verifyPromptPlanner() {
  const search = planBrowserActionFromPrompt({ text: "검색창에 \"codex app-server\" 입력하고 검색해줘", mode: "browser" });
  if (!search || search.steps.length !== 2 || search.steps[0].action.type !== "type" || search.steps[1].action.type !== "click") {
    throw new Error(`Search prompt did not produce a type+click plan: ${JSON.stringify(search)}`);
  }
  const click = planBrowserActionFromPrompt({ text: "현재 페이지에서 Learn more 링크 눌러줘", mode: "browser" });
  if (!click || click.steps[0].action.type !== "click") {
    throw new Error(`Click prompt did not produce click plan: ${JSON.stringify(click)}`);
  }
  const koreanClick = planBrowserActionFromPrompt({ text: "새 채팅 눌러줘", mode: "browser" });
  if (!koreanClick || koreanClick.steps[0].action.type !== "click" || koreanClick.steps[0].targetSummary !== "새 채팅") {
    throw new Error(`Korean click prompt did not extract the target phrase: ${JSON.stringify(koreanClick)}`);
  }
}

function createSnapshot(state) {
  return {
    url: `https://example.test/browser-action-e2e/${state}`,
    title: "Browser Action E2E",
    readyState: "complete",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    text: state === "after" ? "Details opened" : "Browser Action E2E test page",
    elements: [
      {
        id: "open-details",
        role: "button",
        tagName: "button",
        label: "Open details",
        text: "Open details",
        selector: "#open-details",
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
        label: "Delete repository",
        text: "Delete repository",
        selector: "#delete-repo",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: ["delete"]
      }
    ]
  };
}

function send(message) {
  socket.send(JSON.stringify(message));
}

async function postDomSnapshot(snapshot) {
  const response = await fetch(`${baseUrl}/providers/dom/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  if (!response.ok) {
    throw new Error(`DOM snapshot post failed: ${response.status}`);
  }
}

async function pollBrowserActionCommand() {
  const response = await fetch(`${baseUrl}/browser-action/extension/poll?tabId=11&windowId=7&url=${encodeURIComponent(beforeSnapshot.url)}&title=${encodeURIComponent(beforeSnapshot.title)}`);
  if (!response.ok) {
    throw new Error(`Browser Action poll failed: ${response.status}`);
  }
  return (await response.json()).command ?? null;
}

async function postBrowserActionResult(requestId, ok, before, after, error) {
  const response = await fetch(`${baseUrl}/browser-action/extension/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok, before, after, error })
  });
  if (!response.ok) {
    throw new Error(`Browser Action result post failed: ${response.status}`);
  }
}

function waitFor(predicate, label, timeoutMs = 15_000) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => event.type).join(", ")}`));
      }, timeoutMs)
    };
    waiters.push(waiter);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertExtensionPickupWindow(command) {
  if (!command?.createdAt || !command?.expiresAt) {
    throw new Error(`Queued extension command is missing created/expiry metadata: ${JSON.stringify(command)}`);
  }
  const pickupWindowMs = Date.parse(command.expiresAt) - Date.parse(command.createdAt);
  if (pickupWindowMs < 60_000) {
    throw new Error(`Queued extension command expiry is shorter than the MV3 alarm pickup window: ${pickupWindowMs}ms`);
  }
}
