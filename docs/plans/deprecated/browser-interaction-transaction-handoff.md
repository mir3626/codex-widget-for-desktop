# Browser Interaction Transaction Handoff

Status: implemented in iter-20; authoritative handoff for the Browser Action natural-language reliability and transaction discipline track
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Primary consumers:
- Browser Action prompt execution
- Browser Action direct UI execution
- Browser Perception request-scoped context
- Browser View Graph v2 affordance evidence
- Semantic Interface intent/evidence projection
- Semantic Memory feedback and unresolved-intent records

Primary goal: replace resolver-first Browser Action prompt handling with a request-scoped interaction transaction that binds every natural-language browser task to a fresh active-tab view, finite typed candidates, explicit clarification/approval gates, stepwise grounding, reobserve, verification, and feedback.

## Implementation Status

Implemented in iteration `iter-20`. The Browser Action prompt/direct path now has a request-scoped `BrowserInteractionTransaction` layer that coordinates Browser Perception leases, finite View Graph candidate steps, deterministic planning gates, clarification resume, expected-effect verification, per-active-tab concurrency, and advisory Semantic Memory feedback.

Important baseline:

- Browser Action already has typed actions, safety policy, extension/native/CDP/Playwright adapter surfaces, direct UI entry points, prompt-driven execution, and audit/result paths.
- Browser View Graph v2 already models view identity, regions, controls, forms, content lists, affordance index, freshness, diagnostics, and redaction.
- Browser Perception already provides request-scoped fresh active-tab context and extension observe command ack/result states.
- Semantic Interface and Semantic Memory already provide typed semantic evidence, ranking traces, advisory memory, unresolved records, and feedback paths.

Remaining gap:

- Live browser dogfood still needs broader repeated-site validation after extension reloads, but the interface-level gap is now closed by transaction discipline rather than resolver-only tuning.
- Future polish can improve ranked-choice UI presentation and longer trace analysis, but Semantic Memory remains advisory and the current implementation does not require site-specific rules.
- Native desktop/browser-chrome automation remains governed by the earlier Browser Action native helper blocker; this transaction layer only coordinates browser-scoped typed actions.

Implemented surface:

- `src/daemon/browser-action/interaction/` contains the transaction types, lease helpers, intent frame builder, candidate generator, planning gate, transaction manager, verification resolver, and feedback publisher.
- Prompt, direct UI, plan continuation, and clarification resume paths pass transaction/lease metadata into Browser Action execution.
- `targetResolver` remains available for late grounding/revalidation, while candidate generation and planning gates now own the first-pass natural-language/browser-view decision.
- Expected effects are carried on action results and checked by `resultVerifier`, so a refreshed observation alone no longer proves a wrong click successful.
- Transaction feedback is redacted before publication to Semantic Memory and cannot override freshness, safety, visibility, approval, or current view evidence.
- New smokes cover core transaction creation/candidates, concrete Korean clarification, effect-specific verification failure, and per-active-tab concurrency cancellation.
- Dogfood evidence was refreshed at `docs/reports/browser-action-dogfood-evidence-2026-05-10.md`.

## 0. Why This Exists

Live dogfood showed the same class of failures after multiple resolver improvements:

```text
Browser Action을 실행했습니다.
- plan: failed
- steps: step-1:failed
- latest result: needs_clarification; verification=failed; The action needs a specific browser element but the target is not resolved confidently.
```

The root issue is not that one more Korean phrase, regex, or domain rule is missing. User intent can be expressed in too many valid ways:

- `개념글 눌러줘`
- `개념글 눌러서 재밌어보이는 글 보여줘`
- `추천글 필터 켜고 아무거나 열어봐`
- `재밌어 보이는 글 하나 들어가줘`
- `위에 개념글 탭 말고 글 목록에서 하나 골라줘`

Trying to encode these directly into deterministic target resolver rules creates an endless loop:

```text
prompt -> parser/resolver guesses concrete target -> action -> wrong click or generic clarification
```

The correct boundary is:

```text
prompt
  -> fresh active-tab transaction
  -> intent frame
  -> finite candidate actions from current View Graph
  -> deterministic gate / clarification / approval
  -> execution-time grounding
  -> typed action
  -> reobserve
  -> expected-effect verification
  -> redacted feedback
```

The resolver remains necessary, but it must stop being the intent engine. It should ground and revalidate a selected candidate against the latest leased view immediately before execution.

## 1. Scope

In scope:

- request-scoped `BrowserInteractionTransaction`
- revocable `BrowserViewContextLease` over `PreparedBrowserViewContext`
- `IntentFrame` integration with existing Semantic Interface concepts
- finite `CandidateStep` / `CandidateActionProposal` generation from Browser View Graph v2
- deterministic planning gate for selection, clarification, approval, and abstain states
- Korean/locale-aware candidate clarification text
- stepwise execution that re-leases or revalidates before side-effect actions
- stronger expected-effect verification after each step
- clarification continuation without stale snapshot reuse
- transaction-level cancellation and per-active-tab concurrency rules
- Semantic Memory feedback for aliases, corrections, unresolved intents, ranking evidence, and repeated user choices
- smoke/dogfood coverage proving improved natural-language Browser Action reliability without site-specific rules

Out of scope:

- site-specific rules for DCInside, GitHub, Google, or any other website
- arbitrary JavaScript as the default browser action abstraction
- replacing Browser Perception, Browser View Graph v2, Browser Action sessions, or typed adapter contracts
- giving Semantic Memory permission to override freshness, safety, visibility, or approval gates
- storing full DOM, page text, screenshots, cookies, passwords, tokens, payment data, or sensitive page state
- full desktop computer-use outside browser-scoped action boundaries

## 2. Design Principles

- Transaction first: every prompt/direct browser task runs inside one request-scoped transaction with explicit view lease, candidates, selected step, execution timeline, and final outcome.
- Lease before decision: side-effect decisions must be tied to a fresh/stable active-tab view, not to whichever snapshot happened to be latest.
- Resolver late, not absent: resolver grounds a selected candidate in the current leased view. It does not own natural-language intent interpretation.
- Finite candidates only: planners, gates, and optional LLM tie-breakers may choose among known candidate ids. They may not invent selectors, actions, or arbitrary JS.
- Stepwise over compile-once: multi-step plans reobserve and regenerate or rebind candidates after each mutating step.
- Clarification is product behavior: ambiguity should produce concrete candidate choices in the user's locale, not a generic failure receipt.
- Expected effects are contracts: a click/type/select/navigation succeeds only if the expected state change is verified.
- Memory is advisory: user history can boost aliases and ranking, but cannot bypass freshness, safety, approval, visibility, or capability gates.
- Safety remains separate: ambiguity, risk, user approval, and adapter execution are separate states.
- Redacted replay: transaction traces should be useful for debugging and dogfood without persisting sensitive page state.

## 3. Proposed Module Boundary

Create a thin transaction layer over existing Browser Action and Browser Perception modules:

```text
src/daemon/browser-action/
  interaction/
    types.ts
    transactionManager.ts
    contextLease.ts
    intentFrame.ts
    candidateStep.ts
    candidateGenerator.ts
    planningGate.ts
    clarificationModel.ts
    executionBinding.ts
    verificationResolver.ts
    feedbackPublisher.ts
    concurrency.ts
    diagnostics.ts
    index.ts
```

Integration points:

- `src/daemon/server/browser-action/promptRunner.ts`
  - start a `BrowserInteractionTransaction` instead of directly turning prompt text into a final plan receipt
  - acquire a prompt lease before planning
  - emit progress while perception waits

- `src/daemon/server/browser-action/promptPlan.ts`
  - convert deterministic prompt shortcuts into `IntentFrame` or `CandidateStep` seeds
  - keep exact shortcut commands fast

- `src/daemon/browser-action/promptTool.ts`
  - stop treating semantic prompt interpretation as final executable action selection
  - route complex prompts through transaction candidate generation and gate decisions

- `src/daemon/browser-action/actionSession/planExecution.ts`
  - keep typed Browser Action plan/session semantics
  - add transaction/lease hooks before side-effect steps and after-step verification

