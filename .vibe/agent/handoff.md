# Handoff

## Current State

Codex Widget for Desktop is a Tauri + React + Node daemon desktop widget. The
native widget launches, Vite serves renderer assets during dev, and the daemon
listens on `127.0.0.1:4128`.

The latest completed product iteration is `iter-28`, covering Computer Use
credential consent and implementation-ready parity. Follow-up architecture
maintenance split the Computer Session runtime into focused runtime modules
without changing public session APIs.

## Latest Update: Computer Session Runtime Refactor

Split the former Computer Session runtime monolith along existing architecture
boundaries.

Implemented:

- Extracted shared runtime contracts to
  `src/daemon/computer-use/sessionRuntimeTypes.ts`.
- Extracted pure runtime helpers to
  `src/daemon/computer-use/sessionRuntimeHelpers.ts`.
- Moved Browser Action prompt planning/continuation into
  `src/daemon/computer-use/sessionPromptRuntime.ts`.
- Moved generic operation dispatch/freshness/terminal permission orchestration
  into `src/daemon/computer-use/sessionOperationRuntime.ts`.
- Moved browser action feedback, observation, action batch, and verifier
  evidence recording into
  `src/daemon/computer-use/sessionEvidenceRecorder.ts`.
- Moved rollback action execution/eval evidence into
  `src/daemon/computer-use/sessionRollbackRuntime.ts`.
- Added architecture smoke source-size budgets so `sessionRuntime.ts` stays
  below 3,600 lines and the new focused modules stay bounded.
- Updated the Windows Computer Use parity audit to inspect the new module
  locations for freshness/feedback and terminal rollback evidence.

Current size result: `sessionRuntime.ts` is about 3,490 lines, down from about
4,859 lines, with all extracted modules under 450 lines.

Verification passed so far:

- `npm run build:daemon`
- `npm run smoke:architecture-foundations`
- `npm run smoke:computer-use-session`
- `npm run smoke:browser-action:prompt-classification`
- `npm run lint`
- `npm run smoke:browser-action`
- `npm run smoke:computer-use-credential-consent`
- `npm run audit:computer-use-parity`
- `npm run smoke:computer-use-terminal-parity`
- `npm run audit:computer-use-implementation-ready`
- `npm run smoke:computer-use-debug-bundle`
- `npm run smoke:computer-use-effect-verifier`

## Latest Update: Computer Use Credential Consent And Implementation-Ready Parity

Completed iter-28 for the user's "3 and 6" Computer Use parity scope.

Implemented:

- Safe credential consent contract for scoped autonomy:
  expiring/revocable credential leases, reference-only vault handles, and
  explicit redaction policy in `AutonomyPermissionGrants`.
- Fail-closed credential permission evaluation unless a profile has
  `credentialAccess: "ask"`, the `credential` risk class, and a live matching
  consent lease.
- `revokeAutonomyCredentialLease(...)` storage support and
  `/computer-use/autonomy/profiles/:profileId/credential-leases/:leaseId/revoke`.
- Renderer profile evidence and validation for one-time expiring credential
  consent drafts.
- `docs/plans/computer-use-implementation-ready-parity.md` and
  `npm run audit:computer-use-implementation-ready`, which report local
  implementation readiness while leaving external blockers explicit.

Recent verification passed:

- `npm run build:daemon`
- `npm run smoke:computer-use-credential-consent`
- `npm run audit:computer-use-implementation-ready`
- `npm run smoke:renderer-computer-use-profile-draft`
- `npm run lint`
- `npm run smoke:computer-use-one-time-profile`
- `npm run audit:computer-use-parity`
- `npm run smoke:browser-action`
- `npm run smoke:all`

## Current Resume Point

Do not mark the global product goal complete. Iteration `iter-28` is complete
and the active sprint pointer is idle.

Next product work should start from a new iteration or an explicit continuation
request. Use `docs/plans/archive/roadmaps/` for historical roadmap context
instead of re-expanding the active roadmap.

## Remaining Boundaries

- Production signing and official app-server client-tool contract remain
  external blockers.
- VM/RDP/Windows Sandbox backend and GPU ASR/human microphone corpus validation
  remain deferred inputs.
- Unrestricted credential flows, unattended high-risk Windows mutation, and
  authenticated browser profile/cookie access remain blocked by policy.
- The current credential implementation uses reference-only vault handles; it
  does not retrieve raw secrets from Windows Credential Manager or DPAPI.

## Latest Update: Computer Use Parity Improvement Batch

Completed iter-29 through iter-34 for the user's feasible Computer Use
improvement list.

Implemented:

- UIA semantic tree read-only observe support with refs maps, snapshot and
  find-elements APIs, operation handling, redacted debug-bundle evidence, and
  `smoke:computer-use-uia-semantic-tree`.
- Browser profile/session/account/cookie permission policy on top of explicit
  consent leases, including account hints, revoke alias/audit response, default
  deny behavior, and `smoke:computer-use-browser-profile-permission`.
- Live task benchmark fixture corpus, benchmark runner, report/evidence output,
  and `live_task_benchmark_harness` promotion gate integration. It is passed as
  fixture evidence but non-promotable until user-captured live traces exist.
- Native helper v2 dev-contract smoke for foreground preflight, active-window
  and user-input guards, before/after evidence readiness, screenshot metadata,
  disabled command contracts, and unsigned-helper blocker semantics.
- VM/sandbox adapter-shaped boundary for mock, Windows Sandbox, Hyper-V, RDP,
  and cloud providers, wired into `future_vm_session` evidence with fail-closed
  smoke coverage.
- ASR benchmark corpus harness with audio metadata, WER, command accuracy,
  CPU fixture report/evidence, and `smoke:asr-benchmark-harness`.

Verification passed:

- `npm run build:daemon`
- `npm run lint`
- `npm run smoke:computer-use-uia-semantic-tree`
- `npm run smoke:computer-use-browser-profile-permission`
- `npm run smoke:computer-use-live-task-benchmark`
- `npm run smoke:browser-native-desktop-helper-v2-dev-contract`
- `npm run smoke:computer-use-vm-sandbox-boundary`
- `npm run smoke:computer-use-vm-sandbox-adapter`
- `npm run smoke:computer-use-credential-consent`
- `npm run smoke:asr-benchmark-harness`
- `npm run smoke:computer-use-promotion-gate`
- `npm run smoke:all`

Encoding checks passed with strict UTF-8 validation over 42 touched text files
and mojibake scan reporting 0 suspicious matches. The Unix `file` utility is
not installed in this PowerShell environment, so strict UTF-8 validation was
used as the local fallback.

Current resume point: active sprint pointer is idle after iter-34. Remaining
production blockers are still external signing, official app-server client-tool
contract, real VM backend configuration, GPU ASR environment, and user-provided
live task/audio corpora.
