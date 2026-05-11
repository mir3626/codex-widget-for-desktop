import { BrowserPerceptionService } from "../dist/daemon/browser-perception/index.js";
import { ProviderRegistry } from "../dist/daemon/providers/providerRegistry.js";
import {
  BrowserInteractionTransactionManager,
  buildBrowserObservation,
  buildElementGraph,
  buildIntentFrameFromAction,
  createBrowserViewContextLease,
  decideCandidatePlanningGate,
  generateCandidateSteps,
  resolveBrowserActionIntent,
  verifyBrowserAction
} from "../dist/daemon/browser-action/index.js";
import {
  renderSemanticTargetClarificationResponse
} from "../dist/daemon/server/browser-action/clarification.js";

const mode = process.argv[2] ?? "core";

if (mode === "core") {
  await verifyTransactionCore();
  console.log("browser interaction transaction smoke ok");
} else if (mode === "clarification") {
  await verifyTransactionClarification();
  console.log("browser action transaction clarification smoke ok");
} else if (mode === "verification") {
  await verifyTransactionVerification();
  console.log("browser action transaction verification smoke ok");
} else if (mode === "concurrency") {
  await verifyTransactionConcurrency();
  console.log("browser action transaction concurrency smoke ok");
} else {
  throw new Error(`Unknown browser interaction transaction smoke mode: ${mode}`);
}

async function verifyTransactionCore() {
  const context = await prepareContext(createSnapshot());
  const lease = createBrowserViewContextLease({
    context,
    leaseReason: "prompt",
    requiredRiskClass: "safe_side_effect",
    ttlMs: 5_000
  });
  assert(lease.leaseId.startsWith("browser-view-lease-"), "lease id should be generated");
  assertEqual(lease.contextId, context.contextId, "lease context id");
  assertEqual(lease.routeKey, context.routeKey, "lease route key");

  const manager = new BrowserInteractionTransactionManager();
  const transaction = manager.begin({
    requestId: "tx-core",
    actionSessionId: "session-core",
    utterance: "개념글 눌러줘",
    source: "prompt",
    mode: "auto_safe_actions"
  });
  manager.attachLease(transaction.transactionId, lease);
  const intent = buildIntentFrameFromAction({
    utterance: transaction.utterance,
    action: { type: "click", target: { kind: "text", text: "개념글" } },
    targetPhrase: "개념글"
  });
  manager.recordIntent(transaction.transactionId, intent);
  const observation = context.observation;
  const graph = buildElementGraph({
    observationId: observation.id,
    focusedElementId: observation.focusedElementId,
    elements: observation.elements
  });
  const candidates = generateCandidateSteps({
    action: { type: "click", target: { kind: "text", text: "개념글" } },
    graph,
    target: { kind: "text", text: "개념글" },
    hint: "개념글",
    lease
  });
  manager.recordCandidates(transaction.transactionId, candidates);
  assert(candidates.length >= 2, "duplicate concept controls should produce multiple candidates");
  assert(candidates.every((candidate) => candidate.leaseId === lease.leaseId), "candidate ids should be lease-scoped");
  verifySearchIntentAndGate({ graph, lease });
}

function verifySearchIntentAndGate({ graph, lease }) {
  const intent = resolveBrowserActionIntent("검색창에 '브라우저 액션 테스트' 입력하고 검색 버튼 눌러줘");
  assertEqual(intent.actions.length, 2, "search intent should produce type + click");
  const [typeAction, clickAction] = intent.actions;
  assertEqual(typeAction.target.text, "검색", "search field target should not include typed text");
  assertEqual(clickAction.target.text, "검색", "search submit target should not include typed text");
  assertEqual(clickAction.target.role, "button", "search submit action should request button role");
  const candidates = generateCandidateSteps({
    action: clickAction,
    graph,
    target: clickAction.target,
    hint: clickAction.target.text,
    lease
  });
  const decision = decideCandidatePlanningGate({ action: clickAction, candidates, locale: "ko", requireFreshLease: true });
  assertEqual(decision.decision, "proceed", "search button should not re-clarify after sanitized intent");
  const selected = candidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId);
  assertEqual(selected?.element?.id, "search-button", "search submit should select the button candidate");
  const brandedIntent = resolveBrowserActionIntent("검색창에 'codex widget browser action' 입력하고 Google 검색 버튼 눌러줘");
  assertEqual(brandedIntent.actions[1].target.text, "google 검색", "branded search submit label should be preserved");
}

