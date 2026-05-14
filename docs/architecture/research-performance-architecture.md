# Research Performance Architecture

This shard records the implemented macro-architecture from
`docs/plans/research-driven-performance-architecture-handoff.md`.

The direction is paper-prioritized: task success, proof quality, calibrated
failure handling, and p95 latency are the promotion gates. Model confidence,
single-run success, raw WER, raw OCR accuracy, or average latency alone are not
promotion evidence.

## Implemented Workstreams

### A. Unified Computer-Use Eval Ledger

- Storage schema v4 adds daemon-owned `computer_use_eval_runs`,
  `computer_use_eval_steps`, `computer_use_eval_resources`,
  `perception_graphs`, `structured_failure_memory`, `capability_dag_runs`, and
  `capability_dag_nodes`.
- Shared protocol types live in
  `src/shared/protocol/researchArchitecture.ts`.
- Storage APIs live in `src/daemon/storage/researchArchitecture.ts`.
- Eval rollup/readiness helpers live in `src/daemon/computer-use-eval/`.
- Import path:
  `npm run eval:computer-use:import`.
- Rollup path:
  `npm run eval:computer-use:rollup -- --json`.
- Debug/readiness HTTP surfaces:
  - `GET /computer-use/eval/runs`
  - `GET /computer-use/eval/runs/:id`
  - `GET /computer-use/eval/readiness`
  - `GET /computer-use/perception-graphs`
  - `GET /computer-use/failure-memory`

### B. ASR Deterministic Decoder

- Existing faster-whisper persistent worker support remains the current runtime
  evidence path.
- `src/daemon/transcription/deterministicDecoder.ts` converts transcript output
  into candidates, canonical command text, command slots, slot preservation
  confidence, grammar score, alias hits, and clarification decisions.
- The decoder builds contextual lexicons from UI labels, app names, bookmarks,
  file names, package names, and recent successful commands.
- Korean/English aliases normalize common command/package phrases such as
  `react-router-dom`.
- Side-effect risk gates low-confidence commands into clarification rather than
  trusting the top transcript.
- GPU ASR validation, human microphone corpus benchmarking, and ASR
  fine-tuning/LoRA remain deferred.

### C. Perception Graph

- `src/daemon/perception-graph/` defines graph construction and target
  explanation helpers.
- Evidence nodes include semantic label, visible text, accessibility role,
  selector, bbox, freshness, source reliability, and disagreement notes.
- Browser Action target resolution now reads a perception graph explanation and
  applies stronger thresholds for side-effect and high-risk actions.
- OCR output can be mapped into perception graph nodes and stored through the
  daemon graph table.

### D. ROI And Cascade Runtime

- `src/daemon/perception-cascade/` provides screenshot tile hashing,
  dirty-region detection, and cascade planning.
- `screen_observe` capability jobs now produce tile hashes, dirty regions, and
  cascade stage summaries.
- `ocr` capability jobs map recognized text into perception graphs.
- Cascade stages are ordered for cheap evidence first: cached graph, DOM/UIA
  observe, tile diff, ROI OCR, detector, recognizer, GUI parser, and VLM
  fallback.

### E. Structured Failure Memory

- `src/daemon/failure-memory/` records Reflexion-style failure records with
  scenario provenance, expiry, calibration impact, and safety boundaries.
- Memory can supply alias, bad-target, recovery, and abstention calibration
  hints only after current evidence exists.
- Memory is never a proof source, never completes a task, and never bypasses
  approval, restricted-page, credential, freshness, or destructive-action
  boundaries.

### F. Capability DAG Scheduler

- `src/daemon/capability-dag/` evolves capability jobs into a cancellable DAG
  substrate without replacing the existing queue.
- DAG nodes cover setup/local nodes, parallel observe nodes, graph merge, plan,
  approval, action, verification, and eval ledger nodes.
- Capability nodes enqueue existing capability jobs and carry `dagRunId`,
  `dagNodeId`, and `evalRunId` through job input.
- Capability runtime now auto-creates eval runs for generic capability jobs that
  do not already carry an `evalRunId`, records per-event eval steps, finalizes
  runs on final job events, and links capability resources into eval resources.
- DAG node status updates preserve fast completed states so quick handlers do
  not get overwritten by stale running snapshots.

### G. Scoped Autonomy Toolsmith

- `docs/plans/scoped-autonomy-toolsmith-runtime-handoff.md` defines the
  permission-scoped self-implementation path for Codex-YOLO-like computer use.
- `src/shared/protocol/scopedAutonomy.ts` and storage schema v5 add permission
  profiles, autonomy runs, capability gaps, generated tool specs, and generated
  tool runs.
- `src/daemon/scoped-autonomy/` implements deterministic gap detection,
  scoped permission evaluation, redaction, and a Toolsmith runtime that
  materializes reviewed built-in templates into the daemon runtime workspace.
- Initial Toolsmith support covers `web_research_to_pdf`: a missing workflow is
  detected, required grants are checked, a Node tool template is materialized,
  fixture smoke must pass, and execution emits Markdown/PDF artifacts linked to
  eval resources.
- Generated tools currently use reviewed templates only. Arbitrary generated
  code synthesis remains deferred until there is stronger sandboxing, signing,
  review, and rollback policy.
- HTTP debug/execution surfaces under `/computer-use/autonomy/*` expose profiles,
  runs, gaps, generated tool specs, and tool runs, and can drive
  plan/materialize/smoke/execute from the daemon surface.

## Safety Boundaries

Research-driven architecture does not override:

- explicit user approval
- restricted-page handling
- credential secrecy
- local-only daemon security
- destructive-action protection
- raw microphone/audio privacy
- raw screenshot/blob retention policy
- release signing constraints

## Verification

Focused smoke:

```powershell
npm run smoke:research-performance-architecture
npm run smoke:scoped-autonomy-toolsmith
```

Computer-use scenario dogfood:

```powershell
npm run dogfood:research-computer-use
npm run dogfood:computer-use-process-30
npm run dogfood:scoped-autonomy-toolsmith
```

These generate dated scenario catalogs under `docs/dogfood/`, write JSON
evidence under `docs/reports/assets/`, and write Markdown reports under
`docs/reports/`. `dogfood:computer-use-process-30` is the broader user-like
process validation set and intentionally records passed, blocked, and
needs-follow-up outcomes instead of forcing unsupported or unsafe workflows to
look successful.

Architecture-wide closure should include:

```powershell
npm run lint
npm run build:daemon
npm run build:web
npm run smoke:architecture-foundations
npm run smoke:capability-runtime
npm run smoke:browser-action
npm run smoke:vision-context
npm run smoke:asr-runtime-candidates
npm run smoke:research-performance-architecture
npm run smoke:scoped-autonomy-toolsmith
npm run dogfood:research-computer-use
npm run dogfood:computer-use-process-30
npm run dogfood:scoped-autonomy-toolsmith
npm run smoke:all
git diff --check
```
