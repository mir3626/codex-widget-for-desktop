# Semantic Interface Handoff

Status: implemented in iter-15 as a baseline; handoff authority for the semantic decision-layer implementation; updated after Privacy Filter architecture review, Codex/Claude accuracy debate, iter-15 implementation, and 2026-05-09 Codex subagent design review
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Baseline modules:
- `src/daemon/browser-action/`
- `src/daemon/vision-context/`
- `src/daemon/transcription/`
- provider snapshot and Activity ledger paths

Primary goal: build a reusable daemon-side Semantic Interface that converts observations and user intent into deterministic, auditable action hypotheses. It should be portable across Browser Action, Vision Context, Terminal, Workspace, Screen/OCR, and future Windows UI Automation without becoming a browser-specific resolver or a generic LLM planner.

## Implementation Status (2026-05-08)

Implemented:

- `src/daemon/semantic-interface/` package-like daemon module with frozen v1 type surface, ontology/catalog versions, intent frames, deterministic hypothesis/ranking, step-transition grammar, operating profiles, pure safety predicates, trace/replay, redacted trace projection, generic alias lexicon, Browser Action adapter, Browser Action semantic target resolver, Vision Context adapter, and testing harness.
- `npm run smoke:semantic-interface` covering Browser Action concept-filter resolution, duplicate-label abstention, stale snapshot warnings, redacted trace checks, deterministic replay, Browser Action low-risk live gate, Vision read/locate conformance, and typed/untyped/adversarial golden trace modes.
- Browser Action target resolution integration that keeps Browser Action as the executor, uses Semantic Interface only as a target-resolution gate/advisory, attaches redacted semantic trace metadata to safety/audit, and preserves existing exact/selector/focused/bbox resolver behavior.
- Vision Context read/locate conformance through `taskCapsuleToSemanticSnapshot` without changing core ranker/predicate contracts.
- Dogfood evidence report at `docs/reports/semantic-interface-dogfood-evidence-2026-05-08.md`.

Deferred beyond v1:

- Terminal, Workspace, Screen/OCR, and Windows UI Automation adapters remain future consumers. The v1 contracts leave room for them, but Browser Action and Vision Context are the completed conformance targets for this iteration.
- Statistical calibration remains deferred until a held-out dogfood trace set exists. V1 uses evidence-profile gating plus top-vs-runner-up margin as specified.
- LLM enrichment remains logged-only future work and is not part of deterministic ranking.

## 2026-05-09 Design Review Addendum

The post-implementation design review tightened the v1 contract around a specific concern: semantic resolution must not become a hidden scalar confidence score with extra feature names attached. The module should keep evidence multidimensional and typed until hard gates, operating-profile gates, pairwise margin checks, safety predicates, and clarification/abstention decisions have run.

Adopted refinements for the next implementation cycle:

- Promote `CandidateEvidencePacket` as the public evidence contract. The older `DeterministicFeatures` name should be treated as a compatibility alias only while migrating iter-15 code.
- Add `CandidateGenerationTrace`, `ActionabilityEvidence`, `TargetFingerprint`, `PairwiseMargin`, and `RankerTrace` to the replay contract.
- Use integer basis-point scores (`0..10000`) inside evidence packets to avoid replay drift from floating-point rounding.
- Keep final scalar score as an ordering aid only after typed gates have passed.
- Separate target clarification from safety approval at the type and protocol level.
- Treat Semantic Memory as an immutable, scoped, redacted evidence read-set. Memory can assist tie-breaking only after fresh observed candidates pass hard gates.

Explicitly rejected refinements:

- site-specific resolver rules for the motivating `개념글` case
- online learned rankers in v1
- embedding-selected executable targets
- memory-derived permission or approval relaxation
- durable persistence of full DOM text, screenshots, or sensitive page state

## 0. Why This Handoff Exists

Browser Action currently has a real typed action pipeline, but dogfood exposed a deeper semantic-resolution gap.

Motivating failure:

```text
User: 개념글 눌러서 재밌어보이는 글 보여줘
```

The Browser Bridge observation contained both:

- exact `button 개념글`
- partial `link 개념글[동물,기타]`

The current Browser Action target resolver saw both as close text matches, lowered confidence to an ambiguous value, and the safety policy blocked the click:

```text
needs_clarification: The action needs a specific browser element but the target is not resolved confidently.
```

This is not a site-specific problem. It is a missing semantic decision layer:

- The prompt implies an intent frame: activate/filter `개념글`, then reobserve, then locate/read an interesting content item.
- The exact button and partial sidebar link are different semantic entity/affordance candidates.
- Safety risk and reference ambiguity are currently entangled.
- The system needs replayable evidence for why a candidate won, lost, or required clarification.

Vision Context performed better in early dogfood because it already normalizes raw input into durable capsule/evidence/resolution structures instead of throwing raw observations directly into a prompt or selector matcher. Browser Action, Terminal, Workspace, and future computer-use need the same kind of semantic decision boundary.

An architecture review of OpenAI Privacy Filter confirmed a useful but bounded lesson. Privacy Filter should not become the design basis for `semantic-interface`: it is a token-span labeling system over linear text, while this module resolves action targets in evidence graphs. However, several of its reliability patterns are accuracy-critical for v1:

- candidate generation and final deterministic decision must stay separate
- ontology/catalog/schema versions must be explicit and replayable
- invalid semantic transitions must be rejected or disqualified by typed validators
- operating profiles must describe evidence requirements, not vague confidence moods
- evaluation must distinguish typed correctness, untyped grounding, adversarial cases, and abstention
- durable traces must have a redacted projection boundary

Therefore this handoff keeps the existing graph/affordance architecture, but upgrades these patterns from optional refinements to v1 acceptance criteria.

## 1. Product Goal

Create a reusable Semantic Interface for agent-driven projects:

```text
normalized observation + user intent
  -> evidence-backed hypotheses
  -> deterministic ranking
  -> pure safety predicates
  -> executable command proposals
  -> feature-owned execution
  -> verification claims
  -> replayable traces
```

The core product-level promise:

```text
Agent features should resolve "what the user means" against observed state before acting.
```

Examples the interface should eventually support:

