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
const routeChangedSnapshot = createSnapshot("query-normalized");

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

  await postDomSnapshot(beforeSnapshot);
  send({
    type: "ask",
    id: "prompt-browser-action-google",
    text: "구글 홈페이지 열어줘",
    mode: "browser"
  });
  const googleApproval = await waitFor(
    (event) => event.type === "interaction.required" &&
      event.interaction?.requestId === "prompt-browser-action-google" &&
      event.interaction?.kind === "approval",
    "prompt google navigation approval"
  );
  if (!googleApproval.interaction.body.includes("navigate https://www.google.com/")) {
    throw new Error(`Google prompt should request approval for the intended navigation: ${JSON.stringify(googleApproval.interaction)}`);
  }
  const googleAnswer = await waitFor((event) => event.type === "message.completed" && event.id === "prompt-browser-action-google", "prompt google navigation answer");
  if (!googleAnswer.text.includes("https://www.google.com/") || googleAnswer.text.includes("Browser Action E2E test page")) {
    throw new Error(`Prompt google navigation answer should not read the current page: ${googleAnswer.text}`);
  }

  await postDomSnapshot(beforeSnapshot);
  send({
    type: "ask",
    id: "prompt-browser-action-chain",
    text: "개념글 눌러서 재밌어보이는 글 보여줘",
    mode: "browser"
  });
  const firstChainQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("prompt-browser-action-chain") &&
      event.status === "plan_paused_for_extension",
    "first chained prompt command"
  );
  const firstChainCommand = await pollBrowserActionCommand(beforeSnapshot);
  assertEqual(firstChainCommand?.requestId, firstChainQueued.detail?.requestId, "first chained command request id");
  assertEqual(firstChainCommand?.expectedSource?.url, beforeSnapshot.url, "first chained command expected source");
  await postBrowserActionResult(firstChainCommand.requestId, true, beforeSnapshot, afterSnapshot);
  const secondChainQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("prompt-browser-action-chain") &&
      event.status === "plan_paused_for_extension" &&
      event.detail?.requestId !== firstChainCommand.requestId,
    "second chained prompt command"
  );
  const secondChainCommand = await pollBrowserActionCommand(afterSnapshot);
  assertEqual(secondChainCommand?.requestId, secondChainQueued.detail?.requestId, "second chained command request id");
  assertEqual(secondChainCommand?.expectedSource?.url, afterSnapshot.url, "second chained command expected source follows first result URL");
  await postBrowserActionResult(
    secondChainCommand.requestId,
    false,
    afterSnapshot,
    routeChangedSnapshot,
    `Active tab URL changed before Browser Action execution: expected ${afterSnapshot.url}, got ${routeChangedSnapshot.url}.`
  );
  const secondChainRetryQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("prompt-browser-action-chain") &&
      event.status === "plan_paused_for_extension" &&
      event.detail?.requestId !== firstChainCommand.requestId &&
      event.detail?.requestId !== secondChainCommand.requestId,
    "second chained source-refresh retry command"
  );
  const secondChainRetryCommand = await pollBrowserActionCommand(routeChangedSnapshot);
  assertEqual(secondChainRetryCommand?.requestId, secondChainRetryQueued.detail?.requestId, "second chained retry command request id");
  assertEqual(secondChainRetryCommand?.expectedSource?.url, routeChangedSnapshot.url, "second chained retry uses refreshed route source");
  await postBrowserActionResult(secondChainRetryCommand.requestId, true, routeChangedSnapshot, createSnapshot("view"));
  const chainAnswer = await waitFor((event) => event.type === "message.completed" && event.id === "prompt-browser-action-chain", "chained prompt answer");
  if (!chainAnswer.text.includes("https://example.test/browser-action-e2e/view")) {
    throw new Error(`Chained Browser Action answer did not use the final observation: ${chainAnswer.text}`);
  }

  await postDomSnapshot(beforeSnapshot);
  send({
    type: "ask",
    id: "prompt-browser-action-source-refresh",
    text: "개념글 눌러줘",
    mode: "browser"
  });
  const sourceRefreshQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("prompt-browser-action-source-refresh") &&
      event.status === "plan_paused_for_extension",
    "source-refresh prompt command"
  );
  const sourceRefreshCommand = await pollBrowserActionCommand(beforeSnapshot);
  assertEqual(sourceRefreshCommand?.requestId, sourceRefreshQueued.detail?.requestId, "source-refresh command request id");
  assertEqual(sourceRefreshCommand?.expectedSource?.url, beforeSnapshot.url, "source-refresh command starts from initial source");
  await postBrowserActionResult(
    sourceRefreshCommand.requestId,
    false,
    beforeSnapshot,
    afterSnapshot,
    `Active tab URL changed before Browser Action execution: expected ${beforeSnapshot.url}, got ${afterSnapshot.url}.`
  );
  const sourceRetryQueued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId.includes("prompt-browser-action-source-refresh") &&
      event.status === "plan_paused_for_extension" &&
      event.detail?.requestId !== sourceRefreshCommand.requestId,
    "source-refresh retry command"
  );
  const sourceRetryCommand = await pollBrowserActionCommand(afterSnapshot);
  assertEqual(sourceRetryCommand?.requestId, sourceRetryQueued.detail?.requestId, "source-refresh retry request id");
  assertEqual(sourceRetryCommand?.expectedSource?.url, afterSnapshot.url, "source-refresh retry uses refreshed source");
  await postBrowserActionResult(sourceRetryCommand.requestId, true, afterSnapshot, afterSnapshot);
  const sourceRefreshAnswer = await waitFor((event) => event.type === "message.completed" && event.id === "prompt-browser-action-source-refresh", "source-refresh prompt answer");
  if (!sourceRefreshAnswer.text.includes("브라우저 동작을 완료했습니다") && !sourceRefreshAnswer.text.includes("Browser action completed")) {
    throw new Error(`Source-refresh retry prompt did not complete after refreshed observation: ${sourceRefreshAnswer.text}`);
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
  const queued = await waitFor(
    (event) => event.type === "browserAction.progress" &&
      event.actionSessionId === "e2e-plan-session" &&
      event.status === "plan_paused_for_extension",
    "plan queued for extension"
  );
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
  const extensionResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.id === command.resultId, "extension action result");
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
  const blocked = await waitFor(
    (event) => event.type === "browserAction.result" &&
      event.actionSessionId === "e2e-plan-session" &&
      event.result?.status === "failed",
    "destructive denied result"
  );
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
  const feedbackOnly = planBrowserActionFromPrompt({ text: "뒤로가기 동작이 이상한데", mode: "browser" });
  if (feedbackOnly) {
    throw new Error(`Browser Action feedback should not execute as a history command: ${JSON.stringify(feedbackOnly)}`);
  }
  const recoveryBack = planBrowserActionFromPrompt({ text: "엉뚱한 글 클릭했네 뒤로가기", mode: "browser" });
  if (!recoveryBack || recoveryBack.steps.length !== 1 || recoveryBack.steps[0].action.type !== "back") {
    throw new Error(`Explicit recovery back prompt should resolve to a single back action: ${JSON.stringify(recoveryBack)}`);
  }
}

