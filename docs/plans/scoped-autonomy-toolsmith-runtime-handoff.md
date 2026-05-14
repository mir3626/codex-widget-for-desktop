# Scoped Autonomy Toolsmith Runtime Handoff

## Objective

Implement a Codex-YOLO-like computer-use mode for this Windows desktop widget without turning the daemon into an unrestricted executor. The daemon should be able to receive a user goal, detect missing capability, propose and materialize a bounded tool, smoke-test it, execute it under a pre-granted permission profile, and record the full evidence path in the computer-use eval ledger.

This is not a replacement for approval, restricted-page handling, credential secrecy, local daemon security, destructive-action protections, raw media privacy, blob retention policy, or signing constraints. Those boundaries remain stronger than autonomy.

## User Problem

Current computer-use behavior often stops at a missing-capability boundary:

- "browser chrome control is blocked"
- "custom client tool contract is not available"
- "native Windows fallback is not implemented"
- "PDF export/crawling pipeline is not available"

The target behavior is:

1. Understand the user goal.
2. Decide whether existing capabilities can satisfy it.
3. If not, identify the missing capability.
4. Check whether the user has granted a scoped autonomy permission profile that covers implementation and execution.
5. Generate or materialize the smallest safe tool needed for that gap.
6. Run deterministic smoke tests for the generated tool.
7. Execute the tool only if permission, smoke, and safety gates pass.
8. Record artifacts, eval steps, tool provenance, failure memory, and follow-up blockers.

Example goal:

> OpenAI homepage에서 Codex 지원 명령어 조사해서 PDF 파일로 제공해줘.

Target architecture:

- Browser/research/crawl work is represented as a capability gap: `web_research_to_pdf`.
- Toolsmith materializes a bounded `web_research_to_pdf` tool in a runtime workspace.
- The tool is allowed to fetch only domains in the permission profile, write only to approved output roots, and never read credentials.
- Smoke tests prove that the tool can create a report and PDF artifact from fixture content before it touches live content.
- The eval ledger records the gap, permission decision, generated tool spec, smoke result, execution result, and artifacts.

## Non-Negotiable Safety Boundaries

- Permission profile is required before implementation or execution.
- Missing permission produces a structured blocked result, not a workaround.
- Memory and previous successes may rank choices but cannot prove current UI or authority.
- Generated tools must not read tokens, cookies, browser profiles, OS credential stores, SSH keys, payment data, or password managers.
- Generated tools must not mutate Windows settings, install packages, run destructive shell commands, or submit forms unless profile scope explicitly allows that risk and the existing approval model also allows it.
- Restricted pages and browser-internal pages stay restricted unless a native helper explicitly supports a safe bounded action.
- Generated code lives in a daemon runtime workspace, not in repo source, unless the user explicitly requests a durable source change.
- Generated tool artifacts must be redacted, scoped, and linked into the eval ledger.
- Smoke tests are mandatory before execution.

## Architecture

### 1. Permission Profile

Daemon-owned permission profiles define scoped autonomy:

- Mode: `off`, `ask`, or `scoped_yolo`.
- Network domains: exact or wildcard hosts the tool may fetch.
- Browser domains: hosts the browser automation path may control.
- Filesystem read/write roots.
- Allowed and denied command prefixes.
- Package install permission.
- OS mutation permission.
- Generated tool materialization/execution permission.
- Credential policy: currently `never` or future `ask`.
- Runtime limits: timeout and output byte caps.
- Expiry and disabled states.

Profiles are stored in SQLite so user intent is auditable and revocable.

### 2. Capability Gap Detector

The detector maps natural-language goals to missing capability classes:

- `web_research_to_pdf`: crawl/read allowed web sources, synthesize a report, export PDF.
- `browser_chrome_direct_control`: bookmarks, settings, extension reload, downloads, permission popups.
- `native_windows_workflow`: Windows Settings, app installers, file picker, permission dialogs.
- `local_asr_runtime`: real microphone ASR or model/runtime switch.
- `generated_terminal_tool`: bounded local command wrapper when no existing capability handles the request.

The detector records:

- requested capability
- category
- why current capabilities are insufficient
- required grants
- suggested generated tool
- known blockers

### 3. Toolsmith Runtime

Toolsmith is a daemon subsystem that turns an approved gap into a tool spec:

- Tool spec: id, name, capability, version, status, template, entrypoint kind, required grants, smoke tests, artifacts.
- Materialization: write generated executable/script files into `.runtime/autonomy/tools/<tool-id>/`.
- Smoke: run deterministic fixture tests before the tool can execute real input.
- Execution: pass only sanitized JSON input and scoped environment; collect JSON output; store artifacts.
- Provenance: link tool run to autonomy run, eval run, DAG node, and output blobs.

Initial implementation uses built-in templates rather than free-form arbitrary generated code. This gives the daemon a safe foundation while still modeling the future self-implementation path.

### 4. DAG And Eval Integration

Scoped autonomy is represented as a DAG slice:

1. `setup`
2. `capability_gap`
3. `approval`
4. `implement_capability`
5. `tool_smoke`
6. `tool_execution`
7. `verification`
8. `eval_ledger`

Every node writes timing, status, and evidence. Existing computer-use eval runs remain the measurement substrate.

### 5. Failure Memory

Failures are structured as:

- missing permission
- unsafe requested action
- unsupported generator template
- smoke failure
- execution failure
- verification failure
- external network/provider failure

Failure memory may suggest future grants, aliases, or recovery hints, but it cannot authorize execution.

## Implementation Plan

### Phase 1: Foundation

- Add shared scoped-autonomy protocol types.
- Add storage migration and APIs for permission profiles, autonomy runs, gaps, tool specs, and tool runs.
- Add permission evaluator and redaction helpers.
- Add deterministic gap detector.
- Add Toolsmith runtime with a built-in `web_research_to_pdf` template.
- Add smoke test proving profile, gap detection, materialization, smoke, execution, artifacts, and eval ledger recording.

### Phase 2: Daemon Surface

- Add HTTP routes for listing/creating profiles, listing runs, and reading generated tool specs/runs.
- Add debug/export data for permission decisions, gap analysis, smoke results, and artifacts.
- Add dogfood report for scoped autonomy.

### Phase 3: Real Computer-Use Expansion

- Add live browser content ingestion into `web_research_to_pdf`.
- Add browser-download verification tool.
- Add bounded browser bridge extension reload helper.
- Add Windows native workflow helper for permission popups/file picker/settings-only read flows.
- Add renderer panel for autonomy runs, blocked grants, generated tool smoke status, and artifacts.

## Initial Acceptance Criteria

- Storage schema version advances with scoped-autonomy tables.
- A scoped permission profile can be created, read, and evaluated.
- A goal requiring `web_research_to_pdf` produces a structured capability gap.
- Missing permission produces a blocked autonomy run with no generated execution.
- Granted profile materializes a generated tool in a runtime workspace.
- Generated tool smoke test passes before execution.
- Tool execution produces a Markdown report and PDF artifact.
- Eval ledger contains setup/gap/permission/smoke/execution/verification steps.
- Debug/dogfood output explains which grants were used and which safety boundaries were enforced.
- `npm run smoke:scoped-autonomy-toolsmith` passes.

## Deferred Or External Blockers

- Official app-server custom client-tool contract.
- Production signing certificate/service for native helpers.
- Arbitrary generated code synthesis beyond built-in reviewed templates.
- Unattended Windows settings mutation.
- Credential access, browser profile cookie access, and password-manager access.
- Real live crawl of high-risk or authenticated pages.
- Renderer UX for profile grant editing and run inspection.

