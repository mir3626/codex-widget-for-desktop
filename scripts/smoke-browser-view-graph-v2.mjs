import { buildBrowserObservation } from "../dist/daemon/browser-action/index.js";
import { ProviderRegistry } from "../dist/daemon/providers/providerRegistry.js";
import { browserObservationToSemanticSnapshot } from "../dist/daemon/semantic-interface/index.js";

const now = new Date("2026-05-10T05:30:00.000Z");

verifyViewGraphV2Shape();
verifyStableKeysAcrossDomChurn();
verifyPreparedProviderSnapshot();
verifySemanticProjection();

console.log("browser view graph v2 smoke ok");

function verifyViewGraphV2Shape() {
  const observation = buildBrowserObservation({ snapshot: createSnapshot(), now });
  const graph = observation.viewGraph;
  assert(graph, "view graph should exist");
  assertEqual(graph.schemaVersion, "browser-view-graph.v2", "schema version");
  assertEqual(graph.identity.schemaVersion, "browser-view-graph.v2", "identity schema");
  assertEqual(graph.identity.freshness, "fresh", "freshness");
  assert(graph.identity.routeKey, "routeKey should exist");
  assert(graph.identity.querySignature?.includes("id="), "query signature should hash query values");
  assert((graph.regions ?? []).some((region) => region.role === "toolbar"), "toolbar/filter region should exist");
  assert((graph.forms ?? []).some((form) => form.fieldNodeIds.length > 0), "form summary should exist");
  assert((graph.contentLists ?? []).some((list) => list.itemNodeIds.length >= 2), "content list should exist");
  assert((graph.affordanceIndex?.byActionHint.filter ?? []).some((id) => graph.nodes.find((node) => node.id === id)?.label === "개념글"), "filter affordance should index concept button");
  assert((graph.affordanceIndex?.contentCandidates ?? []).length >= 2, "content candidates should be indexed");
  assert((graph.redaction?.redactedFieldCount ?? 0) >= 1, "credential/payment redaction summary should exist");
  assert((graph.diagnostics?.graphNodeCount ?? 0) === graph.nodes.length, "diagnostics node count");
}

function verifyStableKeysAcrossDomChurn() {
  const first = buildBrowserObservation({ snapshot: createSnapshot(), now }).viewGraph;
  const second = buildBrowserObservation({ snapshot: createSnapshot({ shiftSourceOrder: true, title: "Updated title" }), now }).viewGraph;
  const firstConcept = first?.nodes.find((node) => node.label === "개념글");
  const secondConcept = second?.nodes.find((node) => node.label === "개념글");
  assert(firstConcept?.stableKey, "first concept stable key");
  assertEqual(firstConcept?.stableKey, secondConcept?.stableKey, "stable key survives benign source order/title churn");
}

function verifyPreparedProviderSnapshot() {
  const providers = new ProviderRegistry();
  const snapshot = providers.setDomSnapshot(createSnapshot());
  const observation = providers.getDomObservation();
  assert(snapshot.viewGraph, "provider snapshot should carry prepared graph");
  assert(observation?.viewGraph?.identity.routeKey, "provider should retain prepared observation");
  assertEqual(snapshot.viewGraph.identity.viewRevision, observation.viewGraph.identity.viewRevision, "prepared snapshot/observation view revision");
}

function verifySemanticProjection() {
  const observation = buildBrowserObservation({ snapshot: createSnapshot(), now });
  const snapshot = browserObservationToSemanticSnapshot({ observation, now });
  const conceptEntity = snapshot.entities.find((entity) => entity.label === "개념글");
  assert(conceptEntity?.tier2?.viewActionHint === "filter", `semantic entity should receive filter action hint: ${JSON.stringify(conceptEntity?.tier2)}`);
  assert(conceptEntity?.tier2?.viewFreshness === "fresh", "semantic entity should receive freshness");
  const contentEntity = snapshot.entities.find((entity) => entity.label?.includes("흥미로운"));
  assert(contentEntity?.tier2?.viewListId, `content entity should receive list evidence: ${JSON.stringify(contentEntity?.tier2)}`);
}