- Browser: "개념글 눌러서 재밌어보이는 글 보여줘."
- Browser: "이 페이지에서 billing 섹션 펼쳐서 현재 플랜 알려줘."
- Vision: "화면 오른쪽 위 파란 버튼이 뭔지 알려줘."
- Terminal: "방금 실패한 명령의 에러 원인 찾아줘."
- Workspace: "변경된 파일 중 테스트와 관련된 파일 열어줘."
- Future UI Automation: "현재 앱에서 새 프로젝트 버튼 눌러줘."

The interface must be useful across projects, but it must stay grounded in deterministic contracts and replayable traces rather than broad, unverifiable ontology claims.

## 2. Design Doctrine

The Semantic Interface is:

```text
a deterministic semantic decision boundary between observation and action
```

It is not:

- an executor
- a browser adapter
- a Vision capture module
- a Korean NLU engine
- a generic LLM reasoning layer
- a full multi-step planner
- a persistence database
- a site-specific tuning layer

Core principles:

- Evidence first: hypotheses must point to concrete evidence.
- Deterministic by default: same normalized snapshot + same intent + same versions produces the same ranking and safety verdict.
- Adapter agnostic: DOM selectors, OCR boxes, terminal rows, file paths, and UIA handles live as adapter locators, not core assumptions.
- Safety is an invariant, not a late stage: pure safety predicates evaluate hypotheses, steps, and plans.
- Ambiguity is separate from danger: uncertain target resolution and dangerous action risk are different failure modes.
- LLMs may enrich intent candidates or synonyms, but cannot directly choose selectors, locators, or ranker scores.
- Execution remains feature-owned: Browser Action, Terminal, Workspace, and future UIA executors interpret command proposals.
- Traces are first-class: every semantic decision should be replayable and explainable without a live page.

## 3. Scope And Non-Scope

### Owned By `semantic-interface`

- shared type contracts
- minimal semantic vocabulary
- adapter capability contract
- normalized snapshot and evidence contracts
- intent frame contract
- semantic hypothesis contract
- deterministic ranking interface
- safety predicate interface
- trace and replay contract
- adapter conformance test harness
- golden trace fixture helpers

### Not Owned By `semantic-interface`

- actual browser click/type/scroll execution
- Vision capture or OCR runtime
- terminal command execution
- workspace file edits
- OS-level mouse/keyboard automation
- app-server tool contracts
- LLM calls
- prompt-to-intent model calls
- product UI
- site-specific selectors or rules
- broad multi-step planning/backtracking
- cross-adapter evidence fusion in v1
- persistent trace database
- learning/online rankers

### Naming Decision

The implementation and handoff use the name `semantic-interface`.

`affordance resolver` is a useful component concept inside the module, but it is not the module name. Keeping the top-level name aligned with `vision-context` and `browser-action` makes the architecture easier to read:

```text
vision-context       -> observation/capsule interface
browser-action       -> typed browser actuator interface
semantic-interface   -> reusable semantic decision interface
```

## 4. Recommended Module Shape

Initial local module:

```text
src/daemon/semantic-interface/
  index.ts
  types.ts
  ontology.ts
  observation.ts
  intentFrame.ts
  hypothesis.ts
  ranker.ts
  safetyPredicate.ts
  trace.ts
  replay.ts
  adapters/
    browserActionAdapter.ts
    visionContextAdapter.ts
  lexicon/
    generic.ts
    ko.ts
  testing/
    fixtures.ts
    assertions.ts
```

This is a daemon-side module at first. It should be written as a package-like boundary: minimal imports, no renderer dependency, no DOM global dependency, no LLM dependency, and no executor dependency.

## 5. V1 Frozen Type Surface

V1 should keep the public surface small. These contracts are the initial frozen surface:

- `SemanticEvidence`
- `SemanticSnapshot`
- `SemanticEntity`
- `SemanticRelation`
- `IntentFrame`
- `ReferenceExpression`
- `SemanticHypothesis`
- `ExecutableCommandProposal`
- `AdapterCapabilities`
- `SafetyPredicate`
- `SafetyVerdict`
- `TraceRecord`
- `RedactedTraceRecord`
- `VerificationClaim`
- `StepTransitionGrammar`
- `OperatingProfile`
- `SemanticDecisionOutcome`
- `SemanticEvalMode`

The types may be implemented in one `types.ts` first, then split only when the module grows.

### Semantic Evidence

Evidence is a reference to adapter-observed facts. It must remain specific enough to execute or verify through the owning feature, but opaque enough that the core does not become browser-specific.

```ts
export type SemanticEvidenceSource =
  | "dom"
  | "accessibility"
  | "visual"
  | "ocr"
  | "transcript"
  | "terminal"
  | "workspace"
  | "action_result"
  | "memory";

export interface SemanticEvidence {
  id: string;
  snapshotId: string;
  adapterId: string;
  source: SemanticEvidenceSource;
  observedAt: string;
  confidence: number;
  locator?: {
    selector?: string;
    xpath?: string;
    role?: string;
    name?: string;
    bbox?: { x: number; y: number; w: number; h: number };
    textRange?: { start: number; end: number };
    path?: string;
    processId?: number;
    opaque?: Record<string, unknown>;
  };
  value?: {
    text?: string;
    role?: string;
    label?: string;
    state?: Record<string, unknown>;
    attributes?: Record<string, string>;
  };
  redaction?: {
    redacted: boolean;
    reason?: string;
  };
}
```

Invariant:

- Every evidence item has a `snapshotId`, `adapterId`, `source`, and `confidence`.
- Adapter-specific locators are allowed, but core rankers must treat unsupported locator fields as opaque.
- Secret values must be redacted before entering evidence.

### Semantic Snapshot

```ts
export type SemanticSurfaceKind =
  | "browser_page"
  | "terminal"
  | "desktop_screen"
  | "app_window"
  | "workspace"
  | "media_stream";

export interface SemanticSnapshot {
  id: string;
  createdAt: string;
  surface: {
    id: string;
    kind: SemanticSurfaceKind;
    title?: string;
    url?: string;
    adapterId: string;
  };
  capabilities: AdapterCapabilities;
  evidence: SemanticEvidence[];
  entities: SemanticEntity[];
  relations: SemanticRelation[];
  provenance: {
    rawObservationId?: string;
    previousSnapshotId?: string;
    previousActionResultId?: string;
  };
}
```

Invariant:

- `id` should be deterministic in tests or scrubbed in trace replay.
- `entities` and `relations` are normalized projections over evidence, not executor commands.
- `capabilities` must reflect the adapter path that produced the snapshot.

### Semantic Entity And Relation

```ts
export type SemanticEntityKind =
  | "surface"
  | "region"
  | "control"
  | "content_item"
  | "media"
  | "selection"
  | "process";

export type SemanticAffordance =
  | "read"
  | "locate"
  | "activate"
  | "filter"
  | "navigate"
  | "type"
  | "submit";

export type SemanticRelationType =
  | "contains"
  | "labels"
  | "inside"
  | "controls"
  | "filters"
  | "item_of"
  | "selected"
  | "focused";

export interface SemanticEntity {
  id: string;
  kind: SemanticEntityKind;
  surfaceId: string;
  label?: string;
  normalizedLabel?: string;
  description?: string;
  affordances: SemanticAffordance[];
  evidenceIds: string[];
  state?: {
    selected?: boolean;
    focused?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    visible?: boolean;
  };
  tier1?: {
    role?: SemanticTier1Role;
    risk?: SemanticTier1Risk;
  };
  tier2?: Record<string, string>;
}

export interface SemanticRelation {
  from: string;
  to: string;
  type: SemanticRelationType;
  confidence: number;
  evidenceIds: string[];
}
```

Invariant:

- Entity kind and affordances are semantic hints, not execution guarantees.
- Tier1 schema is owned by `semantic-interface`; actual mapping from DOM/OCR/terminal facts to Tier1 is adapter-owned.
- Tier2 labels remain consumer-owned and opaque to core rankers unless a feature-specific ranker explicitly opts in.

### Tier1 Role And Risk

```ts
export type SemanticTier1Role =
  | "observe"
  | "locate"
  | "act";

export type SemanticTier1Risk =
  | "read_only"
  | "local_navigation"
  | "external_navigation"
  | "input_non_submitting"
  | "state_change"
  | "submit_or_publish"
  | "destructive"
  | "credential_or_payment"
  | "code_execution"
  | "data_exfiltration";
```

Core owns these coarse classes. Adapters provide mapping evidence.

### Intent Frame

`semantic-interface` does not own full natural-language parsing in v1. It owns the typed frame that rankers consume.

```ts
export type IntentGoal =
  | "read_content"
  | "locate_target"
  | "activate_control"
  | "filter_content"
  | "navigate"
  | "type_input"
  | "submit"
  | "inspect"
  | "unknown";

export interface IntentFrame {
  id: string;
  instruction: string;
  language?: string;
  goal: IntentGoal;
  steps: IntentStep[];
  constraints: IntentConstraint[];
  outputExpectation?: {
    kind: "answer" | "show" | "open" | "summarize" | "confirm";
    description?: string;
  };
}

export interface IntentStep {
  id: string;
  desiredAffordance: SemanticAffordance;
  reference?: ReferenceExpression;
  expectedOutcome?: VerificationClaim;
  riskBudget: SemanticTier1Risk;
}

export interface ReferenceExpression {
  raw: string;
  normalized: string;
  kind?: "name" | "role" | "position" | "focused" | "selection" | "content_category";
  hints?: {
    entityKinds?: SemanticEntityKind[];
    affordances?: SemanticAffordance[];
    regionRoles?: string[];
    excludeRegionRoles?: string[];
    ordinal?: number;
    contentCategory?: string;
  };
}

export interface IntentConstraint {
  kind: "do_not_submit" | "same_origin" | "read_only" | "requires_confirmation" | "locale" | "adapter";
  value?: string;
}
```

Invariant:

- Rankers consume `IntentFrame`, not raw prompt text.
- Prompt parsing can be deterministic or LLM-assisted outside this module, but the frame must be typed before ranking.

### Semantic Hypothesis

The hypothesis is the core decision object. It is a ranked, evidence-backed interpretation of how a semantic intent could map to an executable feature command.

```ts
export interface SemanticHypothesis {
  id: string;
  intentId: string;
  stepId: string;
  targetEntityId?: string;
  targetEvidenceIds: string[];
  affordance: SemanticAffordance;
  proposal: ExecutableCommandProposal;
  expectedVerification: VerificationClaim;
  evidence: CandidateEvidencePacket;
  finalScoreBp?: BasisPoints;
  enrichment?: EnrichmentLog;
  explanation: string;
  disqualifiers: string[];
}

export type DeterministicFeatures = CandidateEvidencePacket;

export interface EnrichmentLog {
  source: "llm" | "lexicon" | "memory";
  influence: "logged_only";
  suggestions: string[];
  notes?: string;
}
```

Invariant:

- `evidence` must be deterministic and must not include LLM-derived scores.
- `DeterministicFeatures` is a migration alias for iter-15 code. New code should use `CandidateEvidencePacket`.
- `enrichment` is logged separately and cannot be read by the deterministic ranker.
- Disqualified candidates should remain visible in trace output.

### Executable Command Proposal

```ts
export interface ExecutableCommandProposal {
  kind: string; // e.g. "browser.click", "browser.read", "terminal.read", "workspace.open"
  tier1Risk: SemanticTier1Risk;
  tier1Role: SemanticTier1Role;
  payload: unknown;
  targetLocator?: {
    evidenceId?: string;
    entityId?: string;
    opaque?: Record<string, unknown>;
  };
  requiresRevalidation: boolean;
  tier2?: Record<string, string>;
}
```

Invariant:

- `semantic-interface` proposes command shape; feature executors own interpretation.
- All mutating or navigation proposals should generally set `requiresRevalidation: true`.
- A proposal is not permission to execute; it must pass safety predicates.

### Adapter Capabilities

```ts
export interface AdapterCapabilities {
  observe: boolean;
  locate: boolean;
  execute: boolean;
  shadowProbe: boolean;
  dryRun: boolean;
  snapshotImmutable: boolean;
  revalidateBeforeExecute: boolean;
  supportsVisionOnly?: boolean;
  supportsDomLocator?: boolean;
  supportsOcrLocator?: boolean;
}
```

Invariant:

- Hypothesis builders should include capability mismatch evidence rather than silently omitting unsupported actions.
- Vision may support observe/locate but not execute.
- Browser extension may support observe/execute but still require revalidation before acting.

### Safety Predicate And Verdict

