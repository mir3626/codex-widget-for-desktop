# Browser Action Reliability Foundation Handoff

Status: complete.

Created: 2026-05-11.

Latest implementation note: the Browser Action Reliability Foundation is
complete for the ten workstreams in this handoff. The final implementation
includes runtime/history stabilization, expected-effect verification, hardened
transaction intent handling, a live Browser Action test harness, background
Browser Perception scheduling, Semantic Interface/Memory integration, simplified
user-facing Browser Action results, a normalized simulated agent-tool result
contract, and architecture source-size regression gates. Completion evidence is
recorded in
`docs/reports/browser-action-reliability-completion-audit-2026-05-11.md`.

## Purpose

Browser Action has reached a broad feature baseline, but live dogfood now shows
that the main blocker is reliability rather than another small resolver patch.
The extension bridge can connect and observe, yet natural browser commands still
fail or produce inconsistent behavior because runtime state, perception
freshness, semantic candidate generation, action verification, UX feedback, and
test coverage are not yet treated as one product-quality control loop.

This handoff was the authority for completing the reliability foundation.
Historical Browser Action and Semantic handoffs that used to live under
`docs/plans/deprecated/` have been consolidated into `docs/architecture/` and
removed from the working tree. Use the architecture shards and git history for
baseline context.

## Live Findings That Motivate This Goal

Recent manual tests against real browser pages showed these recurring failures:

- History commands could retry or execute against stale source assumptions,
  causing inconsistent back/forward behavior.
- A completed action could be reported as success when the intended destination
  or effect was not proven.
- Prompt complaints such as history behavior feedback could be misclassified as
  executable Browser Action commands.
- Content selection requests could repeatedly choose a non-representative item
  such as a notice/header entry rather than a real content item.
- Numeric post references could be interpreted as ordinal positions.
- Ambiguous target clarification choices were not easy for a user to identify.
- Browser Action prompt-to-action latency was too high because current-page
  understanding was often prepared at request time instead of ahead of time.
- The live test loop required too much manual prompting, observation, and log
  interpretation.

These failures should be fixed by strengthening the transaction and prepared
context pipeline, not by adding site-specific rules.

## Non-Negotiable Constraints

- Do not add site-specific behavior for DCInside, Google, Naver, FM Korea,
  GitHub, or any other site.
- Do not make arbitrary JavaScript the default Browser Action abstraction.
- `full_control_dev` evaluate remains explicit, hidden by default, previewed,
  approved, audited, timed, size-limited, and secret-guarded.
- Browser adapters emit normalized observations/results only; they do not render
  final prompts.
- Semantic Memory is advisory only. It must never override freshness, visibility,
  safety, approval, or current view evidence.
- Low-confidence side-effect actions clarify instead of guessing.
- Destructive, credential-sensitive, submit, delete, send, post, publish, pay,
  purchase, auth, password, token, file upload/download, cross-origin side
  effects, and permission prompts require confirmation or block.
- Never persist password, token, payment, cookie, or credential values.
- Preserve Korean/UTF-8 integrity for touched files.

## Completion Definition

This goal is complete only when all ten workstreams below are implemented or a
true external blocker is recorded with attempted path, reason, and required
scope expansion. Passing generic tests is not enough unless the tests cover the
specific workstream acceptance criteria.

## Workstream 1: Browser Action Runtime Stabilization

Goal: make Browser Action runtime state predictable across prompt, direct UI,
extension, and history-navigation paths.

Implementation requirements:

- Stabilize per-active-tab command concurrency and cancellation.
- Prevent post-action stale prompt reuse.
- Treat history navigation (`back`, `forward`, `reload`) as browser-control
  actions that must not be retried as generic stale-source clicks.
- Keep active-tab source mismatch checks for tab/window mismatches, while
  allowing expected URL changes for history navigation.
- Ensure extension status, reload-required state, defaults, and daemon URL
  settings are visible and stable after reload.
- Restart daemon/widget automatically after source changes that require restart.

Acceptance:

- `back`, `forward`, and `reload` execute at most once per user request.
- History commands do not fail solely because the URL changed before action
  result verification.
- A new prompt cannot accidentally resume an older Browser Action transaction.
- Browser Bridge defaults are populated and stale extension reload state is
  detectable.

## Workstream 2: Browser Action Verification v2

Goal: fail wrong actions even if an adapter returns a refreshed observation.

Implementation requirements:

- Navigate actions must verify the requested destination, not merely any route
  or view change.
- History commands must verify a meaningful navigation effect or explicit
  unavailable/unchanged state.