async function verifyTransactionClarification() {
  const context = await prepareContext(createSnapshot());
  const lease = createBrowserViewContextLease({ context, leaseReason: "prompt", requiredRiskClass: "safe_side_effect" });
  const observation = context.observation;
  const graph = buildElementGraph({
    observationId: observation.id,
    focusedElementId: observation.focusedElementId,
    elements: observation.elements
  });
  const action = { type: "click", target: { kind: "text", text: "개념글" } };
  const candidates = generateCandidateSteps({ action, graph, target: action.target, hint: "개념글", lease });
  const decision = decideCandidatePlanningGate({ action, candidates, locale: "ko", requireFreshLease: true });
  assertEqual(decision.decision, "clarify", "ambiguous duplicate candidates should clarify");
  assert(decision.clarificationOptions.length >= 2, "clarification should include concrete options");
  assert(decision.userFacingMessage.includes("대상이 애매"), "Korean clarification message should be concrete");
  const response = renderSemanticTargetClarificationResponse({
    id: "clarification-smoke",
    sessionId: "session-clarification",
    actionSessionId: "action-session-clarification",
    action,
    utterance: "개념글 눌러줘",
    candidates: decision.clarificationOptions.map((candidate) => candidate.element).filter(Boolean)
  }, "개념글 눌러줘");
  assert(response.includes("영역:"), "clarification response should include candidate region hints");
  assert(response.includes("위치:"), "clarification response should include candidate position hints");
  assert(response.includes("번호, 표시된 이름"), "clarification response should explain usable choice inputs");
}

async function verifyTransactionVerification() {
  const before = buildBrowserObservation({ snapshot: createSnapshot({ url: "https://example.test/list" }) });
  const unchanged = buildBrowserObservation({ snapshot: createSnapshot({ url: "https://example.test/list" }) });
  const changed = buildBrowserObservation({ snapshot: createSnapshot({ url: "https://example.test/list?filter=concept", mutationRevision: "2" }) });
  const action = { type: "click", target: { kind: "text", text: "개념글" } };
  const expected = [{ type: "custom", description: "Target activation produces the expected visible page, route, selection, or content change." }];
  const failed = verifyBrowserAction({ action, expected, before, after: unchanged, ok: true });
  assertEqual(failed.status, "failed", "wrong click without expected effect should fail verification");
  const passed = verifyBrowserAction({ action, expected, before, after: changed, ok: true });
  assertEqual(passed.status, "passed", "route/query transition should satisfy click verification");
  const typeAction = { type: "type", target: { kind: "element_id", id: "search-box" }, text: "hello", clearFirst: true, submit: false };
  const noSubmit = verifyBrowserAction({
    action: typeAction,
    expected: [{ type: "custom", description: "Field value changes without implicit submit/navigation." }],
    before,
    after: unchanged,
    ok: true
  });
  assertEqual(noSubmit.status, "passed", "non-submit typing should verify no navigation");
}

async function verifyTransactionConcurrency() {
  const context = await prepareContext(createSnapshot());
  const lease = createBrowserViewContextLease({ context, leaseReason: "prompt", requiredRiskClass: "safe_side_effect" });
  const manager = new BrowserInteractionTransactionManager();
  const first = manager.begin({
    requestId: "tx-1",
    actionSessionId: "session-1",
    utterance: "첫 번째 요청",
    source: "prompt",
    mode: "auto_safe_actions"
  });
  manager.attachLease(first.transactionId, lease);
  const second = manager.begin({
    requestId: "tx-2",
    actionSessionId: "session-2",
    utterance: "두 번째 요청",
    source: "prompt",
    mode: "auto_safe_actions"
  });
  manager.attachLease(second.transactionId, lease);
  const cancelled = manager.get(first.transactionId);
  const active = manager.readActiveTransactionForLease(lease);
  assertEqual(cancelled?.phase, "cancelled", "new transaction should cancel previous active-tab transaction");
  assertEqual(active?.transactionId, second.transactionId, "latest transaction should own active tab");
}

