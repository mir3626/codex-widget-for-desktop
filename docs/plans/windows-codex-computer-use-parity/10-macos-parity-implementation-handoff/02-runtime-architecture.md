# 02 - Runtime Architecture

## Target Shape

The daemon becomes the single control plane for Computer Use.

```text
renderer request
  -> daemon HTTP/WS route
  -> ComputerSessionRuntime
  -> permission/profile evaluator
  -> capability gap detector
  -> ExecutionSurfaceManager
  -> CapabilityDagRuntime
  -> observer fan-out
  -> PerceptionGraph merge
  -> planner/action normalizer
  -> adapter execution
  -> EffectVerifier
  -> eval ledger/debug bundle/failure memory
  -> renderer update
```

The renderer should display daemon-owned state. It should not infer hidden
permission or runtime state from client-only heuristics.

## Core Runtime Responsibilities

`ComputerSessionRuntime` should own:

- session lifecycle and state transitions,
- active permission profile snapshot,
- selected execution surface,
- operation and prompt-run queue,
- DAG run creation and node updates,
- capability job linkage,
- observation and action feedback records,
- perception graph linkage,
- verifier results,
- rollback actions,
- eval run finalization,
- debug bundle export,
- cancellation and cleanup reconciliation.

The runtime should not directly embed large backend-specific logic. It should
route through adapters and capability handlers.

## Session State Model

Required states:

- `created`: session allocated, no operation yet.
- `planning`: prompt or operation decomposition in progress.
- `observing`: one or more observer nodes running.
- `awaiting_approval`: an exact grant or high-risk action needs user consent.
- `running`: action or generated tool executing.
- `verifying`: post-action effect verification running.
- `recovering`: retry/reobserve/clarification path active.
- `blocked`: cannot continue without missing grant or external capability.
- `completed`: requested task verified.
- `cancelled`: user or runtime cancelled and cleanup reconciled.
- `failed`: unrecoverable internal error with evidence.

State transitions must be reflected in:

- session snapshot route,
- debug bundle,
- eval ledger,
- renderer Computer Use panel,
- promotion-gate evidence when relevant.

## Execution Surfaces

Current and target surfaces:

| Surface | Use | Promotion rule |
|---|---|---|
| `isolated_browser` | Public web tasks, reproducible browser dogfood | Preferred browser default once lifecycle and extension loading are stable. |
| `regular_browser_extension` | User's current browser tabs/profile when explicitly requested | Requires permission profile, restricted-page handling, and redacted evidence. |
| `tool_workspace` | Toolsmith generated/reviewed tools and document artifacts | Requires scoped runtime workspace and smoke pass. |
| `pty_workspace` | Terminal/PTY commands | Requires exact command/cwd/output grants. |
| `foreground_desktop_watch` | Future native foreground UI action | Blocked until signed helper v2 guards exist. |
| `future_vm_session` | Future isolated desktop automation | Blocked until backend, lifecycle, network, file sync, and retention policy exist. |

Surface selection should be conservative:

1. Use structured browser/tool/terminal surface when it can complete the task.
2. Use regular browser only when current profile/tabs are part of the request.
3. Use foreground native only after signed helper v2 and one-time approval.
4. Use VM/sandbox only after the backend is real and policy is implemented.

## Capability DAG

Every non-trivial request should be represented as a DAG, not a monolithic
tool call.

Canonical nodes:

- `permission_check`
- `capability_gap`
- `surface_select`
- `observe_dom`
- `observe_uia`
- `observe_screen`
- `observe_ocr_roi`
- `graph_merge`
- `plan`
- `approval`
- `action`
- `verification`
- `artifact_persist`
- `rollback_prepare`
- `cleanup`
- `eval_ledger`

Node requirements:

- stable node id,
- status,
- dependencies,
- start/end timestamps,
- input/output redaction policy,
- resource ids,
- failure class,
- retry count,
- cancellation propagation,
- rollback action if applicable,
- eval step id when recorded.

Parallelism:

- Safe observer nodes may fan out: DOM, UIA, OCR ROI, screen diff, terminal
  state.
- Expensive nodes, such as full OCR/VLM/parser fallback, should run only when
  cached graph or cheaper observations are insufficient.
- High-risk action nodes must wait for permission and fresh actionable evidence.

## Perception Graph

The perception graph is the shared target-selection substrate.

Each candidate node should include:

- semantic label,
- visible text,
- accessibility role,
- DOM selector or UIA selector,
- bbox and screenshot region,
- OCR box when present,
- z-order/occlusion signal when available,
- freshness timestamp,
- source reliability,
- disagreement notes,
- actionability class.

Evidence rules:

- Read-only actions may use weaker or non-actionable evidence when the outcome
  is only explanation.
- Side-effect actions require current actionable evidence from DOM, UIA,
  native helper, or equivalent structured source.
- High-risk actions require stronger thresholds and explicit approval.
- Failure memory may rank candidates only after current evidence exists.
- Prior success and memory are never proof of current UI state.

## Adapter Routing

Route normalized operations through the best adapter:

- Browser web action: Browser Action adapter, Playwright/CDP, or DOM extension.
- Browser chrome action: Browser Chrome command bridge.
- Download/file upload: Browser Chrome plus file grant verifier.
- Tool/document: Scoped Autonomy/Toolsmith runtime.
- Terminal: terminal/PTY capability handler.
- Screen/OCR: screen capture/OCR/ROI capability.
- Native browser window: bounded native browser-window helper.
- Foreground desktop: signed helper v2 only.

Adapters must return:

- structured result,
- redaction policy,
- verifier hint,
- resource ids or artifact metadata,
- rollback hint,
- external blocker if blocked.

## Effect Verification

Each action needs a verifier appropriate to its surface:

- DOM state changed as expected.
- URL/title/text matches expected postcondition.
- Browser Chrome API reports created/updated/deleted state.
- Download file exists under approved root with hash/size.
- PDF/Markdown artifact exists and contains required citations.
- Terminal command exit code/output/artifact proof matches expectation.
- Native UI post-screenshot/UIA state matches target when helper v2 exists.

Verifier results must include:

- `passed`, `failed`, `inconclusive`, or `blocked`,
- proof summary,
- evidence ids,
- false-positive/false-negative audit affordance,
- recovery hint when inconclusive.

## Debug Bundle Contract

One debug bundle should explain the whole run:

- request/prompt,
- session and surface,
- permission profile snapshot,
- missing grants,
- DAG nodes,
- capability jobs,
- observations,
- perception graphs,
- action feedbacks,
- verifier results,
- eval run/steps/resources,
- generated tool manifests,
- commands/files/URLs,
- artifacts and hashes,
- rollback actions,
- failure memory effects,
- external dependency warnings,
- redaction summary.

The debug bundle is the main handoff artifact for bug reports, dogfood, and
promotion decisions.

