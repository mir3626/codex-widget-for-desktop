# Browser View Graph v2 Handoff

Status: implemented through Iteration `iter-18`; authoritative handoff for the View Graph v2-first Browser Action improvement track
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Primary consumers:
- Browser Action prompt/direct execution
- Browser Extension Bridge command-first observation
- Semantic Interface Browser Action adapter
- future Browser Perception prepared-context service

Primary goal: promote Browser Action from prompt-time DOM snapshot matching to a prepared, deterministic, auditable view model that understands the current browser page before a user asks for an action.

## Implementation Status

Implemented in Iteration `iter-18`:

- `src/daemon/browser-perception/view-graph/` now owns the v2 builder, identity/freshness/digest helpers, element classification, affordance indexing, and Semantic Interface evidence projection helpers.
- `BrowserObservation.viewGraph` now emits `schemaVersion: "browser-view-graph.v2"` from fallback graph construction while preserving existing Browser Action consumers.
- View Graph v2 includes view identity, route key, query signature, freshness, regions, controls, forms, content lists, edges, affordance index, diagnostics, and metadata-only redaction summaries.
- Browser Bridge observations now include additive source order, DOM path hash, parent hash, frame/url, ARIA refs, heading/landmark, form/list owner, computed visibility, sticky/overlay, mutation revision, and mutation timestamp metadata.
- `ProviderRegistry` now retains a prepared `BrowserObservation` and attaches its v2 graph to the DOM snapshot, allowing prompt/direct Browser Action paths to consume prepared graph evidence before falling back to request-time snapshot waiting.
- Semantic Interface Browser Action projection now carries view action hints, risk hints, list/form ids, freshness, and view revision metadata.
- Representative content target resolution now prefers View Graph v2 content-list representative evidence before older heuristics.
- `npm run smoke:browser-view-graph-v2` and `npm run dogfood:browser-view-graph-v2` were added.

Still outside this handoff:

- A full Browser Perception scheduler for continuous multi-tab preparation remains future work.
- Live real-site dogfood should be repeated after reloading the unpacked Browser Bridge extension.

## 0. Why This Exists

Browser Action has a real typed action pipeline, extension bridge, semantic resolver, and memory hooks, but dogfood still shows a deeper issue:

```text
User: 개념글 눌러서 재밌어보이는 글 보여줘
Result: needs_clarification; The action needs a specific browser element but the target is not resolved confidently.
```

This should not be solved with site-specific rules or more one-off regexes. The missing layer is a durable page-understanding model.

Vision Context works better in early dogfood because it prepares context first. Browser Action still largely prepares context at prompt time:

- `src/daemon/server/browser-action/promptRunner.ts` reads the current snapshot source, waits for a fresh snapshot, observes, then executes.
- `src/daemon/server/browser-bridge/snapshotWait.ts` can wait up to 35 seconds for a fresh snapshot.
- `src/daemon/providers/providerRegistry.ts` stores only one latest DOM snapshot.
- `src/daemon/browser-action/browserObservation.ts` builds `viewGraph` while normalizing the current observation, but this graph is not yet a long-lived prepared context with freshness, route identity, list semantics, or action affordance indexing.

View Graph v2 is the first required step toward a Browser Perception layer. It should make the page understandable before the prompt arrives, then let prompt-driven and direct Browser Action reuse the same graph.

## 1. Problem Statement

The current Browser Action pipeline fails for natural instructions when:

- the page contains several text-similar elements with different semantics
- a control and a content item share the same label
- a SPA route changes without a full page load
- a filter click changes query parameters and invalidates strict URL matching
- the active tab snapshot is stale or captured before a dynamic page settles
- "show me an interesting post" requires identifying a content list and choosing a representative item, not merely matching a label
- the resolver can see elements, but cannot understand their region, role in the page, relationship to lists/forms/filters, or likely effect

The desired behavior is not "always click something". It is:

1. maintain a prepared graph of the current view
2. map user intent to graph affordances and content structures
3. execute safe steps when confidence and policy allow it
4. ask a narrow clarification when graph evidence is genuinely ambiguous
5. reobserve and update graph identity after each page/view mutation