- `src/daemon/browser-action/actionSession/executeAction.ts`
  - prefer `BrowserViewContextLease` and candidate binding evidence over raw snapshot fallback
  - record proposal id, lease id, view revision, graph digest, and binding diagnostics

- `src/daemon/browser-action/targetResolver.ts`
  - narrow to execution binding and revalidation against the current view
  - return structured binding failures that can become clarification choices

- `src/daemon/browser-action/resultVerifier.ts`
  - verify expected effects rather than only accepting refreshed observations

- `src/daemon/server/browser-action/clarification.ts`
  - resume the same transaction from selected candidate ids
  - acquire a fresh before-step lease before executing the chosen candidate
  - never resume by blindly reading a stale DOM snapshot

- `src/daemon/semantic-memory/`
  - ingest redacted transaction feedback as advisory memory only

## 4. Core Types

### BrowserInteractionTransaction

One request-scoped browser interaction.

Required fields:

- `transactionId`
- `requestId`
- `actionSessionId`
- `utterance`
- `locale`
- `source`: `prompt | direct_ui | resumed_clarification | approval_resume`
- `phase`: `perceiving | framing_intent | generating_candidates | clarifying | awaiting_approval | executing | verifying | completed | failed | cancelled`
- `activeLease`
- `intentFrame`
- `candidateSteps`
- `selectedCandidateIds`
- `stepCursor`
- `events`
- `memoryReadSetId`
- `auditSummary`
- `finalOutcome`

The transaction is an orchestration boundary. It must not replace `BrowserActionSession` or `BrowserActionPlan`; it coordinates them.

### BrowserViewContextLease

Execution lease over a `PreparedBrowserViewContext`.

Required fields:

- `leaseId`
- `contextId`
- `adapterId`
- `tabKey`
- `windowId`
- `url`
- `origin`
- `routeKey`
- `viewRevision`
- `mutationRevision`
- `graphDigest`
- `capturedAt`
- `expiresAt`
- `freshness`: `fresh | settling_ready | stale | blocked | unavailable`
- `stability`: `stable | mutating | navigating | unknown`
- `leaseReason`: `prompt | direct_action | before_step | after_step | retry | clarification_resume`
- `requiredRiskClass`: `read | safe_side_effect | risky_side_effect`
- `diagnostics`

Lease validity rule:

- A lease is valid only while active tab identity, route key, view revision, mutation revision, graph digest, and expiry satisfy the action's risk policy.
- Old candidate ids are invalid after reobserve unless explicitly rebound to the new lease.
- Side-effect actions must not execute against expired or stale leases.

### IntentFrame

Use or adapt the existing Semantic Interface `IntentFrame` instead of inventing an incompatible model.

Fields needed by Browser Action:

- `actionFamily`: `read | click | type | select | check | scroll | navigate | search | back | forward | reload | screenshot | multi_step`
- `targetPhrase`
- `valuePhrase`
- `constraints`
- `locale`
- `riskHint`
- `multiStepHints`
- `deicticReferences`
- `confidence`
- `evidenceRefs`

### CandidateStep

Finite executable or clarifiable action candidate derived from the current leased view.

Required fields:

- `candidateId`
- `leaseId`
- `contextId`
- `viewRevision`
- `graphDigest`
- `stepIndex`
- `action`
- `targetRef`
- `referenceBindingScope`: `current_view | after_step | deictic | focused_element | spatial | content_list_representative`
- `label`
- `localeLabel`
- `role`
- `region`
- `expectedEffect`
- `riskClass`
- `confidence`
- `scoreBreakdown`
- `alternatives`
- `reasonCodes`
- `memoryEvidence`
- `safetyHints`

Candidate ids must be stable inside one lease and invalid across incompatible graph revisions.

### PlanningGateDecision

Decision over candidates before execution.

States:

- `proceed`
- `clarify`
- `request_approval`
- `abstain`
- `blocked`
- `cancelled`

Required fields:

- `decision`
- `selectedCandidateId`
- `clarificationOptions`
- `approvalRequest`
- `blockingReason`
- `confidence`
- `margin`
- `reasonCodes`
- `userFacingMessage`

