## Automatic Checks

- Platform detection for `detectOptInGaps()` is explicit-only:
  - Prefer `platform` passed by the interview/init seed.
  - Otherwise read `<!-- BEGIN:PROJECT:review-signals -->` or `<!-- BEGIN:HARNESS:review-signals -->` marker blocks in `docs/context/product.md`.
  - Otherwise read explicit `Platform:` / `Platforms:` lines only.
  - Do not infer frontend status from arbitrary product prose.
- Call `detectOptInGaps()` first and seed M7 opt-in findings before subjective review.
- If `pendingRestorations.length > 0`, auto-seed one Friction finding per entry:
  - `id: review-pending-restoration-<ruleSlug>`
  - `proposal: '<title>' restoration decision needed (tier=<tier>, reason=<reason>, source=<file>)`
  - `estimated_loc: 0`
  - `proposed_sprint: 'backlog'`
- If `.vibe/config.json.bundle.enabled === false` and explicit platform/review-signals indicate frontend web/browser, seed a Friction finding for missing bundle-size gate unless recent Phase 3 utility policy explicitly covers the decision.
- If `.vibe/config.json.browserSmoke.enabled === false` and the same platform condition holds, seed a Friction finding for missing browser smoke gate.
- If recent session-log entries contain `[decision][phase3-utility-opt-in]` or `[decision] [phase3-utility-opt-in]`, skip the old default opt-in findings, but still flag explicit `bundle=false` / `browserSmoke=false` decisions that lack both rationale and replacement evidence.
- If `.vibe/config.json.bundle.policy === "automatic"` remains unresolved for a frontend/browser project, seed a Friction finding that the agent did not materialize the automatic bundle policy.
- Read `openHarnessGapCount`, `uncoveredHarnessGaps[]`, and `deadlineHarnessGaps[]` from `vibe-review-inputs`. The helper parses the current six-column `docs/context/harness-gaps.md` ledger and treats `status in open|partial|under-review` or `script-gate != covered` as uncovered review evidence. If any of these fields are non-empty/non-zero, include at least one finding tied to ledger evidence.
- If `uncoveredHarnessGaps[]` includes `gap-context-overhead-policy`, review recent dogfood for repeated handoff/session-log overhead, unsafe prompt/capsule reduction attempts, retrieval-only one-shot prompts, or missing durable-event markers. Do not recommend capsule/router prompt reduction until warning-only context coverage observability and fail-closed safeguards have dogfood evidence.
- When reviewing `gap-context-overhead-policy`, include a compact context-audit summary if one was run (`contextBytes`, `references`, `missing`, `ambiguous`, and one sentence on whether findings are actionable). Keep it report-only; do not convert context-audit noise into a gate or recommend prompt/capsule reduction from size numbers alone.
- If `uncoveredHarnessGaps[]` includes `gap-pass-only-product-identity`, also check semantic agent-context, multimodal, and workflow-agent features. These may need dogfood transcripts, screen-share notes, or task-quality artifacts; type/build/smoke checks alone do not prove the feature improves agent behavior.
- If `pendingRiskRollups.length > 0`, summarize repeated open risks by rollup instead of repeating each old pendingRisk as separate background noise.
- If `wiringDriftFindings.length > 0`, auto-seed one Blocker finding per entry:
  - `id: review-wiring-drift-<artifact basename>`
  - `proposal: '<artifactPath>' was created but is missing runtime reference or sync manifest wiring.`
  - `estimated_loc: 20`
  - `proposed_sprint: 'backlog'`

### Adapter-Health Blind Spot

If the project has `app/api/*/route.ts` or equivalent data fetcher paths
(`productFetcherPaths` non-empty), and e2e or Playwright smoke tests exist, but
those smoke tests do not assert each route response or item contract, seed one
Blocker finding.

Detection: for each `productFetcherPaths` basename, require at least one string
occurrence in the e2e smoke files. If absent, treat that adapter as unprobed.

Avoid false positives when the adapter is explicitly mock-only or when explicit
platform/review-signals are not frontend web/browser.
