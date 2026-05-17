## Iteration iter-17: Browser Action Runtime Closure

Carryover: Iteration 16 completed the View Graph and Semantic Memory implementation on paper and in smoke coverage, but live dogfood still shows prompt-driven Browser Action failures after view transitions and ambiguous semantic targets. This iteration follows the user-requested order `2 -> 3 -> 1 -> 6 -> 7 -> 5`: verify and close View Graph runtime gaps, verify Semantic Interface/Memory live integration, fix prompt-driven Browser Action execution failures, refresh dogfood evidence, continue agent-friendly refactors, and then simplify the UX around the remaining behavior.

### iter-17-sprint-01-view-graph-runtime-audit

Goal: audit actual View Graph runtime behavior against dynamic pages, URL/query changes, SPA route changes, tab/source validation, and execute-time reobserve behavior.

Dependencies: iter-16 View Graph implementation, Browser Bridge auto-observe/long-poll path, Browser Action extension command channel.

Expected scope: inspect View Graph identity/digest propagation from extension snapshot through daemon observation, verify command expected-source metadata is updated after each step, add or extend regression smoke coverage for URL/query/view transitions, and record missing gaps before changing resolver behavior.

Status: complete. Audited the live View Graph/source boundary and closed the highest-risk runtime gap: prompt multi-step execution now retries once from the refreshed active observation when the extension reports an expected-source URL/tab/window mismatch. Browser Bridge poll requests now refresh daemon-visible active-tab status, so stale snapshot guards are no longer heartbeat-only. Regression coverage was added to `npm run smoke:browser-action:e2e-control` and `npm run smoke:browser-bridge`.

### iter-17-sprint-02-semantic-interface-memory-live-audit

Goal: verify that Semantic Interface and Semantic Memory affect the live Browser Action target resolver as typed evidence, not only fixture/test paths.

Dependencies: iter-17-sprint-01, Semantic Interface Browser Action adapter, Semantic Memory read-set plumbing.

Expected scope: confirm View Graph evidence, memory read sets, unresolved-case recording, and target fingerprints appear in live prompt resolution traces; fix integration gaps that cause repeated Korean/browser commands to fall back to low-confidence clarification unnecessarily.

Status: complete. Verified Semantic Interface and Semantic Memory live paths with `npm run smoke:semantic-interface`, `npm run smoke:semantic-memory`, `npm run dogfood:semantic-interface`, and `npm run dogfood:semantic-memory`. The live representative-content resolver was tightened so vague content requests prefer article/content links and reject utility/profile/category/comment anchors instead of falling back to low-confidence or unsafe targets.

### iter-17-sprint-03-prompt-driven-browser-action-failure-fixes

Goal: remove the live failures observed for commands such as `개념글 눌러서 재밌어보이는 글 보여줘` and follow-up click/read requests.

Dependencies: sprints 01-02, Browser Action planner/session executor, extension command queue.

Expected scope: ensure each prompt/direct action starts from a request-scoped fresh observation, multi-step plans reobserve and re-resolve after navigation/filter changes, expected-source guards reject only real stale-source mistakes, and low-confidence side-effect actions produce useful clarification instead of opaque execution receipts.

Status: complete. Fixed prompt-driven failure modes seen in dogfood: expected-source mismatch after URL/query changes now triggers a refreshed-observation retry, and representative-content target resolution no longer selects generic utility links such as points/profile/category/comment badges. Failure and clarification responses now avoid opaque execution receipts.

### iter-17-sprint-04-dogfood-matrix-refresh

Goal: collect updated evidence for the fixed Browser Action semantic execution path.

Dependencies: sprint 03 fixes and working local Browser Bridge.

Expected scope: update Browser Action/Semantic Interface dogfood evidence for direct read, direct safe action, natural-language safe action, click-after-navigation, dynamic/SPAs where practical, risky deny, missing permission, and restricted-page boundaries.

Status: complete. Refreshed the relevant automated dogfood evidence with `npm run dogfood:browser-action`, `npm run dogfood:browser-action:e2e`, `npm run dogfood:semantic-interface`, and `npm run dogfood:semantic-memory`. Live-site manual verification remains recommended after reloading the unpacked extension because installed extension code is outside the daemon smoke boundary.

### iter-17-sprint-05-agent-friendly-refactor-followup

Goal: continue refactoring only where it improves future agent work without destabilizing the fixed runtime path.

Dependencies: sprints 01-04.

Expected scope: split remaining oversized Browser Action/renderer/extension modules around existing architecture boundaries, keep behavior stable, and skip files where extraction would add indirection without reducing maintenance risk.

Status: complete with no broad extraction. The previous large-file refactors are preserved. This sprint intentionally avoided additional structural churn while fixing the runtime path; the only follow-up cleanup was the narrow prompt presentation split needed to reduce receipt-style failures.

### iter-17-sprint-06-browser-action-ux-cleanup

Goal: simplify the Browser Action surface after runtime behavior is reliable.

Dependencies: sprints 01-05.

Expected scope: reduce receipt-like chat responses, hide advanced adapter/debug details by default, expose clear connected/permission/running/failed states, and make clarification/approval paths understandable without requiring manual snapshot or DOM-mode preparation.

Status: complete. Browser prompt responses now return clearer pending, clarification, and failure messages instead of defaulting to `plan/steps/latest result` receipts for those cases. Follow-up renderer work adds structured target clarification choice cards so ambiguous candidates can be selected directly instead of manually typing a number. Successful read/show flows continue to render the observed page content.