## 2. Scope

This handoff scopes View Graph v2 first. It is not the full Browser Perception service yet, but it must be designed so the future service can own or reuse it without a rewrite.

In scope:

- v2 graph types, identity, builder, freshness, and diagnostics
- deterministic graph construction from normalized browser observations
- stable node identity across small DOM churn
- region/list/form/control/content modeling
- affordance indexing for resolver and Semantic Interface use
- SPA and same-tab route/view revision tracking
- extension metadata upgrades needed by the graph
- prompt/direct Browser Action read path that can consume v2 graph
- tests, smokes, and dogfood evidence proving improved semantic action readiness

Out of scope for this handoff:

- full Browser Perception daemon service with continuous scheduling
- arbitrary JavaScript as a default action abstraction
- site-specific tuning for DCInside, GitHub, Google, or any other website
- replacing Browser Action safety, approval, audit, or typed adapters
- LLM-only page interpretation
- online learned ranker or embedding-selected executable targets
- persistence of full DOM text, screenshots, passwords, tokens, cookies, payment values, or sensitive page state

## 3. Design Principles

- Universal first: graph construction must be based on generic browser/document semantics, not domain-specific selectors.
- Prepared, not reactive: graph state should be available before a prompt when possible.
- Typed before scored: keep evidence as typed regions, controls, lists, edges, risk hints, and freshness data before reducing to a scalar confidence.
- Deterministic replay: identical input snapshot plus config should produce identical graph output.
- Safety remains separate: target ambiguity, action risk, and user approval must remain distinct concepts.
- Redacted by default: audit and durable state may store digests and summaries, not full sensitive page state.
- Adapter neutral: extension, Playwright, CDP, and native fallback should all be able to emit observations into the same graph model.
- Backward compatible: current `BrowserObservation.viewGraph` consumers must not break while v2 rolls out.

## 4. Proposed Module Boundary

Create the v2 graph as a daemon-side module that can later be moved under a full Browser Perception service:

```text
src/daemon/browser-perception/
  view-graph/
    types.ts
    builder.ts
    identity.ts
    digest.ts
    regions.ts
    contentLists.ts
    controls.ts
    forms.ts
    affordanceIndex.ts
    freshness.ts
    semanticProjection.ts
    diagnostics.ts
    redaction.ts
    index.ts
```

Bridge points:

- `src/daemon/browser-action/browserObservation.ts` should attach a v2-compatible graph while keeping existing summary behavior.
- `src/daemon/browser-action/types.ts` may need compatibility types or a schema-versioned graph field.
- `src/daemon/semantic-interface/adapters/browser-action/*` should consume v2 graph entities as typed evidence packets.
- `src/daemon/server/browser-action/promptRunner.ts` should prefer fresh prepared graph evidence before falling back to prompt-time snapshot wait.
- `src/daemon/server/browser-bridge/*` should update graph identity/freshness when extension active-tab status, snapshot, or action results arrive.

Naming:

- Public schema name: `BrowserViewGraphV2`
- Compatibility field: `BrowserObservation.viewGraph`
- Future store name: `PreparedBrowserViewContext`

## 5. Core Types

### BrowserViewIdentityV2

Tracks what browser view this graph represents.

Fields:

- `schemaVersion: "browser-view-graph.v2"`
- `tabKey`: stable adapter/browser/window/tab key when available
- `documentId`: adapter-provided document id when available
- `url`
- `origin`
- `pathname`
- `querySignature`: normalized query keys and selected semantic values
- `routeKey`: SPA-friendly identity derived from origin, pathname, route-like query, title, and structure digest
- `title`
- `capturedAt`
- `updatedAt`
- `viewRevision`: monotonic daemon revision for this tab/view
- `domRevision`: adapter-provided revision when available
- `textDigest`: redacted digest of visible text
- `interactiveDigest`: digest of interactive element identity set
- `structureDigest`: digest of region/list/control structure
- `mutationQuietMs`: adapter-reported or estimated quiet period
- `source`: `extension_snapshot | extension_delta | extension_action_result | playwright_observe | cdp_observe | native_diagnostics | test_fixture`
- `freshness`: `fresh | settling | stale | unknown`

