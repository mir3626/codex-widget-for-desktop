# Browser Perception Interface Handoff

Status: draft handoff for the post-View Graph v2 implementation track
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Primary consumers:
- Browser Action prompt execution
- Browser Action direct UI execution
- Browser Extension Bridge command channel
- Semantic Interface evidence projection
- Semantic Memory unresolved/correction feedback

Primary goal: turn Browser Action from "observe when the user asks" into a prepared, request-scoped, continuously refreshed browser perception layer that can reliably answer "what is on the active tab right now?" before resolving or executing actions.

## 0. Why This Exists

Browser View Graph v2 now provides the deterministic page-understanding schema:

- identity and route keys
- freshness
- regions, controls, forms, content lists, edges
- affordance index
- Semantic Interface graph evidence
- redacted diagnostics

Live dogfood still exposes the next missing layer:

```text
현재 활성 탭 관찰이 아직 갱신되지 않았습니다.
Browser Bridge가 gall.dcinside.com 페이지를 읽는 중입니다.
잠시 후 다시 실행해 주세요.
```

This is not primarily a resolver problem. It means the product can build a good graph once a valid observation exists, but it cannot yet guarantee that a fresh, stable observation exists at the exact point a prompt/direct action needs it.

The current system still has prompt-time and poll-time gaps:

- The daemon can have a previous prepared graph, but not a request-scoped fresh graph for the current active tab.
- The extension can be connected and idle, but a prompt can race ahead of the next poll/observe cycle.
- A command can wait for the bridge while the user-visible answer path has already produced a retry-later message.
- Same-tab navigation, query transitions, and SPA route changes can produce source/freshness ambiguity.
- React-style pages can mutate after `document.readyState === "complete"`, so a graph can be structurally valid but still settling.
- The widget UI currently exposes "reading page" as a failure-like user response rather than treating it as an internal perception wait state.

Browser Perception is the missing interface layer between Browser Bridge and Browser Action:

```text
extension/CDP/Playwright/native observations
  -> Browser Perception scheduler and context store
  -> Browser View Graph v2 prepared context
  -> Semantic Interface evidence
  -> Browser Action plan/resolve/execute/verify
```

## 1. Scope

In scope:

- daemon-side Browser Perception service under `src/daemon/browser-perception/`
- request-scoped fresh observation API
- active-tab prepared context store
- extension long-poll command delivery and acknowledgement hardening
- view stabilization for SPA/dynamic pages
- route/view revision handling after action execution
- Browser Action integration before prompt planning and before each side-effect action
- Semantic Interface evidence packet publication from prepared contexts
- renderer status simplification for perception wait/progress/error states
- smoke/dogfood coverage proving the previous "try again later" failure class is closed

Out of scope:

- replacing Browser View Graph v2
- site-specific rules for DCInside or any other website
- arbitrary JavaScript as the default action abstraction
- full desktop computer-use outside browser windows
- storing full DOM, page text, screenshots, cookies, tokens, passwords, or payment data
- ML-only perception or online learned executable targeting

## 2. Design Principles

- Request-scoped freshness: prompt/direct actions must be able to request "observe the current active tab now" and await a bounded result.
- Prepared by default: background preparation should keep the active tab warm, but execution must not rely only on background cadence.
- Ack before wait: if the extension receives a command, the daemon must know that quickly; no silent `awaiting_extension` limbo.
- Stable before side effects: click/type/select/navigation actions require a fresh and stable view unless the user explicitly approves an uncertain action.
- Read can degrade: read/summarize actions may proceed with a settling view if the result clearly reports uncertainty.
- Route identity over raw URL equality: same-tab query/SPA transitions must use view identity, route key, revision, and structure digest rather than raw URL equality alone.
- Universal semantics: page understanding comes from roles, accessibility metadata, regions, forms, content lists, affordances, visible text, and stable graph identity, not domain-specific selectors.
- Redacted durable state: only digests, labels, small summaries, and diagnostics survive beyond the active request.
- UI remains thin: daemon owns observation, freshness, safety, and verification semantics; renderer shows compact status and approval states.

## 3. Proposed Module Boundary

Extend the existing `src/daemon/browser-perception/` boundary:

```text
src/daemon/browser-perception/
  context/
    preparedContext.ts
    contextStore.ts
    freshnessPolicy.ts
    sourceIdentity.ts
  scheduler/
    activeTabScheduler.ts
    requestScopedObserve.ts
    stabilization.ts
    retries.ts
  bridge/
    commandQueue.ts
    commandAck.ts
    resultIngest.ts
    statusModel.ts
  adapters/
    extensionPerceptionAdapter.ts
    cdpPerceptionAdapter.ts
    playwrightPerceptionAdapter.ts
  view-graph/
    ...existing v2 module...
  semantic/
    evidencePublisher.ts
  diagnostics/
    perceptionDiagnostics.ts
  index.ts
```

