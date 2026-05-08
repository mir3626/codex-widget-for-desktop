# Browser Extension Bridge Handoff

Status: complete in `iter-13` for snapshotless Browser Bridge UX; post-dogfood View Graph expansion is now required and open
Target repo: `C:\Users\Tony\Workspace\codex-widget-for-desktop`
Baseline handoffs:
- `docs/plans/browser-action-interface-handoff.md`
- `docs/plans/browser-action-end-to-end-control-handoff.md`
- `docs/plans/browser-action-control-surface-handoff.md`

## 0. Purpose

The current Browser Action implementation exposes too much of the internal DOM/snapshot pipeline to the user. The browser extension still behaves like a manual "send DOM snapshot" tool:

```text
extension icon click -> collect active tab snapshot -> POST snapshot -> poll pending command -> execute
```

That is useful for development, but it is not the desired product UX. Browser Action should feel like a browser bridge for the widget:

```text
user prompt or widget button -> daemon Browser Action request -> extension observes/executes when needed -> result returns to daemon/widget
```

This handoff is authoritative for the extension UX and transport refactor that removes manual snapshot capture from the normal user flow.

Post-`iter-15` dogfood clarified that snapshotless UX is not enough for accurate computer-use behavior. Browser Action must not execute against "the last snapshot"; it must execute against a request-scoped, identity-verified current view. View Graph is therefore a required Browser Bridge expansion, even if it costs additional time and tokens.

## 1. Product Goal

Convert the DOM extension into a first-class Browser Bridge:

- installing the extension should be enough to make the browser available to the widget once local daemon and site permissions are configured
- the extension icon should show connection state, not trigger a snapshot
- the extension popup should expose connection/settings/permission controls
- Browser Action requests from the widget should automatically observe the current tab before executing
- the user should not need to press a snapshot button or manually run a DOM menu before simple browser actions

The product-level target is:

```text
Open browser page -> ask widget "click More information" -> Browser Bridge observes, acts, verifies, and reports.
```

## 2. Current Problems

Problems observed in dogfood:

- the extension icon click returns `OK`, but this only proves snapshot posting/polling at that moment
- the widget menu can look disconnected even when the extension can reach the daemon
- the action flow requires too many manual steps:
  - click extension
  - capture snapshot
  - open Mode/DOM menu
  - choose action
  - configure target/action
  - execute Browser Action
  - sometimes click the extension again to poll
- adapter/debug state is mixed into the main control surface
- Playwright/CDP/extension availability is not clearly separated from the user's immediate task
- "snapshot" is an implementation detail but is currently exposed as a product concept

## 3. Non-Negotiable UX Rules

- Do not require the user to manually click the extension icon to capture a snapshot before action execution.
- Do not use the extension icon as the normal action trigger.
- Do not require a DOM snapshot menu step before Browser Action can run.
- Keep "snapshot" terminology out of the default user-facing extension and widget flow.
- Default Browser Action should be prompt-first or one-click direct action from the widget.
- Extension popup is for connection, permission, and settings, not for executing page actions.
- Advanced diagnostics may remain available, but must be secondary.

## 4. New Extension Role

Rename the conceptual role from:

```text
Codex Widget DOM Snapshot
```

to:

```text
Codex Widget Browser Bridge
```

The extension owns:

- local daemon connectivity checks
- icon badge connection state
- current site permission state
- command polling or request channel
- current tab observation when requested by daemon
- typed Browser Action execution when requested by daemon
- before/after observation result posting
- restricted page and injection-denied error reporting
- native host fallback forwarding where available

The extension must not:

- render final agent prompts
- decide high-level task semantics
- persist full page state
- persist password/token/payment/cookie/credential values
- run arbitrary JavaScript as the normal abstraction

## 5. Icon and Badge Contract

The browser action icon should no longer send a snapshot when clicked. It should open a popup.

Badge states:

```text
OFF  daemon disconnected or unreachable
IDLE daemon connected, no pending action
RUN  action/observe in progress
ASK  user/browser permission needed
ERR  last connection/action failed
```

Suggested colors:

```text
OFF  gray
IDLE teal/green
RUN  blue
ASK  amber
ERR  red
```

Badge updates should happen from:

- popup open
- daemon health check
- command poll success/failure
- action start/result/error
- permission state changes

Manifest V3 service workers can be suspended, so badge freshness must not depend only on a long-lived in-memory connection.

## 6. Popup UX Contract

Clicking the extension icon opens a compact popup with:

- connection status:
  - Widget connected
  - Widget disconnected
  - Native host available/unavailable
- current tab status:
  - Allowed
  - Needs site permission
  - Restricted page
  - Injection unavailable
- toggles:
  - enable this site
  - auto-connect to widget
  - allow safe read/scroll on this site
  - require approval for click/type
  - use native host fallback
- daemon base URL:
  - default `http://127.0.0.1:4128`
  - test connection
  - save/reset
- diagnostics:
  - extension version
  - last heartbeat time
  - last command id
  - last error

The popup should not expose "send snapshot" as the primary action.

## 7. Options UX Contract

The options page should become a fuller settings surface for the Browser Bridge:

- daemon base URL
- polling interval or transport mode
- auto-connect on browser startup
- host permission policy:
  - current site only
  - selected origins
  - all supported sites, explicit opt-in
- native host fallback
- debug logging
- full-control developer features disabled by default

Store the daemon value as a base URL:

```text
http://127.0.0.1:4128
```

Derive endpoint URLs internally:

```text
GET  /storage/health
POST /providers/dom/snapshot              legacy compatibility only
GET  /browser-action/extension/poll
POST /browser-action/extension/result
POST /browser-action/extension/heartbeat
GET  /browser-action/extension/status
```

## 8. Permission Model

Manual snapshot clicks currently rely on `activeTab` as a user gesture. Removing manual snapshot capture requires an explicit permission model.

Recommended model:

1. Keep `activeTab` as fallback for one-time permission.
2. Add optional origin permissions for approved sites.
3. The popup `Enable this site` toggle requests permission for the current origin.
4. Optional "Allow all supported sites" requests broad host permission only as explicit opt-in.
5. Browser Action execution checks permission before observation/execution.

If permission is missing:

```text
daemon queues action -> extension reports needs_site_permission -> widget shows "Enable this site in extension"
```

The extension must not silently execute on sites without permission.

## 9. Command-First Transport

Replace the normal user flow with command-first execution:

```text
daemon queues Browser Action command
extension polls or receives command
extension checks active tab/source/permission
extension collects before observation
extension executes typed action if allowed
extension collects after observation
extension posts result
daemon verifies and broadcasts result
```

Manual snapshot posting remains only as a legacy/debug compatibility path during migration.

### 9.1 Command Polling

The extension should poll the daemon on a configurable interval while enabled.

Polling request includes:

- extension id/version
- browser type
- tab id/window id
- URL/title when available
- permission state
- native host availability
- current mode

The daemon returns either:

- no command
- observe command
- execute command
- cancel command
- permission/setup instruction

### 9.2 Heartbeat

Add or formalize extension heartbeat/status:

```json
{
  "extensionVersion": "0.1.0",
  "daemonBaseUrl": "http://127.0.0.1:4128",
  "browser": "chrome",
  "mode": "idle",
  "activeTab": {
    "url": "https://example.com/",
    "title": "Example Domain",
    "permission": "allowed"
  },
  "nativeHost": "available",
  "lastError": null
}
```

The widget should use this to show simple user-facing states:

- browser connected
- needs site permission
- disconnected
- restricted page
- action running
- last action failed

### 9.3 Request-Scoped Fresh Observation

Prompt-driven and direct Browser Action must start by capturing a fresh observation for that request. Periodic auto-observe remains useful for status and preview, but it is not authoritative for execution.

Required flow:

```text
user prompt/direct action
daemon classifies browser-context action
daemon issues observe_now for the active tab
extension captures the current page/view
daemon verifies identity/freshness
semantic resolver selects target
daemon applies safety/approval
extension executes against the same current view or returns stale_view
daemon reobserves/re-resolves/retries once where safe
```