- Click actions must prove an expected effect when the transaction candidate
  includes an expected effect.
- Content-open actions must verify content-item open behavior, not just URL or
  digest churn.
- Search/filter actions must verify query, route, list, field, or visible result
  changes according to their action family.
- Verification reasons must be user-safe and useful in diagnostics.

Acceptance:

- A wrong navigate destination fails.
- A wrong click fails even if the page reobserved.
- Same-tab query transitions are accepted when they are the expected effect.
- Refreshed observation alone is not counted as success for side-effect actions.

## Workstream 3: Browser Intent Transaction Hardening

Goal: make BrowserInteractionTransaction the primary natural-language browser
control path.

Implementation requirements:

- Keep resolver as late grounding/revalidation, not the primary intent engine.
- Generate finite candidate actions from View Graph v2 affordances.
- Add deterministic gate decisions: proceed, clarify, request approval, abstain,
  block.
- Distinguish browser action requests from feedback/questions about Browser
  Action behavior.
- Parse history commands before generic content-open click phrases when the
  user explicitly asks to go back/forward.
- Support numeric item identifiers separately from ordinal item positions.
- Rebind selected candidates against a fresh lease before execution.
- Preserve shortcut fast paths only where safe and exact.

Acceptance:

- Feedback such as "back behavior is weird" is not executed as `back`.
- "Wrong item opened, go back" resolves to history navigation, not another
  representative content click.
- Ambiguous prompts produce concrete candidate choices.
- Same prompt plus same graph state yields the same candidate ordering and gate
  decision.

## Workstream 4: Live Browser Action Test Harness

Goal: make repeated live Browser Action testing observable and mostly automatic.

Implementation requirements:

- Provide a harness that can drive the widget chat surface like a user.
- Provide an isolated browser/page mode where the user can watch tests without
  disturbing their normal browser session.
- Support a real-browser observation mode for manual dogfood when isolation is
  not enough.
- Capture prompt, selected plan, candidates, approval decisions, timings,
  before/after context identity, verification result, and redacted screenshots
  or graph digests where practical.
- Cover public-site tasks without site-specific behavior in product code.

Acceptance:

- The harness can run repeatable tasks for search, navigation, content open,
  back/forward, tab switch, and ambiguity clarification.
- Harness artifacts explain whether failures are perception, intent, candidate,
  safety, adapter, verification, or UX failures.

## Workstream 5: Browser Perception Scheduler

Goal: prepare current-page understanding before prompts need it.

Implementation requirements:

- Maintain prepared active-tab context using extension heartbeat, tab state,
  URL/title/history/hash/mutation dirty signals, and View Graph v2 digests.
- Refresh dirty contexts with bounded background scheduling.
- Expose request-scoped fresh/stable leases to Browser Action.
- Avoid returning "currently reading page; try again later" as a final answer
  for normal connected/allowed states.
- Handle tab switch, same-tab navigation, and SPA mutations explicitly.

Acceptance:

- Prompt-time latency is reduced for already-observed pages.
- Active tab changes are reflected before the next action where practical.
- SPA/query transitions update graph identity and freshness decisions.

## Workstream 6: Semantic Interface v2 Integration

Goal: make Browser Action use the shared semantic layer instead of local
one-off prompt parsing.

Implementation requirements:

- Convert Browser View Graph v2 affordances into Semantic Interface evidence
  packets.
- Use an IntentFrame with action family, target role, content intent, risk,
  locale, and uncertainty fields.
- Add multi-dimensional deterministic score breakdowns for exact, lexical,
  role, spatial, content-list, recency, memory, and risk dimensions.
- Preserve explainability; do not replace deterministic gates with opaque
  single-score decisions.

Acceptance:

- Browser Action can explain why a candidate was selected or clarified.
- Korean/English mixed prompts and typos improve through semantic evidence
  rather than site-specific rules.
- Semantic Interface evidence is reusable by future Vision/Desktop/Terminal
  control surfaces.

## Workstream 7: Semantic Memory Feedback Loop

Goal: learn from repeated user choices without compromising safety.

Implementation requirements:

- Record redacted unresolved intents, failed semantic matches, selected
  clarification choices, and successful/failed expected effects.
- Add advisory weights for repeated user phrases and preferred candidates.
- Scope memory reads by capability, origin/domain pattern, context identity,
  route key, and action family.
- Keep memory unable to override current evidence, freshness, safety, or
  approval gates.

Acceptance:

- Repeated user selections improve candidate ordering when current view evidence
  supports them.
