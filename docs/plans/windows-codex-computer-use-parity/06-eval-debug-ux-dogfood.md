# 06 - Eval, Debug, UX, And Dogfood

## Goal

Make every computer-use session measurable, debuggable, and promotable through
evidence instead of anecdotes.

## Eval Ledger Integration

Every session should create:

- eval run
- DAG run
- step records
- resource records
- verifier results
- failure class
- final outcome

Metrics:

- task success
- proof rate
- p50 latency
- p95 latency
- perception latency
- action count
- clarification count
- clarification rate
- abstention rate
- unsafe rejection rate
- recovery success
- verifier false-positive audit
- verifier false-negative audit
- rerun stability

Do not promote on:

- one live success
- model confidence only
- average latency while p95 regresses
- raw OCR accuracy only
- raw ASR WER only

## Debug Bundle

Computer-use debug bundle should include:

- session metadata
- permission profile snapshot
- safety decisions
- selected surface
- action schema source
- observation summaries
- perception graph export
- ROI cascade stage timings
- planner output
- action batches
- backend adapter choices
- command/file/network records
- generated tool manifests
- source hashes
- artifact hashes
- verifier results
- failure memory effects
- Computer Session debug bundles now include `failureMemory` records. These
  records are calibration-only and must keep `mayCompleteTask: false`,
  `mayBypassApproval: false`, and `proofSource: false`.
- rollback actions
- blocked grants
- external dependency warnings

Redaction:

- no credentials
- no raw cookies/tokens
- no full browser history by default
- no raw microphone/audio
- screenshot blobs only according to retention policy
- local paths minimized unless grant allows
- generated-tool dependency evidence redacts absolute `file:` package paths
  before tool-run output or eval ledger records are exposed
- generated-tool npm dependency execution evidence redacts the isolated
  dependency workspace while proving the tool received
  `CODEX_WIDGET_TOOL_DEPENDENCY_ROOT` and imported the prepared package
- package-consuming Toolsmith dogfood evidence records repeated local npm
  dependency prepare/execute/rerun samples, installed package provenance,
  blob-backed artifacts, eval/resource proof, p95 latency samples, and path
  redaction; this evidence remains non-promoting until external package
  install allowlist/provenance policy is productized
- external registry npm packages require an exact `packageAllowlist` grant
  such as `npm:name@version` and are blocked before install when only the
  default local `file:*` package policy is present
- Toolsmith dependency prepare records
  `toolsmith-dependency-policy-review.v1` with package classification,
  allowlist requirement, install isolation flags, lockfile/package provenance
  status, and promotion boundary; the Toolsmith renderer panel summarizes this
  as package policy evidence

## Renderer UX

Add or extend a Computer Use panel.

The panel should show:

- active session
- selected permission profile
- selected surface
- current state
- DAG node timeline
- pending approval
- missing grants
- current observation summary
- planned next action
- action preview for high-risk actions
- generated tool status
- artifacts
- rollback actions
- debug bundle copy/save
- latest dogfood/report/evidence links

UX rules:

- Do not hide high-risk action behind generic "continue".
- Show exact missing grant and the narrower one-time grant option.
  Computer Session panel now implements this for blocked runs by deriving a
  scoped one-time autonomy profile from current safety/job evidence and
  attaching it to the run; external blockers remain explicitly blocked.
- Show whether action is browser, terminal, generated tool, or foreground
  desktop.
- Show blocked restricted-page state clearly.
- Do not imply credentials can be handled automatically.

## Approval UX

Approval cards should include:

- action summary
- surface
- risk class
- exact grant requested
- evidence that caused the request
  High-risk Computer Use approval rows now include an expandable sanitized
  Preview with redacted capability input and approval evidence.
- one-time option
- deny option
- manual takeover option where appropriate

High-risk one-time approvals:

- history
- debugger
- file upload
- foreground desktop
- external submission
- local destructive operation
- package install
- generated code execution beyond reviewed templates

## Dogfood Corpus

Create a 30-case corpus that covers real computer-use behavior.

Scenario categories:

1. Public web research to Markdown/PDF.
2. Browser search and navigation.
3. Browser form fill without submission.
4. Browser form submission with explicit approval.
5. Bookmark create/update/delete.
6. Tab group create/claim/release.
7. Download start/observe/verify.
8. File upload preflight blocked without grant.
9. File upload succeeds with explicit grant.
10. History search blocked/approved one-time.
11. Debugger inspect blocked/approved one-time.
12. Restricted page recovery.
13. Current screen explain-only.
14. OCR target selection.
15. Unchanged screen ROI early exit.
16. Toolsmith generated script smoke/fail/retry.
17. Web research live source extraction.
18. Local document conversion.
19. Terminal command success.
20. Terminal command blocked by allowlist.
21. PTY session observation.
22. Browser download plus artifact hash.
23. Foreground watch-mode cancelled by user input.
24. Foreground watch-mode active-window mismatch block.
25. Browser permission popup bounded workflow.
26. Native file picker blocked until helper v2.
27. Windows settings read-only dogfood.
28. Windows settings mutation blocked.
29. Credential prompt manual takeover.
30. Recovery after wrong target or stale observation.

Each case records:

- user-facing scenario
- architecture workflow
- permission profile
- surface used
- DAG nodes
- evidence generated
- success/failure
- "worked by luck" concerns
- follow-up work
- logs/debug bundle location

## Promotion Gates

Promote a slice only when:

- task success improves without p95 regression
- p95 improves without task success regression
- proof rate improves
- unsafe rejection does not regress
- clarification rate drops without unsafe-action increase
- recovery success improves on known failure cases
- rerun stability is acceptable

Keep a feature behind flag when:

- one live success is the only proof
- flaky timing is hidden by retries
- verification is inconclusive
- safety boundary has manual test only
- high-risk action lacks rollback proof

## Suggested Scripts

Add or extend:

- `npm run smoke:computer-use-session`
- `npm run smoke:computer-use-action-adapter`
- `npm run smoke:computer-use-surface-manager`
- `npm run smoke:computer-use-browser-parity`
- `npm run smoke:computer-use-debug-bundle`
- `npm run dogfood:computer-use-browser`
- `npm run dogfood:computer-use-toolsmith`
- `npm run dogfood:computer-use-native-watch`
- `npm run dogfood:computer-use-30`
- `npm run gate:computer-use-promotion`
- `npm run smoke:computer-use-promotion-gate`

Promotion gate scripts must exit zero for policy-blocked slices when evidence is
internally valid. A slice blocked because it has only one live success is a
correct gate result, not a script failure.

Current gate evidence:

- `docs/reports/computer-use-promotion-gate-2026-05-16.md`
- `docs/reports/assets/computer-use-promotion-gate-2026-05-16/evidence.json`
- `docs/reports/assets/scoped-autonomy-web-research-live-runs.jsonl`
- `docs/reports/assets/computer-use-toolsmith-live-runs.jsonl`
- `docs/dogfood/browser-action-recovery-live-corpus.jsonl`

Runtime/debug surfaces:

- `GET /computer-use/eval/promotion-gate`
- `GET /computer-use/eval/dogfood-reports`
- `GET /computer-use/eval/dogfood-reports/content?path=...`
- Renderer Computer Use panel `Promotion gate` section.
- Renderer Computer Use panel `Dogfood reports` section.
- `npm run smoke:computer-use-promotion-gate-route`
- `npm run smoke:browser-action:recovery-live-corpus`
- Renderer status now distinguishes `eligible` promotable gates from `guarded`
  passed-but-non-promoting gates, and displays all current gate rows so release
  guards such as `windows_native_watch_boundary` are not hidden behind the first
  few promotable slices.
- Renderer dogfood links are daemon-owned and repo-relative. The content route
  only serves `docs/reports/**` and `docs/dogfood/**` Markdown/JSON/JSONL/TXT
  files, rejects absolute paths and traversal, and keeps generated evidence
  inspection out of raw local filesystem paths.

Current result: `promotable` for the live research-to-PDF slices. The 30-case
fixture gate passes readiness but remains non-promoting by design. The live
sample ledgers now record repeated runs, p95 samples, accepted source-quality
review, and calibrated browser fallback transport for both scoped autonomy and
parent Computer Session research-to-PDF paths. Browser fallback calibration is
based on repeated stable text hashes and lengths; raw browser text is not stored
in the sample ledgers.

The same gate now includes `browser_action_semantic_live_corpus`, backed by
`docs/dogfood/browser-action-semantic-live-corpus.jsonl` and reviewed live
Browser Action reports. The gate checks reviewed case count, report row
existence, pass status, mode matching, required intent coverage, widget UI plus
isolated source coverage, redaction, and latency samples before marking the
Browser Action live semantic corpus eligible for promotion review.

The promotion gate also includes `browser_action_recovery_live_corpus`, backed
by `docs/dogfood/browser-action-recovery-live-corpus.jsonl`. This corpus links
reviewed failure rows to later passing recovery rows without storing raw page
content. The gate checks failure-row preservation, recovery-row pass status,
mode matching, failure-class coverage (`permission_missing`, `wrong_effect`,
`latency_regression`), widget UI plus isolated source coverage, recovery
evidence tags, calibration-impact tags, redaction, and failure/recovery latency
samples. This keeps Browser Action promotion tied to known failure recovery
rather than success-only live traces.

The gate also includes `windows_native_watch_boundary` as a non-promoting
safety boundary. It reads the 30-case evidence, the deferred release signing
gate, package scripts, and the Computer Session implementation boundary to
confirm that read-only desktop observe is allowed, unsupported Windows/native
mutations remain blocked by design, high-risk Windows mutation is rejected,
`smoke:computer-use-native-watch-boundary` is wired into `smoke:all`, and
foreground input is stopped before native helper execution with
`actualInputSent: false`. This gate passes only as
`blocked_by_design_release_guard`; it must not be interpreted as promotion of
foreground desktop mutation.

## Release Readiness

Release checklist:

- `npm run lint`
- `npm run build:daemon`
- `npm run build:web`
- `npm run smoke:architecture-foundations`
- `npm run smoke:capability-runtime`
- `npm run smoke:browser-action`
- `npm run smoke:browser-bridge`
- `npm run smoke:vision-context`
- `npm run smoke:scoped-autonomy-self-implementation`
- `npm run smoke:computer-use-session`
- `npm run smoke:computer-use-action-adapter`
- `npm run smoke:computer-use-surface-manager`
- `npm run smoke:all`
- `git diff --check`
- strict UTF-8 check
- mojibake scan
- `.cs` BOM check if `.cs` files touched
- native helper signing smoke when release mode is enabled

## Acceptance Criteria

- A user can inspect why a task succeeded or failed from the UI.
- Debug bundle is enough to replay the reasoning path without raw secrets.
- 30-case dogfood corpus records scenario, workflow, result, and follow-up.
- Release readiness does not treat unsigned helper paths as production-ready.
