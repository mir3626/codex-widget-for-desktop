# 03 - Observation, Perception, Action, Verification

## Goal

Make every action explainable through current evidence. Memory and prior traces
may rank candidates, but never prove current UI state.

## Observation Types

Observation sources:

- screenshot
- DOM tree
- browser accessibility snapshot
- UIA/native helper tree
- OCR text boxes
- detector boxes
- visual parser output
- terminal output
- file/artifact metadata
- previous observation summary

Every observation should include:

- source
- timestamp
- surface id
- freshness
- reliability score
- redaction status
- blob/resource references
- viewport/window metadata

## Screenshot As Source Of Truth

For visual computer-use actions, screenshot remains the source of truth for the
feedback loop.

Structured evidence can improve speed and reliability:

- DOM selectors
- UIA automation ids
- OCR boxes
- accessibility roles
- browser chrome metadata

But the action loop must still be able to answer:

- What was visible before the action?
- Where did the agent intend to act?
- What changed after the action?
- What proof shows success or failure?

## Perception Graph

The existing perception graph should become the shared target-selection
substrate.

Evidence node fields:

- semantic label
- visible text
- normalized text
- aliases
- accessibility role
- DOM selector
- UIA selector
- bounding box
- screenshot region
- OCR box
- z-order
- occlusion
- enabled/disabled state
- source reliability
- freshness
- disagreement notes
- risk tags

Edges:

- contains
- overlaps
- label_for
- described_by
- same_as
- near
- blocks
- inferred_from
- contradicted_by

Graph merge rules:

- DOM/UIA current evidence outranks stale memory.
- Screenshot/OCR can confirm visible text where DOM is missing.
- Disagreement should lower confidence, not silently pick one source.
- High-risk actions require stronger evidence than read-only actions.
- Prior failure memory can downrank bad targets after current evidence exists.

## ROI Cascade Runtime

The existing cascade shape should become executable.

Stages:

1. cached graph hit
2. DOM/UIA fresh observe
3. tile hash and dirty-region detection
4. ROI OCR detection boxes
5. ROI OCR text recognition
6. screenshot detector
7. GUI parser
8. VLM fallback

Early exit gates:

- enough confidence for read-only answer
- enough confidence for low-risk click
- enough confidence for high-risk action
- insufficient evidence, request clarification
- restricted surface, block

Required metrics:

- stage started/completed
- p50/p95 stage latency
- cache hit rate
- dirty tile count
- OCR region count
- detector fallback rate
- VLM fallback rate
- target grounding confidence

## Target Grounding

Planner should not emit only text like "click the submit button".

Planner output should include:

```ts
type GroundedTarget = {
  targetId: string;
  evidenceNodeIds: string[];
  label: string;
  actionPoint?: { x: number; y: number };
  selector?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence: number;
  riskClass: RiskClass;
  requiresFreshObservation: boolean;
};
```

Action execution can use:

- DOM selector click when available and safe
- CDP/Playwright locator action
- extension injected action
- coordinate click
- UIA invoke
- keyboard fallback

The selected execution mode must be recorded.

Current implementation note:

- Browser Action pre-action Computer Session observations already record
  `computer-session-target-evidence.v1` when the action result target can be
  matched to a perception graph node. The record includes graph/node ids,
  element id, action type, mapped action risk, threshold, allowed decision,
  confidence, evidence sources/classes, disagreement notes, and a compact
  target summary. This is the current debug/eval explanation path for Browser
  target choice.
- `arbitratePerceptionTarget()` is the first shared target-selection helper. It
  considers fresh perception graphs for a target query, scores candidates by
  graph freshness, match confidence, evidence confidence, threshold result, and
  disagreement penalty, then returns `perception-target-arbitration.v1`
  metadata. Browser Action target evidence now records that arbitration summary
  instead of relying on a one-off direct graph lookup.
