# Handoff

## Current State

The project is a Tauri + React + Node daemon desktop widget. The native widget launches, Vite serves renderer assets during dev, and the daemon listens on `127.0.0.1:4128`.

## Latest Update: Browser Action History Command Latency Fix

Automated live regression after the previous candidate-clarity push found one remaining isolated failure: `local-back-fast-path` moved the target browser back to `/forum`, but the daemon prompt never completed before the 8s scenario timeout.

Root cause: Browser Bridge history actions already waited for the changed page observation inside `executeTabNavigationAction()`, then the outer command-first result path called `readPostActionSnapshot()` a second time using the already-changed snapshot as the fallback. For `back`/`forward`, that second wait required another changed observation that would never occur, adding about 6s and occasionally timing out before the daemon received the result.

Implemented fixes:

- `providers/browser-dom-extension/bridge/action-channel.js` now reuses `result.after` immediately for tab-navigation actions that already performed post-navigation observation.
- `scripts/browser-action-live-runner.mjs` now avoids classifying `"permission":"allowed"` artifacts as permission failures and records final URL/text/screenshot even when a scenario times out.
- Headed isolated live evidence `browser-action-back-fast-regression-20260511` passed `local-back-fast-path` in 357ms.
- Full headed isolated live evidence `browser-action-post-fix-regression-20260511` passed 8/8 scenarios; `back` was 381ms/1177ms and `forward` was 366ms.

Verification passed `npm run dogfood:browser-action:live -- --scenario local-back-fast-path --run-id browser-action-back-fast-regression-20260511`, `npm run dogfood:browser-action:live -- --run-id browser-action-post-fix-regression-20260511`, `npm run smoke:extension`, `npm run smoke:browser-bridge`, and `npm run smoke:browser-action`.

## Latest Update: Browser Action Candidate Clarity And Forward Regression

Follow-up hardening after manual Browser Action testing on 2026-05-11 addressed three live risks:

- View Graph v2 content-list selection now excludes pinned/notice/announcement/admin-style rows from representative content candidates instead of merely downranking them. This prevents vague requests such as "interesting post" from repeatedly opening a fixed notice row when normal article rows exist.
- Browser Action clarification output now renders candidates as readable multi-line summaries with localized role names and explicit selection aliases such as `1` or `첫번째`. Clarification resume accepts Korean/English ordinal words including `첫번째`, `두번째`, `first`, and `second`.
- The live Browser Action runner can now set up browser history with `setupHistoryBack`, enabling deterministic forward-history testing. Added `local-forward-single-step`; headed live dogfood `browser-action-forward-regression-20260511` passed in 6616ms. Headless extension execution remains unavailable because the Manifest V3 service worker is not started in that path.

Verification passed `npm run build:daemon`, syntax checks for the changed smoke/runner scripts, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-view-graph-v2`, JSONL scenario parsing, and headed `npm run dogfood:browser-action:live -- --scenario local-forward-single-step --run-id browser-action-forward-regression-20260511`.

## Latest Update: Browser Action Deterministic Back And Ordinal Content

Manual DB/log review on 2026-05-11 found two separate Browser Action failures:

- `뒤로가기` sometimes acted in the browser but returned a stale widget answer because the Browser Bridge accepted the pre-navigation snapshot once `readyState=complete` was observed.
- Repeating `4번글 눌러줘` was nondeterministic because the intent resolver collapsed the request to `대표 글`, candidate metadata allowed representative-content ties to proceed, and late target resolution could choose a different element than the selected transaction candidate.

Implemented fixes:

- Browser Bridge tab navigation actions now wait for changed URL/route/view-revision evidence for `navigate`/`back`/`forward`; unchanged back/forward observations return a failed execution instead of a stale success.
- Browser Action verification now fails `back`/`forward` when the observed page does not change.
- Content-open intent parsing preserves ordinal requests such as `4번글`, `첫번째 글`, and `맨 윗 글` as `N번째 글`.
- Candidate generation has an ordinal content-list path that filters utility/count/category links, preserves content order, and binds the requested item number to a concrete candidate.
- Execution now uses the transaction-selected candidate as the action target for non-exact element actions, so the resolver revalidates rather than silently choosing a different representative element.
- Regression coverage was added for ordinal content intent/candidate selection, utility vote-link exclusion, and stale back verification.

Verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action:fresh-context`, `npm run smoke:browser-interaction-transaction`, `npm run smoke:browser-action:transaction-verification`, `npm run smoke:browser-view-graph-v2`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, and `npm run smoke:dom`.

Runtime was restarted after daemon/extension-bridge changes. Renderer is listening on `127.0.0.1:5173` with PID `101396`, daemon is healthy on `127.0.0.1:4128` with PID `112748`, and widget PID is `117036`.

Manual follow-up: reload the unpacked Browser Bridge extension before live browser retesting so Chrome/Edge uses the updated bridge `action-channel.js`.

## Latest Update: Browser Action Back Lease And Clarification UX

Manual widget testing on 2026-05-11 showed `뒤로가기` succeeded only 1/4 times and ambiguous target clarification candidates were hard to distinguish.

- Root cause for `뒤로가기`: the prompt was correctly classified as `back`, but `executeAction` treated `settling_ready` active-tab leases as invalid for all non-read side effects. Targetless browser-history actions do not need element grounding, so they now use `isBrowserViewContextLeaseUsableForAction()` and can proceed from a non-stale active-tab lease even while page understanding is settling.
- Stale/expired lease failures are no longer reported as generic target clarification. They fail with a freshness-specific message so the chat answer does not say the target was ambiguous when the real issue is page-understanding freshness.
- Target clarification responses now render richer candidate lines with role, visible label, region/landmark, approximate screen position, link path, nearby text, and element confidence. Users can answer with a number, visible label, region, or position hint.
- Clarification candidate matching now accepts the enriched summary and simple position/region hints such as `상단`, `본문`, `왼쪽`, or `nav`.
- Focused regression coverage was added for targetless `back` from a settling active-tab lease and enriched clarification candidate output.

Verification passed `npm run build:daemon`, `npm run smoke:browser-action`, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-interaction-transaction`, `npm run lint`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action:fresh-context`, `npm run smoke:semantic-interface`, UTF-8/mojibake scan for touched files, and `npm run build:web`.

## Latest Update: Browser Action Search Clarification Continuation

Public-site widget-UI dogfood is now green for the DCInside, FMKorea, Naver, and Google Browser Action matrix.

- Clarification resume now preserves the original prompt `BrowserActionPlan`, completed results, and step id, so selecting a clarified search field continues the remaining submit/search step instead of ending after the `type` action.
- Search intent parsing now separates the field target from the submit button target. Prompts such as `검색창에 '브라우저 액션 테스트' 입력하고 검색 버튼 눌러줘` produce `searchbox: 검색 -> button: 검색`, while branded labels such as `Google 검색 버튼` are preserved as `button: google 검색`.
- Candidate scoring now gives explicit requested-role evidence (`searchbox`, `button`, `link`) to the intended role and penalizes mismatches, reducing broad page/link competition for typed search flows.
- Late execution no longer lets an ambiguous pre-semantic candidate gate force confidence down when Semantic Interface has already selected the same browser element with high confidence.
- Browser safety now treats explicit search-submit buttons as safe search/navigation activations while keeping generic submit/payment/delete/send/upload/download/auth buttons protected.
- Focused smoke coverage was added for search intent/candidate gating and search-submit safety.

Latest public-site run: `docs/reports/browser-action-live-report-browser-action-public-sites-search-final-20260511.md`.

Result: 8 passed / 0 failed.

Verification passed `npm run lint`, `npm run smoke:browser-action`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-interaction-transaction`, and live widget-UI public-site dogfood. The Google-focused rerun `docs/reports/browser-action-live-report-browser-action-google-search-safe-submit-20260511.md` also passed after safe search-submit handling.

Runtime was restarted after daemon-side changes. Renderer is listening on `127.0.0.1:5173` with PID `91084`, daemon is healthy on `127.0.0.1:4128` with PID `104280`, and widget PID is `99348`.

## Latest Update: Browser Action Public-Site Widget UI Dogfood

Public-site Browser Action dogfood now has a reusable scenario file and runner support for isolated all-sites extension permission testing.

- Added `docs/dogfood/browser-action-public-sites-smoke.jsonl` with widget-UI prompts for DCInside, FMKorea, Naver, and Google.
- `scripts/browser-action-live-runner.mjs` now supports `--grant-all-site-permission`. The runner copies the unpacked extension into a temp directory, injects `http://*/*` and `https://*/*` host permissions into that temporary manifest, enables Browser Bridge `allowAllSites` for the temporary profile, and leaves the checked-in extension manifest unchanged.
- The widget-UI runner can now answer clarification input cards via `clarificationChoice` before continuing approval handling.
- Active-tab matching in the runner now tolerates same-origin/same-path URLs with browser-added query strings when the scenario expected URL had no query, which fixed Google `?zx=...` active-tab validation.
- Browser Action intent classification no longer treats direct filter/navigation clicks such as `개념글 눌러줘` as representative content-open requests. This fixed the public DCInside concept-tab scenario without adding site-specific rules.

Latest public-site run: `docs/reports/browser-action-live-report-browser-action-public-sites-live3-20260511.md`.

Result: 6 passed / 2 failed.

- Passed: DCInside read, DCInside concept click, FMKorea read, FMKorea back, Naver read, Google read.
- Failed: Naver search and Google search. Both failures reached clarification, selected the search combobox, and typed the requested query successfully, but clarification resume completed only that clarified `type` step and did not continue the original multi-step plan to submit/search. This is a real Browser Interaction Transaction follow-up: clarification resume needs to preserve and continue remaining candidate steps and emit a final user-facing completion after extension-backed clarified commands.

Verification for this change passed `node --check scripts/browser-action-live-runner.mjs`, `npm run lint`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action`, `git diff --check`, and mojibake scan.

Runtime was restarted after the daemon-side intent change. Renderer is listening on `127.0.0.1:5173` with PID `113488`, daemon is healthy on `127.0.0.1:4128` with PID `106840`, and widget PID is `115152`.

## Latest Update: Browser Bridge Observe Wake-Up

Follow-up live widget log review found one remaining Browser Action failure after the previous latency fix: connected/allowed Browser Bridge prompts could still time out waiting for a fresh active-tab observation because the extension WebSocket wake-up handler ignored `browser_perception_waiting` / `observe_queued` events. The handler now wakes command polling for fresh observe commands, prompt action commands (`plan_paused_for_extension`), approval/direct queued commands, and clarification-resume queued commands. Concurrent wake-ups are coalesced instead of dropped while a poll is already running.

`npm run smoke:browser-perception:extension-command` now exercises WebSocket command delivery for `observe_now` instead of the HTTP long-poll fallback. Focused verification passed `node --check` for the changed extension/smoke scripts, `npm run build:daemon`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, `npm run lint`, `npm run smoke`, `npm run smoke:browser-action`, and `npm run dogfood:browser-action:live -- --run-id browser-action-wakeup-final-20260511`. The final live report passed all seven isolated scenarios: current-page read 128ms, back 192/198ms, approval prime 337ms, grouped Always Allow passed, and reuse 204ms.

Manual follow-up: reload the unpacked Browser Bridge extension before retesting the installed browser extension, because `providers/browser-dom-extension/service-worker.js` changed.

## Latest Update: Browser Action Command Ack and Live Latency

Follow-up live-runner work addressed the latest Browser Action dogfood issues: slow/inconsistent `뒤로가기`, repeated approval prompts, and approval-result responses ending at the approval receipt.

- Extension action commands are now acked through `/browser-action/extension/action-ack` as soon as the Browser Bridge receives them.
- Daemon Browser Action commands are no longer destructively removed on poll response alone; they remain redeliverable until extension ack/result, which prevents Manifest V3 long-poll abort/response-loss races and avoids duplicate back/forward execution after ack.
- Browser Action command polling now prioritizes queued action commands over perception observe commands once the prompt has already planned an action.
- Prompt approvals now persist `always_allow` Browser Action policy labels and asynchronously update the original prompt message with the final action result after approval execution.
- The live runner now measures prompt-to-result latency separately from test setup, captures post-approval final messages, and includes a `local-back-single-step` scenario to prove `뒤로가기` executes once.
- Browser Bridge refresh now checks pending Browser Action commands before auto-observe so browser default actions and post-approval commands are not delayed behind snapshot work.
- Real-browser live-runner artifacts now redact active-tab answer/event/page strings by default; real-mode reports keep status, latency, IDs, and diagnostics without persisting the user's page content.

Latest focused verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-action:fresh-context`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, repeated `npm run dogfood:browser-action:live`, and `npm run dogfood:browser-action:live:real -- --scenario real-active-read`. Latest isolated live-runner report: `docs/reports/browser-action-live-report-browser-action-final-regression2-20260511.md` with prompt latencies around read 123ms, back 186-195ms, normal navigate reuse 183ms, and approval navigate 2803ms. Latest real-mode read report: `docs/reports/browser-action-live-report-browser-action-real-read-redacted2-20260511.md` passed in 556ms with redacted artifacts. The live daemon was restarted; `/storage/health` is ok on `127.0.0.1:4128` with daemon PID `60440`.

Manual follow-up: reload the unpacked Browser Bridge extension before retesting the installed browser extension, because extension bridge files changed.

## Latest Update: Browser Action Live Test Fixes

After live widget testing exposed Browser Action regressions, the prompt path has been tightened without adding site-specific rules.

- Extension-backed prompt commands now fail and remove their queued command if the Browser Bridge does not pick them up within the prompt wait window. This prevents stale commands from executing later against a new prompt/session.
- Representative content selection now rejects survey/notice/admin/event/guide/policy style rows in View Graph content-list representatives, transaction candidates, and semantic content target resolution.
- URL-less navigation requests such as fuzzy gallery/site names no longer turn into arbitrary current-page link clicks. Unknown destinations route to safe search navigation instead of misusing the active page.
- Candidate-gate ambiguity now overrides late resolver confidence for side-effect text targets, while exact element bindings still execute normally.
- Prompt responses now summarize completed browser actions in user-facing text instead of exposing raw `plan/steps/latest result` receipts; failures localize extension timeout, source-change, and target-resolution reasons.
- Chat markdown links now normalize `www.*` external URLs and prevent widget-internal navigation before opening them through the external URL bridge.
- Prompt command wait was reduced from 60s to 40s to improve worst-case response latency while still allowing one long-poll cycle plus browser action execution.

Verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-interaction-transaction`, Browser Perception focused smokes, `npm run smoke:browser-bridge`, `npm run smoke:extension`, `npm run smoke:dom`, `npm run smoke:semantic-interface`, `npm run smoke:semantic-memory`, and mojibake scan. Live daemon/widget were restarted; daemon PID is `78340`, widget PID is `105248`, Vite remains on `127.0.0.1:5173`, and `/storage/health` returned ok.

Manual follow-up: reload the unpacked Browser Bridge extension before retesting if Chrome/Edge still has an older service worker loaded.

## Latest Update: Browser Action Live Test Automation

Added Browser Action live dogfood automation so manual prompt testing no longer requires hand-copying logs for every failure.

- Added `scripts/browser-action-live-runner.mjs`.
- Added npm scripts:
  - `npm run dogfood:browser-action:live`
  - `npm run dogfood:browser-action:live:real`
- Added scenario/docs files:
  - `docs/dogfood/browser-action-live-scenarios.jsonl`
  - `docs/dogfood/browser-action-live-testing.md`
- `isolated` mode starts a temporary daemon, launches a dedicated Chromium profile with the unpacked Browser Bridge extension, configures the extension daemon URL, opens a local fixture page, sends widget-style Browser mode prompts over the daemon websocket, auto-responds to safe approvals, and writes failure packets with daemon events, bridge status, screenshots, and result JSON.
- `real` mode connects to the live daemon and installed Browser Bridge extension for the currently active user browser tab. This mode is for observing real browser progress; do not touch the active tab/window while a scenario is running.
- Default isolated scenarios now cover representative content opening and current-page read behavior.
- A live isolated run passed both default scenarios and wrote `docs/reports/browser-action-live-report-browser-action-live-final-20260510.md` plus assets under `docs/reports/assets/browser-action-live/browser-action-live-final-20260510/`.
- The live runner exposed one real Browser Action issue: representative-content requests with multiple valid content items were clarified too aggressively. `planningGate` now permits a top `content_list_representative` candidate when the user explicitly asks for representative/any/interesting content, while keeping non-representative ambiguous side-effect actions gated.

Verification passed `npm run lint`, `npm run build:web`, `npm run smoke:browser-action`, `npm run smoke:browser-interaction-transaction`, `npm run smoke:extension`, `node --check scripts/browser-action-live-runner.mjs`, `npm run dogfood:browser-action:live -- --dry-run`, and the headed isolated live runner. The live daemon/widget were restarted again after the daemon change; daemon PID is `105696`, widget PID is `66116`, and `/storage/health` returned ok.

## Latest Update: Browser Interaction Transaction

Iteration `iter-20` completed `docs/plans/browser-interaction-transaction-handoff.md`.

- Browser Action's resolver-first prompt path is now treated as insufficient for universal natural-language control; prompt/direct/clarification paths route through request-scoped `BrowserInteractionTransaction` metadata.
- Added `src/daemon/browser-action/interaction/` with transaction/lease types, fresh/stable lease helpers, intent frame construction, finite candidate generation from current browser evidence, deterministic planning gates, transaction management, expected-effect verification helpers, and Semantic Memory feedback publishing.
- Prompt runner, direct UI command handling, prompt plan continuation, and clarification resume now carry transaction ids, lease ids, candidate ids, view revisions, and graph digests into execution.
- Clarification resume reacquires fresh Browser Perception context before acting; it no longer blindly resumes against whichever DOM snapshot is latest.
- `resultVerifier` now checks expected effects so wrong clicks can fail even when an action returns a refreshed observation.
- Added `npm run smoke:browser-interaction-transaction`, `npm run smoke:browser-action:transaction-clarification`, `npm run smoke:browser-action:transaction-verification`, and `npm run smoke:browser-action:transaction-concurrency`.
- Dogfood report: `docs/reports/browser-action-dogfood-evidence-2026-05-10.md`.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting because extension service-worker/bridge files changed.

## Current Readiness Snapshot

- 2026-05-06T07:22:23.060+09:00 strict `node scripts/release-readiness.mjs --require-manual-gates` re-check passed all automated release, resource, store-packet, and two-hour soak gates except the external browser-store submission gate.
- 2026-05-06T08:56:59.660+09:00 product owner deferred actual Chrome Web Store / Microsoft Edge Add-ons dashboard submission until after dogfooding; the release-channel readiness objective closed with that task deferred.
- 2026-05-06T12:27:12.372+09:00 a new active goal was registered: all follow-up work should proceed through `/vibe-iterate`, with Iteration `iter-3` focused on daemon-owned SQLite state, recoverable sessions/tabs/trash, artifact history, activity logs, Vision recording/streaming, and extensible theme/mascot/module foundations.
- 2026-05-06T13:37:00.000+09:00 `iter-3-sprint-03-artifact-activity-ledger` completed: daemon-owned artifact/activity ledger APIs, blob-backed tool-output and file-change artifact records, chat and trash artifact viewers, activity detail UI, and storage/daemon/renderer smoke coverage are in place. Next active sprint is `iter-3-sprint-04-vision-streaming-and-ux-foundation`.
- 2026-05-06T14:07:59.836+09:00 `iter-3-sprint-04-vision-streaming-and-ux-foundation` completed: Vision popup actions, WebM recording metadata/blob preservation, metadata-only Agent screen stream with low-frequency frame delivery to the daemon Vision snapshot endpoint, guardrails, and status-aware mascot hooks are implemented. The planned Iteration 3 sprint set is complete.
- 2026-05-06T14:44:38.519+09:00 product owner clarified that the `/goal` directive means repeated `/vibe-iterate` execution until the categorized dogfooding backlog is actually closed, not stopping after Iteration 3. Durable state now treats Iteration 4 as active; the external goal tool was prematurely marked complete and cannot be reverted from the available API.
- 2026-05-06T14:58:00.000+09:00 `iter-4-sprint-01-ui-polish-and-tab-interactions` completed: resize hit areas, minimum-width model/reason controls, 12px user bubbles, active session tab polish, branch-to-new-session toast, and model/reason session-switch pulse are implemented with renderer smoke coverage.
- 2026-05-06T15:12:00.000+09:00 `iter-4-sprint-02-widget-context-agent-awareness` completed: each Agent turn now receives a daemon-owned widget capability context covering current mode, model/reasoning, sanitized auth, provider statuses, controls, Vision/DOM/PTY use cases, and safety boundaries across app-server, exec, and OAuth proxy paths.
- 2026-05-06T15:19:22.339+09:00 `iter-4-sprint-03-artifact-rendering-and-version-browser` completed: artifact files now include file type icons, bounded text/image previews, current-version metadata, version accordions, and versioned open requests reused by both chat and trash artifact viewers.
- 2026-05-06T15:34:46.947+09:00 `iter-4-sprint-04-vision-voice-interactive-loop` completed: Vision tools now separate snapshot/WebM recording/Agent share, persist cadence and duration controls, retain consent/retention metadata in daemon stream records, dismiss on outside click/Escape, and expose a Web Speech API voice prompt input boundary.
- 2026-05-06T15:43:32.772+09:00 `iter-4-sprint-05-pty-popup-and-mascot-persona` completed: PTY now has an inline use-case/connection guide, a terminal-focused popout entry point on the same daemon port, and Default Dog mascot persona/tone is injected into Agent widget context. The Iteration 4 planned sprint set is complete.
- 2026-05-06T16:04:18.953+09:00 Iteration `iter-5` started to close the remaining feasible backlog: durable app-server thread rebinding, provider snapshot history UI, Vision resource tuning, and final completion audit.
- 2026-05-06T16:22:00.000+09:00 `iter-5-sprint-01-durable-app-server-thread-rebinding` completed: the daemon now persists and rebinds Codex app-server thread ids per durable session, retries stale thread ids safely, and smoke coverage verifies separate internal sessions keep separate app-server threads.
- 2026-05-06T16:38:00.000+09:00 `iter-5-sprint-02-provider-snapshot-history-ui` completed: DOM, Vision, and Terminal provider snapshots are now stored as redacted ledger history and rendered in the Activity detail popover.
- 2026-05-06T16:52:00.000+09:00 `iter-5-sprint-03-vision-resource-and-retention-tuning` completed: Agent screen share now drops overlapping frame ticks, reports skipped frames, avoids duplicate stop messages, cleans up media/frame resources on terminal provider states, and records effective guardrail metadata.
- 2026-05-06T16:53:00.000+09:00 `iter-5-sprint-04-completion-audit-and-readiness-update` completed: roadmap, milestones, iteration history, handoff, session log, and project report state now classify all remaining work. The active vibe-iterate goal has no further feasible non-dogfood implementation backlog.
- 2026-05-06T21:59:00.000+09:00 smoke-test storage isolation was corrected after dogfooding exposed `smoke test` tabs in the real widget DB. Daemon/release smoke scripts now run with temp app-data paths, the real DB was backed up, smoke sessions/artifacts were removed, and `npm run smoke:all` passed without re-polluting the widget DB.
- 2026-05-06T22:18:28.179+09:00 dogfood UI polish follow-up completed: Vision menu alignment, Settings capture behavior, right resize/scrollbar hitboxes, trash restore layout/icon tooltip, titlebar New chat removal, Activity popover/one-line strip, and voice/send button sizing were corrected.
- 2026-05-06T22:38:17.042+09:00 floating popup placement was hardened: More, Vision, Trash, and Activity popups now render through viewport-aware fixed portals, More prefers the top-right direction from its trigger with overflow fallback, and `data-tooltip` tooltips use the same floating placement path.
- 2026-05-06T23:19:17.596+09:00 renderer architecture refactor completed: `App.tsx` was reduced from 4,959 to 2,612 lines, renderer UI moved into feature components, shared UI behavior moved into hooks/utils, and `styles.css` became a scoped CSS import manifest.
- 2026-05-06T23:39:18.331+09:00 dogfood UI motion polish completed technically: trash artifact count now owns the file icon, Activity footer height was reduced to 52px, and the mascot was changed from transform-only bounce to a generated 9-frame sprite sheet from the current PNG.
- 2026-05-07T00:12:14.390+09:00 product-owner correction recorded: the generated sprite sheet is not accepted as "moving mascot" work because it derives from one static pose and only satisfies an automated-condition proxy. Future ambiguous UX requests require a consensus step before implementation, and mascot motion must be reworked with real authored pose/expression/state motion.
- 2026-05-07T00:25:39.389+09:00 `/vibe-sync` advanced the harness from v1.7.4 to v1.7.7. Non-interactive sync failed without approval, so the two conflicted files were manually compared against upstream: `docs/context/orchestration.md` kept this project's Codex role contract while accepting the new Phase 3 consensus requirement, and `docs/orchestration/providers.md` kept the Windows/Codex provider contract while acknowledging configurable role assignment. GitHub CI was corrected to use `npm run build:web` and project-owned `typecheck`/`test` scripts.
- 2026-05-07T00:31:30.893+09:00 GitHub CI follow-up fixed the Ubuntu `build:web` failure caused by missing `node-pty/prebuilds/linux-x64`: non-Windows PTY runtime preparation now writes an unavailable manifest when the package lacks the prebuild, while Windows/release strictness still fails on missing PTY prebuilds.
- 2026-05-07T03:43:58.638+09:00 mascot motion rework was corrected from key-pose/proxy animation to true sequential source sheets: `$imagegen` produced idle/working/Vision/offline frame sheets, `scripts/build-mascot-assets.py` extracts 30 ordered character components per status, normalizes them to a shared bottom-center anchor, removes chroma/aura fringe, and emits 30fps WebP sprite grids plus a JSON manifest. `MascotSprite` now plays one discrete frame at a time with no transform wobble, crossfade layers, randomized pattern jumps, or normal-state drop-shadow.
- 2026-05-07T06:37:23.227+09:00 mascot jitter stabilization follow-up completed after dogfood feedback: the asset builder now computes a warm-fur lower-body anchor plus alpha-area metric per frame, then normalizes each frame to a shared body anchor and near-constant apparent size. This specifically addresses residual "rattling" from per-frame component center/scale drift while keeping the single-layer no-aura playback path.
- 2026-05-07T09:15:52.785+09:00 temporary dogfood FPS tuning control added: the system strip exposes a compact persisted `6-30fps` mascot playback slider so product-owner testing can compare slower frame rates without regenerating sprite assets. `MascotSprite` reads the FPS through a ref so slider changes do not restart the current frame loop.
- 2026-05-07T09:47:23.116+09:00 the temporary mascot FPS dogfood slider now supports `1-30fps`; missing storage falls back to 30fps, while explicitly saved low values under 6fps are preserved for comparison.
- 2026-05-07T20:34:31.614+09:00 app-server approval handling was hardened for dogfood browser-open failures: PowerShell `Start-Process` URL requests now map to external URL approvals and canonical PowerShell execution permissions, with smoke coverage for Google browser open and saved PowerShell allow reuse.
- 2026-05-07T20:41:36.402+09:00 follow-up fixed the real CLI command shape: quoted absolute `pwsh.exe` paths are now recognized as PowerShell, existing exact-command saved allows are honored as legacy fallback, and smoke covers the quoted full-path Google open command.
- 2026-05-07T21:25:07.309+09:00 follow-up corrected the actual app-server approval response protocol from `decision: "approve"` to `decision: "accept"`, which was why browser-open permissions were recorded as allowed in the widget but still surfaced as rejected in the assistant answer. Orphaned probe app-server processes were cleaned up and the daemon was restarted on `127.0.0.1:4128`.
- 2026-05-07T22:20:17.844+09:00 Iteration `iter-8` completed the Vision Context Interface MVP from `docs/plans/vision-context-interface-handoff.md`: daemon-side TaskCapsule/capture/resolver/retention modules, transcription MVP boundary, screen/browser/terminal observation adapters, shared `visionContext.*` protocol, renderer Share-with-Agent integration, app-server `localImage` override support, and smoke coverage for capsule generation, raw media deletion, resolver cases, lexicon correction, destructive clarification, and fake app-server localImage delivery.
- 2026-05-07T22:33:11.196+09:00 `/vibe-review` wrote `docs/reports/review-0-2026-05-07.md`. Findings focus on harness review reliability: escaped-pipe parsing in the gap ledger, Findings heading/parser contract drift, context-audit observability before any prompt reduction, semantic acceptance evidence for agent-context features, and a project-decisions JSONL warning cleanup.
- 2026-05-07T23:15:09.588+09:00 downstream dogfood verification synced the harness to vibe-doctor `v1.7.8` and wrote `docs/reports/review-0-2026-05-07-v1.7.8-dogfood.md`. The previous parser/input regressions are verified fixed; remaining notes are report-only context-audit observability and Vision Context semantic dogfood evidence.
- 2026-05-07T23:25:13.064+09:00 first Vision Context semantic dogfood evidence collected in `docs/reports/vision-context-dogfood-evidence-2026-05-07.md`: the real v1.7.8 residual review section was converted through daemon `visionContext.*`, raw media was deleted, one screenshot was passed as `localImage`, and the app-server task decision correctly held semantic acceptance instead of marking it complete. This is evidence-collected, not final semantic acceptance.
- 2026-05-08T00:13:57.067+09:00 planned the Browser Action Interface in `docs/plans/browser-action-interface-handoff.md`. The plan scopes a daemon-side browser actuator module for observe-plan-act-verify loops, typed browser actions, target resolution, safety policy, extension/native/CDP/Playwright adapters, renderer approval, audit logging, and future computer-use integration.
- 2026-05-08T01:20:00.000+09:00 Iteration `iter-9` implemented the Browser Action Interface MVP: `src/daemon/browser-action` core module, structured extension observations, typed extension action execution, shared `browserAction.*` protocol, daemon extension poll/result endpoints, renderer progress/result logging, existing approval UI reuse, app-server widget-context visibility, and smoke coverage for resolver/safety/approval/extension-result/audit paths.
- 2026-05-08T02:25:00.000+09:00 Iteration `iter-10` upgraded Browser Action from iter-9 MVP to production adapter/evaluate scope: adapter registry/status diagnostics, direct adapter execution, stale reobserve/retry, Playwright controlled-browser adapter, CDP remote-debugging adapter, Windows native desktop diagnostics boundary, explicit full_control_dev evaluate approval/credential safeguards, and real semantic dogfood evidence at `docs/reports/browser-action-dogfood-evidence-2026-05-08.md`.
- 2026-05-08T02:25:00.000+09:00 Browser Action production verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, Browser Action core/Playwright/CDP/evaluate/native smokes, extension/native-host/DOM/app-server smokes, `npm run dogfood:browser-action`, `cargo check --manifest-path src-tauri/Cargo.toml`, UTF-8/mojibake checks, `git diff --check`, and `npm run vibe:checkpoint`.
- 2026-05-08T02:42:00.000+09:00 Added `docs/plans/browser-action-end-to-end-control-handoff.md` as the next Browser Action handoff. It scopes prompt-driven Agent tool integration, renderer UX, extension stability, managed browser/CDP operation, multi-step plans, browser-specific permission policy, Windows UI Automation fallback, and real dogfood matrix.
- 2026-05-08T02:54:17.473+09:00 `/vibe-sync` advanced the harness to vibe-doctor `v1.7.9` and dogfooded the new manual `diff-reviewer` sidecar. Vanilla v1.7.9 failed Codex provider execution on Windows (`spawnSync codex ENOENT`), then downstream dogfood accepted hardening for Codex shim resolution, sealed-packet hash/coverage/status validation, `--cwd` path handling, artifact-root bounds, and secret-safe diff collection. Latest sidecar artifact `dogfood-sidecar-v179-codex-final6` is `advisory` with only a stale-reference note that was corrected after the run; report: `docs/reports/review-0-2026-05-08-v1.7.9-sidecar-dogfood.md`.
- 2026-05-08T03:34:01.932+09:00 `/vibe-sync` advanced the harness from `v1.7.9` to `v1.7.11`. Forced conflict sync was used for the known sidecar/Codex-doc files, then this downstream's Codex Orchestrator/provider contract was re-applied. Verification passed `npm run vibe:typecheck`, bootstrap preflight, `npm run vibe:gen-schemas -- --check`, and focused schema/sidecar tests.
- 2026-05-08T03:44:19.794+09:00 `/vibe-sync` advanced the harness from `v1.7.11` to `v1.7.12`. Dry-run found the two known downstream Codex orchestration doc conflicts, so forced sync was followed by re-applying the local Codex Orchestrator/provider contract. Verification passed `npm run vibe:typecheck`, bootstrap preflight, and `npm run vibe:gen-schemas -- --check`.
- 2026-05-08T04:10:24.000+09:00 Iteration `iter-11` completed the Browser Action end-to-end control layer from `docs/plans/browser-action-end-to-end-control-handoff.md`: widget browser prompts now enter a deterministic daemon Browser Action tool simulation, multi-step plans execute with safety/policy/approval/extension pauses, browser-specific policies are persisted, the renderer exposes a Browser Action panel, extension commands carry expected source/expiry metadata, and E2E dogfood evidence is recorded in `docs/reports/browser-action-e2e-dogfood-evidence-2026-05-08.md`.
- 2026-05-08T04:10:24.000+09:00 Browser Action E2E verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, all Browser Action core/Playwright/CDP/evaluate/native/E2E/renderer smokes, extension/native-host/DOM/app-server smokes, `npm run dogfood:browser-action`, `npm run dogfood:browser-action:e2e`, `cargo check --manifest-path src-tauri/Cargo.toml`, strict UTF-8/mojibake checks, `git diff --check`, and `npm run vibe:checkpoint`.
- 2026-05-08T09:09:48.942+09:00 Iteration `iter-12` completed the Browser Action control surface from `docs/plans/browser-action-control-surface-handoff.md`: a Vision-like Browser Action popup is anchored to the Browser mode button, direct UI commands use shared `browserAction.command`, daemon command handling converts direct requests into `BrowserActionPlan` execution through safety/approval/adapter/verify/audit paths, and prompt classification keeps informational Browser Action questions in normal Agent context.
- 2026-05-08T09:09:48.942+09:00 Browser Action control-surface verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, Browser Action core/Playwright/CDP/evaluate/native/E2E/renderer/direct-menu/prompt-classification smokes, extension/native-host/DOM/app-server smokes, `npm run dogfood:browser-action`, `npm run dogfood:browser-action:e2e`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `cargo check --no-default-features` through the MSVC environment.
- 2026-05-08T10:27:23.258+09:00 Iteration `iter-13` completed the Browser Extension Bridge UX refactor from `docs/plans/browser-extension-bridge-handoff.md`: the extension icon now opens a Browser Bridge popup/settings surface instead of sending a snapshot, badge states show OFF/IDLE/RUN/ASK/ERR, daemon base URL and bridge settings are configurable, heartbeat/status reaches daemon and widget, approved-site auto-observe plus command polling removes the manual snapshot step, and missing-permission/restricted-page recovery states are explicit.
- 2026-05-08T10:27:23.258+09:00 Browser Extension Bridge verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, `npm run smoke:all`, Browser Action core/Playwright/CDP/evaluate/native/E2E/renderer/direct-menu/prompt-classification smokes, extension/browser-bridge/native-host/DOM/app-server smokes, browser store readiness, `npm run dogfood:browser-bridge`, `npm run dogfood:browser-action:e2e`, and MSVC `cargo check --no-default-features`.
- 2026-05-08T12:50:38.055+09:00 Browser Bridge service-worker refactor completed without behavior changes: page-injected DOM snapshot/action functions moved to `providers/browser-dom-extension/bridge/injected-dom.js`, `service-worker.js` dropped from 1428 to 737 lines, and extension smoke now validates bridge modules plus package inclusion. Reload the unpacked extension to pick up the module split.
- 2026-05-08T17:57:17.977+09:00 Added `docs/plans/semantic-interface-handoff.md` as the authoritative handoff for a reusable Semantic Interface: a deterministic observation-to-hypothesis decision boundary with evidence, intent frames, ranker/safety predicate contracts, trace/replay, Browser Action shadow migration, and Vision read/locate conformance.
- 2026-05-08T23:05:00.000+09:00 Iteration `iter-15` completed the Semantic Interface from `docs/plans/semantic-interface-handoff.md`: `src/daemon/semantic-interface/` now owns v1 semantic types, ontology/versioning, intent frames, deterministic hypotheses/ranking, transition grammar, operating profiles, pure safety predicates, trace/replay, redacted trace projection, generic alias lexicon, Browser Action and Vision adapters, typed/untyped/adversarial golden trace harness, Browser Action low-risk live gate metadata, and `docs/reports/semantic-interface-dogfood-evidence-2026-05-08.md`.
- 2026-05-09T02:55:00.000+09:00 Iteration `iter-16` completed Semantic Interface refinement plus Semantic Memory: typed evidence packets and ranker traces, Browser View Graph identity/node/edge mapping, local redacted Semantic Memory storage/read sets, live Browser Action memory integration, renderer Settings controls, `npm run smoke:semantic-memory`, and `docs/reports/semantic-memory-dogfood-evidence-2026-05-09.md`.
- Current dev widget run is live after clearing port `5173`: Vite is listening on `127.0.0.1:5173`, daemon/app-server on `127.0.0.1:4128`, and startup logs are under `dist/logs/widget-dev-20260506-071947.*.log`.
- Browser store submission runbook is source-controlled at `docs/release/browser-store-submission.md`; deferral is recorded in `docs/release/deferred-gates.json`. Use the runbook after dogfooding to clear the deferred public-release gate and then rerun strict readiness.

## Branch And Harness

- Branch: `main`
- Harness: vibe-doctor `v1.7.12`
- Upstream ref: `^v1.7.12`
- Orchestrator: `codex`
- Sprint roles: planner `codex`, generator `codex`, evaluator `codex`
- Sprint mode: `extended` enabled in `.claude/settings.local.json`

## Active Iteration

- Current iteration: `iter-20` (`Browser Interaction Transaction`) complete; Browser Action prompt/direct/clarification paths now use request-scoped transactions, fresh Browser Perception leases, finite View Graph candidates, deterministic gates, late grounding, expected-effect verification, and advisory Semantic Memory feedback.
- Next queued Browser Action follow-up: reload the unpacked Browser Bridge extension and dogfood live sites against the transaction path, especially ambiguous Korean action prompts, multi-step content-list actions, tab-switch behavior, and ranked-choice clarification presentation.
- Remaining precise blockers/future consumers: first-class Codex app-server custom Browser Action tools require a stable custom-tool/client-tool contract; executable Windows browser chrome/restricted-page fallback requires a scoped UI Automation/native input helper; Terminal/Workspace/Screen/OCR/UIA Semantic Interface adapters are future consumers beyond iter-16. Dedicated ranked-choice clarification card UX can still be refined on top of the transaction candidate/clarification model.
- Planned sprints:
  - `iter-13-sprint-01-extension-popup-options-and-settings` (complete)
  - `iter-13-sprint-02-badge-heartbeat-and-daemon-status` (complete)
  - `iter-13-sprint-03-command-first-extension-channel-and-permission-flow` (complete)
  - `iter-13-sprint-04-widget-simplification-smokes-and-dogfood` (complete)
- Iteration 3 status: complete as a foundation iteration only. It does not satisfy the product-wide `/goal`; it delivered SQLite storage, durable session tabs/trash, artifact/activity ledger, and Vision recording/streaming foundations.
- Architecture boundary: daemon owns sessions, messages, app-server runtime metadata, provider snapshots, artifacts, activity logs, and durable preferences. Renderer remains UI/interaction focused.
- Storage boundary: SQLite stores metadata and structured state; large screenshots, recordings, generated files, and before/after snapshots live in an app-data blob store referenced by hash/path metadata. OAuth/Codex credentials must not be stored in SQLite.
- Completed storage foundation: `src/daemon/storage/*` provides SQLite path resolution, schema migrations, WAL/foreign-key setup, health checks, app settings with a no-secret guard, activity logging, and seeded built-in mascot/theme metadata. `runtime.status` includes lightweight storage diagnostics, and `GET /storage/health` runs explicit integrity checks.
- Completed session tabs/trash slice: the daemon emits `session.snapshot`, persists sessions/messages in SQLite, supports session create/open/trash/restore/branch commands, and the renderer now shows internal session tabs plus a restorable trash popover. Branch creates a new durable session seeded with the selected pair. New chat creates a new session rather than overwriting the prior conversation. Per-session model/reasoning/mode values restore when switching sessions.
- Completed artifact/activity ledger slice: the daemon records tool output and app-server file-change events into SQLite artifact/activity metadata, stores generated output and before/after/diff snapshots in the file-backed blob store, exposes `ledger.snapshot`, `ledger.refresh`, and `artifact.open`, and the renderer reuses the artifact accordion from both the active chat timeline and session trash popover. Activity now has a one-line footer summary plus a detail popover backed by daemon records.
- Completed Vision streaming/UX slice: Vision mode has a popup menu for snapshot capture, WebM recording, and Agent screen streaming. Recording uses browser display capture/MediaRecorder and stores completion metadata in daemon `vision_streams` plus the WebM in the blob store. Agent stream keeps a non-recording display-capture session, stores metadata only, and sends low-frequency JPEG frames to `/providers/screen/snapshot` so Agent turns can consume live screen context without creating a video artifact. Recording/streaming guardrails include size limits, two-minute auto-stop, 1 fps stream cadence, and retention metadata. The mascot reflects offline/working/recording/streaming states.
- Completed Sprint 01 focus: visible dogfooding UI polish, resize hit areas, Reason select overlap at minimum width, user bubble radius, More action top-right alignment audit, branch-to-session toast, Chrome-like internal tab behavior, per-session model/reason change affordance, and taste-skill review.
- Completed Sprint 02 focus: daemon-owned widget capability/context snapshot and safe Agent prompt-context injection so Agent mode can answer questions about widget UI controls, modes, PTY/Vision/DOM capabilities, settings, and limitations without exposing credentials or unrelated repo history.
- Completed Sprint 03 focus: richer artifact rendering and version browser in chat and trash, including file type icons, bounded text/image previews, current-version metadata, version accordions, versioned open flows, and Python-generated output handling through the existing blob-backed artifact path.
- Completed Sprint 04 focus: Vision/voice interactive-loop foundations: clearer screen recording vs Agent screen-share choices, stream cadence/resource controls, stronger consent/stop affordances, metadata-only Agent sharing, and a scoped voice prompt input boundary.
- Completed Sprint 05 focus: PTY popup and mascot persona: PTY use cases/history are visible in the terminal surface, a terminal-focused popout entry point exists, direct terminal behavior is preserved, and Default Dog mascot persona/tone hooks are included in Agent widget context.
- Completed Iteration 5 Sprint 01 focus: persisted runtime thread rows, per-session app-server bridge rebinding before turns/regeneration, stale-thread retry/clear behavior, and smoke coverage for separate internal session threads.
- Completed Iteration 5 Sprint 02 focus: provider snapshots are persisted as redacted ledger rows and rendered from the Activity detail popover across DOM, Vision, and Terminal providers.
- Completed Iteration 5 Sprint 03 focus: Vision stream resource cleanup, frame-overlap throttling, skipped-frame diagnostics, duplicate-stop prevention, and effective guardrail metadata are implemented.
- Completed Iteration 5 Sprint 04 focus: final completion audit and readiness update. Remaining follow-up is dogfood-dependent long-run screen-share CPU/memory tuning, live app-server protocol validation across CLI/app-server restarts, and deferred browser store account submission after dogfooding.
- Completed Iteration 6 Sprint 01 focus: renderer frontend structure refactor. `App.tsx` now owns orchestration and side effects while UI surfaces live under `src/renderer/components`, shared behavior under `hooks` and `utils`, renderer constants/types in `config.ts`/`types.ts`, and CSS partials under `src/renderer/styles`.
- Completed Iteration 7 Sprint 01 focus: trash artifact row alignment and compact Activity footer height are accepted. The frame-based mascot sprite animation using `src/renderer/assets/mascot-motion-sprite.png` was rejected as a proxy implementation; the replacement now uses status-specific sequential source sheets, component-extracted 30fps WebP sprite grids, single-layer playback, fixed lower-body anchoring, alpha-area scale stabilization, and no drop-shadow/crossfade/transform-wobble aura, with dogfood acceptance still pending.
- Completed Iteration 8 focus: the Vision Context Interface now sits behind Agent screen sharing. The daemon can start/event/stop/cancel Vision Context sessions, collect timeline/provider observations, build TaskCapsules, render capsule markdown, convert to app-server `UserInput[]` with selected `localImage` evidence, delete raw video/audio temp files after processing, and send the result into the current Codex app-server thread. The transcription MVP includes mock ASR, sidecar boundary, lexicon correction, action-slot confidence, and clarification policy.
- Vision Context semantic acceptance state: first dogfood evidence exists at `docs/reports/vision-context-dogfood-evidence-2026-05-07.md`; do not mark semantic acceptance complete until stronger live UI/live-model before-after evidence is collected or the product owner explicitly accepts this deterministic protocol artifact as sufficient.
- Completed Iteration 9 focus: Browser Action now owns a typed, auditable browser actuator interface. The daemon can start/observe/execute/cancel Browser Action sessions, normalize active-tab DOM snapshots into structured observations with stable element ids, resolve exact/role-text/focused/bbox/ambiguous/low-confidence targets, enforce allow/confirm/block/clarify safety policy, queue typed commands for the extension, accept extension before/after results, verify outcomes, and record Activity audit rows without persisting sensitive page state.
- Browser Action deferred state: CDP, Playwright, and `full_control_dev` evaluate are implemented for the production interface scope. The remaining future boundary is executable Windows UI Automation/browser-chrome control through a scoped helper.
- Completed Iteration 16 focus: Semantic Interface evidence packets and Semantic Memory. Browser observations now carry View Graph identity/node/edge data into Semantic Interface; ranker traces include candidate-generation provenance, pairwise margins, and target fingerprints; Semantic Memory persists only redacted local graph edges/unresolved cases/feedback events, exposes daemon report/read/reset/settings endpoints, contributes immutable read sets to ranking, records Browser Action unresolved target cases, and surfaces Settings enable/report/clear controls.

## Recent Work

- Migrated from Electron to Tauri.
- Verified Windows MSVC/Rust/WebView2 prerequisites.
- Added generated mascot icon resources for Tauri.
- Installed vibe-doctor v1.7.2 project context, provider memory, and harness files so future work can run through sprints.
- Configured Codex provider for Windows via `.\.vibe\harness\scripts\run-codex.cmd`.
- Ran `/vibe-sync` against upstream `v1.7.2`; used `--force` because the non-interactive sync path found harness files without sync history. Backup: `.vibe/sync-backup/2026-05-04T04-37-12-648Z`.
- Sync established ignored `.vibe/sync-hashes.json`, updated `.vibe/config.json` to `^v1.7.2`, appended harness ignore defaults, and added VS Code/CI harness files.
- Updated the project orchestration contract so Codex is the main Orchestrator and all sprint roles default to `codex`.
- Ran `/vibe-sync` to upstream `v1.7.4` after reviewing conflicts in `docs/context/orchestration.md` and `docs/orchestration/providers.md`. Backup: `.vibe/sync-backup/2026-05-04T15-54-12-729Z`.
- Re-applied this downstream project's Codex Orchestrator/Planner/Generator/Evaluator and Windows `run-codex.cmd` provider contract after sync while keeping the new v1.7.4 visual/experience evidence requirements for frontend/game/dashboard Sprint QA.
- Enabled `/vibe-sprint-mode` extended tier for phase-level delegation permissions.
- Replaced the widget's direct OpenAI API key path with daemon-owned OAuth PKCE login and Bearer-token agent proxy streaming.
- Removed the `openai` npm dependency from this client and updated README/context docs to describe the OAuth proxy contract.
- Added development hot services: `npm run dev` now starts `scripts/dev-hot.mjs`, which runs Vite HMR, daemon TypeScript watch, and daemon restart-on-build-change. Tauri dev skips its own daemon spawn unless `CODEX_WIDGET_DEV_SPAWN_DAEMON=1`.
- Added gitignored `.env` support for local OAuth token mode: `CODEX_WIDGET_AUTH_MODE=token`, `CODEX_WIDGET_OAUTH_ACCESS_TOKEN`, and `CODEX_WIDGET_AGENT_PROXY_URL`.
- Changed token-mode Sign in UX so the widget opens an inline token form, saves the OAuth access token/proxy URL into gitignored `.env`, and updates the running daemon without requiring users to edit env files manually.
- Switched the default local auth config back to PKCE/social-login mode and changed OAuth authorize links to open through the OS default browser via a Tauri command instead of WebView popup behavior.
- Added `scripts/dev-auth-proxy.mjs`, a local development OAuth/proxy server on `127.0.0.1:8787`, and wired `npm run dev`/`scripts/dev-hot.mjs` to start it automatically so Sign in can complete locally without manual token entry.
- Corrected the default Sign in flow to use Codex CLI OpenAI/ChatGPT authentication instead of the mock OAuth proxy: `CODEX_WIDGET_AUTH_MODE=codex`, Sign in runs `codex login` when needed, and authenticated prompts run through `codex exec --json`.
- Changed the dev auth proxy to opt-in only via `CODEX_WIDGET_DEV_AUTH_PROXY=1` or `npm run dev:auth-proxy`; it is no longer part of the default widget auth workflow.
- Codex-mode Sign out only disconnects the widget session; it does not run global `codex logout` or remove the user's Codex CLI credentials.
- Applied `taste-skill` frontend cleanup: the renderer now uses a Windows-style single panel with titlebar, system strip, mode tabs, structured conversation messages, token form labels, activity log, composer, and a smaller companion mascot zone.
- Fixed the renderer/Tauri UI mismatch after native testing: window size is now widget-scale (`360x480` config, observed about `374x488` including shadow), taskbar/shadow are enabled, titlebar has Pin/Minimize/Maximize/Close controls, and drag regions are restricted to the titlebar grip/identity so Sign in and the prompt input receive clicks.
- Removed local response evaluation/feedback controls from assistant messages. Response actions now expose copy, regenerate, and a top-right More menu with local branch and browser speech read-aloud actions; streaming markdown links and raw URLs are revealed as whole tokens to avoid visible markdown reflow.
- Switched the default Codex-mode runtime from per-request `codex exec` to a daemon-supervised background `codex app-server` JSON-RPC bridge. The daemon now starts the app-server child process, keeps one `threadId` alive, sends prompts as `turn/start`, maps `item/agentMessage/delta` to widget stream events, interrupts turns on cancel, and terminates the child process on shutdown/sign-out. `CODEX_WIDGET_CODEX_RUNTIME=exec` remains the explicit fallback.
- Pushed checkpoint commit `d066dd5` to `origin/main` with message `CHECKPOINT BEFORE BIG PATCH`.
- Started `/vibe-iterate` Iteration `iter-2` (`Resident Runtime Expansion`) and added milestone/report state for runtime protocol, provider shell, and resident desktop ops.
- Added first-class renderer-daemon runtime interactions: app-server approval/user-input server requests now emit `interaction.required`, render compact approval/input cards in the widget, and return `interaction.respond` to the daemon instead of being silently declined.
- Added `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request` as the default app-server approval policy, with `never` still available for trusted automation experiments.
- Added app-server runtime diagnostics: `runtime.status` now includes start count, last started/exited timestamps, and latest error; the Settings panel surfaces start count and latest error.
- Added visible chat timeline persistence across renderer reloads plus a titlebar New chat control that clears local chat state and resets daemon proxy/app-server session state.
- Added daemon-owned provider status events for Agent, DOM, Vision, and PTY modes so the mode tabs now have a reusable capability/status contract before real providers are implemented.
- Added resident desktop operations: runtime health events, Settings panel, Windows start-at-login toggle, skip-taskbar native config, hide-to-tray close behavior, and a strengthened smoke gate for provider/runtime events.
- Added `npm run smoke:resident` for idle daemon health and RSS budget checks.
- Fixed production bundling by adding `icons/icon.ico` to the Tauri bundle icon list; `npm run build` now produces release exe, MSI, and NSIS installer artifacts.
- Added `npm run smoke:all` and `npm run smoke:all:live` as serial readiness gates so provider smokes do not race by rebuilding `dist` in parallel.
- Added `npm run smoke:app-server` and included it in `smoke:all`; the smoke uses a fake Codex app-server to verify resident thread context, streaming deltas, approval forwarding, and rollback behavior without a live Codex account.
- Added real provider shell functionality for Iteration 2:
  - DOM mode accepts browser/page snapshots at `POST /providers/dom/snapshot`, updates provider readiness, emits DOM snapshot tool output, and injects the latest DOM context into model requests.
  - `providers/browser-dom-extension` adds an unpacked Chrome/Edge Manifest V3 extension that captures the active tab and posts a DOM snapshot to the daemon.
  - The browser DOM extension now has committed icon assets, manifest icon/action metadata, and `npm run package:extension` to generate `dist/providers/codex-widget-dom-extension-0.1.0.zip`.
  - Vision mode accepts screen snapshots at `POST /providers/screen/snapshot`, updates provider readiness, emits screen snapshot tool output, and injects screen description/OCR context into model requests.
  - `providers/screen-capture-helper/capture-screen.ps1` captures the Windows virtual desktop, compresses it to JPEG data URL, and posts it to the Vision snapshot endpoint.
  - The Vision-mode Capture action sends `provider.captureScreen` to the daemon, which runs the screen capture helper and refreshes provider status without requiring the user to run PowerShell manually.
  - Screen/Vision image data is now attached to Codex app-server Vision turns as image input instead of remaining daemon-only metadata.
  - The Windows screen capture helper now supports optional OCR text through auto-detected `tesseract` or a `CODEX_WIDGET_SCREEN_OCR_COMMAND`/`-OcrCommand` template that receives `{image}`.
  - Added bundled OCR runtime packaging: `npm run build:ocr-runtime` prepares `dist/ocr-runtime/ocr-runtime.json`, can fetch requested tessdata language packs, can copy a Tesseract runtime from `CODEX_WIDGET_OCR_RUNTIME_DIR`, `CODEX_WIDGET_TESSERACT_EXE`, PATH, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, or standard Windows install locations, records bundled tessdata languages, and installed helpers resolve `_up_/dist/ocr-runtime` before PATH OCR.
  - Added OCR language selection defaults: auto-generated bundled Tesseract commands choose `eng+kor` when both bundled language packs exist, fall back to available `eng`/`kor`, and allow `CODEX_WIDGET_SCREEN_OCR_LANGUAGE`/`-OcrLanguage` overrides.
  - Added OCR-only image preprocessing: helper OCR now receives an upscaled PNG temp image by default while the snapshot payload remains compressed JPEG; `CODEX_WIDGET_SCREEN_OCR_DISABLE_PREPROCESS=1` restores the older JPEG OCR input path.
  - Added Settings/env configured Vision crop parameters plus daemon-computed screen image hash/change/diff metadata with configurable thresholding so repeated captures can be distinguished from changed and below-threshold context.
  - Terminal/PTY mode executes explicit local commands (`/run`, `$`, `PS>`, `run:`, or fenced shell blocks), streams stdout/stderr as tool output, blocks dangerous command patterns by default, and returns a markdown terminal result.
- Added a persistent command-session layer for Terminal/PTY mode:
  - `/pty start` starts a daemon-owned child shell in the configured Codex widget terminal workdir.
  - `/pty <command>` streams output and returns a markdown terminal-session result while preserving shell state between commands.
  - `/pty status` and `/pty stop` expose the session lifecycle.
  - Direct `terminal.input` protocol messages now send live PTY text/key input and SGR mouse click/drag/wheel sequences without creating chat turns; idle PTY output is broadcast back as `terminal.output`.
- Hardened the renderer chat layout:
  - Conversation messages now use explicit grid flow so user bubbles, assistant markdown, active streaming state, and skeletons stay in separate rows.
  - GFM tables use fixed full-width layout on wide viewports and contained horizontal scrolling on narrow widget widths.
  - Prompt resize clamps against the actual panel height so the composer cannot cover the conversation region.
  - More action menus are aligned above the button with right edges matched.
- Added app-server-backed regenerate boundaries:
  - The renderer computes how many assistant turns are removed when regenerating a selected answer.
  - The daemon receives `regenerate.dropTurns` and calls Codex app-server `thread/rollback` before starting the replacement turn.
  - This preserves app-server context before the selected answer without sending the visible chat history as a prompt.
- Added `docs/providers/dom-snapshot-bookmarklet.js`, `docs/providers/screen-snapshot-example.json`, `npm run smoke:dom`, `npm run smoke:extension`, `npm run smoke:screen`, `npm run smoke:screen-capture:live`, `npm run smoke:screen-helper`, `npm run smoke:screen-helper:live`, and `npm run smoke:terminal`.
- Added `npm run smoke:renderer-chat` for browser-level validation of multi-turn chat overlap, table width, prompt resize, and response action menu placement.
- Added `npm run smoke:resident-soak` for a short resident daemon soak covering runtime samples, ping/pong health, idle active request count, app-server closed state in mock mode, RSS ceiling, and RSS growth.
- Replaced the packaged Tauri daemon child holder with a native daemon supervisor that restarts the Node daemon after unexpected exits with capped exponential backoff, keeps dev-mode duplicate spawn disabled by default, and kills the daemon child on widget shutdown.
- Added `npm run smoke:tauri-supervisor` to validate supervisor backoff and actual child restart behavior through Rust tests.
- Exposed native daemon supervisor diagnostics to the renderer via `get_native_daemon_status`; the widget status strip and Settings runtime grid can now show native daemon starting/running/restarting/error state even while the WebSocket is reconnecting.
- Added packaged daemon runtime resources: `npm run build:web` now creates `dist/daemon-bundle/standalone.js`, prepares `dist/node-runtime/node.exe`, and Tauri bundles both directories so installed Windows builds do not depend on a user-installed `node` command for the widget daemon.
- Added `npm run smoke:node-runtime` and included it in `npm run smoke:all` to verify the bundled Node runtime can run the dependency-bundled daemon without repository `node_modules`.
- Added `npm run smoke:release-resources` to verify generated MSI/NSIS build scripts include the bundled daemon, Node runtime, screen helper, and DOM extension resources.
- Added `npm run smoke:release-launch` to launch the release exe hidden, verify the packaged daemon WebSocket on `127.0.0.1:4128`, and clean up the process tree.
- Added a browser DOM extension Options page backed by `chrome.storage.sync`, so users can point the extension at another local daemon port without editing extension code. The extension only accepts local `http://127.0.0.1/...` or `http://localhost/...` snapshot URLs ending in `/providers/dom/snapshot`.
- Added `npm run smoke:release-install` for NSIS silent install/uninstall observation: it refuses to overwrite existing install state, launches the installed app hidden, verifies the daemon WebSocket, uninstalls, and checks install directory, uninstall registry entry, product install key, and desktop shortcut cleanup.
- Added `npm run release:verify` as the one-command live release gate. It runs `smoke:all:live`, `build`, release resource smoke, release exe launch smoke, NSIS install smoke, MSI install smoke, and prints release artifact sizes.
- Added `npm run release:readiness` as a release-candidate audit. It validates current release artifacts, browser store metadata/package/submission packet readiness, latest release soak evidence, and reports manual blockers for browser store submission and the default two-hour soak.
- Fixed installed-build daemon resource resolution. The native shell now checks the installed exe-adjacent `_up_` resource directory for `dist/daemon-bundle/standalone.js` and `dist/node-runtime/node.exe` before falling back to development paths or system `node`.
- Strengthened `npm run smoke:release-install` to find the installed bundled daemon process, kill it, and verify the native supervisor restarts it with a new PID before uninstall cleanup.
- Added a daemon parent watchdog through `CODEX_WIDGET_NATIVE_PARENT_PID`, so the installed daemon exits when the native app process disappears unexpectedly instead of surviving as an orphan.
- Added `providers/browser-native-host`, an optional Chrome/Edge native messaging host that receives framed `domSnapshot` messages, validates local daemon URLs, and posts snapshots to the local daemon. The browser extension now tries native messaging first and falls back to direct local HTTP when the host is not registered.
- Added browser extension store-readiness metadata: `store-listing.md`, `privacy.md`, `review-notes.md`, `npm run release:browser-store-packet`, and `npm run smoke:browser-store` for permission rationale/privacy/package/submission packet validation.
- Added `npm run release:soak`, a longer hidden release-exe soak that checks runtime samples, ping/pong health, daemon process presence, process-tree working set, and cleanup after the soak.
- Release soak now writes a JSON evidence report under `dist/reports/release-soak-latest.json` by default, with `CODEX_WIDGET_RELEASE_SOAK_REPORT` available for named manual/multi-hour runs.
- Made response Branch runtime-safe: Branch now sends `session.branch` to reset daemon-side proxy/app-server session state, stores the selected user/assistant pair as a one-shot `branchContext`, sends that seed with the next prompt only, and clears it after use so visible branch state does not keep running against hidden old app-server context.
- Added daemon reconnect replay: active agent events are broadcast to connected clients, bounded assistant response snapshots are retained in the daemon, reconnecting renderers receive `message.snapshot`, and a WebSocket close no longer aborts every active request.
- Added native PTY runtime packaging and a node-pty/ConPTY backend for Terminal/PTY mode:
  - `node-pty@1.1.0` is now a runtime dependency.
  - `npm run build:pty-runtime` prepares `dist/pty-runtime` with native node-pty resources, and Tauri bundles it for installed builds.
  - `/pty` sessions prefer node-pty/ConPTY, keep the stdio shell fallback via `CODEX_WIDGET_TERMINAL_BACKEND=pipe`, and support `/pty resize`, `/pty write`, and `/pty key` raw-input commands in addition to command execution.
  - `npm run smoke:pty-runtime` and the existing terminal-session smoke cover packaged native PTY loading and the node-pty backend.
- Added a dedicated renderer PTY viewport for Terminal mode:
  - Terminal tool events now accumulate in a sticky, scrollable PTY surface instead of only appearing in the small Activity log.
  - PTY mode exposes icon-only quick actions for `/pty start`, `/pty status`, `/pty stop`, and local viewport clear.
  - PTY raw input/key requests now drain output for a short quiet window, and the Terminal viewport includes direct input controls for text, Enter, Tab, Escape, and Ctrl+C.
  - PTY direct input now uses `terminal.input` instead of `/pty write` ask turns, keeps text/key controls available during active PTY work, and exposes a mouse-input toggle that forwards SGR click, release, drag, and wheel sequences.
  - Renderer chat smoke now verifies the PTY tab, terminal quick action request, terminal output rendering, viewport containment, and prompt/conversation separation.
- Added `npm run smoke:release-msi-install` for MSI install/uninstall observation:
  - The smoke performs a silent MSI install into a per-user temp directory using `ALLUSERS=2 MSIINSTALLPERUSER=1`.
  - It verifies installed bundled daemon/Node/OCR/PTY resources, launches the installed app hidden, confirms the daemon WebSocket, silently uninstalls, and checks cleanup.
  - `npm run release:verify` now runs the MSI smoke after the existing NSIS install smoke.
- Added `npm run release:browser-store-packet`:
  - It generates `dist/browser-store-submission/codex-widget-dom-extension-<version>` with the extension zip, store listing, privacy disclosure, review notes, native host notes, icons, and SHA-256 checksums.
  - `npm run smoke:browser-store` and `npm run release:readiness` now verify the submission packet exists and can be regenerated.
  - `release:readiness` now treats the unconfirmed soak blocker as a default 120-minute evidence requirement unless `CODEX_WIDGET_RELEASE_MULTI_HOUR_SOAK_MS` or the explicit manual-acceptance env flag is used.
- Added `npm run release:confirm-browser-store`:
  - After actual Chrome Web Store or Edge Add-ons dashboard submission, it writes `dist/reports/browser-store-submission-confirmation.json` with store name, submitted timestamp, submission id or listing URL, package name, and package SHA-256.
  - `release:readiness --require-manual-gates` validates that confirmation report, so the final manual gate has concrete evidence instead of only an env flag.
- Added `docs/release/deferred-gates.json` and release-readiness deferred-gate reporting so default readiness can represent product-owner deferrals without conflating them with missing automated checks.

## Next Recommended Sprint

Post-dogfooding release-channel follow-up: submit the DOM extension packet to Chrome Web Store or Microsoft Edge Add-ons using `docs/release/browser-store-submission.md`, then record confirmation with `npm run release:confirm-browser-store`.

## Open Issues

- Codex app-server is still marked experimental by the Codex CLI, so the bridge should preserve the `codex exec resume` fallback until the protocol is stable enough for production packaging.
- App-server approval and tool-user-input requests now have renderer UI, but the exact Codex app-server protocol is still experimental and may require adapter changes as CLI releases evolve.
- External OAuth provider/backend agent proxy support remains optional for non-Codex auth modes; this repo primarily implements the desktop widget/daemon client boundary.
- OAuth refresh tokens are not persisted; users may need to sign in again when an access token expires.
- Browser DOM provider is snapshot-based and has an unpacked Chrome/Edge extension bridge, local-only Options URL configuration, optional native messaging host, generated zip package, store-readiness metadata, and generated submission packet; final browser store account submission is deferred until after dogfooding.
- Screen capture/vision provider is snapshot-based and has a daemon-triggered Windows capture helper, Settings/env/visual-drag configured crop, optional OCR command hook, bundled OCR runtime packaging, standard Windows Tesseract discovery, bundled tessdata language acquisition/defaults, OCR-only PNG preprocessing, image hash/change/diff metadata with configurable thresholding, and direct app-server image input.
- Terminal/PTY provider now has a node-pty/ConPTY command/raw-input backend, short raw-input output drain, direct `terminal.input` text/key/mouse input, idle PTY output broadcast, and a renderer PTY viewport with direct input controls.
- Browser store account submission is deferred until after dogfooding. The two-hour release soak passed on 2026-05-05 with evidence in `docs/reports/release-soak-2026-05-05-2h.md`.
- The live readiness completion audit is recorded in `docs/reports/live-readiness-audit-2026-05-06.md`; it maps the objective to concrete artifacts and records the browser store submission deferral decision.

## Verification

Completed after harness install:

- `npm run vibe:doctor`
- `node .vibe\harness\scripts\vibe-preflight.mjs --bootstrap`
- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`

Completed after latest `/vibe-sync`:

- `npm run vibe:sync -- --dry-run`
- `npm run vibe:sync -- --force`
- `npm run vibe:sync -- --dry-run`
- `npx tsc -p .vibe/harness/tsconfig.harness.json --noEmit`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap` after switching all role providers to `codex`
- `node .vibe/harness/scripts/vibe-sprint-mode.mjs status`

Completed after `/vibe-sync` to v1.7.4:

- `npm run vibe:sync -- --dry-run` resolved `^v1.7.2` to `v1.7.4` and found two conflicts: `docs/context/orchestration.md`, `docs/orchestration/providers.md`.
- `npm run vibe:sync -- --force`
- Re-applied Codex role/provider overrides to the two conflicted docs after sync; the expected follow-up dry-run still reports those two files as local project overrides.
- `npx tsc -p .vibe/harness/tsconfig.harness.json --noEmit`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- UTF-8/mojibake checks over touched sync/context files

Completed after OAuth proxy client conversion:

- `npm run lint`
- `npm run smoke`
- Local inline OAuth auth-start smoke with dummy provider config
- Local inline OAuth callback/token/proxy streaming smoke with a dummy HTTP provider
- UTF-8/mojibake checks over touched files

Completed after dev hot services change:

- `node --check scripts/dev-hot.mjs`
- `npm run lint`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`

Completed after OAuth token config mode:

- `npm run lint`
- `npm run smoke`
- Local inline static OAuth token proxy smoke
- WebSocket daemon status reports `missing CODEX_WIDGET_OAUTH_ACCESS_TOKEN` while `.env` token is blank
- UTF-8/mojibake checks over touched files

Completed after inline token-mode Sign in UX:

- `npm run lint`
- `npm run smoke`
- Local inline token save smoke: `auth.save-token` -> `.env` upsert -> Bearer proxy stream
- WebSocket daemon status reports `signInAvailable: true` while token is blank
- UTF-8/mojibake checks over touched files

Completed after PKCE/social-login Sign in path:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`
- WebSocket auth-start smoke returns a PKCE authorize URL using `http://127.0.0.1:4128/oauth/callback`
- Running daemon reports `signInMethod: "pkce"`, `configured: true`, and `authenticated: false` until the external OAuth backend completes login
- UTF-8/mojibake checks over touched files

Completed after local dev auth/proxy server:

- `node --check scripts/dev-auth-proxy.mjs`
- `node --check scripts/dev-hot.mjs`
- `npm run lint`
- `npm run smoke`
- `GET http://127.0.0.1:8787/health` returns `{"ok":true}`
- End-to-end PKCE smoke: `auth.start` -> dev auth proxy authorize redirect -> daemon `/oauth/callback` -> token exchange -> authenticated WebSocket status -> Bearer `/agent/stream` response

Completed after Codex CLI OpenAI/ChatGPT auth flow:

- `codex login status` reports `Logged in using ChatGPT`
- `npm run lint`
- `npm run smoke`
- Running daemon WebSocket auth status reports `mode: "codex"`, `authenticated: true`, `signInMethod: "codex"`
- Running daemon prompt smoke returns `widget-codex-live-ok` through `codex exec --json`
- UTF-8/mojibake checks over touched files

Completed after renderer UI redesign:

- `npm run lint`
- `npm run smoke`
- Playwright screenshot at `430x610` for idle widget state
- Playwright screenshot at `430x610` after composer submission/streaming state
- UTF-8/mojibake checks over touched renderer files

Completed after widget-scale/window-control fix:

- `npm run lint`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`
- Playwright `360x480` interaction smoke: auth button toggles `OpenAI -> Sign in -> OpenAI`, prompt input accepts typed text
- Native window rect check reports the running Tauri process at approximately `374x488` including window shadow/bounds
- UTF-8/mojibake checks over touched renderer/Tauri config files

Completed after Pin/Opacity/native window-control update:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Playwright `360x480` UI smoke: Pin label changes `Pinned -> Unpinned`; opacity slider updates the displayed value to `80%`
- Rolled maximize back to the native Tauri maximize/unmaximize command after confirming custom widget-size expansion is not needed
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after webview-edge/native-titlebar layout update:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: panel starts at `left=0, top=0`, titlebar height is `32px`, mascot is `88x88`, opacity slider updates to `85%`, and prompt input remains clickable
- Playwright maximized layout smoke with `.is-maximized` at `1366x768`: panel fills the viewport and mascot moves to the bottom-right with right padding on the prompt/activity area
- UTF-8/mojibake checks over touched renderer/context files

Completed after Activity/opacity/titlebar cleanup:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` UI smoke: opacity slider accepts `0`, panel background alpha reaches `0`, text/input remains visible, Pin button has no text content, Activity log content is separated into a non-overlapping two-line area, and panel bottom border reports `0px`
- Playwright responsive titlebar smoke: opacity controller is visible at `360px` next to `Codex Widget` and hidden at `320px`
- UTF-8/mojibake checks over touched renderer/context files

Completed after native Tauri border removal:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Runtime Win32 style check on the Tauri window reports `WS_CAPTION=false`, `WS_BORDER=false`, `WS_DLGFRAME=false`, and `WS_THICKFRAME=false`
- Native maximize/restore smoke keeps those frame bits disabled while moving between `360x480` and maximized bounds
- UTF-8/mojibake checks over touched Tauri/context files

Completed after radius/mascot/opacity-control refinement:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: widget panel has `12px` top radius, `0px` bottom radius, `0px` bottom border, mascot is `116x116`, and mascot does not overlap panel/prompt/activity
- Playwright maximized layout smoke: panel radius is `0px`, panel fills `1366x768`, mascot is `136x136` at bottom-right, and prompt/activity right padding clears the mascot
- Opacity controller is iconless and reduced to a `58px` titlebar range control
- UTF-8/mojibake checks over touched renderer/context files

Completed after prompt click/focus repair:

- `npm run lint`
- `npm run smoke`
- Browser Playwright focus smoke: prompt input is enabled after reconnect, pointer click focuses it, and typed text is accepted
- Native Tauri click smoke: after WebView reload, clicking the prompt area and sending keys writes `nativefocus` into the input
- Added WebSocket auto-reconnect so daemon restarts no longer leave the prompt disabled in `Offline`
- Added prompt-row pointer focus capture and raised prompt row z-index to keep input focus reliable in the transparent native window
- UTF-8/mojibake checks over touched renderer/context files

Completed after model/reasoning selector UI:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: Model and Reason selectors render between status and mode rows, no panel rows overlap, and selected values persist in localStorage.
- Playwright submit-packet smoke: selecting `gpt-5.3-codex-spark` and `xhigh` sends `{ model, reasoningEffort }` with the `ask` WebSocket message.
- Prompt focus smoke remains valid after the new controls: clicking the prompt row focuses the input and typed text is accepted.
- Codex daemon path now passes selected values to `codex exec --json -m <model> -c model_reasoning_effort="<level>"`; OAuth proxy requests include `model`, `reasoningEffort`, and `reasoning_effort`.
- UTF-8/mojibake checks over touched renderer/daemon/protocol/env-example files

Completed after panel-based resize handles:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added eight resize hit areas on the white `.widget-panel` only; the transparent mascot/agent area has no resize handle.
- Implemented Tauri manual resize fallback through `outerPosition`, `outerSize`, `scaleFactor`, `setPosition`, and `setSize` so resizing works even with the Windows native frame stripped.
- Native smoke confirmed right panel-edge drag changed the window from `360x480` to `450x480`, then restored it.
- Native smoke confirmed white panel bottom-edge drag changed the window from `360x480` to `360x550`, then restored it.
- Playwright DOM smoke confirmed close button hit testing still resolves to the close button, panel right/bottom edges resolve to resize handles, and mascot area resolves to the shell rather than a handle.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after diagonal resize responsiveness fix:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Replaced per-frame paired renderer `setPosition`/`setSize` calls with one custom Tauri `set_window_frame` command backed by Windows `SetWindowPos`.
- Coalesced renderer resize updates so drag movement keeps only the newest pointer coordinates while an IPC frame update is in flight; this avoids request backlog during diagonal drags.
- Native smoke confirmed panel bottom-right diagonal drag changed the window from `360x480` to `448x557`, then restored it.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after widget affordance/UI follow-up:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added mascot window dragging through a Tauri drag region plus `startDragging`; native smoke moved the window by `72x45` from the mascot and restored it.
- Slimmed the titlebar opacity range control to a `10px` input, `1px` track, and `7px` thumb aligned to the track center.
- Filled the active Pin icon interior with the same accent color used by the opacity slider.
- Changed the auth button copy to `Sign in` / `Sign out` instead of provider names.
- Moved the model/reasoning selector row directly above the `Ask Codex` prompt row.
- Suppressed the default right-side `codex` model label in the status strip.
- Raised the app minimum height to `480px` and added explicit min dimensions for the shell, panel, fixed rows, and key controls; Playwright `320x480` and `360x480` layout smokes reported no row overlap.
- Taste-skill review pass confirmed controls keep their click targets, model row is above the prompt, mascot hit testing resolves to the image drag target, and Pin fill uses the accent color.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after native diagonal resize loop fix:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added a Tauri `start_window_resize` command that temporarily enables the Windows resize frame only for the active resize loop, posts the matching native hit-test resize message, then restores the borderless style after mouse release.
- Updated renderer resize startup so panel handles try the native resize loop first and keep the coalesced manual `set_window_frame` path only as a fallback.
- Native smoke confirmed panel bottom-right diagonal drag changed the window from `360x480` to `456x564`, then restored it.
- Native style smoke confirmed `WS_CAPTION`, `WS_BORDER`, `WS_DLGFRAME`, and `WS_THICKFRAME` are all false after the drag.

Completed after prompt composer layout update:

- `npm run lint`
- `npm run smoke`
- Converted the prompt field from a single-line input to a vertically resizable textarea with Enter-to-submit and Shift+Enter newline behavior.
- Moved the model/reasoning selector row below the prompt composer.
- Added extra padding to the Ready empty-state panel under the mode selector.
- Playwright `360x480` layout smoke confirmed the prompt row is before the model row, the model row is before Activity, Ready padding is `12px`, and dragging the textarea resize handle grew the textarea from `38px` to `84px` while the conversation region shrank from `96px` to `50px`.

Completed after prompt area resize clarification:

- `npm run lint`
- `npm run smoke`
- Removed the browser-native textarea resize affordance and added a thin prompt-composer top drag handle instead.
- Composer drag now changes the prompt row height, and the textarea height follows the row height.
- Send/stop button is vertically centered within the prompt row.
- Playwright `360x480` layout smoke confirmed the prompt row grew from `46px` to `90px`, textarea grew from `38px` to `82px`, textarea CSS `resize` is `none`, and model/activity row order stays intact.

Completed after prompt composer max-height expansion:

- `npm run lint`
- `npm run smoke`
- Raised the prompt composer absolute max height from `96px` to `192px`.
- Added viewport-aware clamping so the composer only reaches `192px` when the panel has enough height to keep the conversation region visible.
- Playwright smoke confirmed `360x480` clamps at `96px` with a `48px` conversation area, while `360x640` reaches `192px` with a `111px` conversation area; textarea follows at `88px` and `184px`, and the send button remains vertically centered.

Completed after conversation overflow UX fix:

- `npm run lint`
- `npm run smoke`
- Removed the assistant bubble's internal `max-height` and nested `overflow-y: auto` behavior.
- Kept scrolling at the conversation timeline level only and auto-pinned the timeline to the bottom during streamed responses.
- Long-response Playwright mock session confirmed a `2995` character assistant response renders as one natural bubble with `overflow-y: visible`, `max-height: none`, no assistant-level scroll, and the conversation timeline scrolled to bottom.

Completed after realtime conversation streaming fix:

- `npm run lint`
- `npm run smoke`
- Replaced the single `lastPrompt`/`answer` renderer state with a persistent `chatMessages[]` timeline so follow-up prompts preserve previous user/assistant bubbles.
- Added per-response stream buffers and a UI typewriter loop so large backend deltas reveal progressively instead of appearing as one static text jump.
- Slowed the loading skeleton animation to `2.4s`.
- Added assistant response states (`Queued`, `Thinking`, `Working`, `Streaming`, `Typing`, `Done`, `Stopped`, `Error`) with animated dots and a live cursor so long-running/tooling phases remain visible after the first text arrives.
- Playwright mock stream confirmed: skeleton duration is `2.4s`, a `670` character response had only `90` visible characters shortly after first delta with dots/cursor active, a second prompt left `2` user and `2` assistant bubbles, and no assistant bubble had nested scroll.
- Playwright tooling smoke confirmed a post-answer tool phase shows `Working` with dots/cursor while assistant text remains visible.

Completed after GPT-style conversation layout pass:

- `npm install react-markdown remark-gfm`
- `npm run lint`
- `npm run smoke`
- Removed visible per-message `You` / `Codex` / `Agent / GPT-*` labels from active chat messages.
- Restyled user prompts as right-aligned dark bubbles with left padding; assistant responses now use full-width document-style text instead of a boxed assistant bubble.
- Added `react-markdown` plus `remark-gfm` rendering for assistant messages, including GFM table styling, code, links, blockquotes, lists, and zebra table rows.
- Added compact response actions matching the available widget scope: copy, positive feedback, negative feedback, regenerate, and more-action logging.
- Made the typing reveal more natural by using smaller variable character steps and punctuation/newline delays instead of fixed large chunks.
- Playwright GFM/UI smoke confirmed no `.message-meta` nodes, no `You`/`Codex`/`Agent / GPT` label text, right-aligned user bubble with left padding, full-width assistant response, rendered markdown table, 5 action buttons, active streaming state, and cursor during partial reveal.

Completed after widget Codex execution context separation:

- `npm run lint`
- `npm run smoke`
- Changed widget-launched Codex CLI sessions so they no longer run from this repository by default.
- Default live widget prompts now invoke `codex exec --skip-git-repo-check -C <user-home>` outside the widget repo while preserving normal user-file search/edit/delete capability.
- Added a protected-source instruction wrapper around widget prompts so source changes for this repo are redirected to CLI sessions.
- Added `CODEX_WIDGET_CODEX_WORKDIR`, `CODEX_WIDGET_CODEX_ADD_DIRS`, and `CODEX_WIDGET_CODEX_SANDBOX` documentation/env examples for explicit local-file boundary overrides.

Completed after widget shutdown / sandbox setup fix:

- `npm run lint`
- `npm run smoke`
- Killed one stuck widget-launched `codex exec` process tree whose Windows sandbox setup was consuming CPU.
- Changed the widget default Codex sandbox to `danger-full-access` to avoid the Windows home-directory `workspace-write` sandbox setup path while keeping requested desktop file operations possible.
- Added Windows `taskkill /T /F` process-tree cleanup when a widget Codex request is aborted so `cmd -> node -> codex -> sandbox` descendants do not survive cancel, socket close, or reload.
- WebSocket cancel smoke confirmed a live request launched with `-s danger-full-access`, no `codex-windows-sandbox-setup` process appeared, and no `codex exec` process remained after cancel.

Completed after conversation UI/action bugfix pass:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Made user prompt bubbles fully rounded and centered the streaming dots/loading indicator alignment.
- Moved the prompt height CSS variable to the widget panel grid so prompt resizing reallocates layout height instead of overlapping the conversation.
- Added a codeblock renderer with language label and per-block copy action; tightened markdown/code/table width rules and hid conversation horizontal overflow.
- Reduced side resize handle width so the conversation scrollbar remains clickable while the outermost edge still resizes.
- Fixed response copy to use the full buffered assistant response, added visible feedback logs/states, and changed regenerate to replace the old assistant answer with a pending response instead of appending a second answer.
- Playwright narrow-width smoke confirmed uniform user bubble radii, no conversation horizontal overflow at `330px`, codeblock/table rendering, full response copy, feedback visibility, regenerate replacement, prompt resize without overlap, and usable scrollbar area at `320px`.

Completed after feedback popup and prompt resize hardening:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Added local feedback submission state so selected negative feedback reasons and details are stored in the widget session after submitting the popup.
- Negative feedback now opens a modal-style feedback popup; while either good or bad feedback is selected, the opposite icon is hidden until the selected icon is toggled off.
- Added CSS tooltips and hover/toggled backgrounds for response action icons, and removed native button borders from the action icons.
- Moved the prompt resize hit area fully inside the prompt row and clipped prompt row overflow so textarea resizing cannot paint over the conversation.
- Playwright feedback/resize smoke confirmed bad feedback opens the popup, reason/details submit into visible state/logs, opposite feedback icon hides and returns after toggle-clear, hover tooltip opacity reaches `1`, and textarea/prompt resize no longer overlaps the conversation or paints outside the prompt row.

Completed after response action simplification:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Browser Playwright action/link smoke confirmed response evaluation buttons are gone, `Copy markdown` and `Clear feedback` no longer render, More opens above the button with right edges aligned, Read aloud invokes `speechSynthesis`, Branch leaves a focused user/assistant pair, and split markdown links do not expose raw `[label](url)` syntax while streaming.
- UTF-8/mojibake checks over touched renderer/context files

Completed after Codex app-server runtime transition:

- `npm run lint`
- `npm run smoke`
- `npm run build:renderer`
- Live daemon app-server smoke confirmed two-turn context preservation through one background `codex app-server` thread.
- Added `src/daemon/codexAppServer.ts` for JSON-RPC process/session ownership and `src/daemon/codexRuntime.ts` for shared workdir/sandbox/policy helpers.
- Updated `docs/context/product.md`, `docs/context/architecture.md`, and `.env.example` with `CODEX_WIDGET_CODEX_RUNTIME=app-server` default and `exec` fallback.
- UTF-8/mojibake checks over touched daemon/context files

Completed after `/vibe-iterate` iter-2 runtime protocol pass:

- `npm run lint`
- `npm run smoke`
- Daemon provider/reset protocol smoke confirmed `provider.status` and `session.reset` events.
- Renderer Playwright smoke confirmed localStorage chat restore, provider status dots, and New chat reset cleanup.
- Renderer Playwright fake-WebSocket smoke confirmed approval and user-input interaction cards return `interaction.respond` payloads.
- Live daemon app-server smoke confirmed two-turn context preservation still works with `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request`.
- Regenerated `docs/reports/project-report.html`.

Completed after resident desktop ops pass:

- `npm run lint`
- `npm run smoke` with strengthened provider/runtime event checks
- `npm run smoke:resident`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Renderer Playwright smoke confirmed Settings runtime/provider layout and hidden prompt rows at `360x480`.
- `npm run build` produced:
  - `src-tauri/target/release/codex-widget-for-desktop.exe`
  - `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi`
  - `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe`

Completed after DOM/Terminal provider shell pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:dom`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `node --check scripts/smoke-dom-provider.mjs`
- `node --check scripts/smoke-terminal.mjs`
- `node --check src/daemon/providers/providerRegistry.ts`
- `node --check src/daemon/providers/terminalProvider.ts`

Completed after Screen/Vision snapshot provider pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:screen`
- `npm run smoke:dom`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `node --check scripts/smoke-screen-provider.mjs`
- `node --check src/daemon/server.ts`
- `node --check src/daemon/providers/providerRegistry.ts`

Completed after browser DOM extension bridge pass:

- `npm run smoke:extension`
- `node --check scripts/smoke-browser-extension.mjs`
- `node --check providers/browser-dom-extension/service-worker.js`

Completed after Windows screen capture helper pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:dom`
- `npm run smoke:screen`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:live`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `npm run smoke:all:live`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-live.mjs`
- `node --check scripts/smoke-all.mjs`
- `node --check src/daemon/server.ts`

Completed after app-server diagnostics pass:

- `npm run lint`
- `npm run smoke:resident`
- `npm run smoke:all:live`
- `node --check src/daemon/codexAppServer.ts`

Completed after daemon-triggered Vision capture pass:

- `npm run lint`
- `npm run smoke:screen-capture:live`
- `npm run smoke:all:live`
- `node --check scripts/smoke-screen-capture-request.mjs`
- `node --check src/daemon/providers/screenCaptureProvider.ts`

Completed after screen helper OCR hook pass:

- `npm run lint`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run smoke:screen-helper:live`
- `npm run smoke:screen`
- Screen helper live smoke now posts fake OCR output and asserts it reaches the daemon snapshot.

Completed after bundled OCR runtime packaging pass:

- `npm run lint`
- `npm run build:ocr-runtime`
- `npm run smoke:ocr-runtime`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- The default local build created `dist/ocr-runtime/ocr-runtime.json` with `available: false` because no local Tesseract runtime is installed; the packaging smoke used a mock Tesseract runtime source and verified copy/manifest generation plus daemon-side bundled OCR command resolution.

Completed after browser DOM extension Options pass:

- `node --check providers\browser-dom-extension\service-worker.js`
- `node --check providers\browser-dom-extension\options.js`
- `node --check scripts\smoke-browser-extension.mjs`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-launch`
- Extension smoke now verifies the Options page, storage permission, local-only host permissions, Options script syntax, and packaged zip entries.

Completed after NSIS release install smoke pass:

- `node --check scripts\smoke-release-install.mjs`
- `npm run smoke:release-install`
- Post-smoke checks confirmed no `Codex Widget` install directory under `%LOCALAPPDATA%`, no uninstall registry entry, no `Software\mir3626\Codex Widget` product install key, and no desktop shortcut remained.

Completed after release verification gate pass:

- `node --check scripts\release-verify.mjs`
- `npm run release:verify`
- Release verification ran the live smoke gate, Tauri release build, release resource smoke, release exe launch smoke, NSIS install smoke, and MSI install smoke, then reported release exe/MSI/NSIS artifact sizes.

Completed after installed daemon resource/restart pass:

- `cargo fmt --check --manifest-path src-tauri\Cargo.toml`
- `cargo check --manifest-path src-tauri\Cargo.toml --no-default-features`
- `npm run build`
- `node --check scripts\smoke-release-install.mjs`
- `npm run smoke:release-install`
- Manual diagnostic confirmed the installed app spawned `%LOCALAPPDATA%\Codex Widget\_up_\dist\node-runtime\node.exe` with `_up_\dist\daemon-bundle\standalone.js`, not repo `dist` or system `node`.
- `npm run release:verify` passed after the parent-watchdog change; release install smoke now verifies bundled daemon restart and app-process kill orphan cleanup.

Completed after browser native messaging host pass:

- `node --check providers\browser-native-host\native-host.mjs`
- `node --check providers\browser-dom-extension\service-worker.js`
- `node --check scripts\smoke-browser-native-host.mjs`
- `node --check scripts\smoke-browser-extension.mjs`
- `npm run smoke:browser-native-host`
- `npm run smoke:extension`
- `npm run release:verify`
- Native host smoke framed a DOM snapshot over stdio, verified the host posted it to a local daemon-compatible endpoint, and checked Chrome/Edge registry installer markers.
- Release verification confirmed the native host provider files are bundled into MSI/NSIS resources and installed by the NSIS smoke.

Completed after browser store-readiness pass:

- `node --check scripts\smoke-browser-store-readiness.mjs`
- `npm run smoke:browser-store`
- `npm run release:verify`
- Store readiness smoke verifies extension name/description length, icon files, permission rationales, host permissions, privacy/review notes, native messaging disclosure, no-remote-code statement, and generated package presence.
- Release verification now includes browser store readiness through `smoke:all:live`.

Completed after release longer soak pass:

- `node --check scripts\smoke-release-soak.mjs`
- `npm run release:soak`
- The release soak built the release app, launched the release exe hidden for 60 seconds, collected 13 runtime samples and 29 pong responses, detected the root app and daemon processes, and ended with a 463.6MB process-tree working set across 10 processes.
- `npm run smoke:release-soak`
- The standalone release soak smoke reused the current release build, collected 13 runtime samples and 29 pong responses, detected the root app and daemon processes, and ended with a 409.1MB process-tree working set across 9 processes.

Completed after branch-safe runtime pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:renderer-chat`
- `npm run smoke:screen`
- `npm run smoke:all`
- Daemon smoke now verifies `session.branch` does not broadcast a visible `session.reset`; renderer chat smoke verifies Branch sends `session.branch`, the next prompt includes one-shot `branchContext`, and the following branch prompt does not replay that seed.

Completed after reconnect replay pass:

- `npm run lint`
- `npm run smoke:daemon-reconnect`
- `npm run smoke`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- Reconnect smoke verifies an active response survives the first WebSocket closing, a second client receives a `message.snapshot` containing the already-streamed text, and the final `message.completed` reaches the reconnected client.

Completed after persistent terminal session pass:

- `npm run lint`
- `npm run smoke:terminal-session`
- `npm run smoke:terminal`
- `npm run smoke:all:live`
- `npm run build`
- Added `npm run smoke:terminal-session` and included it in the serial readiness gate.

Completed after native PTY runtime pass:

- `node --check scripts/prepare-pty-runtime.mjs`
- `node --check scripts/smoke-pty-runtime.mjs`
- `npm run lint`
- `npm run smoke:pty-runtime`
- `npm run smoke:terminal-session`
- `npm run build:web`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- PTY runtime smoke verifies `dist/pty-runtime` contains a loadable `node-pty` package, spawns a native PTY, and checks daemon PTY runtime resolution.
- Terminal session smoke now verifies `/pty resize` and the node-pty backend when `CODEX_WIDGET_TERMINAL_BACKEND` is not forced to `pipe`.
- Release resource/install smokes now verify `_up_/dist/pty-runtime/pty-runtime.json` and `_up_/dist/pty-runtime/node_modules/node-pty/package.json` are bundled and installed.

Completed after renderer PTY viewport pass:

- `npm run lint`
- `node --check scripts/smoke-renderer-chat-layout.mjs`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- Renderer chat smoke now covers the PTY tab, terminal quick action request, terminal output rendering, terminal viewport containment, and prompt/conversation separation.

Completed after MSI release install smoke pass:

- `node --check scripts/smoke-release-msi-install.mjs`
- `node --check scripts/release-verify.mjs`
- JSON parse check for `package.json`
- `npm run smoke:release-msi-install`
- `npm run release:verify`
- MSI smoke installs into `%TEMP%\codex-widget-msi-smoke`, launches the installed app hidden, verifies daemon WebSocket startup, uninstalls, and confirms no test install directory or port `4128` daemon remains.

Completed after standard OCR runtime discovery pass:

- `node --check scripts/prepare-ocr-runtime.mjs`
- `node --check scripts/smoke-ocr-runtime.mjs`
- `npm run smoke:ocr-runtime`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- OCR runtime preparation now finds explicit runtime dirs, explicit executables, PATH `tesseract`, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, and standard Windows install layouts before writing the bundled `dist/ocr-runtime/ocr-runtime.json` manifest.

Completed after OCR language defaults pass:

- `node --check scripts/prepare-ocr-runtime.mjs`
- `node --check scripts/smoke-ocr-runtime.mjs`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-ocr.mjs`
- `npm run smoke:ocr-runtime`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run lint`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- OCR runtime manifests now include bundled `.traineddata` languages, and bundled OCR command resolution auto-selects `eng+kor` when `eng` and `kor` language packs are both present.

Completed after PTY direct input pass:

- `node --check scripts/smoke-renderer-chat-layout.mjs`
- `node --check scripts/smoke-terminal-session.mjs`
- `npm run lint`
- `npm run smoke:terminal-session`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- Terminal session smoke now verifies raw `/pty write` output drain, and renderer chat smoke verifies the Terminal viewport input row sends `/pty write` plus Ctrl+C key requests.

Completed after release soak report pass:

- `node --check scripts/smoke-release-soak.mjs`
- `npm run smoke:release-soak`
- The short release soak produced 13 runtime samples, 29 pong responses, 411.1MB process-tree working set across 9 processes, and `dist/reports/release-soak-latest.json`.
- Release soak now writes a JSON report with duration, runtime sample count, pong count, latest runtime status, process-tree memory, thresholds, and process details for later manual/multi-hour evidence review.

Completed after release readiness audit pass:

- `node --check scripts/release-readiness.mjs`
- `npm run release:readiness`
- `node scripts/release-readiness.mjs --require-manual-gates` was run intentionally and failed as expected at that time because browser store submission and a true multi-hour soak had not been confirmed.
- Default readiness audit initially reported manual blockers for browser store submission and multi-hour soak. The 2026-05-05 two-hour soak later cleared the multi-hour blocker, and the 2026-05-06 product-owner decision deferred browser store submission until after dogfooding.
- After the 2026-05-06 product-owner deferral, default `npm run release:readiness` reports `status: deferred` for browser store submission via `docs/release/deferred-gates.json`; strict manual-gate mode still fails until actual store submission is confirmed.

Completed after OCR preprocessing pass:

- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-ocr.mjs`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run lint`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- Screen helper OCR smoke now verifies OCR commands receive the default preprocessed `.png` image path.

Completed latest release build after OCR preprocessing pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,315,264 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,766,904 bytes)

Completed after fake app-server protocol smoke pass:

- `node --check scripts/smoke-codex-app-server.mjs`
- `npm run smoke:app-server`
- `npm run smoke:all`
- `smoke:all` now includes fake Codex app-server coverage for thread reuse, streaming deltas, approval interaction forwarding, and regenerate rollback.

Completed after live app-server smoke pass:

- Added `npm run smoke:app-server:live` and included it in `npm run smoke:all:live`.
- `npm run smoke:app-server:live` passed against the logged-in local Codex CLI with 12 streaming deltas.
- App-server shutdown now waits for the Codex child process tree before daemon close returns, preventing live smoke temp workdir cleanup from racing the background CLI process.
- `npm run smoke:all:live`, `npm run build`, and `npm run smoke:release-resources` passed after the live smoke addition.
- Latest release artifacts: `codex-widget-for-desktop.exe` 10,315,776 bytes, MSI 39,505,920 bytes, NSIS 26,763,736 bytes.

Completed after Vision crop/diff metadata pass:

- `node --check scripts/smoke-screen-provider.mjs`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-renderer-chat-layout.mjs`
- `npm run smoke:renderer-chat`
- `npm run smoke:screen`
- `npm run smoke:screen-helper`
- `npm run lint`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- Settings now exposes compact Vision crop controls, screen capture requests carry the enabled crop rectangle, the helper accepts virtual-screen crop parameters, and screen snapshot responses include `imageHash`, `imageChanged`, `imageDiffRatio`, `imageDiffThreshold`, and `imageMeaningfullyChanged` metadata for repeated-capture diff awareness.

Completed after Vision drag crop picker pass:

- Settings now includes a visual crop selector for Vision capture regions.
- The selector converts the dragged webview rectangle into screen crop coordinates using Tauri window geometry and persists the result into the existing crop settings.
- `npm run smoke:renderer-chat` verifies the picker writes the selected crop size and preserves the existing crop capture request path.
- `npm run smoke:all`, `npm run build`, and `npm run smoke:release-resources` passed after the picker addition.
- Latest release artifacts: `codex-widget-for-desktop.exe` 10,316,800 bytes, MSI 39,505,920 bytes, NSIS 26,753,674 bytes.

Completed after OCR language acquisition pass:

- `prepare-ocr-runtime` can fetch requested tessdata packs during build with `CODEX_WIDGET_TESSDATA_LANGUAGES`.
- Added `npm run ocr:fetch-languages -- eng kor` for ad hoc language-pack acquisition into `dist/ocr-runtime/tessdata`.
- `npm run smoke:ocr-runtime` now verifies build-time tessdata fetch, the ad hoc fetch CLI, manifest language recording, and bundled OCR command resolution without relying on external network.
- `npm run smoke:all`, `npm run build`, and `npm run smoke:release-resources` passed after the OCR acquisition addition.
- Latest release artifacts: `codex-widget-for-desktop.exe` 10,316,800 bytes, MSI 39,510,016 bytes, NSIS 26,763,909 bytes.
- Latest release artifacts after this pass: exe 10,315,776 bytes, MSI 39,505,920 bytes, NSIS 26,764,799 bytes.

Completed after renderer chat layout hardening:

- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run smoke:all:live`
- `npm run build`

Completed after regenerate rollback pass:

- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run smoke:all:live`
- `npm run build`
- The renderer smoke asserts that regenerating the first of three assistant answers sends `regenerate.dropTurns: 3`.

Completed after direct Vision image input pass:

- `npm run lint`
- `npm run smoke:screen`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:screen` now asserts that screen snapshots become app-server image input items.

Completed after resident soak gate pass:

- `npm run lint`
- `npm run smoke:resident-soak`
- `npm run smoke:all:live`

Completed after browser DOM extension packaging pass:

- `npm run package:extension`
- `npm run smoke:extension`
- `npm run lint`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:extension` now verifies manifest icons, service worker syntax, zip creation, and required zip entries.

Completed after native daemon supervisor pass:

- `npm run smoke:tauri-supervisor`
- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run build`
- Added packaged-app daemon restart supervision with capped exponential backoff and shutdown cleanup; the smoke now verifies both delay capping and actual child restart after an exit.
- Added renderer-visible native daemon diagnostics so offline/reconnecting states can distinguish dev-services mode, daemon restart, and daemon errors.

Completed after bundled daemon runtime pass:

- `npm run smoke:node-runtime`
- `npm run lint`
- `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features`
- `npm run smoke:tauri-supervisor`
- `npm run smoke:all:live`
- `npm run build`
- `Select-String` over generated MSI/NSIS installer scripts confirmed `_up_\dist\daemon-bundle\standalone.js` and `_up_\dist\node-runtime\node.exe` are included.
- `npm run smoke:release-resources`
- `npm run smoke:release-launch`

Completed latest release build after provider/runtime readiness passes:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,307,072 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (4,161,536 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (3,063,170 bytes)
- Tauri resources include `_up_/providers/screen-capture-helper/capture-screen.ps1` and `_up_/providers/browser-dom-extension/manifest.json`.

Completed latest release build after persistent terminal session pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe`
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe`

Completed latest release build after native PTY runtime pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,312,704 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,497,728 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,760,198 bytes)
- Release bundles include `_up_/dist/pty-runtime/pty-runtime.json` and `_up_/dist/pty-runtime/node_modules/node-pty/package.json`.

Completed latest release build after renderer PTY viewport pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,501,824 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,764,420 bytes)

Completed latest release build after standard OCR runtime discovery pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,762,752 bytes)

Completed latest release build after OCR language defaults pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,758,248 bytes)

Completed latest release build after PTY direct input pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,315,264 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,501,824 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,773,974 bytes)

Completed after dogfood tooltip/activity/artifact polish:

- Mascot playback is now fixed at 6fps and the temporary FPS tuning slider was removed from the system strip.
- Activity detail count badges now use normal weight, expand for 100+ counts, and the detail/provider-history popover uses responsive row sizing so timestamps stay single-line.
- Renderer native `title` attributes were removed in favor of the shared `data-tooltip`/`FloatingTooltipRoot` path; tooltip placement now recalculates when moving quickly between response action buttons.
- Session artifacts now open from a bottom-left floating conversation button instead of staying pinned inline below the chat, and the panel closes on outside click/Escape.
- Empty untouched `New chat` tabs now use `session.discard` and are deleted without entering trash; non-empty sessions still fall back to normal trash behavior.
- Verification passed `npm run typecheck`, `npm run smoke:renderer-chat`, `npm run smoke:storage`, `npm run build:web`, `node scripts\smoke-daemon.mjs`, and `git diff --check`.

Completed after floating artifact visual polish:

- The active-session artifact popup now has a higher layer than widget buttons, explicit always-visible borders on both the trigger and popup, and a slightly lower sticky trigger position.
- Generated artifact summary badges now show a file icon, extension code, semantic extension name, and extension-specific color treatment based on the generated file.
- Renderer smoke now verifies artifact popup z-index/borders/button offset and generated Markdown badge icon/text/color behavior.
- Verification passed `npm run typecheck`, `npm run smoke:renderer-chat`, `npm run build:web`, and `git diff --check`.

Completed after trash/tab/model/artifact dogfood polish:

- Trash counts now use normal weight, trash-popover hover tooltips were removed, and each trash row now has a Restore icon plus a permanent delete icon wired to daemon `session.delete`.
- Active session tabs now use a thin full green border instead of a top-only green bar.
- Session switch feedback moved from the whole model row to thicker animated select borders; the border uses a green conic gradient that rotates counterclockwise once and then clears.
- Generated artifact badges now show only icon plus extension, with centered alignment and no tooltip; the floating artifact trigger moved further down.
- Verification passed `npm run typecheck`, `npm run smoke:storage`, `npm run smoke:renderer-chat`, `npm run build:web`, `node scripts\smoke-daemon.mjs`, and `git diff --check`.

Completed after execution permission and artifact policy dogfood polish:

- Runtime approval cards now expose `Allow`, `Always allow`, and `Deny`; `Always allow` stores an action-level execution permission in daemon-owned SQLite `app_settings` and future matching Codex app-server approval requests are auto-applied before the renderer is prompted.
- Settings now includes an `Execution permissions` section where saved action policies can be changed between `Ask`, `Always allow`, and `Deny`.
- Tool/provider context output is no longer promoted into artifacts. Screen/DOM/Vision snapshots remain provider history/activity context; artifacts are reserved for user-requested generated/modified/deleted outputs such as app-server file changes.
- Floating artifact badges were tightened again and artifact rows now show version/time metadata so duplicate titles can be compared by recency.
- Model/Reason session-switch feedback now draws a green line from the select border near the 11 o'clock position counterclockwise, holds briefly, then fades out instead of rotating a full border background.
- Verification passed `npm run typecheck`, `npm run build:daemon`, `node scripts\smoke-storage.mjs`, `node scripts\smoke-codex-app-server.mjs`, `node scripts\smoke-screen-provider.mjs`, `npm run smoke:renderer-chat`, `npm run build:web`, `node scripts\smoke-daemon.mjs`, and `git diff --check`.

Completed after control alignment and daemon restart:

- Model/Reason labels now share the select control vertical center, and Agent/DOM/Vision/PTY tabs keep icon/text centers aligned.
- Renderer smoke now explicitly fails if those control centers drift at the minimum dogfood viewport.
- No daemon listener was present on `4128`; a hidden manual daemon was started from `dist\daemon\standalone.js` and `/storage/health` reports ready SQLite storage under `C:\Users\Tony\AppData\Local\Codex Widget`.
- Verification passed `npm run smoke:renderer-chat`, `/storage/health`, and `git diff --check`.

Completed after Mode/Vision UX polish:

- Model/Reason select-border animation now uses the same accent at the start and end of the gradient head, a softened moving endpoint, and an 1.8s timeline with the final 0.5s fading opacity to zero after the full loop.
- DOM/Vision/PTY selected-state re-clicks are now no-ops and keep the current mode selected. Vision opens its action menu from the Mode bar when entering Vision mode.
- The previous in-conversation Vision toolbar was removed. A Mode-bar-attached Vision status panel stays hidden by default, slides/fades in for screen capture, recording, and Agent screen sharing, shows a blinking red live dot for recording/streaming, and delays its fade-out after completion.
- The active-session artifact floating trigger now sits lower at `bottom: -14px` while smoke still checks it stays above the prompt composer.
- Verification passed `npm run typecheck`, `npm run smoke:renderer-chat`, `npm run build:renderer`, `node --check scripts\smoke-renderer-chat-layout.mjs`, and `git diff --check`. Follow-up no-op selected Mode re-click verification also passed `npm run typecheck`, `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, and `git diff --check`.

Completed after external URL approval and Recovery Vault polish:

- Browser-open app-server approval requests now produce a renderer `external.url` event after Allow/Always allow, including saved `allow` permission policies, so the existing Tauri `open_external_url` path actually opens the browser instead of only approving the request.
- Deleted session UI now uses `Recovery Vault` language instead of Trash, uses an Archive icon for archive/recovery entry points, and uses an X icon for permanent delete inside the vault.
- Verification passed `npm run typecheck`, `node --check scripts\smoke-codex-app-server.mjs`, `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:app-server`, `npm run smoke:renderer-chat`, `npm run build:renderer`, and `git diff --check`.

Completed after artifact floating anchor correction:

- The active-session artifact floating trigger no longer uses `position: sticky`; it is fixed against the widget lower-bar stack and visually sits 8px above the prompt composer.
- Renderer smoke now measures the trigger-to-prompt gap and asserts the trigger remains non-sticky.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, and `git diff --check`.

Completed after artifact floating guard adjustment:

- The active-session artifact floating trigger now visually sits 4px above the lower bar.
- When a session has artifacts, the conversation gains a bottom guard spacer so the fixed artifact trigger cannot cover the final assistant response action buttons.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason animation origin adjustment:

- The model/reason select-border draw now starts from an explicit top-left text-start origin (`0deg` at `12px 50%`) instead of the previous top-center-biased path, so the visual start point is around the first option character.
- Renderer smoke now asserts the configured select-border start origin.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason animation tail adjustment:

- After the model/reason select-border draw completes, the full gradient border now rotates counterclockwise for 0.5s at opacity 1, then holds that completed rotation for a separate 0.5s fade-out.
- The tail phase is driven by `--model-select-spin`, leaving the draw phase and text-start origin intact; the total animation duration is now 2.3s.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after visible model/reason tail correction:

- The model/reason select-border motion now uses separate pseudo-elements: `::after` draws the border and `::before` handles the completed-border tail.
- The tail layer uses a full high-contrast conic gradient with a 1.3s delay, then rotates for 0.5s at opacity 1 and fades for the next 0.5s so the final motion is visible in the live widget.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason tail sequencing correction:

- The tail layer no longer starts during the draw phase. Its base opacity is `0`, and the animation uses `forwards` rather than `both` so delay no longer backwards-fills the visible 0% frame.
- Renderer smoke now asserts the tail fill mode and pre-delay opacity, which catches simultaneous draw/tail execution.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason tail visibility correction:

- The completed-border tail no longer relies on custom-property conic angle changes, which were too subtle in the live WebView.
- The tail pseudo-element now physically rotates with `transform: rotate(-360deg)` and a higher-contrast green gradient, while preserving the delayed start and fade-out sequencing.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason single-layer motion correction:

- The draw/tail pseudo-element handoff was removed. Model/reason select-border draw, full-border spin, and fade-out now run in one `::after` animation layer.
- The single-layer timeline prevents the drawn border from disappearing before a delayed tail layer becomes visible.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after model/reason simple draw fallback:

- Product owner chose to stop pursuing the post-draw rotation. Model/reason select-border animation now only draws the border to completion, briefly holds it, and fades out.
- Rotation/tail transform code was removed; renderer smoke now asserts a simple 1.6s no-transform draw/fade timeline.
- Verification passed `node --check scripts\smoke-renderer-chat-layout.mjs`, `npm run smoke:renderer-chat`, `npm run typecheck`, and `git diff --check`.

Completed after Codex app-server browser-open duplicate correction:

- Browser-open approvals no longer emit a renderer `external.url` event from the app-server approval path.
- The bridge still answers Codex app-server approvals with the required protocol payload `decision: "accept"`; Codex runtime now owns the actual browser/PowerShell `Start-Process` side effect, avoiding double opens.
- App-server smoke now asserts approved direct URL and PowerShell browser-open actions do not generate widget-side URL open events.
- Verification passed `node --check src\daemon\codexAppServer.ts`, `node --check scripts\smoke-codex-app-server.mjs`, `npm run smoke:app-server`, `npm run typecheck`, and `git diff --check`.
- Manual daemon was restarted on `127.0.0.1:4128`; the stale pre-restart app-server chain was stopped, leaving only the current daemon-owned app-server process chain.

## Restart Steps

1. Run `git status --short --untracked-files=all` and inspect the sync diff.
2. Default local live auth is Codex CLI auth. Use `CODEX_WIDGET_AUTH_MODE=codex`; Sign in should invoke `codex login` if the user is not already logged into Codex/ChatGPT.
3. Default Codex runtime is `CODEX_WIDGET_CODEX_RUNTIME=app-server`, which starts a daemon-owned background `codex app-server`. Set `CODEX_WIDGET_CODEX_RUNTIME=exec` only to force the older `codex exec resume` fallback.
4. Widget-launched Codex sessions default to `CODEX_WIDGET_CODEX_WORKDIR=<user-home>`, `CODEX_WIDGET_CODEX_SANDBOX=danger-full-access`, and `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request`; override only when testing a different desktop file boundary or trusted no-approval automation path.
5. Use the dev auth proxy only for mock backend OAuth experiments: run `npm run dev:auth-proxy` or set `CODEX_WIDGET_DEV_AUTH_PROXY=1` before `npm run dev`.
6. For production-style backend OAuth proxy live responses, set `CODEX_WIDGET_AUTH_MODE=pkce` and replace `CODEX_WIDGET_AUTH_BASE_URL`/`CODEX_WIDGET_AGENT_PROXY_URL` with a real backend that implements `/oauth/authorize`, `/oauth/token`, redirects to `http://127.0.0.1:4128/oauth/callback`, and serves streaming model responses.
7. For token-mode fallback responses, set `CODEX_WIDGET_AUTH_MODE=token`, press Sign in in the widget, and use the inline token form to save the OAuth access token and backend proxy URL into gitignored `.env`.
8. Run `node .vibe/harness/scripts/vibe-sprint-mode.mjs status` to confirm whether extended mode is still active.
9. Use `npm run dev` for renderer HMR plus daemon restart-on-change; use `npm run dev:services` only when testing the service loop without launching Tauri.
10. Run `npm run smoke:all` after follow-up TypeScript/widget/provider changes; it includes fake Codex app-server thread/approval/rollback coverage. Use `npm run smoke:all:live` when validating Windows desktop capture behavior.
11. For renderer UI work, run `npm run smoke:renderer-chat` and capture a `360x480` Playwright smoke against `http://127.0.0.1:5173/?daemonPort=4128` when a visual screenshot is needed. Model/reasoning selectors live between the status strip and mode tabs and persist to localStorage keys `codex-widget-model` and `codex-widget-reasoning-effort`. For mascot asset updates, keep generated sequential source sheets under `src/renderer/assets/mascot/`, run `python scripts/build-mascot-assets.py`, then run `npm run build:web` and `npm run smoke:renderer-chat`.
12. Renderer visible chat persists under `codex-widget-chat-messages:v1`; use the titlebar New chat control or `session.reset` protocol event to clear both UI and daemon session state.
13. The titlebar close button hides the widget to tray; use tray Quit to exit the resident app.
14. Run `npm run smoke:resident` when resident lifecycle, daemon health, or resource behavior changes.
15. Run `npm run smoke:tauri-supervisor` after Tauri/Rust daemon lifecycle changes.
16. Run `npm run smoke:node-runtime` after daemon bundle, Node runtime resource, or Tauri resource packaging changes; run `npm run smoke:pty-runtime` after PTY runtime packaging changes.
17. Run `npm run smoke:release-resources` after `npm run build` when release bundle resources change.
18. Run `npm run smoke:release-launch` after `npm run build` when native daemon startup, bundled runtime resolution, or release exe behavior changes.
19. Run `npm run smoke:release-install` after `npm run build` when NSIS installability, bundled installed resources, or installer cleanup behavior changes. Run `npm run smoke:release-msi-install` after MSI installability, WiX, or release verification changes. Both refuse to run over existing install state unless `CODEX_WIDGET_RELEASE_INSTALL_SMOKE_ALLOW_EXISTING=1` is set for a controlled test machine.
20. Run `npm run smoke:dom` after browser/provider page-context ingress changes; run `npm run smoke:browser-action`, `npm run smoke:browser-action:playwright`, `npm run smoke:browser-action:cdp`, `npm run smoke:browser-action:evaluate`, and `npm run smoke:browser-action:native` after Browser Action daemon/protocol/adapter/evaluate changes; run `npm run dogfood:browser-action` when semantic Browser Action acceptance evidence needs refreshing; run `npm run smoke:extension` after browser extension package changes, `npm run smoke:browser-bridge` after Browser Bridge popup/badge/heartbeat/permission/command-first changes, `npm run dogfood:browser-bridge` when snapshotless Browser Bridge evidence needs refreshing, `npm run smoke:browser-native-host` after native messaging host changes, `npm run smoke:browser-store`, `npm run release:browser-store-packet`, and a temp-output `npm run release:confirm-browser-store` check after browser store metadata/submission packet/confirmation changes, `npm run smoke:screen` after Vision provider changes, `npm run smoke:screen-capture:live` after daemon-triggered capture changes, `npm run smoke:screen-helper`, `npm run smoke:screen-helper:ocr`, and `npm run smoke:ocr-runtime` after screen helper/OCR changes, `npm run smoke:terminal` after one-shot terminal provider changes, and `npm run smoke:terminal-session` plus `npm run smoke:pty-runtime` after `/pty` session changes.
21. DOM snapshot testing can use `providers/browser-dom-extension` as an unpacked Chrome/Edge extension or `docs/providers/dom-snapshot-bookmarklet.js` as a fallback against the local daemon on port `4128`.
22. Screen snapshot testing can use `providers/screen-capture-helper/capture-screen.ps1` for live capture or `docs/providers/screen-snapshot-example.json` as the raw payload shape against `POST /providers/screen/snapshot`.
23. Run `npm run release:verify` as the full live release gate before treating a build as releasable; it includes NSIS and MSI install smokes.
24. Run `npm run release:soak` for longer release-exe resident validation before manual release candidates or resident lifecycle changes. Use `CODEX_WIDGET_RELEASE_SOAK_MS=7200000` and a named `CODEX_WIDGET_RELEASE_SOAK_REPORT` for the default two-hour release-candidate evidence run.
25. Run `npm run build` before individual release checks when not using `release:verify`; MSI/NSIS bundle creation is now part of the installability gate.
26. Run `npm run vibe:checkpoint` before ending any follow-up maintenance session.

Use `docs/context/qa.md` for routine follow-up commands.

## Latest Update: Browser Action Widget UI Live Automation

Implemented the recommended live automation path that tests Browser Action the way a user does: one Chromium profile hosts the target page with the Browser Bridge extension, and a separate browser-hosted widget UI receives prompts through the real chat composer and approval buttons.

- Added `npm run dogfood:browser-action:live:widget-ui`, backed by `scripts/browser-action-live-runner.mjs --mode widget-ui`. It launches an isolated daemon, local fixture server, Vite renderer, target extension browser, and separate widget browser.
- Widget UI mode now types into `Ask Codex`, clicks the real `Send prompt` control, handles Browser Action approval cards through `Allow` / `Always allow` / `Deny`, screenshots both target and widget surfaces, and verifies final target-browser state.
- Fixed renderer final-answer replacement for approved Browser Action prompts. A later `message.completed` that replaces an approval receipt now updates the visible assistant message instead of leaving the old receipt stuck on screen.
- Hardened Browser Bridge command pickup for real UI timing: daemon WebSocket command polls wait briefly for just-queued commands, command redelivery cooldown is shorter, and the extension schedules wake retries after queued/progress events so approved actions do not stall behind an aborted long-poll response.
- Verification passed `npm run lint`, `npm run build:web`, `npm run smoke:browser-action`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:browser-bridge`, `npm run smoke:extension`, and `npm run dogfood:browser-action:live:widget-ui -- --run-id browser-action-widget-ui-final5-20260511`.
- Restarted the live dev runtime after daemon/renderer changes. Renderer is on `127.0.0.1:5173` PID `92796`, daemon `/storage/health` is ok on `127.0.0.1:4128` PID `10192`, and widget PID is `109152`.

Manual follow-up: reload the unpacked Browser Bridge extension once in Chrome/Edge so the installed service worker uses the wake retry update. The automated widget UI run loads the updated unpacked extension directly.

## Latest Update: Browser Action Live Latency And Grouped Always Allow

Completed the live Browser Action follow-up for slow/inconsistent `뒤로가기`, repeated Always Allow prompts, and general action startup latency.

- Browser Action Always Allow now stores grouped policies through `createAlwaysAllowBrowserActionPolicyInput()` instead of URL-specific `actionLabel` values for normal safe action families. Navigation Always Allow covers similar navigate actions without pinning to one target URL; click/type/check/select share the `safe_click_type` family; read/scroll/screenshot share `safe_read_scroll`.
- Browser Bridge now deduplicates in-flight/recent extension command `requestId`s so stale redelivery cannot execute a previous back/navigate command after a later scenario setup.
- Browser Bridge adds a daemon WebSocket command wake-up path. The extension still keeps HTTP long-poll as fallback, but it now listens for daemon `browserAction.progress: queued` events and immediately requests `browserBridge.command`, avoiding Manifest V3 alarm wake-up delays.
- `npm run dogfood:browser-action:live -- --run-id browser-action-ws-wakeup-always-allow-20260511` passed all seven scenarios. Latest latency evidence: concept random post 554ms, read 113ms, back 178/185ms, first approval navigate 329ms, grouped Always Allow navigate 199ms, reuse navigate 198ms.
- `npm run smoke:browser-bridge` now covers the WebSocket command poll path in addition to HTTP poll/status refresh.

Manual follow-up: reload the unpacked Browser Bridge extension once in Chrome/Edge so the installed service worker uses the WebSocket wake-up and command dedupe code.

## Previous Update: Browser Perception Interface Implementation

Iteration `iter-19` completed `docs/plans/browser-perception-interface-handoff.md`.

- Browser Perception is now implemented under `src/daemon/browser-perception/` with `PreparedBrowserViewContext`, source identity, freshness/stability policy, context store, and `ensureFreshContext`.
- Browser Bridge command polling can deliver `observe_now` before action commands. The extension now posts fast observe acknowledgements to `/browser-action/extension/ack` and final observe results to `/browser-action/extension/observe-result`.
- Browser Bridge snapshots include top-level mutation revision, last mutation timestamp, and mutation quiet duration for SPA/dynamic-page stabilization.
- Prompt, direct command, direct observe, and plan Browser Action paths now call Browser Perception before extension-backed planning/execution.
- Connected/allowed prompt flows emit `browser_perception_waiting` progress and wait for a bounded fresh context instead of returning the old retry-later final answer.
- Added `npm run smoke:browser-perception`, `npm run smoke:browser-perception:extension-command`, `npm run smoke:browser-perception:stabilization`, `npm run smoke:browser-action:fresh-context`, and `npm run dogfood:browser-perception`.
- Dogfood report: `docs/reports/browser-perception-dogfood-evidence-2026-05-10.md`.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting so Chrome/Edge uses the new observe ack/result code.

## Previous Update: Browser Perception Interface Handoff

Added `docs/plans/browser-perception-interface-handoff.md` after live testing showed the next failure class:

```text
현재 활성 탭 관찰이 아직 갱신되지 않았습니다.
Browser Bridge가 gall.dcinside.com 페이지를 읽는 중입니다.
잠시 후 다시 실행해 주세요.
```

This confirms that Browser View Graph v2 is necessary but not sufficient. View Graph v2 can model a page once a valid observation exists, but Browser Action still needs a Browser Perception layer that guarantees request-scoped fresh active-tab context before prompt/direct action planning.

The new handoff scopes:

- daemon `PreparedBrowserViewContext` store and `ensureFreshContext` API
- extension observe command ack/result/timeout/cancel semantics
- long-poll or upgraded poll delivery for `observe_now`
- SPA/query/history/mutation stabilization
- active-tab dirty invalidation and graph revision handling
- Browser Action prompt/direct integration before planning and before side-effect execution
- Semantic Interface evidence publication from prepared contexts
- renderer progress states so "reading page" is not returned as the final chat answer

`docs/plans/sprint-roadmap.md` now includes planned Iteration `iter-19: Browser Perception Interface` with six recommended sprints.

## Previous Update: Browser View Graph v2 Implementation

Iteration `iter-18` completed `docs/plans/browser-view-graph-v2-handoff.md`.

- Browser Action previously relied on prompt-time snapshot/observation; View Graph v2 is now the prepared page-understanding foundation before broader Browser Perception.
- Added `src/daemon/browser-perception/view-graph/` with schema-versioned v2 graph construction: identity, route key, query signature, freshness, regions, controls, forms, content lists, edges, affordance index, diagnostics, and redaction summary.
- `BrowserObservation.viewGraph` now emits v2 graphs while preserving existing Browser Action consumers.
- Browser Bridge snapshots include additive DOM/ARIA/landmark/form/list/mutation metadata; ProviderRegistry stores a prepared BrowserObservation and attaches its v2 graph to the DOM snapshot.
- Prompt Browser Action can use a fresh prepared v2 graph before falling back to request-time snapshot waiting.
- Semantic Interface projection carries graph action hints, risk hints, list/form ids, freshness, and view revision; representative content resolution now prefers v2 content-list evidence.
- Added `npm run smoke:browser-view-graph-v2`, `npm run dogfood:browser-view-graph-v2`, and report `docs/reports/browser-view-graph-v2-dogfood-evidence-2026-05-10.md`.
- Verification passed `npm run lint`, `npm run smoke` including `build:web`, focused Browser Action/Bridge/Semantic smokes, Browser Action/Semantic/View Graph dogfood scripts, UTF-8/mojibake checks, project report refresh, and `npm run vibe:checkpoint`.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting so Chrome/Edge uses the updated metadata collection code.

## Previous Update: Browser View Graph v2 Handoff

Added `docs/plans/browser-view-graph-v2-handoff.md` as the focused handoff for the next Browser Action prepared-context track.

The plan scopes View Graph v2 as a schema-versioned, deterministic page-understanding model with view identity/freshness, regions, controls, content lists, forms, edges, affordance indexes, Semantic Interface evidence projection, extension metadata upgrades, SPA/query transition handling, privacy-safe audit summaries, and dogfood evidence. It should be implemented before further Browser Action resolver tuning because the current live failures are rooted in missing prepared page semantics rather than isolated target-normalization bugs.

## Latest Update: iter-17 Browser Action Runtime Closure

Completed the requested follow-up order `2 -> 3 -> 1 -> 6 -> 7 -> 5` through `$vibe-iterate`.

- View Graph/runtime source handling: prompt-driven Browser Action now retries the affected step once when the extension reports expected-source URL/tab/window mismatch, using the returned active-tab snapshot to refresh observation and re-resolve.
- Semantic Interface/Memory live path: smoke/dogfood verification passed, and representative-content resolution now rejects utility/profile/category/comment anchors while preferring article-like content links.
- Browser Bridge status: `/browser-action/extension/poll` refreshes daemon-visible active-tab URL/title/tab/window/permission, reducing stale snapshot decisions between heartbeat updates.
- UX cleanup: failed, clarification, and extension-pending prompt responses now return clearer user-facing text instead of raw execution receipts; successful read/show flows still render page observations.
- Verification passed `npm run lint`, `npm run build:web`, `npm run smoke`, Browser Action core/e2e/prompt-classification smokes, Browser Bridge/extension smokes, Semantic Interface/Memory smokes, and the Browser Action/Semantic dogfood scripts.

Manual follow-up: reload the unpacked Browser Bridge extension before live-site retesting so Chrome/Edge uses the updated service worker and bridge modules.

## Latest Update: iter-14 Browser Action Semantic Target Pipeline

Completed `iter-14` through `$vibe-iterate` after live dogfood exposed that `새 채팅 눌러줘` failed as a low-confidence side-effect action. The failure was not that Browser Action could not use Vision-style graph/resolver concepts; it was that Browser Action still had a regex-only prompt parser and a shallow target ranker that let broad DOM containers compete with the intended actionable element.

Implemented the Vision Context-inspired split:

- `src/daemon/browser-action/intentResolver.ts` owns executable prompt intent, Korean command suffix stripping, and target phrase extraction.
- `src/daemon/browser-action/targetLexicon.ts` owns target normalization, compact Korean label matching, aliases, and tokenization.
- `targetResolver` now expands aliases, uses CJK-aware tokens, and caps non-actionable container candidates so links/buttons/inputs win over sidebar/page regions.
- Browser Bridge auto-observe now posts snapshots to the daemon over HTTP before falling back to native host, avoiding a native-host-only success path that can leave the daemon's DOM snapshot empty.

Verification passed `npm run lint`, `npm run smoke`, `npm run smoke:browser-action`, `npm run smoke:browser-action:e2e-control`, `npm run smoke:browser-action:prompt-classification`, `npm run smoke:extension`, `npm run smoke:browser-bridge`, `npm run smoke:dom`, `npm run smoke:browser-native-host`, `git diff --check`, UTF-8/mojibake checks, and `npm run vibe:checkpoint`. Dev services and the Tauri widget process were restarted; `/storage/health` is ready on `127.0.0.1:4128`. The unpacked browser extension must be reloaded once for the service-worker auto-observe transport change to affect the live browser.

Follow-up Browser Bridge setting added: the extension popup/options now include `Allow all sites except blocklist`. Turning it on requests Chrome/Edge optional host permissions for `http://*/*` and `https://*/*`; the service worker then allows all supported sites except entries in `observeBlocklist`. Blocklist entries accept origins/hosts such as `https://private.example`, `example.com`, or `*.example.com`.

