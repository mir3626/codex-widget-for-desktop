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
  renderSemanticTargetClarificationResponse,
  selectSemanticClarificationCandidate
} from "../dist/daemon/server/browser-action/clarification.js";
import { preparePromptStepRetryAfterSourceRefresh } from "../dist/daemon/server/browser-action/promptPlanState.js";

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
  verifyExplicitControlRoleIntentAndGate({ graph, lease });
  verifyOrdinalContentIntentAndGate({ graph, lease });
  verifyContentIdentifierIntentAndGate({ graph, lease });
  verifyRepresentativeContentAvoidsNavigation({ graph, lease });
  verifySemanticMemoryAdvisoryRanking({ graph, lease });
}

function verifyExplicitControlRoleIntentAndGate({ graph, lease }) {
  const intent = resolveBrowserActionIntent("개념글 버튼 눌러달라는 뜻이야");
  assertEqual(intent.actions.length, 1, "explicit concept button correction should produce one click");
  assertEqual(intent.actions[0].target.text, "개념글", "explicit concept button target text");
  assertEqual(intent.actions[0].target.role, "button", "explicit concept button target role");
  const candidates = generateCandidateSteps({
    action: intent.actions[0],
    graph,
    target: intent.actions[0].target,
    hint: intent.actions[0].target.text,
    lease
  });
  const decision = decideCandidatePlanningGate({ action: intent.actions[0], candidates, locale: "ko", requireFreshLease: true });
  const selected = candidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId);
  assertEqual(decision.decision, "proceed", "explicit button role should disambiguate duplicate concept targets");
  assertEqual(selected?.element?.id, "concept-filter", "explicit button role should select the control, not a content or sidebar link");
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

function verifyOrdinalContentIntentAndGate({ graph, lease }) {
  const intent = resolveBrowserActionIntent("4번글 눌러줘");
  assertEqual(intent.actions.length, 1, "ordinal content intent should produce one click");
  assertEqual(intent.actions[0].target.text, "4번째 글", "ordinal content intent should preserve the requested item number");
  const candidates = generateCandidateSteps({
    action: intent.actions[0],
    graph,
    target: intent.actions[0].target,
    hint: intent.actions[0].target.text,
    lease
  });
  const decision = decideCandidatePlanningGate({ action: intent.actions[0], candidates, locale: "ko", requireFreshLease: true });
  const selected = candidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId);
  assertEqual(decision.decision, "proceed", "ordinal content target should proceed when the item exists");
  assertEqual(selected?.element?.id, "post-4", "ordinal content target should select the fourth content item");
  assert(selected?.label.includes("4번째 글"), "ordinal candidate label should be user-readable");
  assert(!candidates.some((candidate) => candidate.element?.id === "vote-post-2"), "utility vote links must not count as content items");
}

function verifyContentIdentifierIntentAndGate({ graph, lease }) {
  const intent = resolveBrowserActionIntent("1174404번글 눌러줘");
  assertEqual(intent.actions.length, 1, "content id intent should produce one click");
  assertEqual(intent.actions[0].target.text, "1174404번 글", "long content number should be treated as an identifier, not ordinal");
  const candidates = generateCandidateSteps({
    action: intent.actions[0],
    graph,
    target: intent.actions[0].target,
    hint: intent.actions[0].target.text,
    lease
  });
  const decision = decideCandidatePlanningGate({ action: intent.actions[0], candidates, locale: "ko", requireFreshLease: true });
  const selected = candidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId);
  assertEqual(decision.decision, "proceed", "content id target should proceed when the matching link exists");
  assertEqual(selected?.element?.id, "post-1174404", "content id target should select the matching href/text candidate");
}

function verifyRepresentativeContentAvoidsNavigation({ graph, lease }) {
  const intent = resolveBrowserActionIntent("재밌어보이는 글 아무거나 눌러줘");
  assertEqual(intent.actions.length, 1, "representative content intent should produce one click");
  const candidates = generateCandidateSteps({
    action: intent.actions[0],
    graph,
    target: intent.actions[0].target,
    hint: intent.actions[0].target.text,
    lease
  });
  const decision = decideCandidatePlanningGate({ action: intent.actions[0], candidates, locale: "ko", requireFreshLease: true });
  const selected = candidates.find((candidate) => candidate.candidateId === decision.selectedCandidateId);
  assertEqual(decision.decision, "proceed", "representative content target should proceed with content-list candidates");
  assertEqual(selected?.element?.id, "post-1", "representative content should prefer page content over navigation links");
  assert(!candidates.some((candidate) => candidate.element?.id === "nav-story"), "navigation links must not be representative content candidates when page content exists");
}