### BrowserViewGraphV2

Top-level graph object.

Fields:

- `schemaVersion`
- `identity`
- `nodes: BrowserViewNodeV2[]`
- `edges: BrowserViewEdgeV2[]`
- `regions: BrowserRegionSummaryV2[]`
- `contentLists: BrowserContentListV2[]`
- `forms: BrowserFormSummaryV2[]`
- `affordanceIndex: BrowserAffordanceIndexV2`
- `diagnostics: BrowserViewGraphDiagnosticsV2`
- `redaction: BrowserViewGraphRedactionSummary`

### BrowserViewNodeV2

Represents any meaningful view entity.

Node kinds:

- `surface`: whole page or modal surface
- `region`: header, nav, main, sidebar, footer, article, dialog, toolbar
- `control`: button, tab, filter, menuitem, link-as-action, icon action
- `content_item`: post, issue, card, search result, table row, list item
- `text_block`: paragraph, heading, label, status, error
- `form`: form boundary
- `field`: input, textarea, select, checkbox, radio
- `media`: image, video, canvas, embedded preview
- `table`: table/grid
- `state`: selected/active/error/loading/disabled state marker

Important fields:

- `id`: graph-local stable id
- `stableKey`: deterministic key from role, label, href/action, DOM path hints, bbox bucket, and sibling pattern
- `kind`
- `role`
- `label`
- `text`
- `tokens`
- `bbox`
- `visible`
- `enabled`
- `editable`
- `selected`
- `href`
- `actionHint`: `read | navigate | filter | expand | submit | delete | type | select | check | scroll | unknown`
- `riskHints`: `safe_read | same_page_update | navigation | submit | destructive | credential | payment | download | file_upload | cross_origin | unknown`
- `regionId`
- `listId`
- `formId`
- `sourceElementIds`
- `confidence`
- `evidence`

### BrowserViewEdgeV2

Represents relationships, not just containment.

Edge types:

- `contains`
- `labels`
- `describes`
- `adjacent_to`
- `same_group`
- `list_item_of`
- `controls`
- `filters`
- `submits`
- `navigates_to`
- `opens`
- `updates_region`
- `selected_in`
- `focused_in`
- `error_for`
- `depends_on`

Each edge includes:

- `from`
- `to`
- `type`
- `confidence`
- `evidence`

### BrowserAffordanceIndexV2

Fast lookup model for resolver and prompt planning.

Indexes:

- `byToken`
- `byRole`
- `byActionHint`
- `byRiskHint`
- `byRegion`
- `byList`
- `byForm`
- `focused`
- `selected`
- `primaryControls`
- `contentCandidates`
- `safeReadTargets`
- `riskyActionTargets`

The index should not decide the final action alone. It provides candidates and evidence packets to Semantic Interface and Browser Action target resolution.

## 6. Graph Construction Pipeline

Input:

- normalized `BrowserObservation`
- adapter/source metadata
- previous graph for the same tab/view when available
- extension metadata such as DOM path, source order, frame id, shadow-root boundary hints, and element revision when available

Pipeline:

1. Normalize identity
   - derive tab key, route key, query signature, and digests
   - classify graph freshness
   - detect same-view revision vs new-view transition

2. Normalize source elements
   - map `BrowserElement` records into source element facts
   - preserve stable selectors, labels, text, role, bbox, href, focused/selected/editable state
   - redact values from password/token/payment-like fields

3. Segment regions
   - use ARIA landmarks, roles, DOM hierarchy hints, bbox clusters, heading boundaries, and text density
   - identify main content, navigation, sidebars, toolbar/filter rows, dialogs, footer, and repeated panels

4. Detect controls
   - classify buttons, tabs, toggles, nav links, filters, search fields, submits, destructive controls, and auth/payment/download/file-upload risks
   - record likely effect without executing

