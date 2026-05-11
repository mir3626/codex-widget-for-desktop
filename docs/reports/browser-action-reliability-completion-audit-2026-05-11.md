# Browser Action Reliability Foundation Completion Audit

Generated: 2026-05-11

## Objective

Complete the Browser Action reliability foundation from
`docs/plans/browser-action-reliability-foundation-handoff.md` across ten
workstreams:

1. Browser Action Runtime Stabilization
2. Browser Action Verification v2
3. Browser Intent Transaction Hardening
4. Live Browser Action Test Harness
5. Browser Perception Scheduler
6. Semantic Interface v2 Integration
7. Semantic Memory Feedback Loop
8. Browser Action UX Simplification
9. App-Server / Agent Tool Contract
10. Architecture Cleanup / Module Boundary Hardening

## Prompt-To-Artifact Checklist

| Requirement | Concrete evidence | Verification |
| --- | --- | --- |
| Handoff document exists and is marked complete | `docs/plans/browser-action-reliability-foundation-handoff.md`; `docs/plans/sprint-roadmap.md` iter-24 | inspected and updated |
| Runtime state is predictable across prompt/direct/extension/history paths | `providers/browser-dom-extension/bridge/action-channel.js`; `src/daemon/server/browser-action/promptPlanState.ts`; extension defaults in popup/options | `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, live run below |
| History actions do not double-run or fail solely on expected URL changes | source mismatch handling in extension action channel and prompt retry state | `npm run smoke:browser-action:transaction-verification`; live `local-back-*`, `local-forward-single-step` |
| Navigate verifies requested destination | `src/daemon/browser-action/interaction/verificationResolver.ts` | `npm run smoke:browser-action:transaction-verification` |
| Wrong clicks fail when expected effect is not proven | `verificationResolver.ts` expected-effect checks | `npm run smoke:browser-action:transaction-verification` |
| Feedback/questions do not execute as actions | `src/daemon/browser-action/intentResolver.ts` | `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action:e2e-control` |
| Transaction candidate generation handles numeric ids, ordinals, representative content | `src/daemon/browser-action/intentResolver/contentRequests.ts`; `src/daemon/browser-action/interaction/candidateStep.ts` | `npm run smoke:browser-interaction-transaction` |
| Clarification/transaction flow remains concrete and resumable | `src/daemon/server/browser-action/clarification.ts`; interaction choice card renderer from prior iter | `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-action:renderer` |
| Live test harness exists and classifies failures | `scripts/browser-action-live-runner.mjs`; `scripts/smoke-browser-action-live-harness.mjs`; `docs/dogfood/browser-action-live-testing.md` | `npm run smoke:browser-action:live-harness`; live report below |
| Perception scheduler prepares active-tab context ahead of prompts | `src/daemon/browser-perception/service.ts`; `src/daemon/server/http/routes/browserBridgeRoutes.ts`; `src/daemon/server/ws/browserBridgeMessages.ts` | `npm run smoke:browser-perception`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-bridge` |
| Scheduler avoids background/foreground contention | foreground priority and in-flight background dedupe in `BrowserPerceptionService` | `scripts/smoke-browser-perception.mjs` background scheduler test |
| No-waiter observe results update prepared context | `completeObserveResult()` background ingestion path | `npm run smoke:browser-perception`; `npm run smoke:browser-bridge` |
| Semantic Interface v2 evidence is integrated | `src/daemon/semantic-interface/`; Browser Action target resolver and prepared-context adapters | `npm run smoke:semantic-interface`, `npm run smoke:browser-action:semantic-live-corpus` |
| Semantic Memory feedback remains advisory but influences ordering | `src/daemon/browser-action/interaction/candidateStep.ts`; `src/daemon/semantic-interface/memory/` | `npm run smoke:semantic-memory`; transaction core memory-ranking smoke |
| UX hides raw internal receipts and opens links externally | `src/daemon/server/browser-action/presentationPrompt.ts`; `src/renderer/components/ConversationPanel.tsx` | `npm run smoke:browser-action:renderer`, live answer forbid checks |
| Direct UI surface still works | `src/renderer/components/BrowserActionMenu.tsx`; renderer/direct command path | `npm run smoke:browser-action:direct-menu` |
| Agent tool boundary is explicit and not prompt-only | `src/daemon/agent-tools/browserActionTool.ts`; `src/daemon/agent-tools/appServerClientTool.ts`; `docs/architecture/agent-tool-runtime.md` | `npm run smoke:architecture-foundations`, `npm run smoke:app-server` |
| Official app-server client-tool is not silently claimed complete | `docs/architecture/open-blockers.md` records `BLOCKED` official contract | inspected; `smoke:architecture-foundations` asserts blocked fallback |
| Architecture boundaries are guarded | module split from prior iter plus source-size budgets in `scripts/smoke-architecture-foundations.mjs` | `npm run smoke:architecture-foundations`, `npm run smoke:all` |
| UTF-8/mojibake integrity preserved | `git diff --check`; changed-file mojibake scan | passed |
| Durable context updated | `.vibe/agent/handoff.md`, `.vibe/agent/session-log.md`, `.vibe/agent/sprint-status.json`, `.vibe/agent/iteration-history.json`, project report | `npm run vibe:checkpoint` |