function verifySemanticMemoryAdvisoryRanking({ graph, lease }) {
  const intent = resolveBrowserActionIntent("재밌어보이는 글 아무거나 눌러줘");
  const action = intent.actions[0];
  const baseline = generateCandidateSteps({
    action,
    graph,
    target: action.target,
    hint: action.target.text,
    lease
  });
  const baselineDecision = decideCandidatePlanningGate({ action, candidates: baseline, locale: "ko", requireFreshLease: true });
  const baselineSelected = baseline.find((candidate) => candidate.candidateId === baselineDecision.selectedCandidateId);
  assertEqual(baselineSelected?.element?.id, "post-1", "baseline representative content should follow current view evidence order");
  const memoryReadSet = createMemoryReadSet({
    phrase: "재밌어보이는 글 아무거나",
    toKey: "두 번째 게시글 제목"
  });
  const memoryCandidates = generateCandidateSteps({
    action,
    graph,
    target: action.target,
    hint: action.target.text,
    lease,
    memoryReadSet,
    memoryEvidence: {
      readSetId: memoryReadSet.id,
      edgeCount: memoryReadSet.edges.length,
      exclusionCount: memoryReadSet.exclusions.length
    }
  });
  const memoryDecision = decideCandidatePlanningGate({ action, candidates: memoryCandidates, locale: "ko", requireFreshLease: true });
  const memorySelected = memoryCandidates.find((candidate) => candidate.candidateId === memoryDecision.selectedCandidateId);
  assertEqual(memorySelected?.element?.id, "post-2", "semantic memory may advisably reorder equally supported current-view candidates");
  assert(memorySelected?.reasonCodes.includes("semantic_memory_phrase_alias"), "memory-selected candidate should record memory reason code");
  assert(memorySelected?.scoreBreakdown.semantic_memory > 0, "memory-selected candidate should expose bounded memory score contribution");
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
  assert(response.includes("선택어: 1 또는 첫번째"), "clarification response should include readable ordinal aliases");
  assert(response.includes("번호, \"첫번째/두번째\""), "clarification response should explain ordinal choice inputs");
  const selectedByOrdinal = selectSemanticClarificationCandidate({
    id: "clarification-smoke",
    sessionId: "session-clarification",
    actionSessionId: "action-session-clarification",
    action,
    utterance: "개념글 눌러줘",
    candidates: decision.clarificationOptions.map((candidate) => candidate.element).filter(Boolean)
  }, "두번째");
  assertEqual(selectedByOrdinal?.id, decision.clarificationOptions[1]?.element?.id, "Korean ordinal clarification choice should select the requested candidate");
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
  const wrongNavigate = verifyBrowserAction({
    action: { type: "navigate", url: "https://www.google.com/search?q=codex%20widget" },
    before,
    after: changed,
    ok: true
  });
  assertEqual(wrongNavigate.status, "failed", "navigate must fail when the requested destination is not reached");
  const rightNavigate = verifyBrowserAction({
    action: { type: "navigate", url: "https://www.google.com/search?q=codex%20widget" },
    before,
    after: buildBrowserObservation({ snapshot: createSnapshot({ url: "https://www.google.com/search?q=codex%20widget" }) }),
    ok: true
  });
  assertEqual(rightNavigate.status, "passed", "navigate should pass when the requested destination is reached");
  const staleBack = verifyBrowserAction({
    action: { type: "back" },
    expected: [{ type: "navigation_complete" }],
    before,
    after: unchanged,
    ok: true
  });
  assertEqual(staleBack.status, "failed", "back with unchanged observation should fail verification");
  const historyRetryPlan = {
    id: "history-retry-plan",
    actionSessionId: "history-action-session",
    createdAt: new Date().toISOString(),
    goal: "뒤로가기",
    status: "paused",
    confidence: 1,
    steps: [{
      id: "step-1",
      action: { type: "back" },
      status: "awaiting_extension",
      attempts: 1,
      resultId: "history-result"
    }]
  };
  const historyMismatchResult = {
    id: "history-result",
    actionSessionId: "history-action-session",
    action: { type: "back" },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: "failed",
    before,
    after: changed,
    error: "Active tab URL changed before Browser Action execution: expected https://example.test/list, got https://example.test/other.",
    verification: {
      status: "failed",
      reason: "Active tab URL changed before Browser Action execution: expected https://example.test/list, got https://example.test/other."
    },
    safety: {
      decision: "allow",
      risk: "low",
      reason: "test",
      actionLabel: "back",
      targetSummary: "(none)",
      destructive: false
    }
  };
  assertEqual(
    preparePromptStepRetryAfterSourceRefresh(historyRetryPlan, historyMismatchResult),
    false,
    "history navigation must not be retried after source refresh mismatch"
  );
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

function createMemoryReadSet({ phrase, toKey }) {
  return {
    id: "mem-read-smoke",
    schemaVersion: "semantic-memory.v1",
    storeVersion: "semantic-memory-store.v1",
    decayEpoch: "smoke",
    scope: {
      surface: "browser_page",
      origin: "https://example.test",
      viewPattern: "/list"
    },
    queryHash: "memory-query-smoke",
    resultHash: "memory-result-smoke",
    edges: [{
      id: "edge-memory-preferred-post",
      fromKey: phrase.normalize("NFKC").toLowerCase(),
      toKey: toKey.normalize("NFKC").toLowerCase(),
      relation: "phrase_alias",
      weightBp: 9000,
      evidenceCount: 3,
      positiveCount: 3,
      negativeCount: 0,
      scope: {
        surface: "browser_page",
        origin: "https://example.test",
        viewPattern: "/list"
      },
      source: "clarification",
      safetyClass: "safe_action",
      lastUsedAt: new Date().toISOString()
    }],
    exclusions: []
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
        id: "nav-story",
        role: "link",
        tagName: "a",
        label: "재밌는 사이트 안내글",
        text: "재밌는 사이트 안내글",
        href: "https://example.test/navigation/story",
        selector: "nav a.story",
        bbox: { x: 20, y: 124, w: 180, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.94,
        sourceOrder: 3,
        nearestLandmark: "navigation",
        contextText: "재밌는 사이트 안내글",
        domPathHash: "nav-story",
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
        sourceOrder: 4,
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
        sourceOrder: 5,
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
        sourceOrder: 6,
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
        sourceOrder: 7,
        nearestLandmark: "main",
        listOwner: "posts",
        contextText: "흥미로운 글 제목 작성자 조회수",
        domPathHash: "post-1",
        mutationRevision
      },
      {
        id: "post-2",
        role: "link",
        tagName: "a",
        label: "두 번째 게시글 제목",
        text: "두 번째 게시글 제목",
        href: "https://example.test/post/2",
        selector: "main a.post:nth-of-type(2)",
        bbox: { x: 120, y: 176, w: 360, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.94,
        sourceOrder: 8,
        nearestLandmark: "main",
        listOwner: "posts",
        contextText: "두 번째 게시글 제목 작성자 조회수",
        domPathHash: "post-2",
        mutationRevision
      },
      {
        id: "vote-post-2",
        role: "link",
        tagName: "a",
        label: "추천 97",
        text: "추천 97",
        href: "https://example.test/post/2",
        selector: "main a.vote",
        bbox: { x: 500, y: 176, w: 80, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.92,
        sourceOrder: 9,
        nearestLandmark: "main",
        listOwner: "posts",
        contextText: "추천 97",
        domPathHash: "vote-post-2",
        mutationRevision
      },
      {
        id: "post-3",
        role: "link",
        tagName: "a",
        label: "세 번째 게시글 제목",
        text: "세 번째 게시글 제목",
        href: "https://example.test/post/3",
        selector: "main a.post:nth-of-type(3)",
        bbox: { x: 120, y: 212, w: 360, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.94,
        sourceOrder: 10,
        nearestLandmark: "main",
        listOwner: "posts",
        contextText: "세 번째 게시글 제목 작성자 조회수",
        domPathHash: "post-3",
        mutationRevision
      },
      {
        id: "post-4",
        role: "link",
        tagName: "a",
        label: "네 번째 게시글 제목",
        text: "네 번째 게시글 제목",
        href: "https://example.test/post/4",
        selector: "main a.post:nth-of-type(4)",
        bbox: { x: 120, y: 248, w: 360, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.94,
        sourceOrder: 11,
        nearestLandmark: "main",
        listOwner: "posts",
        contextText: "네 번째 게시글 제목 작성자 조회수",
        domPathHash: "post-4",
        mutationRevision
      },
      {
        id: "post-1174404",
        role: "link",
        tagName: "a",
        label: "코덱스 목표를 위한 팁",
        text: "코덱스 목표를 위한 팁",
        href: "https://example.test/board/view/?id=demo&no=1174404",
        selector: "main a.post[data-no='1174404']",
        bbox: { x: 120, y: 284, w: 360, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.94,
        sourceOrder: 12,
        nearestLandmark: "main",
        listOwner: "posts",
        contextText: "1174404 코덱스 목표를 위한 팁 작성자 조회수",
        domPathHash: "post-1174404",
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