5. Detect content lists
   - find repeated link/card/row structures
   - infer list item boundaries
   - separate content items from utility/profile/category/comment/navigation links
   - score representative items for "interesting/read/show me any item" instructions

6. Detect forms
   - group fields and labels
   - classify submit/cancel/clear controls
   - preserve typed field intent while redacting sensitive values

7. Build edges
   - containment, label, list, control-effect, form, navigation, update-region, selected/focused, and error edges

8. Build affordance index
   - make resolver lookup fast and typed
   - keep candidate provenance and confidence axes

9. Emit diagnostics
   - graph size, build time, truncation, stale/settling reason, redaction count, missing metadata, unsupported frame/shadow cases

## 7. Extension Metadata Upgrade

The extension should preserve existing snapshot/package compatibility, but enrich observations so the daemon can build a better graph.

Additive metadata candidates:

- `sourceOrder`
- `domPathHash`
- `parentPathHash`
- `frameId`
- `frameUrl`
- `shadowRootBoundary`
- `ariaControls`
- `ariaDescribedBy`
- `ariaLabelledBy`
- `headingLevel`
- `nearestHeading`
- `nearestLandmark`
- `formOwner`
- `listOwner`
- `computedVisibility`
- `isStickyOrFixed`
- `isLikelyOverlay`
- `mutationRevision`
- `lastMutationAt`
- `documentReadyState`

Do not add default arbitrary JS execution. The extension may use content-script DOM inspection internally to create normalized observations, but daemon-facing actions remain typed Browser Action requests.

## 8. Prompt And Direct Action Integration

Prompt-driven path should change from:

```text
prompt -> wait for fresh snapshot -> build observation -> resolve -> execute
```

to:

```text
extension/adapter updates view graph continuously or on demand
prompt -> read fresh prepared graph -> resolve/plan -> execute -> reobserve/update graph -> verify/respond
```

Direct UI actions should use the same graph:

```text
button click in widget -> request builder -> prepared graph lookup -> safety -> action -> verification
```

Compatibility rule:

- If no fresh graph exists, the current prompt-time observation path can remain as fallback.
- If a graph exists but is `settling`, low-risk read may proceed with a settling warning, while side-effect actions should wait/reobserve or clarify.
- If a graph is `stale`, side-effect actions must refresh before execution.

## 9. Semantic Interface Integration

View Graph v2 should feed Semantic Interface as typed evidence, not as a flattened prompt string.

Mapping examples:

- `control` node with `actionHint=filter`, label `개념글`, selected false
  - candidate entity: `affordance.filter`
  - actionability: high for "click/filter/show recommended posts"
  - risk: same-page update or navigation, not destructive

- `content_item` node under a repeated list
  - candidate entity: `content.item`
  - actionability: high for "show/read/open an interesting post"
  - representative item evidence: visible text, list position, density, non-utility classification

- `link` node in sidebar with label text containing `개념글`
  - candidate entity: `navigation.category` or `content.related_link`
  - actionability lower for "press the concept-post filter" if a primary filter control exists

Semantic Interface should still abstain when:

- top candidates are semantically equivalent and close
- the action has side effects and target confidence is low
- the page is stale or settling beyond policy limits
- requested intent cannot be grounded in visible graph entities

## 10. Freshness And SPA Handling

View Graph v2 must explicitly handle same-tab transitions.

Cases:

- full navigation: origin/path/title/structure changed
- route query change: same path, meaningful query changed
- SPA virtual navigation: URL may stay similar, title/structure/text digest changes
- dynamic update: DOM/list content changed after click without URL change
- settling: recent mutation, loading indicator, or repeated snapshots still changing
- stable: mutation quiet window passed and digests unchanged

Policy:

- URL mismatch alone should not fail a multi-step plan if the graph identity confirms an expected same-view or route-transition result.
- After action execution, verification should compare expected effect against new graph revision, not only raw URL equality.
- Stale element errors should trigger reobserve and target re-resolution against graph v2 once before failing.

## 11. Privacy, Safety, And Audit

Never persist:

- password values
- token/cookie/session values
- payment values
- full sensitive form values
- full page screenshots by default
- complete page text in durable audit

Allowed durable summaries:

- graph schema version
- URL origin/path with query redaction where needed
- digests
- node/edge counts
- redacted labels
- action family
- risk class
- target node id/stable key
- graph freshness
- verification summary
- diagnostic errors

Audit should record enough to debug "why did it click this?" without storing the user's sensitive page state.

## 12. Implementation Order

Recommended order for the first View Graph v2 sprint sequence:

1. Types and compatibility bridge
   - add `src/daemon/browser-perception/view-graph/types.ts`
   - add schema-versioned graph output
   - keep `BrowserObservation.viewGraph` consumers working

2. Identity, digest, and freshness
   - route key, query signature, text/interactive/structure digests
   - fresh/settling/stale/unknown classification
   - same-view vs new-view transition detection

3. Region and control graph builder
   - segment landmarks/main/sidebar/nav/filter/toolbars
   - classify controls and risk/action hints

4. Content list and representative item model
   - repeated item detection
   - utility/profile/category/comment exclusion
   - content candidate ranking for "interesting/any/read/show" instructions

5. Affordance index
   - token, role, action, risk, region, list, form, focus, selected indexes
   - candidate evidence export for Semantic Interface

6. Extension metadata upgrade
   - additive snapshot fields
   - no default UX regression
   - package/smoke compatibility preserved

7. Prompt/direct path consumption
   - prompt runner uses fresh graph when available
   - action verification uses graph revision and expected effect
   - source mismatch no longer fails expected route/filter transitions

8. Tests, smokes, and dogfood evidence
   - deterministic graph fixtures
   - SPA mutation fixture
   - list/filter fixture
   - real dogfood report

## 13. Acceptance Criteria

View Graph v2 is complete only when:

- `BrowserObservation` can expose a schema-versioned View Graph v2 without breaking existing Browser Action smokes.
- A graph built from deterministic fixtures contains regions, controls, content lists, forms, edges, affordance indexes, freshness, and diagnostics.
- Stable node keys survive benign DOM churn, text refresh, and SPA updates.
- The builder distinguishes:
  - primary filter/tab controls
  - navigation/sidebar/category links
  - repeated content items
  - utility/profile/comment links
  - form fields and submit/risky controls
- The motivating generic flow is represented without site-specific rules:
  - "click concept/recommended filter"
  - reobserve updated list
  - choose/read a representative content item
- Same-tab URL/query changes caused by expected actions do not fail solely as source mismatch when graph identity confirms the transition.
- Stale target reobserve/retry uses v2 graph evidence once before failure.
- Semantic Interface receives typed graph evidence packets for control, content, region, list, and freshness evidence.
- Audit records graph ids/digests/summaries without storing full sensitive page state.
- Extension snapshot compatibility, Browser Bridge behavior, and legacy DOM provider smokes remain passing.
- Dogfood evidence documents at least one successful prompt/direct flow that previously failed due to target ambiguity or expected route transition.

## 14. Verification Commands

Required for implementation completion:

```bash
npm run lint
npm run build:web
npm run smoke
npm run smoke:browser-action
npm run smoke:browser-action:e2e-control
npm run smoke:browser-action:prompt-classification
npm run smoke:browser-bridge
npm run smoke:extension
npm run smoke:dom
npm run smoke:semantic-interface
npm run smoke:semantic-memory
npm run smoke:browser-view-graph-v2
npm run dogfood:browser-action
npm run dogfood:semantic-interface
npm run vibe:checkpoint
```

If a new command cannot be added in the first sprint, the implementation must still include equivalent deterministic fixture coverage and record the exact command name as planned work.

## 15. Dogfood Evidence

Create or update:

```text
docs/reports/browser-view-graph-v2-dogfood-evidence-<date>.md
```

Evidence should include:

- active page URL/origin redacted as needed
- graph identity/freshness summary
- node/edge/list/control counts
- action transcript
- before/after graph revision
- resolver candidates with redacted evidence
- verification result
- failure notes and fallback behavior