async function prepareContext(snapshot) {
  const providers = new ProviderRegistry();
  const service = new BrowserPerceptionService();
  providers.setDomSnapshot(snapshot);
  const result = await service.ensureFreshContext({
    providers,
    bridgeStatus: createBridgeStatus(snapshot.url),
    request: {
      requestId: `tx-smoke-${Date.now()}`,
      reason: "prompt",
      requiredFreshness: "stable",
      timeoutMs: 200
    }
  });
  if (!result.context) {
    throw new Error(`Browser Perception did not return context: ${JSON.stringify(result)}`);
  }
  return result.context;
}

function createBridgeStatus(url) {
  return {
    connected: true,
    mode: "idle",
    updatedAt: new Date().toISOString(),
    activeTab: {
      tabId: 17,
      windowId: 3,
      url,
      title: "Interaction Smoke",
      origin: "https://example.test/*",
      permission: "allowed"
    }
  };
}

function createSnapshot(options = {}) {
  const url = options.url ?? "https://example.test/list";
  const mutationRevision = options.mutationRevision ?? "1";
  return {
    url,
    title: "Interaction Smoke",
    readyState: "complete",
    mutationRevision,
    mutationQuietMs: 900,
    lastMutationAt: new Date(Date.now() - 900).toISOString(),
    bridge: {
      tabId: 17,
      windowId: 3,
      url,
      title: "Interaction Smoke",
      permission: "allowed"
    },
    text: "개념글\n개념글 모음\n검색\n흥미로운 글 제목",
    elements: [
      {
        id: "concept-filter",
        role: "button",
        tagName: "button",
        label: "개념글",
        text: "개념글",
        selector: "button[data-filter='concept']",
        bbox: { x: 16, y: 20, w: 80, h: 32 },
        visible: true,
        enabled: true,
        confidence: 0.96,
        sourceOrder: 1,
        nearestLandmark: "toolbar",
        domPathHash: "concept-filter",
        mutationRevision
      },
      {
        id: "concept-nav",
        role: "link",
        tagName: "a",
        label: "개념글",
        text: "개념글",
        href: "https://example.test/concept",
        selector: "nav a.concept",
        bbox: { x: 20, y: 90, w: 88, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.92,
        sourceOrder: 2,
        nearestLandmark: "sidebar",
        domPathHash: "concept-nav",
        mutationRevision
      },
      {
        id: "search-box",
        role: "searchbox",
        tagName: "input",
        label: "검색",
        placeholder: "검색",
        value: "",
        selector: "input[type='search']",
        bbox: { x: 160, y: 20, w: 160, h: 32 },
        visible: true,
        enabled: true,
        editable: true,
        confidence: 0.94,
        sourceOrder: 3,
        nearestLandmark: "toolbar",
        domPathHash: "search-box",
        mutationRevision
      },
      {
        id: "search-button",
        role: "button",
        tagName: "button",
        label: "검색",
        text: "검색",
        selector: "button[type='submit']",
        bbox: { x: 326, y: 20, w: 64, h: 32 },
        visible: true,
        enabled: true,
        confidence: 0.95,
        sourceOrder: 4,
        nearestLandmark: "toolbar",
        domPathHash: "search-button",
        mutationRevision
      },
      {
        id: "search-help",
        role: "link",
        tagName: "a",
        label: "검색 도움말",
        text: "검색 도움말",
        href: "https://example.test/help/search",
        selector: "a.search-help",
        bbox: { x: 400, y: 20, w: 88, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.92,
        sourceOrder: 5,
        nearestLandmark: "toolbar",
        domPathHash: "search-help",
        mutationRevision
      },
      {
        id: "post-1",
        role: "link",
        tagName: "a",
        label: "흥미로운 글 제목",
        text: "흥미로운 글 제목",
        href: "https://example.test/post/1",
        selector: "main a.post",
        bbox: { x: 120, y: 140, w: 360, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.94,
        sourceOrder: 6,
        nearestLandmark: "main",
        listOwner: "posts",
        contextText: "흥미로운 글 제목 작성자 조회수",
        domPathHash: "post-1",
        mutationRevision
      }
    ]
  };
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