Keep `view-graph/` as the graph builder. Browser Perception owns when and why graphs are built, refreshed, invalidated, waited on, and exposed to Browser Action.

## 4. Core Types

### PreparedBrowserViewContext

Represents the daemon's current understanding of one browser view.

Required fields:

- `contextId`
- `schemaVersion: "browser-perception-context.v1"`
- `adapterId`: `extension | cdp | playwright | native`
- `tabKey`
- `source`: active tab/window/url/title/origin/frame metadata
- `viewGraph`: `BrowserViewGraphV2`
- `observation`: compatible `BrowserObservation`
- `freshness`: `fresh | settling | stale | blocked | unavailable`
- `stability`: `stable | mutating | navigating | unknown`
- `viewRevision`
- `mutationRevision`
- `capturedAt`
- `updatedAt`
- `expiresAt`
- `lastObservedReason`: `background | prompt | direct_action | before_step | after_step | retry | extension_poll`
- `diagnostics`
- `redaction`

### PerceptionObserveRequest

Request from Browser Action or renderer to ensure a fresh context exists.

Fields:

- `requestId`
- `reason`
- `adapterHint`
- `tabHint`
- `requiredFreshness`: `fresh | stable | any_visible`
- `maxAgeMs`
- `settleQuietMs`
- `timeoutMs`
- `allowSettlingForRead`
- `actionRisk`: `read | safe_navigation | side_effect | sensitive`
- `cancelSignal`

### PerceptionObserveResult

Result consumed by Browser Action.

Fields:

- `status`: `ready | settling_ready | blocked | permission_required | restricted_page | disconnected | timeout | cancelled | error`
- `context`
- `ack`
- `wait`
- `diagnostics`
- `userRecovery`

Important rule: `timeout` is a real bounded timeout, not a normal "wait for next poll" state. Connected/allowed extensions should normally produce `ready`, `settling_ready`, or a specific blocked/error result.

### ExtensionObserveCommand

Command delivered to the extension.

Fields:

- `commandId`
- `kind: "observe_now"`
- `reason`
- `expectedActiveTab`
- `requiredOriginPolicy`
- `captureMode`: `metadata | graph_input | screenshot_optional`
- `deadlineAt`
- `settleQuietMs`
- `includeMutationState`

### ExtensionObserveAck

Fast acknowledgement that prevents silent waits.

Fields:

- `commandId`
- `status`: `accepted | busy | missing_permission | restricted_page | wrong_tab | unsupported | error`
- `activeTab`
- `receivedAt`
- `estimatedResultMs`
- `error`

### ExtensionObserveResult

Final extension result.

Fields:

- `commandId`
- `status`: `succeeded | failed | cancelled | expired`
- `snapshot`
- `activeTab`
- `mutationRevision`
- `mutationQuietMs`
- `readyState`
- `resultPostedAt`
- `error`

## 5. Runtime Flow

### Prompt-Driven Browser Action

Current target flow:

```text
user prompt
  -> classify browser action intent
  -> ensureFreshViewContext(reason=prompt, requiredFreshness=stable, timeout=bounded)
  -> Semantic Interface resolves intent against prepared View Graph v2 evidence
  -> Browser Action builds plan
  -> for each side-effect step:
       ensureFreshViewContext(reason=before_step, requiredFreshness=stable)
       re-resolve target by fingerprint/stableKey/affordance
       safety policy and approval
       execute typed action
       ensureFreshViewContext(reason=after_step, requiredFreshness=fresh or settling_ready)
       verify result
  -> chat response uses action result, not internal execution receipt
```

`Browser Bridge is reading the page` should be a progress event while `ensureFreshViewContext` is pending, not the final chat answer unless a true timeout or permission problem occurs.

### Direct UI Browser Action

Direct buttons should share the same path:

```text
direct read/click/type/search/scroll/navigation request
  -> build deterministic BrowserActionPlan
  -> ensureFreshViewContext
  -> resolve/approve/execute/verify
```

No manual extension icon click, no manual snapshot button, and no DOM mode preparation should be required.

### Background Preparation

The active tab should stay warm through background preparation:

- extension heartbeat/long-poll reports active tab state
- active-tab change invalidates old active context
- extension page events mark context dirty
- scheduler observes after tab activation, URL change, history state change, hash change, visibility change, or mutation quieting
- daemon stores only the latest redacted prepared context per tab/view

