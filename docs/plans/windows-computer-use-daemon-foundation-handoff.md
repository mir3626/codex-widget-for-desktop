# Windows Computer Use Daemon Foundation Handoff

Status: foundation implemented and audited
Owner: Codex
Date: 2026-05-12

## Objective

Build the daemon foundation needed for a Windows version of Codex computer use.
The target is a local, single-user desktop control plane that can coordinate
screen, browser, desktop UI Automation, OCR, terminal, and agent-tool work
without introducing a separate helper-to-helper invocation mesh or external
message broker.

The daemon remains the authority for workflow, safety, state, cancellation,
timeouts, memory budget, result correlation, and user-visible events. Helpers
remain bounded workers that perform one typed job and return normalized results.

## Baseline

The current product already has several pieces of the required model:

- Browser Action has a daemon-owned session manager, adapter registry, pending
  command queue, approval handling, extension ack/result completion, and prompt
  continuation.
- Browser Bridge extension uses poll/WebSocket command pickup plus ack/result
  HTTP callbacks.
- Native desktop helper uses a stdin JSON -> stdout JSON contract for bounded
  Windows UI Automation actions.
- Vision and screen providers post snapshots into the daemon and can attach
  images to Codex app-server turns.
- Terminal/PTY is daemon-owned and exposes direct renderer input events.
- SQLite already stores sessions, messages, provider snapshots, terminal
  events, blobs, artifacts, activity, and semantic memory.
- `docs/architecture/capability-transaction.md` defines the shared transaction
  shape: acquire context, frame intent, generate candidates, gate, bind, execute,
  reobserve, verify, and publish redacted feedback.

What is missing is a general daemon foundation for durable capability work,
resource control, helper process supervision, cancellation, and a stable event
contract that can be reused by Windows computer-use features beyond Browser
Action.

## Non-Goals

- Do not add Kafka, Redis, NATS, or any external broker for the local product.
- Do not allow helpers to freely call each other.
- Do not turn native desktop helpers into arbitrary unsupervised desktop
  control.
- Do not persist raw passwords, tokens, cookies, payment values, API keys,
  screenshots containing secrets without an explicit retention policy, or full
  unbounded accessibility trees.
- Do not make browser `evaluate` or arbitrary script execution part of the
  normal computer-use path.
- Do not bypass daemon-owned approval, audit, timeout, and cancellation.

## Target Architecture

```text
renderer
  -> daemon capability API
    -> durable job queue and transaction store
    -> resource manager
    -> concurrency scheduler
    -> approval/cancellation controller
    -> helper process supervisor
      -> screen helper
      -> OCR helper/runtime
      -> browser extension bridge
      -> native desktop UIA helper
      -> PTY process
      -> future app-server tool helpers
    <- normalized observations/results
  <- capability events and artifacts
```

The daemon is not Kafka. It is a local stateful workflow coordinator with:

- one durable queue for capability jobs,
- one in-memory scheduler for active work,
- one resource budget manager,
- one event stream to renderer clients,
- one audit/evidence path to SQLite and blobs.

## Design Principles

- Daemon owns orchestration. Helpers execute typed jobs and return typed output.
- Every side-effecting action belongs to a request-scoped transaction.
- Every helper invocation has a request id, timeout, cancellation signal,
  bounded payload size, and redacted audit record.
- Large data moves through blob files, not retained in memory or JSON events.
- Current view evidence beats memory. Memory is advisory only.
- Execution is late-bound against the freshest safe context.
- Verification checks the intended effect, not merely that a helper returned.
- Restart recovery is best effort for pending jobs, explicit for completed
  history, and conservative for side effects.

## Core Types

Add shared daemon-owned types under a new module such as
`src/daemon/capability-runtime/`.

```ts
export type CapabilityJobKind =
  | "browser_action"
  | "browser_chrome"
  | "desktop_action"
  | "screen_observe"
  | "ocr"
  | "terminal"
  | "agent_tool";

export type CapabilityJobStatus =
  | "queued"
  | "scheduled"
  | "awaiting_approval"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type CapabilityJob = {
  id: string;
  transactionId: string;
  sessionId?: string;
  kind: CapabilityJobKind;
  status: CapabilityJobStatus;
  priority: "background" | "normal" | "interactive";
  requestedBy: "prompt" | "direct_ui" | "background" | "approval_resume";
  inputJson: unknown;
  inputBlobIds?: string[];
  outputJson?: unknown;
  outputBlobIds?: string[];
  leaseId?: string;
  approvalId?: string;
  timeoutMs: number;
  deadlineAt: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  lastError?: string;
};
```

