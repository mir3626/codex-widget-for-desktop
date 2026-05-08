# Semantic Interface Handoff

Status: planned; handoff authority for the next semantic decision-layer implementation
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Baseline modules:
- `src/daemon/browser-action/`
- `src/daemon/vision-context/`
- `src/daemon/transcription/`
- provider snapshot and Activity ledger paths

Primary goal: build a reusable daemon-side Semantic Interface that converts observations and user intent into deterministic, auditable action hypotheses. It should be portable across Browser Action, Vision Context, Terminal, Workspace, Screen/OCR, and future Windows UI Automation without becoming a browser-specific resolver or a generic LLM planner.

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
- `VerificationClaim`

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
  features: DeterministicFeatures;
  enrichment?: EnrichmentLog;
  explanation: string;
  disqualifiers: string[];
}

export interface DeterministicFeatures {
  exactLabelMatch?: number;
  partialLabelMatch?: number;
  affordanceMatch?: number;
  roleMatch?: number;
  regionMatch?: number;
  viewportPresence?: number;
  enabled?: number;
  selectedOrFocused?: number;
  freshness?: number;
  sourceConfidence?: number;
  riskPenalty?: number;
}

export interface EnrichmentLog {
  source: "llm" | "lexicon" | "memory";
  influence: "logged_only";
  suggestions: string[];
  notes?: string;
}
```

Invariant:

- `features` must be deterministic and must not include LLM-derived scores.
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
  ranked: Array<{
    hypothesisId: string;
    score: number;
    selected: boolean;
    featureContributions: DeterministicFeatures;
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
same normalized snapshot + same intent frame + same ranker/predicate/catalog versions
  -> same ranked hypotheses and safety verdicts
```

Execution results may vary because the external world changes. Decision replay must not.

## 6. Deterministic Ranking

The initial ranker should be simple, named, and testable.

Input:

- `SemanticSnapshot`
- `IntentFrame`
- generated `SemanticHypothesis[]`

Output:

- sorted hypotheses
- scores
- feature contributions
- disqualifiers

Initial ranking signals:

- exact label match beats partial label match
- desired affordance match beats raw text match
- entity kind match beats generic container match
- enabled/visible/current-surface candidates beat hidden/stale candidates
- selected/focused state improves confidence only when relevant
- unsupported adapter capability disqualifies or warns
- high Tier1 risk does not lower reference confidence; it affects safety verdict separately

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

## 7. Safety And Ambiguity Policy

Safety and ambiguity must be independent.

Reference resolution statuses:

- `resolved`
- `ambiguous`
- `unresolved`
- `unsupported`

Safety verdicts:

- `allow`
- `warn`
- `confirm`
- `block`

Default policy:

- read/locate may proceed with lower confidence when no side effect occurs
- low-risk filter/activate/navigation may proceed only when a semantic hypothesis clears threshold and adapter can revalidate before execute
- type into non-submitting fields requires stronger target confidence and secret redaction
- submit/publish/send/delete/payment/auth/password/token/file upload/download/code execution/data exfiltration must confirm or block
- unsupported adapter capabilities must not silently downgrade to fake success
- if ambiguity remains among candidates with the same affordance and same risk, ask for clarification
- if ambiguity is only between exact desired-affordance candidate and partial wrong-affordance candidate, the exact desired-affordance candidate may win with traceable disqualifiers

Shadow probe is not a v1 execution feature. V1 should model adapter capability for `shadowProbe`, but live probing requires a separate policy review because real browser clicks can still produce analytics, focus, navigation, or hidden side effects.

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
ranker(input) must receive DeterministicFeatures, not EnrichmentLog
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
- Vision Context adapter may map OCR/visual regions/capsule observations to evidence/entities.
- Terminal adapter may map buffer lines, cwd, command history, prompt state, exit status to evidence/entities.
- Workspace adapter may map file paths, git status, diagnostics, symbols, and edits to evidence/entities.
- Adapters may provide Tier2 labels, but the semantic core must treat them as opaque unless a feature-specific extension opts in.
- Adapters must not hide restricted/unsupported states.
- Adapters must preserve redaction boundaries.

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
- traces include evidence, hypotheses, feature scores, selected/rejected candidates, safety verdicts, and verification claims
- `개념글` and similar Korean connective target cases resolve without site-specific hardcoding
- safety and ambiguity are represented separately in trace output
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
- `src/daemon/semantic-interface/adapters/browserActionAdapter.ts`
- `scripts/smoke-semantic-interface.mjs`
- fixture for the `개념글` ambiguity case

Acceptance:

- Browser Action observation fixture converts to semantic snapshot.
- The `개념글` prompt frame resolves to an activate/filter hypothesis for the exact button candidate.
- The partial `개념글[동물,기타]` link remains visible as a rejected/disqualified candidate.
- Replay of the same fixture produces identical ranking and safety verdict.
- Existing Browser Action smokes continue to pass.

### Sprint 02: Browser Action Shadow Mode

Goal: run the semantic resolver next to prompt-driven Browser Action.

Scope:

- build intent-frame bridge from existing Browser Action prompt planning
- emit semantic traces for live prompt-driven Browser Action attempts
- record advisory diff without changing execution
- add trace redaction checks

Acceptance:

- live Browser Action requests produce semantic traces
- no user-visible execution changes
- Activity/dogfood can show why semantic resolver would pick a different candidate

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

- separate `EnrichmentLog` from `DeterministicFeatures`
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
- What exact confidence threshold should Phase C use for low-risk filter/activate actions?
- Should Browser Action intent parsing directly emit `IntentFrame`, or should an adapter bridge convert existing `BrowserActionPromptPlan` first?
- How much Vision Context data should enter semantic traces before privacy redaction becomes too noisy?
- Should trace replay scrub dynamic ids/timestamps globally or require deterministic id factories in tests?

## 18. Non-Negotiable Rules

- Do not make `semantic-interface` an executor.
- Do not make LLM output the default action selector.
- Do not add site-specific rules for the `개념글` case.
- Do not hide ambiguity by silently choosing risky candidates.
- Do not persist password/token/payment/cookie/credential values in traces.
- Do not weaken Browser Action safety policy during semantic migration.
- Do not modify Browser Action live execution in Phase A.
- Preserve Korean/UTF-8 encoding integrity.