## Live Evidence

`npm run dogfood:browser-action:live -- --run-id iter24-scheduler-memory-isolated-20260511`
passed 8/8 isolated scenarios:

- `local-concept-random-post`: pass, 644ms
- `local-current-page-read`: pass, 136ms
- `local-back-fast-path`: pass, 325ms
- `local-back-single-step`: pass, 341ms
- `local-forward-single-step`: pass, 356ms
- `local-navigate-always-allow-prime`: pass, 367ms
- `local-navigate-always-allow-grouped`: pass, 1871ms
- `local-navigate-always-allow-reuse`: pass, 357ms

Report path:
`docs/reports/browser-action-live-report-iter24-scheduler-memory-isolated-20260511.md`

Tracked semantic-live summary rows were added to:
`docs/dogfood/browser-action-semantic-live-corpus.jsonl`

## Verification Commands

Passed during the completion pass:

- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `npm run smoke:all`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-action:fresh-context`
- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-action:transaction-clarification`
- `npm run smoke:browser-action:transaction-verification`
- `npm run smoke:browser-action:transaction-concurrency`
- `npm run smoke:browser-action:renderer`
- `npm run smoke:browser-action:direct-menu`
- `npm run smoke:browser-action:live-harness`
- `npm run smoke:browser-action:semantic-live-corpus`
- `npm run smoke:browser-perception`
- `npm run smoke:browser-perception:extension-command`
- `npm run smoke:browser-perception:stabilization`
- `npm run smoke:browser-bridge`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:semantic-interface`
- `npm run smoke:semantic-memory`
- `npm run smoke:architecture-foundations`
- `npm run smoke:app-server`
- `npm run dogfood:browser-action:live -- --run-id iter24-scheduler-memory-isolated-20260511`
- `git diff --check`
- changed-file mojibake scan
- `npm run vibe:checkpoint`

## Remaining Follow-Up

These are not blockers for the ten-workstream implementation but should remain
visible:

- Reload the unpacked Browser Bridge extension before manual live retesting so
  the updated popup/service-worker files are active.
- Run a real installed-extension `real` mode dogfood pass after extension
  reload if the product owner wants evidence against the current personal
  browser tab rather than the isolated runner.
- Official Codex app-server client-tool integration remains `BLOCKED` until a
  stable contract exists; the daemon simulated tool runtime is the supported
  production path for now.
- Live Windows UI Automation/browser-chrome execution was outside this Browser
  Action reliability goal at the time of the audit. It is now superseded by the
  bounded helper implemented at
  `providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`;
  signed/native hardening remains future work.
- Semantic Memory weights are deliberately conservative. More live data should
  tune the advisory contribution, but memory must not override safety or
  freshness gates.
