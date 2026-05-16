# 01 - Target, Parity Strategy, And Boundaries

Status: execution contract
Date: 2026-05-16

## Benchmark Target

Codex macOS Computer Use is the benchmark for user outcomes:

- observe screen/application/browser state,
- understand targets semantically,
- select and act on UI elements,
- use browser and terminal capabilities,
- produce files/artifacts,
- recover from failed attempts,
- ask for approval when required,
- preserve enough evidence to debug and improve,
- and avoid unsafe or privacy-violating actions.

The Windows widget does not need to duplicate hidden macOS internals. It should
match or exceed the user-visible outcome through Windows-appropriate layers.

## Windows Strategy

Use a layered strategy instead of a single monolithic "computer use" adapter:

1. Browser DOM/extension/CDP where the target is web content or browser chrome.
2. Browser Action and Browser Chrome commands for web/navigation/downloads/
   history/debugger/file-upload/site-permission workflows.
3. Terminal/PT Y and Toolsmith workspaces for research, conversion, scripts,
   local artifacts, and reproducible generated tools.
4. Perception graph for DOM/UIA/OCR/screenshot/native observation fusion.
5. Native Windows helper only for narrow workflows that cannot be achieved by a
   safer semantic API.
6. Foreground desktop watch-mode only after signed helper v2 safety gates exist.
7. Future VM/sandbox only after a real isolation, lifecycle, artifact, and
   network policy exists.

This keeps the app useful before full foreground desktop mutation is safe.

## Product-Owner Decisions Already Accepted

- Browser and Toolsmith parity should progress before arbitrary desktop
  mutation.
- If macOS Computer Use appears stronger than an existing widget path, redesign
  the widget path toward that behavior unless Windows safety prevents it.
- If Windows cannot perform the exact same action safely, implement a bounded
  equivalent that achieves the same user goal.
- Use the daemon as the orchestration authority. Do not add a separate
  cross-helper interface bus unless a concrete bottleneck appears.
- Capability DAG, eval ledger, perception graph, failure memory, and debug
  bundle are the shared substrate for all modalities.
- Scoped YOLO means bounded permission profiles and generated tools, not
  unrestricted automation.

## Safety Model

All actions must classify into one of these rough groups:

- Read-only observe:
  - lower approval burden,
  - still redacts sensitive evidence,
  - still records provenance.
- Reversible low/medium-risk mutation:
  - requires scoped grants,
  - records effect verifier and rollback where possible.
- High-risk one-time mutation:
  - requires explicit one-time profile or approval,
  - records exact grant, evidence, and verifier result,
  - no always-allow policy.
- Blocked by design:
  - credentials,
  - restricted pages,
  - unauthenticated profile/cookie access,
  - broad foreground desktop mutation without helper v2,
  - unattended OS settings mutation,
  - unsupported native file picker disclosure,
  - production release signing gaps.

## High-Risk Surfaces

Treat the following as high-risk even if a local API can technically do them:

- browser history search/open,
- browser debugger attach,
- browser site-permission mutation,
- downloads that write to disk,
- file upload/set-file-input,
- package installation,
- registry mutation,
- OS settings mutation,
- native foreground click/key/type,
- app launch or window focus that changes user state,
- clipboard read/write,
- raw screenshot/audio persistence,
- generated code execution,
- local file disclosure,
- authenticated browser profile/cookie state.

## Evidence Requirements

Every non-trivial action should record:

- request id / session id / run id,
- selected surface,
- permission profile and grants used,
- missing requirements if blocked,
- DAG node timing,
- action input redacted to policy,
- observation/perception graph node ids,
- verifier result,
- rollback action if possible,
- eval ledger step/resource linkage,
- debug bundle resource,
- failure-memory record if failed or abstained.

For high-risk actions, current evidence must beat memory. Failure memory can
rank or warn, but it must never be the proof source for current UI state.

## Approval Rules

Approval must happen before:

- materializing generated code,
- running generated code,
- installing dependencies,
- writing outside approved output roots,
- accessing browser history,
- attaching debugger,
- setting file inputs,
- mutating browser permissions,
- mutating registry/OS settings,
- sending foreground native input,
- persisting raw screenshots/audio,
- deleting user artifacts.

Approval records must say exactly which grant was used and why.

## Windows-Specific Constraints

Windows cannot safely copy every macOS desktop action directly because:

- foreground desktop input is race-prone without active-window and user-idle
  guards,
- UIA coverage varies by app,
- browser chrome and permission prompts are outside DOM injection,
- file pickers disclose local paths,
- Settings mutation often lacks clean rollback,
- unsigned helpers are not production-grade,
- UAC/elevation boundaries are explicit platform boundaries.

Therefore the Windows implementation must prefer semantic APIs, bounded helper
workflows, and reversible dogfood cases before arbitrary foreground input.

## What Must Not Be Claimed As Complete Yet

Do not claim any of these as complete until code and verification prove them:

- unrestricted native foreground desktop automation,
- signed helper v2 production deployment,
- browser permission bubble visual clicking,
- native file picker selection,
- authenticated browser profile/cookie access,
- official app-server custom client tool contract,
- production release signing certificate/service,
- real VM/sandbox backend,
- GPU ASR validation,
- human microphone corpus benchmark,
- ASR fine-tuning/LoRA.

## Design Bias For Future Work

When choosing between approaches:

- Prefer semantic browser/OS APIs over coordinates.
- Prefer reusable daemon runtime contracts over one-off scripts.
- Prefer current-evidence graph proof over model confidence.
- Prefer fixture smoke plus live dogfood over one live success.
- Prefer blocked-with-explanation over unsafe "best effort".
- Prefer small vertical slices with promotion gates over broad unverified
  rewrites.

