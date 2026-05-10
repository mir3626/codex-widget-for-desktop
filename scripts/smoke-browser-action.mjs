import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import {
  BrowserActionAdapterRegistry,
  BrowserActionSessionManager,
  buildBrowserObservation,
  buildElementGraph,
  createAlwaysAllowBrowserActionPolicyInput,
  decideBrowserActionSafety,
  matchBrowserActionPolicy,
  normalizeBrowserActionPolicy,
  planBrowserActionFromPrompt,
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
  verifyAlwaysAllowPolicyGrouping();
  await verifyTargetlessActionsIgnoreFallbackTargets();
  await verifyStaleReobserveRetry(beforeSnapshot, afterSnapshot);
  await verifyExtensionCommandTimeoutCancellation(beforeSnapshot);

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

function verifyAlwaysAllowPolicyGrouping() {
  const navigatePolicyInput = createAlwaysAllowBrowserActionPolicyInput({
    approval: createApproval({
      action: { type: "navigate", url: "https://first.example.test/path" },
      actionLabel: "navigate https://first.example.test/path",
      risk: "medium"
    })
  });
  if (navigatePolicyInput.origin || navigatePolicyInput.actionLabel) {
    throw new Error(`Always allow navigate policy should be grouped by action/risk, not URL or label: ${JSON.stringify(navigatePolicyInput)}`);
  }
  assertEqual(navigatePolicyInput.actionFamily, "navigate", "always allow navigate family");
  const navigatePolicy = normalizeBrowserActionPolicy(navigatePolicyInput);
  const navigateMatch = matchBrowserActionPolicy({
    policies: [navigatePolicy],
    action: { type: "navigate", url: "https://second.example.test/other" },
    mode: "auto_safe_actions",
    safety: createSafety({ actionLabel: "navigate https://second.example.test/other", risk: "medium" })
  });
  assertEqual(navigateMatch.decision, "allow", "grouped navigate policy should match a different URL");

  const clickPolicyInput = createAlwaysAllowBrowserActionPolicyInput({
    approval: createApproval({
      action: { type: "click", target: { kind: "text", text: "Open details", role: "button" } },
      actionLabel: "click",
      targetSummary: "button Open details",
      risk: "medium"
    })
  });
  if (clickPolicyInput.origin || clickPolicyInput.actionLabel) {
    throw new Error(`Always allow click policy should be grouped by safe click/type family, not exact target: ${JSON.stringify(clickPolicyInput)}`);
  }
  assertEqual(clickPolicyInput.actionFamily, "safe_click_type", "always allow click/type family");
  const clickPolicy = normalizeBrowserActionPolicy(clickPolicyInput);
  const typeMatch = matchBrowserActionPolicy({
    policies: [clickPolicy],
    action: { type: "type", target: { kind: "text", text: "Search", role: "textbox" }, text: "codex" },
    mode: "auto_safe_actions",
    safety: createSafety({ actionLabel: "type", targetSummary: "textbox Search", risk: "medium" })
  });
  assertEqual(typeMatch.decision, "allow", "grouped click/type policy should match similar typed actions");
}

function createApproval(input) {
  return {
    id: "approval-smoke",
    actionSessionId: "policy-session",
    resultId: "policy-result",
    action: input.action,
    safety: createSafety(input),
    target: undefined,
    adapterId: "extension"
  };
}

function createSafety(input) {
  return {
    decision: "confirm",
    risk: input.risk,
    reason: "Browser Action smoke approval.",
    actionLabel: input.actionLabel,
    targetSummary: input.targetSummary ?? "(none)",
    destructive: input.risk === "destructive"
  };
}

function verifyResolverAndSafety(snapshot) {
  const observation = buildBrowserObservation({ snapshot });
  const providedGraphObservation = buildBrowserObservation({
    snapshot: {
      ...snapshot,
      viewGraph: {
        ...observation.viewGraph,
        contentLists: [{
          id: "provided-content-list",
          label: "provided content list",
          regionId: "region-main",
          itemNodeIds: ["view-interesting-post"],
          representativeNodeIds: ["view-interesting-post"],
          confidence: 0.91
        }]
      }
    }
  });
  if ((providedGraphObservation.viewGraph?.contentLists ?? []).length === 0) {
    throw new Error("Provided Browser View Graph v2 should preserve content-list metadata through normalization.");
  }
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
  const koreanPrompt = planBrowserActionFromPrompt({ text: "새 채팅 눌러줘", mode: "browser" });
  if (!koreanPrompt || koreanPrompt.steps[0].action.type !== "click" || koreanPrompt.steps[0].targetSummary !== "새 채팅") {
    throw new Error(`Korean click prompt should extract a clean target phrase: ${JSON.stringify(koreanPrompt)}`);
  }
  const newChat = resolveTarget({ graph, target: koreanPrompt.steps[0].action.target, hint: koreanPrompt.steps[0].targetSummary });
  assertEqual(newChat.primary?.id, "new-chat", "Korean new chat target");
  if (newChat.confidence < 0.9) {
    throw new Error(`Korean new chat target should resolve with high confidence: ${JSON.stringify(newChat)}`);
  }
  const dcConceptPrompt = planBrowserActionFromPrompt({ text: "개념글 눌러서 재밌어보이는 글 보여줘", mode: "browser" });
  if (!dcConceptPrompt || dcConceptPrompt.steps.length !== 2 || dcConceptPrompt.steps[0].action.type !== "click" || dcConceptPrompt.steps[0].targetSummary !== "개념글" || dcConceptPrompt.steps[1].targetSummary !== "link: 재밌어보이는 글") {
    throw new Error(`Korean connective click prompt should extract the first target phrase: ${JSON.stringify(dcConceptPrompt)}`);
  }
  const googlePrompt = planBrowserActionFromPrompt({ text: "구글 홈페이지 켜줘", mode: "browser" });
  if (!googlePrompt || googlePrompt.steps[0].action.type !== "navigate" || googlePrompt.steps[0].action.url !== "https://www.google.com/") {
    throw new Error(`Korean website-open prompt should navigate instead of reading the current page: ${JSON.stringify(googlePrompt)}`);
  }
  const googleOpenPrompt = planBrowserActionFromPrompt({ text: "구글 홈페이지 열어줘", mode: "browser" });
  if (!googleOpenPrompt || googleOpenPrompt.steps[0].action.type !== "navigate" || googleOpenPrompt.steps[0].action.url !== "https://www.google.com/") {
    throw new Error(`Korean website-open prompt should not be treated as representative content: ${JSON.stringify(googleOpenPrompt)}`);
  }
  const urlLessMovePrompt = planBrowserActionFromPrompt({ text: "특이저 ㅁ 갤러리로 이동해줘", mode: "browser" });
  if (!urlLessMovePrompt || urlLessMovePrompt.steps[0].action.type !== "navigate" || !urlLessMovePrompt.steps[0].action.url.startsWith("https://www.google.com/search?q=")) {
    throw new Error(`URL-less target navigation should use safe search navigation instead of clicking the current page: ${JSON.stringify(urlLessMovePrompt)}`);
  }
  const concept = resolveTarget({ graph, target: dcConceptPrompt.steps[0].action.target, hint: dcConceptPrompt.steps[0].targetSummary });
  assertEqual(concept.primary?.id, "concept-posts", "Korean concept posts target");
  if (concept.confidence < 0.9) {
    throw new Error(`Korean concept target should resolve with high confidence: ${JSON.stringify(concept)}`);
  }
  const content = resolveTarget({ graph, observation, target: dcConceptPrompt.steps[1].action.target, hint: dcConceptPrompt.steps[1].targetSummary });
  assertEqual(content.primary?.id, "interesting-post", "Korean representative content target");
  if (content.confidence < 0.75) {
    throw new Error(`Representative content target should resolve with high confidence: ${JSON.stringify(content)}`);
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

async function verifyTargetlessActionsIgnoreFallbackTargets() {
  const manager = new BrowserActionSessionManager(new BrowserActionAdapterRegistry());
  const snapshot = createSnapshot("before");
  snapshot.focusedElementId = "delete-repo";
  snapshot.elements = [
    {
      ...snapshot.elements.find((element) => element.id === "delete-repo"),
      id: "danger-first"
    },
    ...snapshot.elements.filter((element) => element.id !== "delete-repo")
  ];
  const session = manager.start({ id: "browser-action-targetless-safety", mode: "auto_safe_actions" });
  manager.observe({ actionSessionId: session.id, snapshot });
  const read = await manager.execute({
    actionSessionId: session.id,
    snapshot,
    action: { type: "read", reason: "explain current page" }
  });
  assertEqual(read.result.status, "succeeded", "targetless read status");
  assertEqual(read.result.safety.decision, "allow", "targetless read safety");
  if (read.result.target) {
    throw new Error(`Targetless read should not inherit fallback page target: ${JSON.stringify(read.result.target)}`);
  }

  const reload = await manager.execute({
    actionSessionId: session.id,
    snapshot,
    action: { type: "reload" }
  });
  if (!reload.command || reload.result.status === "needs_clarification") {
    throw new Error(`Targetless reload should queue without fallback-target clarification: ${JSON.stringify(reload.result)}`);
  }
}

async function verifyExtensionCommandTimeoutCancellation(snapshot) {
  const manager = new BrowserActionSessionManager(new BrowserActionAdapterRegistry());
  const session = manager.start({ id: "browser-action-command-timeout", mode: "auto_safe_actions" });
  manager.observe({ actionSessionId: session.id, snapshot });
  const execution = await manager.execute({
    actionSessionId: session.id,
    snapshot,
    action: { type: "click", target: { kind: "element_id", id: "open-details" } }
  });
  if (!execution.command) {
    throw new Error(`Expected queued extension command before timeout cancellation: ${JSON.stringify(execution.result)}`);
  }
  const failed = manager.failExtensionCommand(execution.command.requestId, "timeout smoke");
  assertEqual(failed?.status, "failed", "timeout cancellation result status");
  assertEqual(failed?.error, "timeout smoke", "timeout cancellation result error");
  const leftover = manager.pollExtensionCommand();
  assertEqual(leftover, undefined, "timeout cancellation removes queued command");
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
        id: "new-chat",
        role: "link",
        tagName: "a",
        label: "새 채팅",
        text: "새 채팅",
        ariaLabel: "새 채팅",
        selector: "a[aria-label=\"새 채팅\"]",
        bbox: { x: 20, y: 200, w: 120, h: 36 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "chat",
        role: "link",
        tagName: "a",
        label: "채팅",
        text: "채팅",
        ariaLabel: "채팅",
        selector: "a[aria-label=\"채팅\"]",
        bbox: { x: 160, y: 200, w: 90, h: 36 },
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
        href: "https://gall.dcinside.com/mgallery/board/lists/?id=thesingularity&exception_mode=recommend",
        bbox: { x: 260, y: 200, w: 80, h: 36 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "global-stat-link",
        role: "link",
        tagName: "a",
        label: "어제 990,699개 게시글 등록",
        text: "어제 990,699개 게시글 등록",
        selector: "a[href=\"/board/lists/?id=dclottery\"]",
        href: "https://example.test/board/lists/?id=dclottery",
        bbox: { x: 860, y: 96, w: 220, h: 24 },
        nearestLandmark: "nav",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.98,
        riskHints: []
      },
      {
        id: "notice-post",
        role: "link",
        tagName: "a",
        label: "처음 오신 분을 위한 안내",
        text: "처음 오신 분을 위한 안내",
        contextText: "100 공지 처음 오신 분을 위한 안내 운영자 01.01 1000",
        selector: "a[href=\"/mgallery/board/view/?id=thesingularity&no=100&page=1\"]",
        href: "https://example.test/browser-action/view/?id=thesingularity&no=100&page=1",
        bbox: { x: 360, y: 236, w: 240, h: 28 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.94,
        riskHints: []
      },
      {
        id: "survey-post",
        role: "link",
        tagName: "a",
        label: "[설문] 알리 할인상품 의견 요청",
        text: "[설문] 알리 할인상품 의견 요청",
        contextText: "설문 이벤트 운영자 [설문] 알리 할인상품 의견 요청",
        selector: "a[href=\"/mgallery/board/view/?id=thesingularity&no=1169000&page=1\"]",
        href: "https://example.test/browser-action/view/?id=thesingularity&no=1169000&page=1",
        bbox: { x: 360, y: 248, w: 260, h: 28 },
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
        label: "AI가 만든 재밌는 글",
        text: "AI가 만든 재밌는 글",
        contextText: "1171535 활용 AI가 만든 재밌는 글 작성자 오늘 1964 28",
        selector: "a[href=\"/mgallery/board/view/?id=thesingularity&no=1169668&page=1\"]",
        href: "https://example.test/browser-action/view/?id=thesingularity&no=1169668&page=1",
        bbox: { x: 360, y: 260, w: 240, h: 28 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.94,
        riskHints: []
      },
      {
        id: "utility-points",
        role: "link",
        tagName: "a",
        label: "잉여력: 6,483",
        text: "잉여력: 6,483",
        selector: "a[href=\"/index.php?mid=best&document_srl=1169668&act=dispCommunicationPointHistory\"]",
        href: "https://example.test/index.php?mid=best&document_srl=1169668&act=dispCommunicationPointHistory",
        bbox: { x: 30, y: 20, w: 160, h: 28 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
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