Live DCInside prompt fix: `개념글 눌러서 재밌어보이는 글 보여줘` now extracts `개념글` as the click target. Browser Bridge also captures `[onclick]`/`[tabindex]` controls and prioritizes visible actionable DOM elements before applying the element cap so hidden DCInside settings/overlay controls do not crowd out real page tabs.

## Latest Update: Semantic Interface Accuracy Handoff Amendment

After reviewing OpenAI Privacy Filter and running a Codex/Claude accuracy debate, `docs/plans/semantic-interface-handoff.md` was updated before implementation. The decision is to keep the current graph/affordance `semantic-interface` architecture, not replace it with Privacy Filter-style token span labeling, but to promote selected Privacy Filter reliability patterns to v1 requirements.

The handoff now requires `RedactedTraceRecord`, `StepTransitionGrammar`, `OperatingProfile`, `SemanticDecisionOutcome`, and typed/untyped/adversarial eval modes. V1 calibration is defined as evidence-profile gating plus top-vs-runner-up margin and typed abstention, with statistical calibration deferred until a held-out trace set exists. The golden trace suite must cover duplicate labels, hydration drift, ARIA/visible mismatch, offscreen/occluded targets, i18n aliases, dynamic id churn, shadow DOM boundaries, and nested form scope. Under-evidenced side-effect resolution must return `abstain` or clarification rather than fabricating confidence.

## Latest Update: iter-15 Semantic Interface Started

Iteration `iter-15` is active. It follows `docs/plans/semantic-interface-handoff.md` and carries forward iter-14's Browser Action semantic target improvements into a reusable daemon-side `semantic-interface` module. Planned sprint order:

- `iter-15-sprint-01-type-surface-golden-traces`
- `iter-15-sprint-02-browser-action-shadow-and-redacted-traces`
- `iter-15-sprint-03-vision-read-locate-conformance`
- `iter-15-sprint-04-low-risk-browser-live-gate-and-completion`

Current sprint: `iter-15-sprint-01-type-surface-golden-traces`. Browser Action live behavior must remain unchanged during Sprint 01; the first implementation is type surface, deterministic ranker/replay, transition grammar, operating profiles, redacted traces, Browser Action adapter conversion, and golden trace smoke coverage.