Gate rules:

- one high-confidence safe read/scroll may proceed
- one high-confidence safe side-effect may proceed if policy allows
- low-confidence side effects must clarify
- destructive or credential-sensitive actions must request approval or block
- duplicate labels with low margin must clarify
- stale or expired lease must reobserve before proceeding

### ExecutionBinding

Late binding from selected candidate to current browser element/action target.

Required fields:

- `bindingId`
- `candidateId`
- `leaseId`
- `elementId`
- `locator`
- `role`
- `name`
- `bbox`
- `stableFingerprint`
- `revalidationStatus`
- `diagnostics`

The binding is produced immediately before action execution.

### ExpectedEffect

Contract used by verification after an action.

Kinds:

- `observation_returned`
- `url_or_route_changed`
- `list_filtered`
- `content_item_opened`
- `field_value_changed`
- `checkbox_state_changed`
- `select_value_changed`
- `focus_changed`
- `modal_opened`
- `scroll_position_changed`
- `navigation_history_changed`
- `no_submit_or_navigation`
- `download_or_permission_blocked`

Expected effects should include the before lease, after lease, and verification tolerance.

### VerificationClaim

Post-action result.

Fields:

- `claimId`
- `candidateId`
- `beforeLeaseId`
- `afterLeaseId`
- `status`: `passed | failed | inconclusive`
- `matchedEffects`
- `missingEffects`
- `diagnostics`
- `userFacingSummary`

### InteractionFeedbackEvent

Redacted feedback sent to Semantic Memory.

Fields:

- `transactionId`
- `utteranceHash`
- `locale`
- `contextIdentity`
- `intentFrameSummary`
- `candidateSummary`
- `decisionReason`
- `userClarificationChoice`
- `verificationOutcome`
- `correction`
- `redactionSummary`

No full DOM text, secret values, cookies, passwords, tokens, payment values, or screenshots may be persisted by default.

## 5. Execution Flow

### Prompt-driven flow

```text
user prompt
  -> begin BrowserInteractionTransaction
  -> acquire prompt ViewContextLease from Browser Perception
  -> build IntentFrame
  -> generate CandidateStep[] from View Graph v2 affordances
  -> planning gate
     -> proceed
     -> clarify
     -> request approval
     -> abstain/block
  -> before side-effect step: acquire/revalidate before_step lease
  -> late execution binding
  -> safety policy and approval
  -> typed adapter action
  -> acquire after_step lease
  -> verify ExpectedEffect
  -> generate next-step candidates if needed
  -> complete response and feedback
```

### Direct UI flow

Direct UI actions should use the same transaction pipeline with pre-filled `IntentFrame` and `CandidateStep` seeds. The UI must not bypass lease, safety, verification, or audit behavior.

### Clarification resume flow

```text
user selects clarification option
  -> resume BrowserInteractionTransaction
  -> acquire clarification_resume/before_step lease
  -> rebind selected candidate to current graph
  -> if incompatible: regenerate candidates or ask again
  -> execute, reobserve, verify
```

Do not resume clarification by reading a raw latest DOM snapshot.

### Multi-step flow

Multi-step tasks must not pre-bind all future targets from the first view. Example:

```text
개념글 눌러서 재밌어보이는 글 보여줘
```

Correct behavior:

1. lease current page
2. identify `개념글` filter/tab candidates
3. clarify if ambiguous
4. execute selected filter/tab
5. reobserve and lease the new filtered view
6. generate content-list representative candidates from the new view
7. choose or clarify
8. execute selected content item
9. verify content opened

## 6. Candidate Generation

Candidate generation should consume typed View Graph v2 affordances:

- controls
- links
- buttons
- tabs
- filters
- nav items
- forms
- focused fields
- selected/checked states
- content lists
- representative content items
- region/heading context
- visible text and accessible names
- expected effects and risk hints

It must avoid domain-specific selectors. Universal scoring dimensions:

- action-family fit
- target phrase fit
- role/name/text fit
- region fit
- control/content distinction
- expected effect fit
- current selected state
- visibility/enabled/editable
- list membership
- spatial/deictic hint fit
- memory advisory evidence
- ambiguity margin
- risk class
- freshness and lease validity