function createSnapshot(state) {
  const url = state === "after"
    ? "https://example.test/browser-action-e2e/lists/?id=pathofexile&exception_mode=recommend"
    : state === "query-normalized"
      ? "https://example.test/browser-action-e2e/lists?id=pathofexile"
      : state === "google"
        ? "https://www.google.com/"
      : `https://example.test/browser-action-e2e/${state}`;
  return {
    url,
    title: state === "google" ? "Google" : "Browser Action E2E",
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
        id: "concept-posts",
        role: "link",
        tagName: "a",
        label: "개념글",
        text: "개념글",
        selector: "a[href=\"/mgallery/board/lists/?id=thesingularity&exception_mode=recommend\"]",
        href: "https://example.test/browser-action-e2e/after",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "interesting-post",
        role: "link",
        tagName: "a",
        label: "재밌어보이는 실험 글",
        text: "재밌어보이는 실험 글",
        selector: "a[href=\"/browser-action-e2e/view\"]",
        href: "https://example.test/browser-action-e2e/view",
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

async function pollBrowserActionCommand(snapshot = beforeSnapshot) {
  const response = await fetch(`${baseUrl}/browser-action/extension/poll?tabId=11&windowId=7&url=${encodeURIComponent(snapshot.url)}&title=${encodeURIComponent(snapshot.title)}`);
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