Required dogfood cases:

- direct observe/read on a normal page
- natural-language click of a filter/tab-like control
- natural-language representative content item selection
- SPA or query-only transition
- stale snapshot/graph refresh recovery
- restricted page or missing permission boundary

## 16. Risks And Blockers

Known risks:

- MV3 service worker suspension can delay observation freshness.
- SPA frameworks can mutate content without reliable navigation events.
- Shadow DOM and iframe content can hide useful semantics from the extension.
- Virtualized lists may expose only visible rows.
- Highly visual/icon-only UIs may need Vision Context fusion.
- Some pages intentionally obscure text/roles or block extension access.

BLOCKED criteria:

- If a browser security boundary prevents observation, record unsupported state and recovery path.
- If iframe/shadow DOM access is unavailable, record precise missing metadata and keep outer-page graph valid.
- If a site requires credentials or sensitive user state to test, do not use it as required acceptance evidence.
- If View Graph v2 needs a full Browser Perception scheduler before prompt-fast-path can be completed, record that dependency explicitly rather than claiming graph readiness solves latency alone.

## 17. Durable Context Updates

When implementing from this handoff, update:

- `docs/plans/browser-view-graph-v2-handoff.md`
- `docs/plans/sprint-roadmap.md`
- `.vibe/agent/iteration-history.json`
- `.vibe/agent/sprint-status.json`
- `.vibe/agent/handoff.md`
- `.vibe/agent/session-log.md`
- `docs/reports/project-report.html`
- dogfood evidence under `docs/reports/`

## 18. Suggested Goal Prompt

```text
/goal

Objective:
Read docs/plans/browser-view-graph-v2-handoff.md and implement Browser View Graph v2 as the first prepared-context foundation for Browser Action. Use $vibe-iterate before every new implementation cycle until View Graph v2 acceptance criteria are complete.

Primary sources:
- Treat docs/plans/browser-view-graph-v2-handoff.md as the authoritative handoff for this goal.
- Treat docs/plans/browser-action-interface-handoff.md, docs/plans/browser-extension-bridge-handoff.md, docs/plans/semantic-interface-handoff.md, and docs/plans/semantic-memory-handoff.md as baseline context only.

Required workflow:
1. Before each new implementation cycle, invoke and follow $vibe-iterate.
2. Use $vibe-iterate to load current project state, carry forward unfinished View Graph v2 work, update sprint roadmap, iteration history, handoff, session log, sprint status, and run normal sprint implementation.
3. Start by recording that Browser Action currently uses prompt-time snapshot/observation and that View Graph v2 is the prepared page-understanding layer needed before broader Browser Perception.
4. Do not stop after planning. Implement, test, dogfood where practical, document, and iterate until View Graph v2 is complete or precisely BLOCKED.

Implementation target:
Create a schema-versioned Browser View Graph v2 module under the daemon, designed to become part of Browser Perception, and integrate it with BrowserObservation, Browser Action target resolution, Semantic Interface evidence, extension metadata, and verification/audit summaries.

Completion criteria:
- BrowserObservation exposes View Graph v2 without regressing existing Browser Action/DOM/extension behavior.
- View Graph v2 models identity, freshness, regions, controls, forms, content lists, edges, affordance index, diagnostics, and redaction.
- Prompt/direct Browser Action paths can consume fresh v2 graph evidence before falling back to prompt-time snapshot wait.
- Same-tab SPA/query transitions and stale target reobserve/retry use graph identity/revision rather than raw URL equality alone.
- Semantic Interface receives typed graph evidence packets for controls, content lists, regions, affordances, freshness, and risk hints.
- Dogfood evidence proves at least one previously ambiguous browser action flow is improved without site-specific rules.
- Required verification passes, including a new or equivalent View Graph v2 smoke.

Stop conditions:
- Stop only when View Graph v2 is complete by the handoff criteria.
- If blocked by browser security, unavailable adapter metadata, or full Browser Perception scheduler dependency, record BLOCKED with attempted path and required scope expansion.
```
