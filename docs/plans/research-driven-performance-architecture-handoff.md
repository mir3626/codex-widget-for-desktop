# Research-Driven Performance Architecture Handoff

Status: proposed macro-architecture handoff

Decision owner: product owner

Decision date: 2026-05-14

## Executive Position

The next major architecture step should be research-led rather than
implementation-led. When an existing widget structure conflicts with a
well-supported paper direction, the paper-backed direction should win unless it
violates local safety, credential, or user-consent boundaries.

The daemon remains the local control plane, but its role must grow from
"message broker plus helper supervisor" into a scientific execution engine:

- define reproducible tasks
- collect multimodal evidence
- run fast cascades before expensive models
- verify concrete effects before completion
- store failures as structured calibration data
- promote changes only when task-level metrics improve

The project should stop optimizing isolated subsystems first. It should optimize
measured end-to-end task success, latency, clarification rate, recovery quality,
and proof quality.

## Research Sources

Primary sources used for this handoff:

- Whisper: Robust Speech Recognition via Large-Scale Weak Supervision
  <https://arxiv.org/abs/2212.04356>
- SpecAugment: A Simple Data Augmentation Method for Automatic Speech
  Recognition <https://arxiv.org/abs/1904.08779>
- Contextualized Streaming End-to-End Speech Recognition with Trie-Based Deep
  Biasing and Shallow Fusion <https://arxiv.org/abs/2104.02194>
- Weighted Finite-State Transducers in Speech Recognition
  <https://research.google/pubs/weighted-finite-state-transducers-in-speech-recognition-3/>
- ScreenAI: A Vision-Language Model for UI and Infographics Understanding
  <https://arxiv.org/abs/2402.04615>
- SeeClick: Harnessing GUI Grounding for Advanced Visual GUI Agents
  <https://arxiv.org/abs/2401.10935>
- OmniParser for Pure Vision Based GUI Agent
  <https://arxiv.org/abs/2408.00203>
- Pix2Struct: Screenshot Parsing as Pretraining for Visual Language
  Understanding <https://arxiv.org/abs/2210.03347>
- EAST: An Efficient and Accurate Scene Text Detector
  <https://arxiv.org/abs/1704.03155>
- CRAFT: Character Region Awareness for Text Detection
  <https://arxiv.org/abs/1904.01941>
- TrOCR: Transformer-based OCR with Pre-trained Models
  <https://arxiv.org/abs/2109.10282>
- PP-OCRv3: More Attempts for the Improvement of Ultra Lightweight OCR System
  <https://arxiv.org/abs/2206.03001>
- WebArena: A Realistic Web Environment for Building Autonomous Agents
  <https://arxiv.org/abs/2307.13854>
- Mind2Web: Towards a Generalist Agent for the Web
  <https://arxiv.org/abs/2306.06070>
- OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer
  Environments <https://arxiv.org/abs/2404.07972>
- ReAct: Synergizing Reasoning and Acting in Language Models
  <https://arxiv.org/abs/2210.03629>
- Reflexion: Language Agents with Verbal Reinforcement Learning
  <https://arxiv.org/abs/2303.11366>
- BranchyNet: Fast Inference via Early Exiting from Deep Neural Networks
  <https://arxiv.org/abs/1709.01686>
- DeeBERT: Dynamic Early Exiting for Accelerating BERT Inference
  <https://arxiv.org/abs/2004.12993>
- FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness
  <https://arxiv.org/abs/2205.14135>

## Architecture Mandates

### 1. Evaluation Becomes The Top-Level Product Surface

Research basis: WebArena, Mind2Web, OSWorld.

Current problem:

- Browser Action, Vision Context, ASR, terminal, and Windows helper work have
  separate smokes and dogfood reports.
- Unit correctness can improve while actual task success remains flat.
- Latency is recorded in several places but is not yet a single release budget.

Mandate:

- Add a unified `computer_use_eval` ledger owned by the daemon.
- Every scenario records task setup, prompt, modality inputs, action trace,
  evidence graph, verifier result, elapsed time, step count, clarification
  count, recovery path, and final task success.