```ts
export type SafetySubjectKind = "hypothesis" | "step" | "plan";

export interface SafetyPredicateInput {
  subjectKind: SafetySubjectKind;
  hypothesis?: SemanticHypothesis;
  hypotheses?: SemanticHypothesis[];
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  policy?: Record<string, unknown>;
}

export type SafetyVerdict =
  | { kind: "allow"; reasons: string[] }
  | { kind: "warn"; reasons: string[] }
  | { kind: "confirm"; reasons: string[] }
  | { kind: "block"; reasons: string[] };

export type SafetyPredicate = (input: SafetyPredicateInput) => SafetyVerdict;
```

Invariant:

- Safety predicates are pure functions.
- They must not call LLMs, network, filesystem, time, randomness, or executors.
- Multiple predicate results compose by strictest verdict:

```text
block > confirm > warn > allow
```

### Verification Claim

`VerificationClaim` is a single-step verify contract, not a broad planner.

```ts
export interface VerificationClaim {
  kind:
    | "observation_contains"
    | "entity_state"
    | "url_changed"
    | "url_contains"
    | "selection_changed"
    | "content_list_changed"
    | "no_hidden_side_effect"
    | "custom";
  entityId?: string;
  evidenceId?: string;
  expected?: Record<string, unknown>;
  description: string;
}
```

Invariant:

- Claims must be checkable from observations or feature-owned result metadata.
- Natural-language-only verification is allowed only as `custom` and cannot gate high-risk execution without feature-specific validation.

### Trace Record

```ts
export interface TraceRecord {
  id: string;
  createdAt: string;
  snapshotId: string;
  intentId: string;
  intentHash: string;
  semanticInterfaceVersion: string;
  rankerVersion: string;
  predicateVersion: string;
  catalogVersion: string;
  rankerTrace: RankerTrace;
  ranked: Array<{
    hypothesisId: string;
    finalScoreBp: BasisPoints;
    selected: boolean;
    evidence: CandidateEvidencePacket;
    explanation: string;
    disqualifiers: string[];
  }>;
  verdicts: Array<{
    hypothesisId: string;
    verdict: SafetyVerdict;
  }>;
  enrichment?: EnrichmentLog[];
}
```

Reproducibility contract:

```text
same normalized snapshot + same intent frame + same candidate generator/ranker/predicate/catalog versions
  + same optional immutable memory read-set hash
  -> same ranked hypotheses and safety verdicts
```

Execution results may vary because the external world changes. Decision replay must not.

### Redacted Trace Record

`TraceRecord` may exist in memory during a local decision. Durable Activity, report, and app-server context sinks must use a redacted projection.

```ts
export interface RedactedTraceRecord {
  schemaVersion: number;
  id: string;
  createdAt: string;
  snapshotId: string;
  intentId: string;
  intentHash: string;
  semanticInterfaceVersion: string;
  redactionPolicyVersion: string;
  summary: {
    outcome: "selected" | "abstained" | "blocked" | "confirm_required" | "unsupported";
    selectedHypothesisId?: string;
    hypothesisCount: number;
    warningCount: number;
  };
  ranked: Array<{
    hypothesisId: string;
    finalScoreBp: BasisPoints;
    selected: boolean;
    explanation: string;
    disqualifiers: string[];
  }>;
  verdicts: Array<{
    hypothesisId: string;
    verdict: SafetyVerdict;
  }>;
  warnings: SemanticSourceWarning[];
}

export interface SemanticSourceWarning {
  kind: "snapshot_stale" | "source_mismatch" | "adapter_mismatch" | "redacted_evidence" | "unsupported_surface";
  severity: "info" | "warn" | "block";
  evidenceIds: string[];
  description: string;
}
```

Invariant:

- Durable traces must not include password/token/payment/cookie/credential values.
- Redaction happens before writing Activity, report, or app-server context.
- A source mismatch warning is equivalent to Privacy Filter's tokenizer/decode mismatch warning: it does not always block, but it must be visible and replayable.

### Step Transition Grammar, Operating Profile, And Outcome

Privacy Filter's BIOES/Viterbi loop must not be copied into `semantic-interface`. The transferable pattern is constrained validation: typed state transitions prevent malformed decisions from looking valid.

```ts
export type SemanticStepTransition =
  | "intent_to_reference"
  | "reference_to_target"
  | "target_to_action"
  | "action_to_verification";

export interface StepTransitionGrammar {
  id: string;
  version: string;
  validate(input: {
    snapshot: SemanticSnapshot;
    intent: IntentFrame;
    hypothesis: SemanticHypothesis;
  }): {
    valid: boolean;
    disqualifiers: string[];
    warnings: SemanticSourceWarning[];
  };
}

export interface OperatingProfile {
  id: "strict" | "standard" | "permissive";
  version: string;
  requiredEvidence: {
    exactOrAliasMatch?: boolean;
    roleOrAffordanceMatch?: boolean;
    visibleInViewport?: boolean;
    enabledStateKnown?: boolean;
    uniqueWithinScope?: boolean;
    revalidationRequired?: boolean;
    maxSnapshotAgeMs?: number;
    minTopMargin?: number;
  };
}

export type SemanticDecisionOutcome =
  | { kind: "act"; hypothesis: SemanticHypothesis; safety: SafetyVerdict; trace: TraceRecord }
  | { kind: "confirm"; hypothesis: SemanticHypothesis; safety: SafetyVerdict; trace: TraceRecord }
  | { kind: "abstain"; reasons: string[]; trace: TraceRecord }
  | { kind: "block"; reasons: string[]; trace: TraceRecord };

export type SemanticEvalMode = "typed" | "untyped" | "adversarial";
```

Invariant:

- The transition grammar validates semantic structure; it does not flatten graph evidence into token labels.
- Operating profiles are defined by evidence requirements. Safety/risk policy selects a profile; it does not directly mutate ranker thresholds.
- `abstain` is a successful safety outcome when evidence is insufficient for a side-effect action.

## 6. Deterministic Ranking

The initial ranker should be simple, named, and testable.

Input:

- `SemanticSnapshot`
- `IntentFrame`
- generated `SemanticHypothesis[]`

Output:

- sorted hypotheses
- basis-point scores
- typed evidence packets
- disqualifiers

Ranking must not collapse evidence into one scalar too early. The scalar score is only the final ordering aid after typed gates have run. Each hypothesis must carry a multidimensional deterministic evidence packet so required axes can be inspected, gated, compared, and traced independently.