- Memory cannot cause action on stale or invisible elements.
- Feedback records are redacted and test-covered.

## Workstream 8: Browser Action UX Simplification

Goal: make Browser Action understandable without exposing internal plan receipts
or adapter noise by default.

Implementation requirements:

- Hide Browser Bridge menus outside Browser mode or relevant active states.
- Collapse adapter/debug details behind advanced diagnostics.
- Replace raw plan receipts with concise user-facing action summaries.
- Improve candidate clarification display with labels, roles, regions, and
  previews where available.
- Persist approval choices according to explicit policy and expiry.
- Open chat message links in an external browser tab/window rather than inside
  the widget webview.

Acceptance:

- The user sees clear states: connected, reading, needs permission, restricted,
  running, approval needed, completed, failed, or target unclear.
- Internal plan details remain available in diagnostics but are not the main
  chat answer.

## Workstream 9: App-Server / Agent Tool Contract

Goal: make Browser Action a real agent capability boundary instead of a
prompt-only convention.

Implementation requirements:

- Keep the deterministic daemon-side simulated tool path until the official
  app-server client-tool contract is stable.
- Define request/result/error/approval schemas shared by simulated and future
  app-server client-tool paths.
- Cover approval, action result, adapter error, and verification failure in fake
  app-server smokes.
- Keep the official app-server client-tool path marked BLOCKED where contracts
  are unavailable or unstable.

Acceptance:

- Prompt -> tool request -> daemon action -> result -> agent response is
  covered by deterministic smoke tests.
- Future app-server integration can reuse the same schema without changing
  Browser Action semantics.

## Workstream 10: Architecture Cleanup / Module Boundary Hardening

Goal: keep the codebase workable for future agent implementation cycles.

Implementation requirements:

- Keep daemon route/protocol/domain/adapter boundaries separated.
- Keep renderer runtime bootstrap-oriented and feature state in focused hooks.
- Keep extension bridge service worker code split within Manifest V3 limits.
- Add architecture smokes for module boundaries and source-size regressions.
- Update durable architecture docs when the real implementation changes.

Acceptance:

- New Browser Action changes land in focused modules rather than giant runtime
  files.
- Architecture smokes catch boundary regressions.
- Remaining large files are either justified or listed for follow-up cleanup.

## Recommended Execution Order

1. Workstream 1 runtime stabilization.
2. Workstream 2 verification v2.
3. Workstream 3 transaction hardening.
4. Workstream 4 live harness improvements.
5. Workstream 5 perception scheduler.
6. Workstream 6 semantic integration.
7. Workstream 7 memory feedback.
8. Workstream 8 UX simplification.
9. Workstream 9 app-server/tool contract.
10. Workstream 10 architecture cleanup.

The first sprint should focus on the highest-impact live regressions:

- stale extension/default settings visibility,
- history-navigation retry/source mismatch,
- navigate false-positive verification,
- feedback prompts misclassified as actions,
- content-open and numeric-reference candidate gaps,
- focused regression smokes.

## Required Verification

Run the specific smoke/test set for the files changed in each sprint plus the
current Browser Action core gates. At minimum for completion:

- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-action:fresh-context`
- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-action:transaction-clarification`
- `npm run smoke:browser-action:transaction-verification`
- `npm run smoke:browser-action:transaction-concurrency`
- `npm run smoke:browser-view-graph-v2`
- `npm run smoke:browser-perception`
- `npm run smoke:browser-bridge`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:semantic-interface`
- `npm run smoke:semantic-memory`
- any new live harness, semantic, UX, tool-contract, and architecture smokes
  added by this goal
- UTF-8/mojibake checks for touched text files
- `npm run vibe:checkpoint`

## Durable Context Updates

Each sprint must update the durable context required by the repo rules:

- `docs/plans/browser-action-reliability-foundation-handoff.md`
- `docs/plans/sprint-roadmap.md`
- `.vibe/agent/iteration-history.json`
- `.vibe/agent/sprint-status.json`
- `.vibe/agent/handoff.md`
- `.vibe/agent/session-log.md`
- relevant `docs/architecture/*.md`
- relevant `docs/reports/*` and dogfood artifacts

## Completion Audit Template

Before marking this goal complete, build a checklist mapping every workstream
item, test command, handoff requirement, blocker, and durable context update to
real evidence:

- file path and diff,
- smoke/test output,
- live dogfood artifact,
- architecture or report update,
- recorded BLOCKED item with attempted path.

If any item is missing, weakly verified, or only indirectly covered, continue
the goal instead of marking completion.