function createSnapshot(options = {}) {
  const sourceShift = options.shiftSourceOrder ? 10 : 0;
  return {
    url: "https://example.test/board/lists?id=topic&exception_mode=recommend",
    title: options.title ?? "Example board",
    readyState: "complete",
    capturedAt: now.toISOString(),
    viewport: { width: 1280, height: 900, scrollX: 0, scrollY: 0 },
    text: [
      "개념글",
      "흥미로운 기술 글 제목",
      "또 다른 긴 게시글 제목",
      "로그인",
      "검색"
    ].join("\n"),
    elements: [
      {
        id: "concept-filter",
        role: "button",
        tagName: "button",
        label: "개념글",
        text: "개념글",
        selector: "button[data-testid=\"concept-filter\"]",
        bbox: { x: 240, y: 112, w: 72, h: 32 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.95,
        riskHints: [],
        sourceOrder: 1 + sourceShift,
        domPathHash: "path-concept-filter",
        nearestLandmark: "toolbar"
      },
      {
        id: "sidebar-concept",
        role: "link",
        tagName: "a",
        label: "개념글[동물,기타]",
        text: "개념글[동물,기타]",
        href: "https://example.test/category/concept",
        selector: "aside a:nth-of-type(1)",
        bbox: { x: 24, y: 280, w: 120, h: 24 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.85,
        riskHints: [],
        sourceOrder: 2 + sourceShift,
        domPathHash: "path-sidebar-concept",
        nearestLandmark: "aside"
      },
      {
        id: "post-1",
        role: "link",
        tagName: "a",
        label: "흥미로운 기술 글 제목",
        text: "흥미로운 기술 글 제목",
        href: "https://example.test/board/view?id=topic&no=123456",
        selector: "main .post:nth-of-type(1) a",
        bbox: { x: 260, y: 180, w: 480, h: 28 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.92,
        riskHints: [],
        sourceOrder: 3 + sourceShift,
        domPathHash: "path-post-1",
        nearestLandmark: "main",
        listOwner: "list-main-posts"
      },
      {
        id: "post-2",
        role: "link",
        tagName: "a",
        label: "또 다른 긴 게시글 제목",
        text: "또 다른 긴 게시글 제목",
        href: "https://example.test/board/view?id=topic&no=234567",
        selector: "main .post:nth-of-type(2) a",
        bbox: { x: 260, y: 220, w: 480, h: 28 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.92,
        riskHints: [],
        sourceOrder: 4 + sourceShift,
        domPathHash: "path-post-2",
        nearestLandmark: "main",
        listOwner: "list-main-posts"
      },
      {
        id: "search-field",
        role: "searchbox",
        tagName: "input",
        label: "검색",
        placeholder: "검색",
        inputType: "search",
        selector: "input[name=\"q\"]",
        bbox: { x: 820, y: 112, w: 180, h: 32 },
        visible: true,
        enabled: true,
        editable: true,
        confidence: 0.95,
        riskHints: [],
        sourceOrder: 5 + sourceShift,
        domPathHash: "path-search-field",
        nearestLandmark: "form",
        formOwner: "form-search"
      },
      {
        id: "password-field",
        role: "textbox",
        tagName: "input",
        label: "password",
        inputType: "password",
        selector: "input[type=\"password\"]",
        bbox: { x: 820, y: 160, w: 180, h: 32 },
        visible: true,
        enabled: true,
        editable: true,
        confidence: 0.95,
        riskHints: ["password", "auth"],
        sourceOrder: 6 + sourceShift,
        domPathHash: "path-password",
        nearestLandmark: "form",
        formOwner: "form-login"
      }
    ]
  };
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