- A feature is not "better" unless it improves task-level success or latency
  against a fixed baseline corpus.

Architectural change:

```text
today:
  provider smoke -> local pass/fail

target:
  scenario corpus -> daemon eval run -> evidence graph -> verifier -> metric ledger
```

Required metrics:

- task success rate
- functional correctness proof rate
- p50/p95 end-to-end latency
- p50/p95 perception latency
- action count per task
- clarification rate
- abstention rate
- unsafe-action rejection rate
- recovery success rate
- verifier false-positive and false-negative audit counts

### 2. ASR Becomes A Candidate Lattice Plus Deterministic Decoder

Research basis: Whisper, SpecAugment, trie-based contextual biasing, WFST.

Current problem:

- The local ASR path returns one transcript string.
- Slot repair exists only in narrow benchmark normalization.
- Korean commands with English package names, app names, UI labels, and browser
  terms need deterministic normalization before model prompting.

Mandate:

- Treat ASR output as candidates, not truth.
- Add a deterministic ASR post-decoder that uses:
  - contextual aliases from current UI labels, app names, bookmarks, file names,
    package names, and recent command history
  - Korean/English canonicalization rules
  - WFST-like grammar scoring for allowed command forms
  - slot preservation scoring before transcript confidence
  - clarification when command slots are underdetermined

Architectural change:

```text
audio chunks
  -> VAD segments
  -> persistent ASR worker
  -> transcript candidates
  -> contextual lexicon and trie bias
  -> deterministic command grammar
  -> slot confidence
  -> intent candidate or clarification
```

Design priority:

- Do not fine-tune first.
- Do not treat WER as the primary metric.
- Optimize command intent and slot preservation first.
- Fine-tuning or LoRA is allowed only after a representative human corpus
  exists.

Deferred inputs:

- Human microphone corpus recording is currently deferred.
- GPU validation is currently deferred.

### 3. Vision Context Becomes A Multimodal Evidence Graph

Research basis: ScreenAI, SeeClick, OmniParser, Pix2Struct.

Current problem:

- The project has separate browser DOM, UIA/native helper, OCR, screenshot, and
  Vision paths.
- The agent can receive context, but the architecture does not yet have one
  canonical graph that explains why a target is actionable.

Mandate:

- Build a `perception_graph` abstraction.
- Every candidate UI element is a node.
- DOM, UIA, OCR, screenshot detector, visual parser, and previous observation
  data attach evidence edges to the node.
- Actions may only target nodes that satisfy evidence thresholds for the action
  risk class.

Architectural change:

```text
browser DOM observe
screen capture
Windows UIA observe
OCR text boxes
visual GUI parser
previous stable observation
  -> perception graph
  -> target candidates
  -> verifier-ready action plan
```

Evidence classes:

- semantic label
- visible text
- accessibility role
- DOM selector or UIA selector
- bounding box
- screenshot region
- OCR text box
- z-order/occlusion signal
- freshness timestamp
- source reliability
- disagreement notes

Rule:

- If evidence sources disagree, the system should abstain or ask a
  clarification unless the action is read-only and reversible.

### 4. Vision/OCR Speed Uses ROI, Delta, And Cascades

Research basis: EAST, CRAFT, TrOCR, PP-OCRv3, BranchyNet, DeeBERT.

Current problem:

- Full-screen OCR or full-screen VLM passes are too expensive for interactive
  computer use.
- The daemon can schedule capability jobs, but the perception pipeline does not
  yet enforce early exits.

Mandate:

- Default to cheap observers and cached evidence.
- Re-run expensive OCR or VLM only on dirty regions.
- Introduce early-exit confidence thresholds.
- Escalate from cheap to expensive perception only when the verifier needs it.

Target cascade:

```text
cached graph hit
  -> DOM/UIA fresh observe
  -> tile diff + ROI OCR
  -> text detector + recognizer
  -> GUI parser
  -> VLM fallback
```

Implementation details:

- Use screenshot tile hashes and perceptual diff to identify dirty regions.
- Persist ROI evidence as blob-backed resources.
- Store OCR boxes separately from recognized text.
- Allow multiple OCR backends behind the same evidence schema.
- Track p50/p95 latency per cascade stage.