These types should wrap existing Browser Action concepts gradually rather than
replace them in one large migration.

## Workstream 1: Durable Capability Queue

Goal: pending and completed capability work should survive daemon restart where
that is safe and useful.

Storage additions:

- Add migration v3 with `capability_jobs`, `capability_job_events`,
  `capability_locks`, and `capability_resources`.
- Store compact JSON metadata in SQLite.
- Store screenshots, OCR input images, large accessibility snapshots, debug
  bundles, and recordings as blobs.
- Index by `status`, `kind`, `session_id`, `transaction_id`, `deadline_at`, and
  `created_at`.

Suggested schema:

```sql
CREATE TABLE IF NOT EXISTS capability_jobs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  requested_by TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  lease_id TEXT,
  approval_id TEXT,
  timeout_ms INTEGER NOT NULL,
  deadline_at TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS capability_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES capability_jobs(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_resources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES capability_jobs(id) ON DELETE CASCADE,
  blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  redaction_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

Restart behavior:

- `queued` and `scheduled` jobs can resume if their deadline has not passed.
- `running` jobs become `failed` or `expired` on daemon boot unless the helper
  has a durable external handle that can be reattached.
- `awaiting_approval` jobs can resume only if the approval is still valid.
- Side-effecting jobs must not auto-retry after an unknown daemon crash.
- Read-only/background observe jobs may retry with a fresh lease.

Acceptance:

- Daemon restart does not leave invisible pending browser/screen/desktop work.
- Completed job history can be inspected from storage.
- Expired jobs produce a user-visible event and an activity log entry.

## Workstream 2: Resource Manager

Goal: keep memory bounded while handling screenshots, OCR images, UI graphs, and
debug evidence.

Implementation requirements:

- Add a `CapabilityResourceManager` that writes large payloads to the existing
  blob store.
- Define per-kind payload limits:
  - screen image input: blob only, never long-lived base64 in memory.
  - OCR text: capped JSON preview plus optional full text blob.
  - UIA/accessibility tree: capped normalized graph in JSON, overflow blob.
  - browser DOM snapshot: capped text/elements matching current Browser Action
    limits.
  - debug bundles: metadata-only by default.
- Add TTL and retention tags: `ephemeral`, `session`, `evidence`, `user_saved`.
- Add cleanup for expired ephemeral blobs after jobs complete or fail.
- Add memory accounting for active jobs: estimated input bytes, output bytes,
  helper RSS when measurable, and active capture count.

Acceptance:

- Repeated screen/OCR jobs do not grow daemon RSS unbounded.
- Large screenshots and recordings are referenced by blob id/path.
- User-visible events carry summaries and blob ids, not full payloads.

## Workstream 3: Helper Process Supervisor

Goal: every heavyweight or risky operation runs in a bounded helper process or
controlled child, not inside long-lived daemon code.

Helper contract:

- stdin: one UTF-8 JSON request or a length-prefixed stream for native
  messaging style helpers.
- stdout: one compact UTF-8 JSON response.
- stderr: diagnostics only.
- request fields: `schemaVersion`, `requestId`, `jobId`, `transactionId`,
  `command`, `timeoutMs`, `input`, `resourcePaths`.
- response fields: `ok`, `requestId`, `status`, `output`, `resourcePaths`,
  `error`, `metadata`.
- helper must not call another helper directly.

Supervisor responsibilities:

- spawn with `windowsHide: true`,
- pass sanitized env only,
- enforce timeout and kill process tree on timeout/cancel,
- cap stdout/stderr bytes,
- normalize non-zero exits into typed errors,
- record helper implementation/version/hash/signature diagnostics,
- optionally require signatures for release helpers.

Candidate helpers:

- screen capture helper,
- OCR runtime helper,
- native desktop UIA helper,
- browser native desktop helper,
- PTY process,
- future browser-chrome/bookmark helper only where extension APIs are
  unavailable.

Acceptance:

- A hung helper cannot hang the daemon.
- Cancelling a job kills its helper process tree.
- Helper stderr is preserved as bounded diagnostics.
- Missing helper, unsigned helper, timeout, invalid JSON, and non-zero exit all
  produce typed errors.

## Workstream 4: Concurrency Scheduler

Goal: avoid overloading the local desktop while keeping interactive work fast.

Scheduler rules:

- Global active job cap, default 4.
- Per-capability caps:
  - screen observe: 1 active, background debounced.
  - OCR: 1 active by default.
  - native desktop action: 1 active per foreground desktop/window.
  - browser extension action: 1 active per tab key.
  - terminal: per PTY session serial input.
  - agent tool: separate cap from local UI actions.
- Background work yields to interactive work.
- Active tab/window lease changes cancel or stale-mark affected browser/desktop
  jobs.
- Jobs have deadlines; expired jobs are not executed.

Data structures:

- In-memory ready queue sorted by priority, deadline, and creation time.
- Per-surface locks keyed by `adapterId:windowId:tabId:routeKey` or
  `desktop:processId:windowHandle`.
- SQLite records only durable state, not every scheduler heap detail.

Acceptance:

- Two click/type actions cannot execute concurrently on the same tab/window.
- Background perception cannot starve a user-requested desktop action.
- Interactive cancellation takes effect before queued lower-priority jobs run.

## Workstream 5: Cancellation and Lease Invalidation

Goal: cancellation is explicit and reliable across renderer, daemon, and helper
boundaries.

Sources of cancellation:

- user presses stop,
- session is trashed/deleted,
- active tab/window changes,
- approval denied,
- context lease expires,
- daemon shutdown,
- timeout,
- helper crash.

Implementation requirements:

- Add `CapabilityCancellationToken` with `reason`, `requestedAt`, and optional
  `sourceEventId`.
- Each active helper process gets an AbortController-equivalent and process-tree
  kill path.
- Browser/desktop jobs check lease freshness before execution and before
  verification.
- Prompt continuation must stop when its underlying job is cancelled.
- Cancellation emits one terminal event: `cancelled`, `failed`, or `expired`.

Acceptance:

- Stop/cancel does not leave a helper process running.
- A denied approval does not allow a queued action to execute later.
- Active-tab change cancels or stale-marks pending extension commands for the
  old tab.

## Workstream 6: Common Event Contract

Goal: renderer and diagnostics should consume one predictable event shape for
computer-use capability work.

Add shared protocol events:

```ts
export type CapabilityEvent =
  | {
      type: "capability.job";
      jobId: string;
      transactionId: string;
      kind: CapabilityJobKind;
      status: CapabilityJobStatus;
      phase?: CapabilityTransactionPhase;
      summary: string;
      detail?: unknown;
    }
  | {
      type: "capability.resource";
      jobId: string;
      transactionId: string;
      resourceId: string;
      role: string;
      mime: string;
      preview?: unknown;
    };