Background preparation improves latency but does not replace request-scoped observe for side-effect actions.

## 6. Extension Bridge Requirements

The extension must support command-first perception:

1. Poll or long-poll daemon for pending commands.
2. Immediately return an ack for each command.
3. Check active tab, URL/origin permission, restricted page, and frame availability.
4. Inject or use existing content script to collect graph input.
5. Wait until either:
   - mutation quiet threshold is satisfied, or
   - bounded settle timeout is reached.
6. Return snapshot/result metadata with mutation revision and quiet duration.
7. Retry result post when transient daemon/network failure occurs.
8. Mark command failed with a visible reason on permission/restricted/wrong-tab errors.

The extension should keep legacy DOM snapshot endpoints for compatibility, but normal Browser Action must use command-first observe.

### Long-Poll vs WebSocket

Prefer long-poll for the next production step:

- Manifest V3 service workers can sleep; long-poll can be re-established cheaply.
- The daemon can associate each observe request with an explicit command id and deadline.
- The existing polling architecture can be upgraded without replacing the bridge transport.
- WebSocket remains a later optimization once the command semantics are stable.

The long-poll path must still handle same-tab navigation by including active-tab metadata and view identity in every ack/result.

## 7. SPA and Dynamic Page Stabilization

React/Vue/Svelte/Next-style pages can mutate after load. Browser Perception should treat page stability as graph evidence, not as a boolean page-load event.

Signals:

- `document.readyState`
- URL, title, and history state changes
- `popstate`, `hashchange`, patched `history.pushState` and `history.replaceState`
- MutationObserver revision counter
- visible interactive element digest
- visible text digest
- structure digest
- last input/action timestamp
- network-idle proxy if adapter can provide it

Stabilization rule:

- For side-effect actions, prefer two consecutive compatible observations or one observation with sufficient `mutationQuietMs`.
- For read-only actions, allow `settling_ready` if the graph has enough visible content and diagnostics explain that the page may still be changing.
- If graph identity changes after target resolution but before execution, re-resolve.
- If graph identity changes after execution, verify against the new context rather than failing solely on raw URL mismatch.

## 8. Browser Action Integration Points

### Prompt Runner

Replace "wait for next snapshot" behavior with:

- `browserPerception.ensureFreshContext(request)`
- timeout/cancel-aware pending status
- progress event while waiting
- final error only on `timeout`, `permission_required`, `restricted_page`, `disconnected`, or `blocked`

### Planner and Resolver

Resolvers should receive:

- `PreparedBrowserViewContext`
- `BrowserViewGraphV2`
- Semantic Interface evidence packets
- freshness/stability diagnostics
- source identity and view revision

Target resolution must prefer graph-level affordance/list/form evidence before flat element matching.

### Executor

Before executing side-effect steps:

- validate context freshness
- compare target fingerprint/stableKey against latest graph
- re-resolve stale targets once
- block or clarify if confidence drops below side-effect threshold

After executing:

- request after-step observation
- update prepared context
- verify against graph transition evidence

## 9. Renderer UX Requirements

The renderer should not show internal execution receipts as final answers.

User-facing states:

- `Browser connected`
- `Reading current page`
- `Page changed, refreshing understanding`
- `Needs site permission`
- `Restricted page`
- `Browser disconnected`
- `Action needs approval`
- `Action completed`
- `Could not identify target`

When perception is pending:

- show compact progress in Browser menu/status
- keep the chat turn alive when practical
- do not tell the user to manually retry unless the daemon hit a true bounded timeout

When a permission recovery is needed:

- show the exact recovery action, such as enabling all allowed sites or removing the origin from blocklist

## 10. Safety and Privacy

- Side-effect actions require fresh/stable context.
- Low-confidence side effects clarify instead of guessing.
- Submit/delete/send/post/publish/pay/purchase/auth/password/token/file upload/download/cross-origin side effects/permission prompts still require confirmation unless a saved policy explicitly covers them.
- Password/token/payment/cookie/credential values must never be persisted.
- Perception durable context stores metadata, digests, summaries, and redacted labels only.
- Sensitive fields should be represented as field type/risk metadata, not value text.
- `full_control_dev` evaluate remains separate and hidden by default.

## 11. Testing and Smokes

Add focused coverage:

- `npm run smoke:browser-perception`
- `npm run smoke:browser-perception:extension-command`
- `npm run smoke:browser-perception:stabilization`
- `npm run smoke:browser-action:fresh-context`

Required cases:

- connected extension receives observe command and acks before result
- prompt waits for request-scoped observation instead of returning "try again later"
- disconnected extension returns a clear recovery error
- missing permission returns `permission_required`
- restricted page returns `restricted_page`
- same-tab query transition updates route/view identity without raw URL false failure
- SPA mutation after readyState waits for quiet/stable threshold
- side-effect action blocks on stale context
- read-only action can use `settling_ready` with diagnostics
- cancellation cancels pending observe and pending action
- result-post retry does not duplicate action execution
- ProviderRegistry prepared context remains backward compatible with DOM snapshot consumers

Dogfood evidence:

- reload extension
- open a generic dynamic board/list page
- run "read this page" without manual snapshot
- run "click the recommended/concept/filter tab" without manual snapshot
- run "show me an interesting post" after query/SPA transition
- verify the flow uses graph/list evidence and does not contain site-specific rules
- record before/after context identity, route key, mutation quietness, plan steps, verification result, and final chat response

## 12. Recommended Sprint Order

### Sprint 1: Context Store and Request-Scoped Observe API

- Add `PreparedBrowserViewContext` types.
- Add in-memory active-tab context store.
- Add freshness/stability policy.
- Add `ensureFreshContext` daemon API.
- Bridge existing ProviderRegistry prepared observation into the context store.
- Add smoke fixtures for fresh/stale/settling context decisions.

### Sprint 2: Extension Command Ack and Long-Poll Observe

- Add daemon command queue with `observe_now`.
- Add extension long-poll or upgraded poll command delivery.
- Add fast ack/result separation.
- Add command timeout/cancel handling.
- Preserve legacy DOM snapshot endpoints.
- Add smoke coverage for ack, result, timeout, permission, and restricted page.

### Sprint 3: SPA Stabilization and Active-Tab Dirty Signals

- Extend content script mutation/history tracking.
- Mark active context dirty on tab/url/title/history/mutation changes.
- Implement stabilization thresholds.
- Add same-tab query transition and SPA mutation smokes.

### Sprint 4: Browser Action Prompt/Direct Integration

- Replace prompt-time retry-later path with `ensureFreshContext`.
- Ensure direct UI and prompt paths share the same perception API.
- Re-resolve side-effect targets against the latest graph.
- Convert "reading page" into progress, not final answer.
- Add prompt smoke for the previous failure message.

### Sprint 5: Semantic Evidence and Verification Refresh

- Publish prepared context evidence to Semantic Interface.
- Ensure memory read sets are scoped by context identity/revision.
- Update action verification to accept legitimate route/query transitions.
- Add dogfood evidence for filter -> representative content flow.

### Sprint 6: UX, Diagnostics, and Completion

- Simplify renderer Browser status around perception states.
- Add diagnostics report for bridge ack/result/freshness.
- Refresh docs, roadmap, handoff, iteration history, project report.
- Run full verification and checkpoint.

## 13. Acceptance Criteria

Browser Perception is complete only when:

- Browser Action can request a fresh active-tab context and await it through a bounded daemon API.
- Connected/allowed extension states no longer return a final "currently reading, try again later" chat answer for normal prompts.
- Extension observe commands have explicit ack/result/timeout/cancel states.
- Active tab source identity includes tab/window/url/title/route key/view revision/mutation revision.
- SPA/query transitions update graph identity and do not fail solely because raw URL changed.
- Side-effect Browser Actions revalidate or re-resolve stale targets before execution.
- Semantic Interface receives prepared context graph evidence from the request-scoped context, not only from stale provider snapshots.
- Renderer shows perception waiting as progress and only surfaces actionable failures.
- Dogfood proves one previously ambiguous live browser action improves without site-specific rules.
- Existing Browser Action, Browser Bridge, DOM, extension, View Graph v2, Semantic Interface, and Semantic Memory smokes remain passing.

## 14. Required Verification

- `npm run lint`
- `npm run smoke`
- `npm run smoke:browser-view-graph-v2`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-bridge`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:semantic-interface`
- `npm run smoke:semantic-memory`
- new Browser Perception smokes listed above
- updated Browser Action / Browser Perception dogfood evidence
- UTF-8/mojibake checks for touched text files
- `npm run vibe:checkpoint`

## 15. Stop Conditions

Stop only when Browser Perception closes the fresh-observation gap described in this handoff or when a real blocker requires scope expansion.

Record `BLOCKED` if:

- Manifest V3 behavior prevents reliable command ack/result delivery in the installed browser.
- Browser security prevents observing the active tab even with granted permission.
- A required adapter only works with external browser configuration not available in the current environment.
- A full scheduler requires a broader product decision outside Browser Action/Browser Bridge.

Each `BLOCKED` record must include item, reason, attempted implementation path, required scope expansion, and verification evidence.
