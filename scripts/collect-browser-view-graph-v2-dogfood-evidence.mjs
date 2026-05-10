import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildBrowserObservation,
  buildElementGraph,
  resolveTarget
} from "../dist/daemon/browser-action/index.js";
import { browserObservationToSemanticSnapshot } from "../dist/daemon/semantic-interface/index.js";

const reportPath = "docs/reports/browser-view-graph-v2-dogfood-evidence-2026-05-10.md";
const assetPath = "docs/reports/assets/browser-view-graph-v2-2026-05-10/evidence.json";
const now = new Date("2026-05-10T06:00:00.000Z");

const before = buildBrowserObservation({ snapshot: createBoardSnapshot("before"), now });
const after = buildBrowserObservation({ snapshot: createBoardSnapshot("after"), now: new Date(now.getTime() + 1200) });
const graph = buildElementGraph({ observationId: before.id, focusedElementId: before.focusedElementId, elements: before.elements });
const conceptResolution = resolveTarget({
  graph,
  observation: before,
  action: { type: "click", target: { kind: "text", text: "개념글" } },
  target: { kind: "text", text: "개념글" },
  hint: "개념글"
});
const contentResolution = resolveTarget({
  graph: buildElementGraph({ observationId: after.id, focusedElementId: after.focusedElementId, elements: after.elements }),
  observation: after,
  action: { type: "click", target: { kind: "text", text: "재밌어보이는 글" } },
  target: { kind: "text", text: "재밌어보이는 글" },
  hint: "재밌어보이는 글"
});
const semanticSnapshot = browserObservationToSemanticSnapshot({ observation: after, now });

assertEqual(before.viewGraph?.schemaVersion, "browser-view-graph.v2", "before graph schema");
assertEqual(conceptResolution.primary?.id, "concept-filter", "concept filter target");
assertEqual(contentResolution.primary?.id, "post-fun-1", "representative content target");
assert(after.viewGraph?.identity.routeKey && before.viewGraph?.identity.routeKey !== after.viewGraph.identity.routeKey, "query transition should change route key");

const evidence = {
  generatedAt: new Date().toISOString(),
  scenario: "deterministic generic board filter plus representative content flow",
  before: summarizeObservation(before),
  after: summarizeObservation(after),
  conceptResolution: summarizeResolution(conceptResolution),
  contentResolution: summarizeResolution(contentResolution),
  semanticProjection: {
    entities: semanticSnapshot.entities.length,
    relations: semanticSnapshot.relations.length,
    conceptEntity: semanticSnapshot.entities.find((entity) => entity.label === "개념글")?.tier2,
    contentEntity: semanticSnapshot.entities.find((entity) => entity.label?.includes("흥미로운"))?.tier2
  }
};