```

Mapping:

- Existing `browserAction.progress` and `browserAction.result` remain for
  compatibility.
- New computer-use features emit `capability.job` first.
- Browser Action can dual-emit during migration.
- Renderer should show concise user-facing summaries by default and hide raw
  diagnostics behind advanced UI.

Event phases:

- `queued`
- `perceiving`
- `framing_intent`
- `generating_candidates`
- `awaiting_approval`
- `executing`
- `verifying`
- `completed`
- `failed`
- `cancelled`
- `expired`

Acceptance:

- A renderer can show progress for browser, desktop, screen, OCR, and terminal
  work without capability-specific code for every status.
- Events never contain large raw screenshots or secret values.

## Workstream 7: Approval and Safety Policy

Goal: all side-effecting computer-use actions use one daemon-owned policy path.

Policy requirements:

- Read-only observe jobs can run automatically when provider permissions allow.
- Side effects default to `ask_before_action` unless user policy allows them.
- Desktop actions that type text, submit forms, change settings, delete files,
  send messages, purchase/pay, authenticate, upload/download files, or expose
  credentials require confirmation or block.
- Browser chrome actions such as bookmark create/update/delete are explicit
  side effects and should be audited.
- Password/token/payment/cookie fields are redacted and not persisted.
- Approval decisions include scope, expiry, action family, origin/surface, and
  target risk.

Implementation requirements:

- Extract reusable safety policy utilities from Browser Action where practical.
- Keep capability-specific risk classifiers at the edge.
- Persist approval summaries, not secret input values.

Acceptance:

- A helper cannot execute a side-effecting action without a daemon safety
  decision.
- Saved approval policies expire and can be revoked.
- High-risk actions produce user-visible approval cards with meaningful labels.

## Workstream 8: Computer-Use Context Model

Goal: define what the model and daemon see before a Windows desktop action.

Prepared context sources:

- browser view graph,
- screen/OCR snapshot,
- desktop UIA graph,
- terminal viewport state,
- session and runtime mode,
- user-approved policies.

Context lease fields:

- source id,
- surface id,
- window handle/tab id when available,
- route key or desktop window identity,
- revision/digest,
- capturedAt,
- expiresAt,
- risk class allowed by the lease,
- redaction mode,
- blob/resource references.

Acceptance:

- Computer-use actions execute only against a current compatible lease.
- Late binding can prove that the selected target still exists.
- Verification can compare before/after context identity.

## Workstream 9: Verification and Evidence

Goal: every action should prove the intended effect or fail with useful
diagnostics.

Verification requirements:

- Read-only observe: verifies fresh context exists.
- Click/type/select/check: verifies expected UI state, navigation, text field,
  selected item, or visible effect.
- Browser chrome bookmark action: verifies bookmark tree changed as expected or
  tab navigated to selected bookmark URL.
- Desktop settings action: verifies the target setting state changed, not just
  that a settings page opened.
- OCR: verifies text extraction completed with language/runtime metadata.
- Terminal: verifies command/session state and exit/stream status.

Evidence:

- Store before/after context identity.
- Store redacted debug bundle.
- Store small previews in SQLite and large artifacts in blobs.
- Attach evidence to activity log and ledger where user-visible.

Acceptance:

- Wrong-target actions fail even if a helper returns success.
- Verification failure classifies perception, binding, execution, or effect
  mismatch.

## Workstream 10: Recovery and Shutdown

Goal: daemon lifecycle should not leave stale helpers or invisible work.

Requirements:

- On boot, reconcile `queued`, `scheduled`, `awaiting_approval`, and `running`
  jobs.
- On shutdown, mark active jobs as `cancelled` or `failed` with
  `daemon_shutdown`.
- Parent-watchdog cleanup remains for packaged helper processes.
- Extension pending commands expire visibly.
- Prompt waiters resolve with cancellation/failure on shutdown.

Acceptance:

- Restarting the widget does not silently execute an old side-effecting action.
- Orphaned helper processes are cleaned up.
- User can see that an in-flight job was cancelled by restart/shutdown.

## Workstream 11: Public API and Migration Plan

Initial daemon APIs:

- `capability.start` client message for direct UI/internal starts.
- `capability.cancel` client message.
- `GET /capabilities/jobs/:id` for diagnostics.
- `GET /capabilities/jobs?sessionId=...` for recent job summaries.
- Internal `CapabilityRuntime.enqueue()` for Browser Action, Vision, Terminal,
  and future Desktop Action callers.

Migration order:

1. Add storage migration and capability runtime skeleton.
2. Add event contract and renderer-safe summaries.
3. Wrap screen capture and OCR helper calls first because they are read-only or
   low side-effect.
4. Wrap native desktop helper execution.
5. Dual-emit Browser Action events and store Browser Action queued commands as
   capability jobs.
6. Add browser chrome/bookmark actions using extension APIs.
7. Move prompt continuation waiters onto capability job completion where
   practical.

Compatibility:

- Keep current Browser Action APIs during migration.
- Keep current extension poll/result endpoints.
- Do not break existing smoke tests while adding the generic capability layer.

## Suggested File Layout

```text
src/daemon/capability-runtime/
  index.ts
  types.ts
  runtime.ts
  durableQueue.ts
  scheduler.ts
  resourceManager.ts
  helperSupervisor.ts
  cancellation.ts
  eventMapper.ts
  safety.ts
  verification.ts
  diagnostics.ts