## 7. Clarification UX Contract

Clarification should be concrete and localizable.

Bad:

```text
The action needs a specific browser element but the target is not resolved confidently.
```

Good:

```text
대상이 애매해서 바로 실행하지 않았습니다. 실행할 대상을 선택해 주세요.

1. 상단 필터 "개념글" - 현재 게시글 목록을 개념글로 필터링
2. 게시글 "..." - 목록의 첫 번째 게시글 열기
3. 검색 입력창 - 게시판 안에서 검색어 입력
```

Clarification options must include:

- candidate id
- visible label
- role
- region
- expected effect
- risk class
- confidence reason

The selected option resumes the same transaction and becomes Semantic Memory feedback.

## 8. Concurrency and Cancellation

Browser transactions require per-active-tab sequencing.

Rules:

- one mutating BrowserInteractionTransaction may own a tab lease at a time
- read-only transactions may share a fresh stable lease when no mutating transaction is active
- a newer prompt can cancel a pending perception wait only when user intent clearly supersedes the previous action
- cancellation during observe, clarification, approval, before-step, and between-step states must prevent later actions
- direct UI actions and prompt-driven actions use the same queue/lock policy
- extension commands must include transaction id and step id where practical

## 9. Verification

Verification must become effect-specific.

Examples:

- `click filter`: route/query, selected state, list digest, or visible filter state changed
- `open content item`: route/content heading changed to the selected content item or compatible destination
- `type field`: field value changed and no submit/navigation occurred unless requested
- `select/check`: selected or checked state changed
- `back/forward`: history route/view changed in the expected direction
- `read`: fresh observation returned with matching source identity
- `scroll`: scroll position or visible window changed

Verification failure should not be reported as success merely because a refreshed observation exists.

## 10. Safety

Keep existing Browser Action safety rules:

- no arbitrary JavaScript as the default abstraction
- `full_control_dev` evaluate remains explicit, hidden by default, previewed, approved, timed, size-limited, audited, and secret-guarded
- low-confidence side-effect actions clarify
- destructive/credential-sensitive actions confirm or block
- submit/delete/send/post/publish/pay/purchase/auth/password/token/file upload/download/cross-origin side effects/permission prompts require confirmation unless an explicit safe policy covers them
- never persist password/token/payment/cookie/credential values

The transaction layer must not weaken these rules.

## 11. Semantic Memory Use

Allowed:

- alias hints
- repeated user preference hints
- clarification choice history
- unresolved intent records
- correction records
- ranking boost evidence
- dogfood/evaluation traces

Forbidden:

- selecting an executable target without current view evidence
- bypassing side-effect approval
- overriding stale lease failures
- persisting sensitive values or full page state
- hardcoding a site-specific action path as learned memory

## 12. Implementation Workstreams

### 1. Handoff and Baseline Recording

- Preserve this file as the authoritative handoff for the Browser Interaction Transaction track.
- Record that Browser Action's current resolver-first prompt path is insufficient for universal natural-language browser control.
- Update sprint roadmap, session log, handoff, and iteration history during implementation cycles.

### 2. Transaction and Lease Types

- Add `BrowserInteractionTransaction` and `BrowserViewContextLease`.
- Wrap `PreparedBrowserViewContext` without replacing Browser Perception internals.
- Add lease validity and revocation helpers.
- Add per-active-tab transaction concurrency model.

### 3. Intent Frame and Candidate Step Generation

- Reuse/adapt Semantic Interface `IntentFrame`.
- Convert deterministic prompt shortcuts into intent/candidate seeds.
- Generate finite candidate steps from View Graph v2 affordances.
- Include Korean/locale labels and expected effects.

### 4. Planning Gate and Clarification

- Add deterministic gate rules for proceed/clarify/approval/block.
- Replace generic `needs_clarification` receipts with concrete candidate options.
- Resume clarification through fresh lease and rebind selected candidates.

### 5. Stepwise Execution Integration

- Integrate transaction/lease hooks into prompt runner and plan execution.
- Revalidate or reobserve before side-effect steps.
- Bind candidates immediately before typed adapter execution.
- Reobserve after every action.

