## Iteration iter-19: Browser Perception Interface

Status: complete.

Carryover: Iteration 18 completed Browser View Graph v2, but live dogfood still showed that prompt execution can race ahead of a fresh active-tab observation and return "Browser Bridge is reading the page; try again later." Iteration 19 implemented the Browser Perception interface that owns request-scoped fresh observation, extension observe acknowledgements, SPA stabilization, prepared context storage, and Browser Action integration.

### iter-19-sprint-01-context-store-and-request-scoped-observe

Goal: add the daemon-side `PreparedBrowserViewContext` store and bounded `ensureFreshContext` API.

Expected scope: context identity, freshness/stability policy, active-tab context storage, ProviderRegistry prepared observation bridge, and smoke fixtures for fresh/stale/settling context decisions.

Status: complete. Added `PreparedBrowserViewContext`, `PreparedBrowserViewContextStore`, source identity helpers, freshness/stability policy, and `BrowserPerceptionService.ensureFreshContext()`. Provider snapshots now feed Browser Perception context, and smoke fixtures cover fresh, stale, settling, blocked, and permission-required decisions.

### iter-19-sprint-02-extension-command-ack-and-long-poll-observe

Goal: make extension observe commands explicit, acknowledged, cancellable, and timeout-aware.

Expected scope: daemon observe command queue, extension long-poll or upgraded poll delivery, fast ack/result separation, timeout/cancel handling, permission/restricted/wrong-tab results, and legacy DOM snapshot compatibility.

Status: complete. Browser Bridge poll can now return `observe_now` commands before action commands. The extension posts fast acknowledgements to `/browser-action/extension/ack`, posts observe results to `/browser-action/extension/observe-result`, preserves legacy `/providers/dom/snapshot`, and handles missing permission, restricted pages, wrong tab/window, result post retry, timeout, and error states.

### iter-19-sprint-03-spa-stabilization-and-active-tab-dirty-signals

Goal: handle same-tab URL/query/history/mutation changes before Browser Action resolves targets.

Expected scope: content-script mutation/history tracking, active context dirty invalidation, stabilization thresholds, query-transition smoke coverage, and React-style mutation-after-load fixtures.

Status: complete. Browser Bridge snapshots now include top-level mutation revision, last mutation timestamp, and mutation quiet duration. Browser Perception treats read-only settling contexts differently from side-effect contexts, queues fresh observation when mutation quietness is insufficient, and smoke coverage verifies same-tab query/mutation revision updates.

### iter-19-sprint-04-browser-action-prompt-direct-integration

Goal: ensure prompt and direct Browser Action paths consume request-scoped Browser Perception before planning or side-effect execution.

Expected scope: prompt runner `ensureFreshContext` integration, side-effect re-resolve against the latest graph, progress events while perception is pending, and a regression smoke for the previous retry-later message.

Status: complete. Prompt, direct-command, direct-observe, and plan execution paths now call Browser Perception before extension-backed planning/execution. Connected/allowed prompt flows emit `browser_perception_waiting` progress, wait for a bounded `observe_now` result, and no longer return the old retry-later text as the final answer in the fresh-context smoke.

### iter-19-sprint-05-semantic-evidence-and-verification-refresh

Goal: publish prepared context evidence to Semantic Interface and update Browser Action verification around legitimate route/query transitions.

Expected scope: prepared context evidence packets, Semantic Memory scope/read-set alignment, graph transition verification, and dogfood evidence for filter -> representative content flow without site-specific rules.

Status: complete. Prepared contexts carry View Graph v2 route key, view revision, mutation revision, freshness, stability, and graph digest into the Browser Action observation path already consumed by Semantic Interface and Semantic Memory. Dogfood evidence covers a generic dynamic board filter -> representative content flow without site-specific rules.

### iter-19-sprint-06-ux-diagnostics-and-completion

Goal: make perception waiting visible as progress rather than as a failed final answer.

Expected scope: compact renderer perception states, diagnostics for command ack/result/freshness, full verification, project report refresh, durable context updates, and checkpoint.

Status: complete. Browser Perception waiting now appears as Browser Action progress, while true permission/restricted/disconnected/timeout states produce actionable failure text. Added focused smokes and dogfood evidence, refreshed durable context/report state, and ran checkpoint.