mkdirSync(dirname(assetPath), { recursive: true });
writeFileSync(assetPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
writeFileSync(reportPath, renderReport(evidence), "utf8");
console.log(`browser view graph v2 dogfood evidence written: ${reportPath}`);

function summarizeObservation(observation) {
  return {
    url: observation.url,
    title: observation.title,
    viewRevision: observation.viewGraph?.identity.viewRevision,
    routeKey: observation.viewGraph?.identity.routeKey,
    freshness: observation.viewGraph?.identity.freshness,
    nodes: observation.viewGraph?.nodes.length,
    edges: observation.viewGraph?.edges.length,
    regions: observation.viewGraph?.regions?.map((region) => ({ id: region.id, role: region.role, nodeIds: region.nodeIds.length })),
    contentLists: observation.viewGraph?.contentLists,
    forms: observation.viewGraph?.forms,
    diagnostics: observation.viewGraph?.diagnostics,
    redaction: observation.viewGraph?.redaction
  };
}

function summarizeResolution(resolution) {
  return {
    primary: resolution.primary ? {
      id: resolution.primary.id,
      role: resolution.primary.role,
      label: resolution.primary.label,
      href: resolution.primary.href
    } : null,
    alternatives: resolution.alternatives.map((element) => ({ id: element.id, label: element.label })),
    confidence: resolution.confidence,
    reason: resolution.reason,
    semanticOutcome: resolution.semantic?.outcome
  };
}

function renderReport(evidence) {
  return `# Browser View Graph v2 Dogfood Evidence

Date: 2026-05-10
Scenario: ${evidence.scenario}

## Summary

- Before route key: \`${evidence.before.routeKey}\`
- After route key: \`${evidence.after.routeKey}\`
- Before graph: ${evidence.before.nodes} nodes, ${evidence.before.edges} edges
- After graph: ${evidence.after.nodes} nodes, ${evidence.after.edges} edges
- Content lists after filter: ${evidence.after.contentLists?.length ?? 0}
- Redaction policy: ${evidence.after.redaction?.policy}

## Action Transcript

1. Resolve \`개념글\` against a generic board-like view with both a primary filter button and a sidebar link.
   - Selected: \`${evidence.conceptResolution.primary?.id}\` / ${evidence.conceptResolution.primary?.label}
   - Confidence: ${evidence.conceptResolution.confidence}
   - Reason: ${evidence.conceptResolution.reason}
2. Reobserve a query-transitioned view with a refreshed content list.
3. Resolve \`재밌어보이는 글\` against View Graph v2 representative content-list evidence.
   - Selected: \`${evidence.contentResolution.primary?.id}\` / ${evidence.contentResolution.primary?.label}
   - Confidence: ${evidence.contentResolution.confidence}
   - Reason: ${evidence.contentResolution.reason}

## Semantic Projection

- Semantic entities: ${evidence.semanticProjection.entities}
- Semantic relations: ${evidence.semanticProjection.relations}
- Concept entity tier2: \`${JSON.stringify(evidence.semanticProjection.conceptEntity)}\`
- Content entity tier2: \`${JSON.stringify(evidence.semanticProjection.contentEntity)}\`

## Supporting Asset

- \`${assetPath}\`
`;
}

function createBoardSnapshot(phase) {
  const recommended = phase === "after";
  return {
    url: recommended
      ? "https://example.test/board/lists?id=topic&exception_mode=recommend"
      : "https://example.test/board/lists?id=topic",
    title: recommended ? "Example board - recommended" : "Example board",
    readyState: "complete",
    capturedAt: now.toISOString(),
    viewport: { width: 1280, height: 900, scrollX: 0, scrollY: 0 },
    text: [
      "개념글",
      "개념글[동물,기타]",
      "흥미로운 기술 글 제목",
      "또 다른 긴 게시글 제목"
    ].join("\n"),
    elements: [
      element("concept-filter", "button", "button", "개념글", "개념글", undefined, { x: 240, y: 112, w: 72, h: 32 }, "toolbar", "path-concept-filter"),
      element("sidebar-concept", "link", "a", "개념글[동물,기타]", "개념글[동물,기타]", "https://example.test/category/concept", { x: 24, y: 280, w: 120, h: 24 }, "aside", "path-sidebar-concept"),
      element("post-fun-1", "link", "a", "흥미로운 기술 글 제목", "흥미로운 기술 글 제목", "https://example.test/board/view?id=topic&no=123456", { x: 260, y: 180, w: 480, h: 28 }, "main", "path-post-1", "list-main-posts"),
      element("post-fun-2", "link", "a", "또 다른 긴 게시글 제목", "또 다른 긴 게시글 제목", "https://example.test/board/view?id=topic&no=234567", { x: 260, y: 220, w: 480, h: 28 }, "main", "path-post-2", "list-main-posts"),
      {
        ...element("password-field", "textbox", "input", "password", "", undefined, { x: 820, y: 160, w: 180, h: 32 }, "form", "path-password"),
        inputType: "password",
        editable: true,
        riskHints: ["password", "auth"]
      }
    ]
  };
}

function element(id, role, tagName, label, text, href, bbox, nearestLandmark, domPathHash, listOwner) {
  return {
    id,
    role,
    tagName,
    label,
    text,
    href,
    selector: `${tagName}[data-id="${id}"]`,
    bbox,
    visible: true,
    enabled: true,
    editable: false,
    confidence: 0.92,
    riskHints: [],
    sourceOrder: 1,
    domPathHash,
    nearestLandmark,
    listOwner
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
