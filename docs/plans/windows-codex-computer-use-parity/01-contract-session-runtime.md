# 01 - Contract And Session Runtime

## Goal

Create the missing runtime that turns independent modules into one computer-use
session.

The runtime must support:

- OpenAI-style screenshot/action feedback loop.
- Codex-style app/browser outcomes.
- Existing widget backends as execution adapters.
- Safety, permissions, eval, and debug evidence from the first step.

## Shared Protocol: Normalized Computer Action

Add a daemon/shared protocol that is stable even if upstream OpenAI response
shapes change.

Suggested file:

- `src/shared/protocol/computerUse.ts`

Suggested types:

```ts
export type ComputerAction =
  | { type: "screenshot" }
  | {
      type: "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
    }
  | {
      type: "double_click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
    }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; path: Array<{ x: number; y: number }> }
  | {
      type: "scroll";
      x: number;
      y: number;
      deltaX?: number;
      deltaY?: number;
    }
  | { type: "type"; text: string }
  | { type: "keypress"; keys: string[] }
  | { type: "wait"; ms?: number };
```

Add separate structured fast-path operations instead of overloading visual
actions:

```ts
export type ComputerStructuredOperation =
  | { kind: "browser_action"; action: BrowserActionRequest }
  | { kind: "browser_chrome"; command: BrowserChromeCommand }
  | { kind: "terminal"; command: TerminalCommandRequest }
  | { kind: "toolsmith"; runId: string; toolId: string; input: unknown }
  | { kind: "screen_observe"; request: ScreenObserveRequest }
  | { kind: "ocr"; request: OcrRequest }
  | { kind: "native_browser_window_action"; action: unknown }
  | { kind: "visual_desktop_action"; action: ComputerAction };
```

Do not let structured operations hide user-visible evidence. Every operation
must map to:

- visible or file/terminal evidence
- verifier criteria
- eval ledger step
- rollback or "not reversible" statement
- action feedback when before/after evidence exists. Current implementation
  exposes this as `ComputerSessionActionFeedbackSummary` in the debug bundle,
  linking Browser Action results to before/after observations, verifier status,
  perception graph id, capability job id, DAG node id, target evidence, and
  redaction policy.

## OpenAI Action Shape Adapter

Build a small adapter that accepts both action shapes:

- legacy/single: `{ action: { type: "click", ... } }`
- current/batched: `{ actions: [{ type: "click", ... }] }`

Also normalize:

- camelCase vs snake_case action names where encountered
- `doubleClick` to `double_click`
- keypress string vs array
- missing wait duration
- scroll deltas vs direction fields

Adapter output must always be:

```ts
type NormalizedComputerActionBatch = {
  actions: ComputerAction[];
  sourceSchema: "openai_single_action" | "openai_actions_array" | "widget_native";
  warnings: string[];
};
```

Never execute an unknown action type. Return a blocked planning result with
evidence.

## ComputerSessionRuntime

Suggested file:

- `src/daemon/computer-use/sessionRuntime.ts`

Responsibilities:

- Create a session record.
- Bind permission profile.
- Create eval run.
- Create or attach DAG run.
- Acquire surface lock.
- Observe.
- Plan.
- Request approval when needed.
- Execute actions or structured operations.
- Verify effects.
- Record failure memory.
- Export debug bundle.
- Finalize, cancel, or block.

Session states:

```ts
export type ComputerSessionState =
  | "created"
  | "permission_check"
  | "surface_selecting"
  | "observing"
  | "planning"
  | "awaiting_action_confirmation"
  | "executing"
  | "verifying"
  | "recovering"
  | "completed"
  | "blocked"
  | "cancelled"
  | "failed";
```

Session record should include:

- `sessionId`
- `userRequest`
- `profileId`
- `selectedSurface`
- `riskClass`
- `state`
- `createdAt`
- `updatedAt`
- `evalRunId`
- `dagRunId`
- `latestObservationId`
- `latestActionBatchId`
- `latestVerifierResultId`
- `blockedReason`
- `requiresUserAction`

## Session Loop

Minimal loop:

```text
create session
  -> permission check
  -> select surface
  -> observe
  -> plan
  -> classify action risk
  -> approval if required
  -> execute
  -> post-observe
  -> verify
  -> complete or recover
```

Recovery loop:

```text
failed verifier
  -> classify failure
  -> query structured failure memory
  -> adjust aliases/target/recovery hint
  -> reobserve
  -> replan
  -> retry within budget
  -> block if confidence or safety threshold fails
```

Cancellation must propagate to:

- in-flight capability job
- DAG node
- generated tool process
- PTY command if owned by session
- browser runner if session-owned
- pending approval card

## DAG Ownership

The session runtime should own a DAG run for all non-trivial tasks.

Canonical DAG node kinds:

- `permission_check`
- `surface_select`
- `observe`
- `perception_graph_merge`
- `plan`
- `approval`
- `execute`
- `post_observe`
- `verify`
- `recover`
- `rollback`
- `eval_ledger_record`
- `debug_bundle_record`

Task-specific DAG node kinds:

- `crawl_or_observe`
- `extract`
- `verify_sources`
- `draft_markdown`
- `render_pdf`
- `store_artifact`
- `verify_artifact`
- `download_observe`
- `file_upload_preflight`
- `browser_chrome_command`
- `terminal_command`
- `toolsmith_materialize`
- `toolsmith_smoke`
- `toolsmith_execute`

Implementation requirement:

- The existing `CapabilityDagRuntime` should be promoted from utility to daemon
  component.
- It should support node-local resources, timings, cancellation, retry, failure
  class, rollback action, eval linkage, and debug export.
- Scoped Autonomy fixed DAG records should migrate onto the shared DAG runtime
  incrementally.

## Planner Boundary

The planner can be:

- existing Browser Action prompt resolver
- Toolsmith gap detector
- model-driven computer action output
- deterministic route selector

But the planner must return a typed plan:

```ts
type ComputerPlan = {
  planId: string;
  sessionId: string;
  intent: string;
  surface: ExecutionSurfaceId;
  steps: Array<ComputerPlanStep>;
  requiredApprovals: ApprovalRequirement[];
  expectedEvidence: EvidenceRequirement[];
  rollbackPlan?: RollbackPlan;
  confidence: number;
  assumptions: string[];
};
```

Do not execute free-form planner text directly.

## Compatibility With Existing Capability Runtime

Required changes:

- Register a real `browser_action` handler.
- Keep browser transaction mirror, but do not depend on it for execution.
- Make `screen_observe`, `ocr`, `terminal`, `browser_chrome`, `agent_tool`, and
  `native_browser_window_action` invokable as session DAG nodes.
- Ensure all capability jobs can carry `computerSessionId`, `dagRunId`, and
  `evalRunId`.
- Ensure capability job completion emits a session event.

## Session Events

Expose session events over WebSocket and HTTP.

Event examples:

- `computer.session.created`
- `computer.session.state`
- `computer.session.observation`
- `computer.session.plan`
- `computer.session.approval_required`
- `computer.session.action_started`
- `computer.session.action_completed`
- `computer.session.verifier_result`
- `computer.session.blocked`
- `computer.session.completed`
- `computer.session.debug_bundle_ready`

Renderer should not infer core state by polling unrelated capability jobs.

## Acceptance Criteria

- A simple browser task creates one `ComputerSessionRuntime` session.
- The session records observe, plan, execute, verify, and eval ledger steps.
- Cancelling the session cancels the active job and marks the DAG node.
- A Browser Action request can run through capability runtime, not only the old
  Browser Action endpoint.
- Debug bundle can reconstruct the exact action loop without raw secrets.