src/daemon/storage/migrations/v3CapabilityJobs.ts
src/shared/protocol/capability.ts
src/daemon/server/ws/capabilityMessages.ts
src/daemon/server/http/routes/capabilityRoutes.ts
scripts/smoke-capability-runtime.mjs
```

## Verification Plan

Required checks:

- `npm run lint`
- `npm run smoke:storage`
- `npm run smoke:screen-provider`
- `npm run smoke:ocr-runtime`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-native-desktop-helper-native`
- `npm run smoke:terminal`
- New `npm run smoke:capability-runtime`
- `git diff --check`
- UTF-8/mojibake checks for touched text files

New smoke coverage should include:

- queued read-only job completes,
- side-effecting job pauses for approval,
- denied approval cancels the job,
- helper timeout kills child process,
- daemon restart reconciles queued/running jobs,
- large payload is stored as blob,
- per-surface concurrency lock serializes two same-window actions,
- cancellation resolves prompt waiter and emits terminal status.

## Risks and Mitigations

- Risk: over-generalizing before Desktop Action requirements are concrete.
  Mitigation: start with common job/resource/supervisor primitives and wrap
  existing providers incrementally.
- Risk: durable queue accidentally replays side effects after restart.
  Mitigation: read-only jobs may resume; side-effecting `running` jobs fail
  closed unless explicitly safe to retry.