- `screen_observe` outputs with bounded text/box evidence now create
  `computer_session_screen_observation` graphs. Screen nodes combine OCR
  visible-text/box evidence with screenshot-region, bbox, freshness, and
  source-reliability evidence while preserving raw screenshot retention
  boundaries.
- Computer Session keeps a per-session screen tile-hash cache. A repeated
  `screen_observe` automatically receives `previousTileHashes` and previous
  observation metadata, enabling dirty-region detection to return zero changed
  regions and skip ROI OCR/detector stages when the screen is unchanged.
- Native browser-window helper outputs with `observation` or `after` snapshots
  now create `computer_session_native_browser_observation` graphs. Native nodes
  use `uia` evidence for semantic label, role, visible text, `uia_selector`,
  bbox, freshness, and source reliability, so bounded helper observations can
  participate in the same target graph without becoming broad foreground YOLO.
- Arbitration treats non-actionable screen/OCR nodes as read-only evidence.
  They can help explain visible state, but for side-effect/high-risk/credential
  actions the selected node must be actionable; otherwise the candidate records
  `target_not_actionable` and remains blocked.
- This is not yet the full cross-source arbitration layer. DOM-backed Browser
  Action target evidence and screen/OCR graph creation are implemented first;
  UIA/native helper and VLM evidence still need to be merged into the same
  graph explanation before foreground visual action promotion.

## Action Router

The router should choose the safest reliable adapter:

1. structured file/tool/terminal path if the task is not truly GUI-bound
2. DOM/Playwright locator action for web content
3. Browser Chrome API for browser chrome state
4. CDP fixed command where supported and approved
5. extension injected action
6. native browser-window helper
7. foreground visual desktop action in watch-mode
8. future VM visual action

Do not choose visual coordinate input when a safer structured path provides the
same user-visible outcome and proof.

## Verification

Verification must run after meaningful actions.

Verifier inputs:

- expected outcome
- pre-observation
- action result
- post-observation
- graph diff
- file/terminal/browser metadata
- safety decision

Verifier output:

```ts
type EffectVerifierResult = {
  verifierId: string;
  sessionId: string;
  nodeId: string;
  status: "passed" | "failed" | "inconclusive" | "blocked";
  proof: EvidenceReference[];
  falsePositiveRisk: "low" | "medium" | "high";
  falseNegativeRisk: "low" | "medium" | "high";
  recoveryHint?: string;
};
```

Promotion must not be based on:

- raw OCR accuracy alone
- raw ASR WER alone
- one live success
- model confidence alone
- average latency with worse p95

Promotion is allowed when:

- task success improves without p95 regression
- p95 improves without task success regression
- clarification rate drops without unsafe-action increase
- verifier false-positive rate drops
- recovery success improves on known failure corpus

Current implemented slice:

- Computer Session has a session-level `EffectVerifier` for capability-backed
  operations.
- Capability runtime verifier output is still honored, but explicit expectations
  declared in the operation, such as `text contains ...` or `stdout contains ...`,
  are checked against actual output before the session can complete.
- Failed/inconclusive verification records:
  - `effect_verification` eval step
  - failed verification/eval DAG follow-up nodes
  - bounded `fallback` recovery node
  - `recovery_attempt` eval step
  - structured failure memory as calibration only
- Smoke: `npm run smoke:computer-use-effect-verifier`.

## Failure Memory

Failure memory should record:

- scenario
- action intent
- evidence provenance
- failure class
- bad target pattern
- alias correction
- recovery hint
- expiry
- calibration impact
- safety boundary

Memory may:

- downrank repeated bad targets
- suggest aliases
- suggest recovery steps
- trigger abstention/clarification

Memory must not:

- prove current UI state
- bypass approval
- bypass restricted pages
- bypass credentials policy
- bypass evidence freshness

## Acceptance Criteria

- Browser target selection can explain why a target was chosen.
- High-risk actions require stronger evidence than read-only actions.
- Unchanged screens avoid expensive OCR/VLM work.
- Failure memory appears in debug bundles as calibration, not proof.
- Verification records proof and residual false-positive risk.
