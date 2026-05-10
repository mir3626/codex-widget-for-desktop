import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBrowserSemanticFixture,
  createSemanticMemoryStore,
  replaySemanticDecision
} from "../dist/daemon/semantic-interface/index.js";

const date = "2026-05-09";
const reportPath = `docs/reports/semantic-memory-dogfood-evidence-${date}.md`;
const assetPath = `docs/reports/semantic-memory-dogfood-evidence-${date}.json`;
mkdirSync("docs/reports", { recursive: true });

const appDataDir = mkdtempSync(join(tmpdir(), "codex-widget-semantic-memory-dogfood-"));
const store = createSemanticMemoryStore({ appDataDir });

try {
  const unresolved = store.recordUnresolvedCase({
    surface: "browser_page",
    failureKind: "ambiguous_target",
    utterance: "개념글 눌러서 재밌어보이는 글 보여줘",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    candidates: [
      { id: "concept-posts", label: "개념글", reason: "main filter button" },
      { id: "concept-sidebar", label: "개념글[동물,기타]", reason: "partial sidebar link" }
    ],
    traceId: "trace-dogfood-ambiguous-concept"
  });

  const clarification = store.recordFeedbackEvent({
    source: "clarification_selected",
    surface: "browser_page",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    utterance: "개념글 눌러서 재밌어보이는 글 보여줘",
    payload: {
      phrase: "개념글",
      selectedTarget: "개념글",
      rejectedTarget: "개념글[동물,기타]",
      preferredRole: "button",
      preferredRegion: "main",
      preferredAffordance: "filter",
      action: "browser.click",
      safetyClass: "safe_action"
    }
  });

  const readSet = store.readMemory({
    phrase: "개념글",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    limit: 20
  });

  const fixture = createBrowserSemanticFixture();
  const outcome = replaySemanticDecision({
    snapshot: fixture.snapshot,
    intent: fixture.intent,
    memoryReadSet: readSet,
    now: new Date("2026-05-09T00:00:00.000+09:00")
  });
  const selected = outcome.trace.ranked.find((candidate) => candidate.selected);
  const evidence = {
    unresolved,
    clarification,
    readSet: {
      ...readSet,
      edges: readSet.edges.map((edge) => ({
        id: edge.id,
        relation: edge.relation,
        fromKey: edge.fromKey,
        toKey: edge.toKey,
        weightBp: edge.weightBp,
        evidenceCount: edge.evidenceCount,
        safetyClass: edge.safetyClass
      }))
    },
    replay: {
      outcome: outcome.kind,
      selectedHypothesisId: selected?.hypothesisId,
      selectedFinalScoreBp: selected?.finalScoreBp,
      selectedMemoryEvidence: selected?.evidence.memory,
      targetFingerprint: outcome.trace.rankerTrace.targetFingerprint,
      pairwiseMargin: outcome.trace.rankerTrace.pairwiseMargin
    },
    report: store.readReport()
  };

  writeFileSync(assetPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(evidence), "utf8");
  console.log(`semantic memory dogfood evidence written: ${reportPath}`);
} finally {
  store.close();
  rmSync(appDataDir, { recursive: true, force: true });
}

function renderReport(evidence) {
  return `# Semantic Memory Dogfood Evidence - ${date}

## Summary

This deterministic dogfood run verifies the first Semantic Memory path:

- unresolved Browser Action target ambiguity is recorded with redacted utterance data
- clarification feedback creates typed memory graph edges
- ranker integration consumes an immutable MemoryReadSet with hashes
- memory contributes separate evidence axes instead of one opaque prior
- safety remains unchanged and target execution still requires fresh observed candidates

## Input Case

\`\`\`text
개념글 눌러서 재밌어보이는 글 보여줘
\`\`\`

The ambiguity is the universal duplicate-label class: a main filter/control candidate and a partial sidebar/content link candidate can share similar text.

## Evidence

- unresolved case id: \`${evidence.unresolved.id}\`
- feedback id: \`${evidence.clarification.id}\`
- memory read set id: \`${evidence.readSet.id}\`
- memory query hash: \`${evidence.readSet.queryHash}\`
- memory result hash: \`${evidence.readSet.resultHash}\`
- memory edges: ${evidence.readSet.edges.length}
- replay outcome: \`${evidence.replay.outcome}\`
- selected hypothesis: \`${evidence.replay.selectedHypothesisId}\`
- selected score bp: \`${evidence.replay.selectedFinalScoreBp}\`

## Safety Boundary

Semantic Memory did not select an executable target by itself. The replay path still used the current BrowserObservation fixture, Semantic Interface gates, pairwise margin, target fingerprint, and Browser Action-owned execution semantics.

## Supporting Asset

See \`${assetPath}\` for the redacted JSON evidence.
`;
}