- Risk: helper stdout or screenshots blow memory budgets.
  Mitigation: enforce byte caps and blob offload at the supervisor boundary.
- Risk: renderer becomes noisy with low-level events.
  Mitigation: default to concise summaries and hide diagnostics behind advanced
  surfaces.
- Risk: policy logic forks across capabilities.
  Mitigation: shared safety decision shape with capability-specific risk
  classifiers.

## Definition of Done

This handoff is complete when:

- capability jobs are durable in SQLite,
- helper process execution is supervised with timeout/cancel/kill,
- resource blobs prevent large payload retention in daemon memory,
- common capability events reach the renderer,
- side-effecting jobs share approval and safety policy,
- restart/shutdown reconciliation is implemented,
- Browser Action continues to pass existing smokes during migration,
- at least one screen/OCR path and one native desktop/browser path run through
  the new capability runtime,
- a new smoke suite proves queue, cancellation, timeout, resource, and recovery
  behavior.

## Implementation Result

The first daemon-owned foundation slice has been implemented:

- shared capability protocol events and client messages,
- SQLite v3 durable capability job/event/resource storage,
- daemon `CapabilityRuntime` with queue, scheduler, cancellation, helper
  supervisor, resource manager, safety gate, and event mapper,
- WS/HTTP capability APIs and diagnostics routes,
- startup reconciliation and shutdown cancellation,
- screen observe/provider capture routing through capability jobs,
- native desktop action handler integration through the bounded helper path,
- browser chrome/bookmark capability commands routed through the Browser Bridge
  extension API with result callbacks,
- OCR capability execution routed through the runtime with bounded helper
  command support, capped previews, and optional full-text blob evidence,
- terminal capability execution routed through a supervised bounded child helper,
- agent-tool capability boundary jobs for the supported simulated daemon runtime
  and explicit app-server client-tool blocked contract reporting,
- Browser Action compatibility migration support through dual-write/dual-emit
  capability jobs for approvals, queued commands, extension pickup, results,
  observations, and failures,
- same-lease serialization for `leaseId`/`lockKey`,
- durable `capability_locks` acquisition/release and diagnostics,
- priority dispatch so queued interactive work starts before lower-priority
  background work when capacity frees,
- context lease expiry/mismatch checks before execution and before
  verification,
- approval deadline expiry handling,
- secret-like capability input redaction before persistence plus terminal
  credential-command rejection,
- final capability-state activity entries for session ledgers,
- prompt waiter shutdown clearing through cancellation/failure resolution,
- expected desktop effects fail verification unless a helper provides explicit
  effect proof,
- resource accounting, helper diagnostics, verification summaries, and
  ephemeral resource cleanup accounting on completed jobs,
- `smoke:capability-runtime`, `smoke:browser-chrome-capability`,
  `smoke:ocr-capability`, `smoke:terminal-capability`, and
  `smoke:agent-tool-capability` coverage for queue, approval, timeout,
  cancellation, resources, recovery, same-surface serialization,
  priority dispatch, context lease expiry, approval expiry, extension bridge
  command/result routing, OCR execution, terminal command execution, and
  agent-tool boundary handling.

Completion audit:
`docs/reports/windows-computer-use-daemon-foundation-completion-audit-2026-05-12.md`.

Remaining work is live hardening beyond the foundation: dogfood high-risk
Windows settings workflows against real OS surfaces, configure release signing
credentials for native helpers, and tune future adapter-specific verification
once concrete settings/app workflows are introduced.
