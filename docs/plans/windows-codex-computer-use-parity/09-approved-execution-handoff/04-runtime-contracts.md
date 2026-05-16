# 04 - Runtime Contracts And Data Flows

Status: implementation contract
Date: 2026-05-16

## Core Principle

Every Computer Use workflow should flow through the same traceable pipeline:

```text
request
-> permission/profile evaluation
-> surface selection
-> capability DAG nodes
-> observation/perception graph
-> action execution or blocked preflight
-> effect verification
-> eval ledger record
-> debug bundle/resource evidence
-> renderer explanation
```

Avoid one-off success paths that skip ledger, debug, safety, or perception
evidence.

## Computer Session Lifecycle

Expected lifecycle:

1. Renderer or dogfood script creates a session with requested surface/profile.
2. Daemon selects or rejects the surface.
3. Runtime creates eval run and initial DAG records.
4. Operations are submitted.
5. Each operation creates DAG nodes and eval steps.
6. Safety/permission decisions are attached to the operation.
7. Action either executes, asks for approval, or blocks with reason.
8. Verifier records proof/failure.
9. Debug bundle exposes all linked evidence.
10. Renderer updates from daemon events and refreshes the panel.

## Surface Contract

Known surface kinds:

- `isolated_browser`
- `regular_browser_extension`
- `tool_workspace`
- `pty_workspace`
- `foreground_desktop_watch`
- `future_vm_session`

Surface selection must be explicit. If a requested surface is unavailable or
unsafe, the session should block with a precise reason rather than silently
falling back to a riskier surface.

## Permission Contract

Permission profiles must cover:

- domains/network,
- commands,
- output roots,
- package install,
- browser automation,
- browser history/debugger/file upload,
- OS mutation,
- generated code,
- runtime timeout,
- output size,
- risk class,
- one-time vs persistent,
- expiration/disabled state.

Deny rules are enforced before:

- materialization,
- smoke tests,
- execution,
- artifact persistence,
- rollback that deletes user artifacts.

Credential access remains denied until a future secure credential-flow exists.

## Capability DAG Contract

Each non-trivial run should be represented as DAG nodes such as:

- `permission_check`
- `surface_select`
- `capability_gap`
- `implement_capability`
- `dependency_prepare`
- `smoke_test`
- `task_plan`
- `observe`
- `graph_merge`
- `action`
- `verify`
- `rollback`
- `eval_ledger_record`

Node fields should include:

- id,
- kind,
- status,
- started/finished timing,
- dependencies,
- input/output redacted to policy,
- missing requirements,
- failure class/reason,
- resource links,
- rollback action if available.

Cancellation should propagate to active capability jobs and mark unfinished DAG
nodes coherently.

## Perception Graph Contract

Perception graph nodes should carry current evidence:

- semantic label,
- visible text,
- accessibility role,
- DOM selector,
- UIA/native selector,
- bbox,
- screenshot/ROI region,
- OCR box,
- z-order/occlusion,
- freshness,
- source reliability,
- disagreement notes,
- provenance.

Source types:

- DOM,
- Browser Bridge,
- CDP/Playwright,
- UIA/native helper,
- OCR,
- screenshot detector,
- visual parser/VLM fallback,
- previous observation only as stale context.

High-risk actions require stronger current evidence thresholds than read-only
actions. Failure memory can influence ranking but cannot prove current state.

## Browser Action Flow

Target flow:

```text
prompt / operation
-> browser surface selected
-> DOM/CDP/extension/native observations
-> perception graph merge
-> target selection
-> action feedback
-> verifier
-> eval/debug records
```

Required invariants:

- restricted pages are not bypassed,
- reload-required extension state is explicit,
- clicks/types/selects use current graph evidence,
- browser-native fallback is only for browser-window scoped helper paths,
- live traces are redacted before corpus promotion.

## Browser Chrome Flow

Browser Chrome commands flow through:

```text
Computer Session operation
-> browser_chrome command bridge
-> safety classification
-> extension/browser API execution
-> verification
-> eval/debug resource
```

Commands include:

- `tab_group.*`
- `bookmark.*`
- `download.*`
- `history.search`
- `history.open`
- `debugger.inspect`
- `debugger.screenshot`
- `debugger.print_to_pdf`
- `permission.get`
- `permission.set`
- `file_upload.inspect`
- `file_upload.set_files`
- `file_upload.clear`
- `file_upload.blocked`

History, debugger, file upload, permission mutation, download mutation, and
erase/cancel flows require explicit high-risk grants or approvals.

## Toolsmith Flow

Scoped autonomy/gap handling should flow through:

```text
user request
-> capability gap detector
-> proposed tool spec
-> permission check
-> materialize reviewed/generated tool in runtime workspace
-> dependency prepare in isolated workspace
-> smoke tests
-> activation if smoke passes
-> execute DAG task nodes
-> artifact persistence
-> verifier
-> rerun comparison
-> rollback cleanup
```

Generated tools must not be written into repo source unless the user explicitly
asks to promote them. Failed generated tools stay inactive but inspectable.

## Terminal Flow

Terminal/PT Y commands should:

- be exact-command or allowlist/profile gated,
- avoid destructive commands unless explicitly granted,
- record redacted output,
- detect artifacts only under approved output roots,
- link artifacts into eval/debug resources,
- support cancellation where possible.

The reversible Windows registry dogfood is a narrow exception for an app-owned
test key and exact rollback command. It must not be generalized into broad OS
mutation.

## Native Watch-Mode Flow

Current state is blocked preflight, not real input.

Required future v2 flow:

```text
request
-> one-time foreground watch approval
-> visible countdown
-> active-window/process assertion
-> user-idle monitor
-> abort-on-user-input
-> signed helper v2 command
-> action
-> effect verification
-> rollback proof
-> eval/debug/failure memory
```

Until v2 exists:

- broad `visual_desktop_action` must block before native input,
- `native_file_picker_action` must block before local path disclosure,
- browser-window scoped native helper may remain separate and narrow,
- release gate must keep unsigned helpers non-promoting.

## Debug Bundle Contract

Debug bundle should expose:

- session metadata,
- selected surface,
- permission profile,
- safety decisions,
- DAG nodes,
- observations,
- perception graphs,
- action feedback,
- verifier results,
- eval steps/resources,
- sources,
- artifacts,
- rollback actions,
- failure memory,
- freshness summaries,
- promotion gate linkage where relevant.

Sensitive payloads must be redacted or blob-backed according to policy.

## Renderer Contract

Renderer should not infer hidden runtime state. It should display daemon-owned
state:

- session list and selected session,
- surface and profile,
- blocked grants,
- DAG node status,
- artifacts/source quality,
- promotion gate state,
- Toolsmith stability/rerun/dependencies,
- rollback consequences,
- debug bundle copy/save.

Renderer refresh should be driven by daemon events plus quiet refetch to avoid
stale panel state.