Required v1 evidence shape:

```ts
export type BasisPoints = number; // integer 0..10000

export type AxisEvidenceStatus =
  | "present"
  | "missing"
  | "conflict"
  | "stale"
  | "unsupported"
  | "redacted";

export interface AxisEvidence {
  scoreBp: BasisPoints;
  status: AxisEvidenceStatus;
  evidenceIds: string[];
  reasonCodes: string[];
}

export interface ActionabilityEvidence {
  visible: AxisEvidence;
  enabled: AxisEvidence;
  stable: AxisEvidence;
  inViewport: AxisEvidence;
  occlusion: AxisEvidence;
  adapterCapability: AxisEvidence;
  revalidation: AxisEvidence;
}

export interface MemoryContributionEvidence {
  phraseAlias: AxisEvidence;
  preferredRole: AxisEvidence;
  preferredRegion: AxisEvidence;
  usualAction: AxisEvidence;
  avoidTarget: AxisEvidence;
  scopeStrength: AxisEvidence;
  readSetId?: string;
}

export interface CandidateEvidencePacket {
  lexical: AxisEvidence;
  alias: AxisEvidence;
  affordance: AxisEvidence;
  role: AxisEvidence;
  entityKind: AxisEvidence;
  region: AxisEvidence;
  graphRelation: AxisEvidence;
  viewFreshness: AxisEvidence;
  focus: AxisEvidence;
  actionability: ActionabilityEvidence;
  memory?: MemoryContributionEvidence;
  risk: AxisEvidence;
  ambiguity: AxisEvidence;
}

export interface TargetFingerprint {
  surfaceId: string;
  viewIdentityHash: string;
  entityId?: string;
  evidenceIds: string[];
  role?: string;
  normalizedLabel?: string;
  affordances: SemanticAffordance[];
  regionPath?: string[];
  relationDigest?: string;
  locatorDigest?: string;
  bboxBucket?: string;
}

export interface CandidateGenerationTrace {
  sourceSnapshotId: string;
  intentFrameId: string;
  generatorVersion: string;
  generatedCandidateIds: string[];
  rejectedBeforeRanking: GateResult[];
}

export interface GateResult {
  candidateId: string;
  gate: "hard" | "operating_profile" | "safety_precheck";
  status: "pass" | "fail" | "warn";
  reasonCodes: string[];
}

export interface OperatingProfileDecision {
  profileId: string;
  requiredAxes: string[];
  minTopMarginBp: BasisPoints;
  selectedBy: "action_family" | "risk_tier" | "surface_kind" | "evidence_quality";
  reasonCodes: string[];
}

export interface PairwiseMargin {
  winnerId: string;
  runnerUpId: string;
  finalMarginBp: BasisPoints;
  axisMarginsBp: Record<string, BasisPoints>;
  sufficient: boolean;
  reasonCodes: string[];
}

export interface RankerTrace {
  candidateGeneration: CandidateGenerationTrace;
  gateResults: GateResult[];
  profileDecision: OperatingProfileDecision;
  pairwiseMargin?: PairwiseMargin;
  selectedCandidateId?: string;
  targetFingerprint?: TargetFingerprint;
  outcome: "act" | "clarify" | "abstain" | "block";
  reasonCodes: string[];
}
```

Ranker decision stages:

```text
1. hard gate
   remove candidates that fail freshness, visibility, required affordance, unsupported adapter capability, or malformed transition grammar

2. operating-profile gate
   require action-family-specific evidence axes instead of a single global threshold

3. ranking
   compute scalar ordering only for candidates that survived gates

4. margin/abstention
   compare top candidate and runner-up by profile-specific axes and final score

5. target fingerprinting
   attach a deterministic fingerprint that the feature executor must revalidate before side-effect execution
```

Example profile rules:

```text
click/type:
  viewFreshness >= 8500
  actionability.visible >= 8000
  affordance >= 7000
  lexical or alias >= 6500
  top candidate must beat runner-up by required axes and minTopMargin

read/locate:
  may use lower affordance thresholds
  must still record uncertainty and avoid false precision
```

Embeddings or vector similarity may be used for broad candidate generation or alias discovery, but not as the final authority for execution. Final selection must be based on typed, replayable evidence packets, operating-profile gates, margin checks, target fingerprint revalidation, and safety predicates.

Initial ranking signals:

- exact label match beats partial label match
- desired affordance match beats raw text match
- entity kind match beats generic container match
- enabled/visible/current-surface candidates beat hidden/stale candidates
- selected/focused state improves confidence only when relevant
- unsupported adapter capability disqualifies or warns
- high Tier1 risk does not lower reference confidence; it affects safety verdict separately

Accuracy-critical v1 additions:

- keep candidate evidence as multidimensional typed packets until hard gates and operating-profile gates have run
- trace candidate generation separately from ranking so recall failure cannot masquerade as confident selection
- distinguish visibility from actionability; a visible node may still be disabled, occluded, stale, adapter-unsupported, or unsafe to revalidate
- attach `TargetFingerprint` to side-effect proposals and require executor-owned revalidation before acting
- compare top candidates with pairwise axis margins, not only final score
- run `StepTransitionGrammar` after hypothesis generation and before selection
- use `OperatingProfile` evidence requirements instead of one global confidence threshold
- compare top candidate against runner-up by margin; if margin or required evidence is insufficient, return `abstain`
- record source warnings such as stale snapshot, adapter mismatch, hidden/offscreen evidence, and redacted evidence
- keep all rejected candidates visible in trace output with deterministic disqualifiers
- validate ontology/catalog schemas at build time and snapshot ingest time; per-action runtime validation is reserved for live locator/state fields

For the motivating Browser Action case:

```text
Prompt: 개념글 눌러서 재밌어보이는 글 보여줘

Intent step 1:
  desiredAffordance: filter | activate
  reference: 개념글

Candidate A:
  entity: button 개념글
  kind: control
  affordance: filter/activate
  exactLabelMatch: 1
  affordanceMatch: 1
  selected: true

Candidate B:
  entity: link 개념글[동물,기타]
  kind: content_item/control
  affordance: navigate/open
  partialLabelMatch: 1
  affordanceMatch: 0
  disqualifier: wrong affordance for first step

Selected:
  Candidate A
```

