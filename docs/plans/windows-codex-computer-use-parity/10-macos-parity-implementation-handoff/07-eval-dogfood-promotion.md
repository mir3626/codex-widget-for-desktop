# 07 - Eval, Dogfood, And Promotion

## Objective

Make parity measurable. A feature is not complete because a smoke test passes.
It is complete when repeated dogfood shows task-level success, proof quality,
latency, redaction, and recovery behavior under stable gates.

## Eval Ledger

Every Computer Session should record:

- eval run id,
- scenario id when available,
- prompt,
- modality inputs,
- permission profile id/snapshot,
- surface,
- DAG nodes,
- action trace,
- observations,
- perception graph evidence,
- resources/artifacts,
- verifier result,
- elapsed time,
- step count,
- clarification count,
- recovery path,
- task success,
- failure class,
- false-positive/false-negative audit affordance.

## Metrics

Required rollups:

- task success rate,
- proof rate,
- p50 latency,
- p95 latency,
- perception p50/p95,
- action count,
- clarification rate,
- abstention rate,
- unsafe rejection rate,
- recovery success,
- verifier false-positive audit count,
- verifier false-negative audit count,
- rerun stability,
- redaction violations.

Promotion cannot rely on:

- one live success,
- raw model confidence,
- raw WER/OCR accuracy,
- average latency with worse p95,
- fixture-only success,
- hidden retry flakiness.

## Dogfood Corpus

Maintain a 30+ scenario corpus with these categories:

1. Public web research to Markdown/PDF.
2. Browser search and navigation.
3. Browser form fill without submission.
4. Browser form submission with approval.
5. Bookmark create/update/delete.
6. Tab group create/claim/release.
7. Download start/observe/verify.
8. File upload blocked without grant.
9. File upload succeeds with explicit grant.
10. History search blocked/approved one-time.
11. Debugger inspect/screenshot/print-to-PDF approved one-time.
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
25. Browser permission popup outcome via contentSettings.
26. Native file picker blocked until helper v2.
27. Windows settings read-only dogfood.
28. Windows settings mutation blocked.
29. Credential prompt manual takeover.
30. Recovery after wrong target or stale observation.

Each record should include:

- user-facing scenario,
- architecture workflow,
- permission profile,
- surface,
- DAG nodes,
- evidence generated,
- success/failure,
- "worked by luck" concern,
- follow-up work,
- logs/debug bundle location.

## Promotion Gate Classes

Use explicit gate classes:

- `eligible`: repeated evidence supports promotion.
- `guarded`: implementation is correct but safety/release guard prevents broad
  promotion.
- `blocked`: external or non-negotiable blocker.
- `deferred`: intentionally not pursued now.
- `fixture_only`: useful smoke but not live proof.
- `insufficient_samples`: live path exists but sample count too low.

## Browser Promotion Criteria

Browser Action:

- repeated public-site live samples,
- target evidence through perception graph,
- post-action observation and verifier proof,
- recovery cases included,
- Korean prompt phrasing included,
- p95 tracked.

Browser Chrome:

- repeated download.verify samples,
- repeated debugger.print_to_pdf samples,
- high-risk one-time approvals verified,
- path/history redaction verified,
- resource/proof rate tracked,
- no arbitrary CDP/eval.

## Toolsmith Promotion Criteria

Toolsmith:

- live allowed-domain source extraction,
- generated/reviewed tool smoke pass,
- artifact proof and source citations,
- rerun stability,
- dependency provenance,
- rollback proof,
- blocked cases explain exact grants.

## Native Promotion Criteria

Native helper v1:

- can remain bounded browser-window helper only.

Foreground helper v2:

- signed helper proof,
- countdown/user-input abort,
- active-window/process allowlist,
- pre/post evidence,
- effect verifier,
- rollback proof,
- repeated dogfood,
- release readiness gate.

Until then, native foreground input is a guarded/blocking boundary, not a
promotable feature.

## Debug Bundle Export

Renderer and daemon should support copying/saving a bundle containing:

- session state,
- profile and grants,
- DAG,
- observations,
- graph,
- actions,
- capability jobs,
- resources,
- artifacts,
- verifier,
- rollback,
- failure memory,
- promotion-gate evidence links.

This is required for real user dogfood triage.