### 6. Verification Resolver

- Add expected-effect contracts.
- Strengthen result verification for route, list, field, selection, content-open, navigation, and no-submit cases.
- Ensure verification failures are visible and actionable.

### 7. Memory Feedback and Diagnostics

- Publish redacted feedback events to Semantic Memory.
- Record unresolved and correction data without letting memory override gates.
- Add transaction diagnostics to audit/activity evidence.

### 8. Prompt, Direct UI, and Agent Path Consistency

- Ensure prompt-driven and direct Browser Action paths use the same transaction pipeline.
- Informational prompts about Browser Action should remain normal chat/context answers, not actions.
- Simulated Agent/browser tool path should return useful action summaries rather than raw execution receipts.

### 9. Smokes and Dogfood

- Add smokes for lease validity, stale candidate invalidation, clarification resume, multi-step reobserve, verification failures, memory advisory limits, and concurrency/cancel behavior.
- Update dogfood evidence with real prompt-driven Browser Action examples.

## 13. Acceptance Criteria

The work is complete only when:

- Browser Action prompt/direct flows run through `BrowserInteractionTransaction`.
- Side-effect actions require a valid fresh/stable `BrowserViewContextLease`.
- Candidate ids are bound to lease/context/view revision/graph digest and invalidated after incompatible reobserve.
- Resolver no longer acts as the primary natural-language intent engine.
- Concrete candidate clarification replaces generic target-confidence failure for ambiguous prompts.
- Clarification resume uses fresh lease and rebinds selected candidate before execution.
- Multi-step prompts reobserve and regenerate/rebind candidates after mutating steps.
- Expected-effect verification can fail a wrong click even if an observation refresh succeeds.
- Per-active-tab concurrency/cancel behavior prevents racing prompt/direct/extension actions.
- Semantic Memory feedback remains advisory and cannot override freshness, safety, or approval.
- Prompt/action receipts become useful user-facing summaries, not raw internal plan logs.
- Existing Browser Action, Browser Bridge, Browser Perception, View Graph v2, Semantic Interface, Semantic Memory, extension, DOM, CDP, Playwright, evaluate, renderer, and app-server smokes are not regressed.

## 14. Required Verification

Required commands:

- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-action:fresh-context`
- `npm run smoke:browser-view-graph-v2`
- `npm run smoke:browser-perception`
- `npm run smoke:browser-perception:extension-command`
- `npm run smoke:browser-perception:stabilization`
- `npm run smoke:browser-bridge`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:semantic-interface`
- `npm run smoke:semantic-memory`
- new Browser Interaction Transaction smokes:
  - `npm run smoke:browser-interaction-transaction`
  - `npm run smoke:browser-action:transaction-clarification`
  - `npm run smoke:browser-action:transaction-verification`
  - `npm run smoke:browser-action:transaction-concurrency`
- updated Browser Action dogfood evidence
- UTF-8/mojibake checks for touched text files
- `npm run vibe:checkpoint`

## 15. Dogfood Matrix

Dogfood evidence should include:

- extension reloaded; no manual snapshot button required
- active tab switched immediately before prompt; previous tab context not used
- Korean ambiguous prompt produces concrete clarification choices
- clarification choice resumes the same transaction and executes against a fresh lease
- multi-step filter/list/content flow reobserves after step 1 before choosing step 2
- non-submit form fill verifies value changed and no submit/navigation happened
- risky action asks approval or blocks
- route/query/SPA transition invalidates old candidate ids
- verification failure is reported as failure, not success
- transaction evidence includes transaction id, lease id, candidate id, binding, before/after view revisions, expected effect, and verification result

## 16. Stop Conditions

Stop only when the transaction pipeline is implemented, verified, and dogfooded by the acceptance criteria above.

If a production requirement cannot be completed because of browser security, unavailable adapter metadata, unstable app-server tool contracts, or scope outside Browser Action, record `BLOCKED` with:

- item
- reason
- attempted path
- required scope expansion
- verification evidence

Do not silently downgrade this work to another resolver or regex tuning pass.