### V1 Calibration Strategy

V1 should not pretend to have statistically calibrated probabilities before enough dogfood data exists. The first production calibration strategy is:

```text
evidence-profile gating + top-vs-runner-up margin + typed abstention
```

This means:

- a candidate must satisfy the selected `OperatingProfile.requiredEvidence`
- the selected candidate must beat the runner-up by the profile's `minTopMargin` when a side-effect action is proposed
- read/locate may use permissive profiles, but the decision must still trace uncertainty
- click/type/navigation/filter actions must abstain or clarify when evidence is under-specified
- future statistical calibration, such as temperature scaling or isotonic regression, requires a held-out golden trace set and a documented recalibration script

## 7. Safety And Ambiguity Policy

Safety and ambiguity must be independent.

Reference resolution statuses:

- `resolved`
- `ambiguous`
- `unresolved`
- `unsupported`

Decision outcomes:

- `act`
- `confirm`
- `abstain`
- `block`

Safety verdicts:

- `allow`
- `warn`
- `confirm`
- `block`

Clarification and safety approval are different protocol concepts:

```ts
export interface ClarificationDecision {
  kind: "clarify";
  reason: "ambiguous_target" | "unknown_reference" | "unknown_intent" | "missing_required_evidence";
  choices: Array<{
    candidateId: string;
    label: string;
    evidenceSummary: string;
    targetFingerprint?: TargetFingerprint;
  }>;
  trace: RankerTrace;
}

export interface SafetyApprovalDecision {
  kind: "safety_approval";
  risk: SemanticTier1Risk;
  proposal: ExecutableCommandProposal;
  safety: SafetyVerdict;
  targetFingerprint?: TargetFingerprint;
  trace: RankerTrace;
}
```

Clarifying which target the user means is not permission to perform a risky action. A confirmed target can still require a separate safety approval.

Default policy:

- read/locate may proceed with lower confidence when no side effect occurs
- low-risk filter/activate/navigation may proceed only when a semantic hypothesis clears threshold and adapter can revalidate before execute
- type into non-submitting fields requires stronger target confidence and secret redaction
- submit/publish/send/delete/payment/auth/password/token/file upload/download/code execution/data exfiltration must confirm or block
- unsupported adapter capabilities must not silently downgrade to fake success
- if ambiguity remains among candidates with the same affordance and same risk, ask for clarification
- if ambiguity is only between exact desired-affordance candidate and partial wrong-affordance candidate, the exact desired-affordance candidate may win with traceable disqualifiers
- if required evidence is missing for a side-effect action, return typed `abstain` rather than fabricating confidence
- if a snapshot is stale or mismatched against the execution surface, reobserve or abstain before acting
- high-risk families select stricter operating profiles but remain profile-invariant for confirm/block rules

Shadow probe is not a v1 execution feature. V1 should model adapter capability for `shadowProbe`, but live probing requires a separate policy review because real browser clicks can still produce analytics, focus, navigation, or hidden side effects.

### V1 Adversarial Accuracy Suite

The golden trace suite must include fixed adversarial classes. These are not optional nice-to-have cases; they define what "accurate enough to act" means.

Required classes:

- duplicate label: multiple visible controls/content items share the same text
- post-hydration drift: the observed target changes after snapshot creation
- ARIA-vs-visible mismatch: accessible name and visible text disagree
- offscreen or occluded target: candidate exists but is not safely actionable
- i18n alias: user phrase and target label differ by language, spacing, suffix, or common synonym
- dynamic id churn: selectors/ids change while semantic role remains stable
- shadow DOM boundary: evidence is visible but locator support may be adapter-limited
- nested form scope: text/type/submit candidates must resolve to the correct local form/control scope

Each class needs at least one golden fixture before live low-risk adoption is marked complete. Aggregate precision/recall is not enough; the report must show per-class pass/fail and abstention behavior.

## 8. LLM Boundary

Allowed:

- propose synonyms
- propose natural-language intent candidates
- suggest content-ranking criteria
- summarize traces
- explain alternatives to the user

Not allowed:

- select a DOM selector directly
- produce an executable locator that bypasses deterministic validation
- write ranker scores
- override a safety predicate
- read secret evidence
- cause execution without a `SemanticHypothesis` and `SafetyVerdict`

Type-level rule:

```text
ranker(input) must receive CandidateEvidencePacket and validated intent-frame data, not EnrichmentLog
```

If future LLM enrichment is added, traces must clearly mark it as `influence: "logged_only"` until a separate deterministic validator explicitly accepts part of it as typed intent-frame input.

## 9. Adapter Contract

Adapters convert feature-specific observations into semantic snapshots. They do not execute actions and do not render final prompts.

```ts
export interface SemanticObservationAdapter<TObservation = unknown> {
  id: string;
  surfaceKinds: SemanticSurfaceKind[];
  capabilities(input?: TObservation): AdapterCapabilities;
  toSnapshot(input: {
    observation: TObservation;
    previousSnapshotId?: string;
    previousActionResultId?: string;
    now?: Date;
  }): SemanticSnapshot;
}
```

Adapter rules:

- Browser Action adapter may map DOM role/name/selector/bbox/href to evidence/entities.
- Browser Action View Graph adapter must map region, node, edge, route/view identity, mutation stability, and digest evidence when available; this is required for SPA/dynamic-page accuracy and is not optional polish.
- Vision Context adapter may map OCR/visual regions/capsule observations to evidence/entities.
- Terminal adapter may map buffer lines, cwd, command history, prompt state, exit status to evidence/entities.
- Workspace adapter may map file paths, git status, diagnostics, symbols, and edits to evidence/entities.
- Adapters may provide Tier2 labels, but the semantic core must treat them as opaque unless a feature-specific extension opts in.
- Adapters must not hide restricted/unsupported states.
- Adapters must preserve redaction boundaries.

### 9.1 Browser View Graph Adapter Requirement

Browser Action must provide Semantic Interface with View Graph features instead of only a flat `BrowserElement[]`. This is required because SPA pages can change route/view without a document reload, dynamic ids can churn during hydration, and repeated labels require region/group context.

Adapter-owned evidence should include:

- `BrowserViewIdentity`: tab/window/document/url/route, view revision, DOM revision, captured time, mutation quiet time.
- `ViewNode`: semantic nodes such as region, control, field, content item, list, row, modal, and form.
- `ViewEdge`: relationships such as contains, labels, same_group, filters, submits, and navigates_to.
- `ViewDigest`: route, visible text, interactive element, and optional layout digests.
- stale/source warnings when the expected execution view no longer matches the observed view.

Semantic core requirements:

- Treat View Graph features as deterministic evidence, not as browser-specific core assumptions.
- Prefer current-view, visible, enabled, affordance-compatible nodes over stale or hidden nodes.
- Use region and edge context to resolve duplicate labels.
- Preserve abstention when evidence is insufficient for side-effect actions.
- Emit redacted trace explanations for selected node, alternatives, stale-view decisions, and ambiguity.

Feature-owned execution requirements:

- Browser Action keeps the original semantic target reference and expected view identity in action commands.
- Extension validates the current view before executing.
- On `stale_view` or `stale_target`, daemon reobserves/re-resolves once for safe recoverable actions.
- Safety policy remains Browser Action owned; Semantic Interface does not execute.

## 10. Browser Action Migration

### Phase A: Shadow Only

Goal: run semantic decisions beside the current Browser Action resolver without changing behavior.

Scope:

- add `src/daemon/semantic-interface/`
- add Browser Action adapter converter
- add deterministic ranker skeleton
- add safety predicate skeleton
- add trace/replay JSON output
- add golden trace for the `개념글` ambiguity case
- keep existing Browser Action execution unchanged

Exit criteria:

- deterministic replay passes for golden traces
- `npm run smoke:browser-action` remains unchanged
- semantic trace explains selected/rejected candidates

### Phase B: Advisory Overlay

Goal: compare semantic decisions with existing Browser Action decisions.

Scope:

- run semantic resolver on prompt-driven Browser Action requests
- record advisory diff in Activity or dogfood report
- do not alter live execution

Exit criteria:

- semantic top candidate is correct in known failure fixtures
- existing successful Browser Action traces remain compatible
- no user-visible behavior changes

### Phase C: Gated Live For Low-Risk Browser Actions

Goal: let semantic resolution drive low-risk actions.

Allowed families:

- read
- locate
- filter/activate where reversible or low-risk and revalidation is available
- local navigation/back/forward/reload

Still excluded:

- submit
- destructive action
- credential/payment/auth
- upload/download
- cross-origin side effects
- evaluate/full_control_dev

Exit criteria:

- `개념글` style filter/read task works from live Browser Bridge observations
- trace records evidence, ranking, safety, execution result, and verification
- fallback toggle can return to advisory mode

### Phase D: Wider Live Use

Goal: expand to more Browser Action families only after trace stability and safety evidence.

Requirements:

- red-team safety fixtures
- saved policy integration
- per-action revalidation
- renderer/activity trace visibility
- dogfood matrix coverage

## 11. Vision Context Validation

Vision should validate universality without forcing premature cross-adapter fusion.

Initial Vision role:

- read-only adapter/conformance consumer
- convert Vision observations, OCR spans, visual regions, and TaskCapsule evidence into semantic snapshots
- validate shared `read` and `locate` affordance behavior
- produce the same trace format as Browser Action

Acceptance:

- Vision adapter can be added without changing core `semantic-interface` types or ranker contracts.
- A Vision fixture with visual/OCR evidence can produce `SemanticSnapshot`, `SemanticHypothesis`, safety verdict, and trace.
- Browser and Vision traces share the same replay harness.
- Any change required in core for Vision must be treated as evidence that the Browser-first abstraction leaked.

Do not require Vision to execute clicks or OS input in v1.

## 12. Terminal And Workspace Future Fit

The v1 contracts should leave room for:

- terminal buffer/process observations
- shell command risk predicates
- workspace file/symbol/diagnostic observations
- file open/edit command proposals
- future Windows UIA/accessibility observations

But Terminal and Workspace should not drive v1 implementation until Browser shadow traces and Vision read/locate conformance are stable.

## 13. Production Completion Criteria

The Semantic Interface is production-quality only when all of the following are true:

- deterministic replay passes for a substantial golden trace suite
- traces include evidence, hypotheses, basis-point scores, selected/rejected candidates, safety verdicts, and verification claims
- ranker traces expose typed evidence packets, candidate generation provenance, gate results, pairwise margins, and target fingerprints, not only one final scalar score
- redacted durable traces are emitted separately from in-memory full traces
- `개념글` and similar Korean connective target cases resolve without site-specific hardcoding
- safety and ambiguity are represented separately in trace output
- `abstain` is a first-class outcome for under-evidenced side-effect actions
- `StepTransitionGrammar` rejects or disqualifies malformed intent/reference/target/action/verification mappings
- operating profiles are defined by evidence requirements and selected by safety/risk policy
- v1 calibration uses evidence-profile gating plus top-vs-runner-up margin, with statistical calibration deferred until a held-out trace set exists
- embeddings/vector similarity, if added, are limited to candidate generation or alias discovery and cannot decide execution without typed evidence validation
- typed, untyped, and adversarial semantic eval modes are implemented in the golden trace harness
- the adversarial target-resolution suite covers duplicate label, hydration drift, ARIA/visible mismatch, offscreen/occluded, i18n alias, dynamic id churn, shadow DOM, and nested form scope
- Browser Action shadow/advisory/live phases are documented and gated
- low-risk Browser Action live adoption has fallback/rollback
- Vision read/locate conformance works without core changes
- all safety predicates are pure and deterministic
- ranker cannot read LLM enrichment logs
- redaction tests prove secret values do not enter traces
- unsupported capability states are typed results, not thrown-only failures
- adapter conformance tests cover Browser and Vision
- existing Browser Action, Browser Bridge, DOM, app-server, and Vision smokes are not regressed
- docs include adapter authoring, predicate authoring, and trace debugging guidance

## 14. Required Verification Commands

Initial implementation should add:

```text
npm run smoke:semantic-interface
```

Expected full gate as the module starts integrating:

- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `npm run smoke:semantic-interface`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-bridge`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:vision-context`
- applicable dogfood evidence scripts
- `git diff --check`
- UTF-8/mojibake checks for touched text files
- `npm run vibe:checkpoint`

## 15. Initial Sprint Plan

### Sprint 01: Type Surface And Golden Trace Harness

Goal: establish the semantic-interface boundary without changing live behavior.