Do not rely only on `tabId`. Same-tab navigation can keep `tabId` while replacing the document. SPA route changes can keep both `tabId` and document while changing the actionable view.

Minimum observation identity:

```ts
type BrowserObservationIdentity = {
  tabId?: number | string;
  windowId?: number | string;
  frameId?: number;
  documentId?: string;
  navigationId?: string;
  url: string;
  title?: string;
  readyState?: "loading" | "interactive" | "complete";
  capturedAt: string;
  observedAt?: string;
};
```

Validation rules:

- `snapshot.url` must match the active tab URL after normalizing hash-only differences where appropriate.
- `capturedAt` must be tied to the current request, not only to the last background poll.
- `documentId` or navigation token should match when available.
- `readyState` should be `interactive` or `complete`; otherwise the extension returns loading/retry metadata.
- mismatched identity must not execute side-effect actions.

### 9.4 Long-Poll Command Channel

The current alarm/poll loop is an acceptable fallback, but prompt-driven Browser Action needs a lower-latency command path. Prefer a daemon HTTP long-poll endpoint before a WebSocket-only design because Manifest V3 service workers can suspend and drop persistent connections.

Recommended transport:

```text
extension opens /browser-action/extension/wait
daemon holds request until observe/action/cancel command or timeout
extension executes command or captures observe_now
extension immediately opens the next wait request
alarm poll remains fallback for recovery
```

Why not WebSocket as the default:

- MV3 service-worker suspension can close the socket without a reliable always-on background page.
- WebSocket still needs command queue, retry, expiry, heartbeat, and missed-command recovery.
- HTTP long-poll fits the existing local daemon endpoint/auth/debug model and degrades naturally to alarm poll.

WebSocket can be added later as an optional fast path, but long-poll plus queue semantics should be the production baseline.

### 9.5 View Graph Requirement

View Graph is a required Browser Bridge capability for SPA and dynamic-page accuracy. A one-time DOM snapshot is a momentary picture; View Graph is the extension-maintained semantic map of the current browser view, its regions, controls, content items, routes, mutations, and stability.

Conceptual graph:

```text
View
  Route/document/view identity
  Regions: header, nav, sidebar, main, modal, form, list, table
  Nodes: controls, fields, links, content items, rows, cards
  Edges: contains, labels, same_group, filters, submits, navigates_to
  State: focus, selection, route revision, DOM revision, mutation quietness
```

View Graph must support:

- SPA route detection through `pushState`, `replaceState`, `popstate`, and `hashchange`.
- DOM mutation tracking with revision counters.
- mutation quiet waiting before authoritative observe.
- visible-text and interactive-element digests.
- region segmentation for main/nav/sidebar/modal/form/list/table scope.
- stable keys for continuity, without treating stable keys as security guarantees.
- action-time validation against expected view identity/digest.
- stale view/target errors that trigger daemon reobserve/re-resolve instead of unsafe execution.

View identity model:

```ts
type BrowserViewIdentity = {
  tabId?: number | string;
  windowId?: number | string;
  documentId?: string;
  frameId?: number;
  url: string;
  routeKey: string;
  historyIndex?: number;
  viewRevision: number;
  domRevision: number;
  capturedAt: string;
  mutationQuietMs: number;
};
```

View node model:

```ts
type ViewNode = {
  nodeId: string;
  stableKey: string;
  kind: "view" | "region" | "control" | "content_item" | "form" | "field" | "list" | "row" | "modal";
  role?: string;
  name?: string;
  text?: string;
  href?: string;
  selector?: string;
  bbox?: Rect;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  affordances: ("read" | "activate" | "type" | "select" | "scroll")[];
  riskHints: string[];
  regionId?: string;
  parentId?: string;
  siblingIds?: string[];
};
```

View edge model:

```ts
type ViewEdge = {
  from: string;
  to: string;
  kind: "contains" | "labels" | "controls" | "describes" | "near" | "same_group" | "opens" | "filters" | "submits" | "navigates_to";
  confidence: number;
};
```

Action commands should carry both a selected node and the original semantic reference:

```ts
type BrowserActionCommand = {
  requestId: string;
  action: "click" | "type" | "scroll";
  targetNodeId?: string;
  targetReference: {
    text: string;
    role?: string;
    region?: string;
    affordance: string;
  };
  expectedView: BrowserViewIdentity;
  expectedDigest: {
    routeDigest: string;
    textDigest: string;
    interactiveDigest: string;
    layoutDigest?: string;
  };
};
```

This is required for pages where text labels repeat, controls move after hydration, or React/Vue/Next route state changes without a full document reload.

## 10. Daemon Requirements

The daemon should own Browser Action semantics and treat extension observations as adapter evidence.

Required daemon work:

- extension bridge status store
- heartbeat/status endpoints
- queue state that supports command-first observe and execute
- command expiry and cancellation
- clear unavailable states:
  - extension not installed or not polling
  - daemon URL mismatch
  - site permission missing
  - active tab unavailable
  - restricted browser page
  - result post failed
- automatic observe before direct or prompt-driven actions
- adapter auto-selection with extension as active-tab bridge when available
- protocol events that map technical states to user-facing status

The daemon must continue to enforce:

- safety policy
- saved browser permissions
- target resolution
- approval
- audit
- verification
- secret redaction

## 11. Widget UX Requirements

The widget should hide snapshot mechanics.

Default Browser Action UI should show:

- Browser connected/disconnected
- Current tab available/permission needed
- Read current page
- Click
- Type/fill
- Scroll
- Navigate/search
- Cancel

Advanced/debug UI should be collapsed:

- adapter status
- raw extension diagnostics
- CDP endpoint
- Playwright managed browser
- native host
- audit/debug details

When a user asks a natural prompt:

```text
click More information on the current page
```

the widget/daemon flow should be:

```text
ensure extension bridge connection
ensure current site permission
observe current tab automatically
resolve target
run safety policy
request approval if needed
execute
reobserve
verify
reply
```

## 12. Safety and Privacy Requirements

- No hidden side effects.
- Low-confidence read/scroll may proceed with uncertainty.
- Low-confidence side-effect actions must clarify.
- Submit/delete/send/post/publish/pay/purchase/auth/password/token/file upload/download/cross-origin side effects/permission prompts require confirmation unless explicit saved policy covers them.
- Never persist password/token/payment/cookie/credential values.
- Sensitive fields should be redacted before leaving the page context.
- `evaluate` remains explicit `full_control_dev` only.
- Extension popup/settings must not normalize unsafe full-control use.

## 13. Migration Requirements

During migration:

- preserve package/smoke compatibility
- preserve native host fallback
- keep legacy `POST /providers/dom/snapshot` support for tests and debugging
- remove legacy snapshot button from default user flow
- update extension store text/review notes to describe Browser Bridge behavior
- update smoke tests to prove command-first execution
- keep a temporary debug snapshot command only if hidden behind diagnostics/dev mode

Final user-facing state:

- no "snapshot" button
- no required extension click before action
- no required DOM menu snapshot step

## 14. Recommended Implementation Sprints

### Sprint 1: Handoff, Protocol, and State Model

Deliver:

- this handoff
- extension bridge settings/status types
- daemon base URL normalization helpers
- extension heartbeat/status protocol shape
- roadmap and durable context updates

Acceptance:

- docs describe the intended snapshotless UX
- tests cover daemon base URL normalization
- no product behavior change required yet

### Sprint 2: Extension Popup and Options

Deliver:

- `default_popup` in manifest
- popup HTML/JS/CSS
- options page updated from snapshot URL to daemon base URL
- toggles for auto-connect, site permission, safe read/scroll, require approval, native host fallback
- connection test button

Acceptance:

- clicking extension icon opens popup and does not send a snapshot
- popup shows connected/disconnected state
- daemon URL save/reset/test works
- options smoke covers URL normalization and settings persistence

### Sprint 3: Badge and Heartbeat

Deliver:

- badge state manager
- daemon health check
- extension heartbeat endpoint
- daemon extension status store
- widget status derived from heartbeat

Acceptance:

- badge reports OFF/IDLE/RUN/ASK/ERR in smokeable paths
- daemon status changes when heartbeat arrives/expires
- widget can show browser bridge connected/disconnected without manual snapshot

### Sprint 4: Command-First Extension Channel

Deliver:

- background polling loop
- command poll payload with active tab and permission state
- observe command support
- execute command support using existing typed action executor
- result posting with before/after observations
- cancellation/expiry handling

Acceptance:

- daemon can queue observe/action command without prior snapshot
- extension executes command after polling
- result includes before/after observation
- no extension icon click required
- result post failure is visible

### Sprint 5: Site Permission Flow

Deliver:

- optional origin permission request for current site
- popup `Enable this site` toggle
- missing-permission error path
- widget status/error text for permission-required state

Acceptance:

- extension does not execute without permission
- user can enable current site from popup
- after permission, command-first observe/action succeeds
- restricted pages still report unsupported state

### Sprint 6: Widget UX Simplification

Deliver:

- remove snapshot-centric language from default Browser Action UI
- collapse adapter/debug controls behind advanced diagnostics
- direct UI actions automatically observe before executing
- prompt-driven actions use extension bridge availability/status
- recovery messages for disconnected/permission-required states

Acceptance:

- user can run simple read/click/type/scroll from widget without manual snapshot
- natural-language Browser Action does not require DOM menu prep
- adapter details are available but not primary

### Sprint 7: Compatibility, Store Copy, and Smokes

Deliver:

- extension smoke updated for popup, badge, heartbeat, command-first action, permission states
- native-host smoke compatibility
- DOM provider legacy smoke remains passing
- package smoke passes
- README/store-listing/review-notes/privacy updates

Acceptance:

- `npm run smoke:extension`
- `npm run smoke:browser-native-host`
- `npm run smoke:dom`
- new browser bridge smokes
- extension package remains valid MV3

### Sprint 8: Dogfood and Completion

Deliver:

- real dogfood evidence with no manual snapshot click
- extension active-tab read
- extension active-tab click
- permission-required then enable-site recovery
- disconnected daemon recovery
- widget prompt-driven action
- direct widget action
- updated durable context/report

Acceptance:

- dogfood proves the intended UX:
  - install extension
  - configure connection/site permission
  - operate browser from widget without snapshot step
- semantic acceptance is based on real action evidence, not only smoke checks

### Sprint 9: Request-Scoped Observe and Long-Poll

Deliver:

- `/browser-action/extension/wait` long-poll endpoint
- `observe_now` command type with request id and expected active-tab metadata
- prompt/direct Browser Action path that waits for a request-scoped fresh observation before resolving
- alarm polling retained as recovery fallback
- timeout/cancel/retry semantics for pending observe/action commands

Acceptance:

- tab switch followed immediately by prompt does not execute against the previous tab snapshot
- same-tab navigation followed immediately by prompt waits for the new page observation
- stale or missing observation produces a visible recovery message, not false target clarification
- smokes cover command wait timeout, stale snapshot guard, and alarm fallback

### Sprint 10: View Identity and SPA Stability

Deliver:

- observation identity fields on Browser Bridge snapshots
- document/navigation identity where browser APIs provide it
- content-script route hooks for `pushState`, `replaceState`, `popstate`, and `hashchange`
- `viewRevision` and `domRevision`
- mutation quiet tracking and `mutationQuietMs`
- visible text and interactive element digests

Acceptance:

- React/SPA fixture route changes invalidate stale observations even when `tabId` and document stay the same
- action execution rejects `stale_view` when expected view identity/digest no longer matches
- daemon reobserves and re-resolves once for safe stale-view recovery

### Sprint 11: View Graph Schema and Region Segmentation

Deliver:

- optional `viewGraph` field on Browser observations
- `ViewNode` and `ViewEdge` schema
- region segmentation for header/nav/sidebar/main/modal/form/list/table/repeated rows
- labels/same_group/filters/submits/navigates_to edge inference
- privacy-safe redaction for text, form values, and sensitive fields

Acceptance:

- repeated-label fixture distinguishes main-region controls from sidebar/content links
- form fixture links labels, fields, and submit controls without persisting secrets
- modal fixture scopes actions to the active modal before background page controls

### Sprint 12: Semantic Interface View Graph Resolver

Deliver:

- Semantic Interface adapter that consumes View Graph features
- target ranking features for region relevance, group relations, affordance, visibility, focus, and historical continuity
- action-time semantic re-resolve against the latest view graph
- redacted trace evidence that explains selected node, alternatives, stale-view decisions, and ambiguity

Acceptance:

- `개념글`-style duplicate text resolves to the intended filter/control by region/affordance
- React/SPA fixture survives dynamic ids, hydration drift, and route changes
- low-confidence side-effect actions clarify instead of acting
- dogfood evidence proves prompt-driven SPA/browser tasks, not only static deterministic pages

## 15. Verification Gate

Implementation result:

- Extension popup/options: complete. The extension action opens a Browser Bridge popup and no longer triggers snapshot capture in the default flow.
- Badge/heartbeat/status: complete. The service worker publishes OFF/IDLE/RUN/ASK/ERR badge states, daemon heartbeat/status endpoints normalize bridge state, and the widget receives `browserExtensionBridge.status`.
- Command-first bridge channel: complete for the extension MVP. The extension polls the daemon while auto-connect is enabled, auto-observes approved sites through the internal legacy DOM provider transport, executes queued typed Browser Action commands without manual icon clicks, posts before/after observations, and preserves native-host and `/providers/dom/snapshot` compatibility.
- Site permission flow: complete. The popup can request permission for the current origin; missing permission and restricted pages produce explicit recovery states.
- Widget UX simplification: complete. Browser mode foregrounds bridge state and direct actions; adapter/debug detail is collapsed behind diagnostics.
- Dogfood evidence: recorded at `docs/reports/browser-extension-bridge-dogfood-evidence-2026-05-08.md`.
- Remaining external blockers: first-class Codex app-server custom Browser Action tools and executable Windows UI Automation browser-chrome fallback remain outside this extension bridge scope and are tracked in Browser Action handoffs.
- Required follow-up: request-scoped fresh observation, long-poll command delivery, and View Graph are not optional polish. They are required for production Browser Action accuracy on tab switches, same-tab navigation, SPA route changes, hydration drift, and duplicate-label pages.

Required verification:

```text
npm run lint
npm run build:web
npm run smoke
npm run smoke:browser-action
npm run smoke:browser-action:e2e-control
npm run smoke:browser-action:renderer
npm run smoke:browser-action:direct-menu
npm run smoke:browser-action:prompt-classification
npm run smoke:browser-action:playwright
npm run smoke:browser-action:cdp
npm run smoke:browser-action:evaluate
npm run smoke:browser-action:native
npm run smoke:extension
npm run smoke:browser-bridge
npm run smoke:browser-native-host
npm run smoke:dom
npm run smoke:app-server
npm run dogfood:browser-bridge
npm run dogfood:browser-action:e2e
applicable cargo checks for touched Tauri/Rust code
UTF-8/mojibake checks for touched text files
npm run vibe:checkpoint
```

## 16. Completion Criteria

The goal is complete only when:

- the extension icon opens a connection/settings popup and no longer triggers snapshot capture in the default flow
- the extension badge shows widget/browser bridge state
- daemon base URL is configurable and tested
- extension heartbeat/status is visible to daemon and widget
- Browser Action observe/execute can run through the extension without a prior manual snapshot
- missing site permission produces a clear popup/widget recovery path
- widget direct actions and natural prompts automatically observe before action execution
- default widget UI hides snapshot and adapter/debug complexity
- existing Browser Action, extension, DOM provider, native-host, Playwright, CDP, and app-server smokes are not regressed
- real dogfood evidence proves the snapshotless Browser Bridge UX
- durable context files reflect the completed state

## 17. Stop Conditions

Stop only when the Browser Bridge UX is complete by the criteria above, or when a real blocker requires scope expansion.

If blocked, record:

- item
- reason
- attempted path
- required scope expansion
- verification evidence

Do not silently downgrade back to a manual snapshot UX.