### 5. Agent Execution Uses Bounded ReAct Plus Structured Reflexion

Research basis: ReAct, Reflexion.

Current problem:

- Browser Action and capability jobs already follow observe/act/verify in parts,
  but the loop is not yet a formal architecture primitive across all modes.
- Failure feedback is collected, but not systematically converted into durable
  policy updates.

Mandate:

- Standardize every computer-use task as:

```text
plan -> observe -> select evidence -> act -> observe -> verify -> commit
```

- Store failures as structured records, not free-form memory.
- Reflexion-style learning may update:
  - calibration weights
  - recovery rules
  - alias maps
  - known bad target patterns
  - scenario-specific abstention triggers

It may not bypass:

- user approval
- safety policy
- credential boundaries
- restricted-page boundaries
- evidence freshness requirements

### 6. The Daemon Scheduler Becomes A Capability DAG Runtime

Research basis: OSWorld-style execution-based evaluation plus early-exit and
IO-aware scheduling principles.

Current problem:

- Capability jobs are durable and supervised, but still mostly single-job
  requests.
- Perception work can be parallelized more aggressively.

Mandate:

- Expand capability jobs into DAG nodes:
  - independent observers run in parallel
  - expensive fallbacks wait on confidence gates
  - verifier runs only when required evidence is ready
  - cancellation propagates through the DAG
  - resource accounting is per node and per task

Target shape:

```text
capability task
  -> setup node
  -> parallel observe nodes
  -> graph merge node
  -> plan node
  -> approval node if needed
  -> action node
  -> verification node
  -> eval ledger node
```

The existing daemon foundation should be migrated rather than replaced.

### 7. Memory Becomes Calibration, Not Authority

Research basis: Reflexion plus benchmark-driven agent evaluation.

Current problem:

- Semantic memory is advisory, but future work could accidentally over-trust it.

Mandate:

- Memory must never be a proof source for a current UI state.
- Memory can rank candidates only after current evidence exists.
- Memory records must include provenance, scenario, failure class, and expiry.
- All memory effects must be visible in debug bundles.

## Process Mandates

### Paper-First RFC Rule

Any major change to ASR, perception, action selection, verification, or agent
memory must include:

- paper or benchmark basis
- hypothesis
- baseline metric
- expected metric movement
- failure mode to watch
- rollback condition

### Experiment Lifecycle

Every performance improvement should use this lifecycle:

```text
propose -> baseline -> implement behind flag -> dogfood -> compare -> promote or revert
```

Required artifacts:

- scenario corpus row
- local benchmark report
- debug bundle sample
- latency table
- failure-class audit
- handoff/session-log entry

### Metric Promotion Rules

Promote a change only if one is true:

- task success improves without p95 latency regression
- p95 latency improves without task success regression
- clarification rate drops without unsafe-action increase
- verifier false-positive rate drops
- recovery success improves on known failure corpus

Do not promote based only on:

- raw WER
- raw OCR accuracy
- model confidence
- one live success
- lower average latency with worse p95

## Proposed Workstreams

### Workstream A: Unified Computer-Use Eval Ledger

Goal:

- Make OSWorld/WebArena-style execution-based evaluation the release gate.

Deliverables:

- `computer_use_eval_runs` and `computer_use_eval_steps` storage tables.
- Scenario schema for browser, Windows, ASR, Vision, terminal, and cross-app
  tasks.
- Metric rollup script.
- Renderer debug export integration.
- Release/readiness summary section.

Acceptance:

- Existing Browser Action live corpus and Windows dogfood reports can be
  imported into the ledger.
- Each eval run has task success, latency, proof, and failure-class fields.

### Workstream B: ASR Deterministic Decoder

Goal:

- Improve Korean command reliability without waiting on model fine-tuning.

Deliverables:

- Contextual lexicon builder from UI labels, file names, app names, bookmarks,
  package names, and recent successful commands.
- Korean/English canonical alias rules.
- WFST-like command grammar scorer.
- Slot preservation confidence.
- Clarification gate based on slot risk.
- ASR debug bundle section.

