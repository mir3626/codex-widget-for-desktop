# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: idle
> **Completed**: iter-29-sprint-01-uia-semantic-tree-observe-api, iter-30-sprint-01-browser-profile-lease-policy, iter-31-sprint-01-live-task-benchmark-and-gate, iter-32-sprint-01-helper-v2-dev-contract-smoke, iter-33-sprint-01-vm-sandbox-adapter-boundary, iter-34-sprint-01-asr-benchmark-corpus-harness
> **Pending**: -
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration iter-28: Computer Use Credential Consent And Implementation-Ready Parity

Status: complete.

Carryover: Windows Codex Computer Use parity is locally implemented with guarded
boundaries, but production signing, official app-server client-tool contract,
VM/sandbox backend, and ASR corpus validation remain external or user-test
dependent. The user chose to defer signing, VM/cloud, and ASR work, keep the
app-server path local-contract only, and implement credential consent/revoke/
redaction plus a local implementation-ready audit as far as possible.

### iter-28-sprint-01-credential-consent-lease-boundary

Goal: implement user-consented credential handling without opening unrestricted
credential access.

Expected scope: shared protocol types for credential consent leases, redacted
vault references, redaction policy, fail-closed permission evaluation, profile
storage normalization, explicit revoke route, renderer profile validation, and
focused smoke coverage.

Status: complete. Added shared credential consent lease, vault-reference, and
redaction policy types; fail-closed evaluator logic; profile storage
normalization; explicit HTTP lease revoke; renderer validation/evidence display;
and focused daemon/renderer smoke coverage. The implementation does not retrieve
raw secrets from any vault.

### iter-28-sprint-02-implementation-ready-parity-audit

Goal: separate local implementation readiness from production/external blockers
so Computer Use parity status remains honest.

Expected scope: implementation-ready design doc, local contract/deferred VM/ASR
documentation, dedicated audit/report/evidence script, package script wiring,
and refreshed context/checkpoint state.

Status: complete. Added `docs/plans/computer-use-implementation-ready-parity.md`
and `npm run audit:computer-use-implementation-ready`, which reports
`implementation_ready_with_external_deferred` when local readiness evidence is
present while production signing, official app-server contract, VM/cloud, and
ASR corpus inputs remain deferred.

## Iteration iter-29: Computer Use UIA Semantic Tree

Status: complete.

Carryover: UIA semantic refs were a feasible implementation-ready parity item
after iter-28, but they had to start as read-only observe with no native input.

### iter-29-sprint-01-uia-semantic-tree-observe-api

Goal: add refs-map semantic tree support for windows, buttons, textboxes,
menus, lists, and stable find-elements queries.

Status: complete. Added shared semantic tree protocol types, UIA/native-helper
snapshot normalization, `/computer-use/snapshot`,
`/computer-use/find-elements`, session-scoped snapshot/find-elements routes,
operation handling, redacted debug-bundle evidence, and
`smoke:computer-use-uia-semantic-tree`.

## Iteration iter-30: Browser Profile Permission Model

Status: complete.

Carryover: Credential consent leases existed, but authenticated browser
profile/session/account/cookie access needed its own default-deny policy layer.

### iter-30-sprint-01-browser-profile-lease-policy

Goal: implement explicit browser profile/session/account/cookie requirements,
lease matching, revoke, redaction, and audit evidence.

Status: complete. Added browser profile policy evaluation, account hints on
leases, browser-profile lease revoke route/audit response, permission decision
summaries, and `smoke:computer-use-browser-profile-permission`.

## Iteration iter-31: Computer Use Live Task Benchmark Harness

Status: complete.

Carryover: Existing process gates did not provide a dedicated benchmark corpus
for Windows app, browser, and terminal live task classes.

### iter-31-sprint-01-live-task-benchmark-and-gate

Goal: add corpus format, success/latency/rollback/evidence metrics,
report/evidence output, and promotion gate integration.

Status: complete. Added `docs/eval/computer-use-live-task-corpus.fixture.json`,
`scripts/benchmark-computer-use-live-tasks.mjs`,
`smoke:computer-use-live-task-benchmark`, generated fixture report/evidence,
and `live_task_benchmark_harness` promotion gate integration. Fixture evidence
is non-promotable until user-captured live traces are supplied.

## Iteration iter-32: Native Helper V2 Dev Contract

Status: complete.

Carryover: Foreground watch and disabled helper-v2 boundaries were present, but
the dev/unsigned contract needed direct smoke coverage.

### iter-32-sprint-01-helper-v2-dev-contract-smoke

Goal: verify foreground preflight, active-window/user-input guards,
before/after evidence readiness, screenshot metadata, disabled commands, and
unsigned-helper blocker semantics.

Status: complete. Added `smoke:browser-native-desktop-helper-v2-dev-contract`,
which ties protocol, helper client, adapter, and contract verifier evidence
together without sending native input.

## Iteration iter-33: VM Sandbox Adapter Boundary

Status: complete.

Carryover: `future_vm_session` existed as a runtime block; it needed an
adapter-shaped boundary for future Windows Sandbox, Hyper-V, RDP, and cloud
providers.

### iter-33-sprint-01-vm-sandbox-adapter-boundary

Goal: define adapter contracts, mock/local unavailable/dev boundaries, and
fail-closed smoke coverage.

Status: complete. Added `vmSandboxAdapter.ts`, adapter descriptors for mock,
Windows Sandbox, Hyper-V, RDP, and cloud, runtime boundary evidence, selected
adapter metadata, and `smoke:computer-use-vm-sandbox-adapter`.

## Iteration iter-34: ASR Benchmark Harness

Status: complete.

Carryover: ASR candidate benchmarking existed, but corpus-level WER and command
accuracy validation needed a standalone report/evidence harness.

### iter-34-sprint-01-asr-benchmark-corpus-harness

Goal: add audio metadata corpus, expected transcript, WER, command accuracy,
CPU fixture smoke, and report/evidence output.

Status: complete. Added `docs/eval/asr-benchmark-corpus.fixture.json`,
`scripts/benchmark-asr-corpus.mjs`, generated fixture report/evidence, and
`smoke:asr-benchmark-harness`. GPU and microphone-corpus validation remain
future user/environment-dependent work.