Scope:

- `src/daemon/semantic-interface/types.ts`
- `src/daemon/semantic-interface/index.ts`
- `src/daemon/semantic-interface/ranker.ts`
- `src/daemon/semantic-interface/safetyPredicate.ts`
- `src/daemon/semantic-interface/trace.ts`
- `src/daemon/semantic-interface/replay.ts`
- `src/daemon/semantic-interface/transitionGrammar.ts`
- `src/daemon/semantic-interface/operatingProfile.ts`
- `src/daemon/semantic-interface/adapters/browserActionAdapter.ts`
- `scripts/smoke-semantic-interface.mjs`
- fixture for the `개념글` ambiguity case
- first adversarial fixtures for duplicate-label, i18n alias, and stale snapshot/source mismatch cases

Acceptance:

- Browser Action observation fixture converts to semantic snapshot.
- The `개념글` prompt frame resolves to an activate/filter hypothesis for the exact button candidate.
- The partial `개념글[동물,기타]` link remains visible as a rejected/disqualified candidate.
- Replay of the same fixture produces identical ranking and safety verdict.
- transition grammar produces deterministic disqualifiers for malformed mappings.
- operating profiles can force `abstain` when required evidence or top-vs-runner-up margin is missing.
- typed/untyped/adversarial eval modes are represented in the fixture harness, even if the first suite is small.
- Existing Browser Action smokes continue to pass.

### Sprint 02: Browser Action Shadow Mode

Goal: run the semantic resolver next to prompt-driven Browser Action.

Scope:

- build intent-frame bridge from existing Browser Action prompt planning
- emit semantic traces for live prompt-driven Browser Action attempts
- record advisory diff without changing execution
- add trace redaction checks
- add `RedactedTraceRecord` projection for Activity/report/app-server durable sinks
- emit source warnings for stale snapshot, source mismatch, adapter mismatch, redacted evidence, and unsupported surface
- expand adversarial fixtures to cover ARIA/visible mismatch, offscreen/occluded, dynamic id churn, shadow DOM, and nested form scope

Acceptance:

- live Browser Action requests produce semantic traces
- no user-visible execution changes
- Activity/dogfood can show why semantic resolver would pick a different candidate
- durable traces contain redacted summaries and no credential/token/payment/cookie values
- advisory reports include per-adversarial-class pass/fail/abstain behavior

### Sprint 03: Vision Read/Locate Conformance

Goal: validate that the interface is not Browser-only.

Scope:

- convert Vision Context observations or TaskCapsule evidence into semantic snapshots
- add Vision fixture replay
- ensure no core type changes are needed

Acceptance:

- Vision fixture produces a semantic snapshot and read/locate hypotheses
- shared replay harness works for Browser and Vision fixtures
- core ranker/predicate contracts stay unchanged
- typed/untyped eval split works for Vision read/locate traces without Browser-only assumptions

### Sprint 04: Low-Risk Browser Action Live Gate

Goal: selectively use semantic decisions for low-risk Browser Action flows.

Scope:

- feature flag or mode gate for semantic live use
- allow read/locate/filter/navigation families only
- require revalidation before execution
- keep fallback/advisory mode

Acceptance:

- `개념글 눌러서 재밌어보이는 글 보여줘` can pass the first filter/activate step without safety false positive
- execution remains blocked/confirmed for risky actions
- trace includes before/after verification evidence

## 16. Risks And Mitigations

Risk: ontology grows into an unmaintainable "semantic everything" project.

Mitigation:

- keep v1 vocabulary minimal
- add affordances/relations only when golden traces require them
- keep Tier2 consumer-owned

Risk: core becomes browser-specific.

Mitigation:

- keep locators opaque
- require Vision conformance without core changes
- prohibit DOM globals and browser imports in core

Risk: LLM output leaks into deterministic ranking.

Mitigation:

- separate `EnrichmentLog` from `CandidateEvidencePacket`
- ranker signature must not accept enrichment
- trace marks enrichment as logged-only

Risk: safety false negatives.

Mitigation:

- pure predicates with strictest verdict wins
- red-team safety fixtures
- fail closed on unsupported or unknown high-risk actions

Risk: stale observations.

Mitigation:

- mutating proposals require revalidation
- adapter capability contract must expose revalidation support
- executor must re-check target evidence before acting

Risk: Browser Action regression during migration.

Mitigation:

- shadow mode first
- advisory diff before live use
- low-risk live gate only
- fallback toggle to previous resolver

## 17. Open Questions

- Should the first implementation store semantic traces in Activity, report files, or only smoke fixtures?
- Should Browser Action intent parsing directly emit `IntentFrame`, or should an adapter bridge convert existing `BrowserActionPromptPlan` first?
- Should trace replay scrub dynamic ids/timestamps globally or require deterministic id factories in tests?
- What is the minimum held-out dogfood trace count before statistical calibration is worth adding beyond profile gating and margin abstention?

Resolved by the Privacy Filter review/debate:

- Do not replace the graph/affordance design with token-span sequence labeling.
- Do not use one global confidence threshold for Phase C. Use operating profiles selected by risk tier.
- Do not persist full traces by default. Durable sinks use `RedactedTraceRecord`.
- Do not treat aggregate precision/recall as enough semantic evidence. Track typed, untyped, adversarial, and abstention behavior.

## 18. Non-Negotiable Rules

- Do not make `semantic-interface` an executor.
- Do not make LLM output the default action selector.
- Do not import Privacy Filter's BIOES token-span loop as the core semantic model.
- Do not flatten graph/affordance evidence into linear token labels for action resolution.
- Do not flatten typed evidence packets into one scalar before hard gates, operating-profile gates, pairwise margin, and safety checks have run.
- Do not treat memory, embeddings, or alias matches as executable target authority.
- Do not add site-specific rules for the `개념글` case.
- Do not hide ambiguity by silently choosing risky candidates.
- Do not merge clarification with safety approval.
- Do not treat under-evidenced side-effect resolution as success; use `abstain` or clarification.
- Do not use aggregate precision/recall as the headline production metric for action accuracy.
- Do not persist password/token/payment/cookie/credential values in traces.
- Do not weaken Browser Action safety policy during semantic migration.
- Do not modify Browser Action live execution in Phase A.
- Preserve Korean/UTF-8 encoding integrity.