Acceptance:

- Synthetic and future human corpora report command-slot accuracy.
- Mixed Korean/English package names are canonicalized before agent planning.
- Low-confidence side-effect commands ask clarification rather than guessing.

### Workstream C: Perception Graph

Goal:

- Merge DOM, UIA, OCR, screenshot, and visual parser evidence into one target
  selection substrate.

Deliverables:

- Shared `PerceptionGraph` protocol.
- Evidence node/edge schema.
- Browser Action target selection migrated to graph reads.
- Native helper observations mapped into graph nodes.
- OCR regions mapped into graph nodes.
- Debug graph export.

Acceptance:

- A target candidate can explain every score with source evidence.
- Disagreement between DOM/UIA/OCR/visual sources is visible.
- High-risk actions require stronger evidence than read-only actions.

### Workstream D: ROI And Cascade Perception Runtime

Goal:

- Reduce Vision Context latency by avoiding full-screen expensive passes.

Deliverables:

- Tile hash and dirty-region detector.
- ROI OCR capability job.
- OCR detection/recognition split.
- Stage-level latency marks.
- Early-exit confidence gates.
- VLM fallback contract.

Acceptance:

- Unchanged screens avoid OCR/VLM rework.
- Changed-region OCR is measured separately from full-screen OCR.
- p95 perception latency has a tracked budget.

### Workstream E: Structured Failure Memory

Goal:

- Convert failures into calibration without letting memory become authority.

Deliverables:

- Failure class taxonomy.
- Reflexion-style structured failure record.
- Calibration updater for aliases, bad-target patterns, and recovery hints.
- Expiry/provenance enforcement.
- Debug visibility in exported bundles.

Acceptance:

- A repeated known failure changes ranking or clarification behavior.
- Memory never completes a task without current evidence.

### Workstream F: Capability DAG Scheduler

Goal:

- Let daemon execute perception, action, and verification as a cancellable DAG.

Deliverables:

- Capability DAG protocol.
- Parallel observer fan-out.
- Confidence-gated fallback nodes.
- Per-node resources and timings.
- DAG cancellation and shutdown reconciliation.

Acceptance:

- Browser/Windows tasks can run DOM/UIA/OCR observers in parallel.
- Expensive fallback work is skipped when cheap evidence is enough.
- Eval ledger records every DAG node.

## Migration Order

1. Add eval ledger and metric rollups.
2. Add ASR deterministic decoder around existing persistent worker.
3. Add perception graph schema without changing all providers.
4. Migrate Browser Action target selection to perception graph.
5. Add ROI OCR and dirty-region cascade.
6. Add structured failure memory.
7. Expand capability jobs into DAG execution.
8. Revisit model-level upgrades after enough corpus exists.

## Conflicts With Current Structure

The following conflicts are intentional:

- Provider-specific success reports become subordinate to unified eval metrics.
- Single transcript ASR becomes candidate/slot decoding.
- Snapshot-style Vision Context becomes graph evidence plus ROI refresh.
- Simple queued capability jobs evolve into DAG execution.
- Debug bundles become required evidence artifacts, not optional diagnostics.
- Release readiness must include performance and task-success budgets.

The current implementation can remain operational during migration, but new
high-impact work should move toward these paper-backed structures instead of
deepening one-off provider paths.

## Non-Negotiable Boundaries

Paper priority does not override:

- explicit user approval
- restricted page handling
- credential secrecy
- local-only daemon security
- destructive-action protections
- raw microphone/audio privacy
- raw screenshot/blob retention policy

## Current Deferrals

- GPU ASR validation is deferred.
- Human microphone corpus recording and benchmark execution are deferred.
- ASR fine-tuning or LoRA is deferred until enough representative human corpus
  evidence exists.
- Public release signing remains blocked on certificate or signing service.

## Recommended Next Slice

Start with Workstream A plus the minimum schema for Workstream B:

- create the eval ledger schema and import path
- define scenario/result JSON schema
- add metric rollup script
- add ASR command-slot metric fields
- do not change action execution behavior yet

This gives the project a stable measuring instrument before changing the
subsystems being measured.
