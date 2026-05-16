# 00 - Overview

## Handoff Map

This plan is sharded. Use the shards as follows:

- `README.md` - root index for context-loss restart, current stable boundary,
  verification ladder, next safe work, and external blockers.
- `00-overview.md` - strategic target and safety boundaries.
- `01-contract-session-runtime.md` - session/action protocol and runtime
  contract.
- `02-surfaces-permissions-safety.md` - execution surfaces and grants.
- `03-observation-perception-action.md` - evidence, perception, routing,
  verification, and recovery.
- `04-browser-tool-terminal-slices.md` - browser/tool/terminal verticals.
- `05-windows-native-helper-watch-mode.md` - Windows native helper/watch-mode
  design.
- `06-eval-debug-ux-dogfood.md` - measurement, debug UX, dogfood, and
  promotion.
- `07-migration-checklist.md` - phase-by-phase acceptance state.
- `08-implementation-resumption-handoff.md` - operational resume instructions
  when chat context is lost.
- `09-approved-execution-handoff/` - product-owner approved execution pack with
  target boundaries, current inventory, implementation slices, runtime
  contracts, promotion gates, and current status ledger.
- `10-macos-parity-implementation-handoff/` - product-owner approved
  user-outcome parity handoff based on the macOS Computer Use benchmark
  briefing. Use this as the detailed implementation map for browser, native,
  Toolsmith, permission, eval, and release parity work.

## Product Target

The widget should support practical Codex-style computer-use requests on
Windows:

- "Open this site, find the relevant information, and produce an artifact."
- "Use the browser to click, type, download, and verify an outcome."
- "Inspect the current screen and explain or act on visible UI."
- "Run local commands or generated tools when they are safer and more reliable
  than visual UI automation."
- "Ask for permission at the exact risk boundary instead of refusing too early
  or acting too broadly."

The target user experience is similar to Codex macOS Computer Use, but the
implementation must be Windows-native and daemon-owned.

## Public Computer Use Behavior To Match

From public OpenAI/Codex docs, the important behavior is:

1. The agent receives a screenshot or browser/screen observation.
2. The model emits one or more computer actions.
3. The host executes those actions in a bounded environment.
4. The host returns a new screenshot or observation as feedback.
5. The loop continues until the task is complete, blocked, or escalated.

The public action vocabulary includes visual actions such as:

- screenshot
- click
- double click
- move
- drag
- scroll
- type
- keypress
- wait

The widget may use structured fast paths, such as DOM, UIA, CDP, file APIs, or
terminal commands, but those paths must still produce evidence that explains the
same user-visible outcome.

## Current Repo Reality

The repo already has many pieces, but not a single Computer Use pipeline.

Existing pieces:

- Browser Action:
  - DOM extension bridge
  - Playwright adapter
  - CDP adapter
  - limited Windows native browser-window helper
- Browser Chrome:
  - bookmarks
  - tab groups
  - downloads
  - history
  - debugger
  - file upload commands
- Screen/OCR:
  - Windows screen capture helper
  - OCR capability
- Vision Context:
  - task capsule construction
  - renderer/daemon message path
- Terminal:
  - one-shot command provider
  - PTY session runtime
- Capability Runtime:
  - jobs
  - approval
  - locks
  - resources
  - verification
  - eval recording
- Capability DAG:
  - generic DAG runtime exists
  - not yet the daemon's main computer-use execution pipeline
- Research Architecture:
  - eval ledger
  - perception graph
  - ROI cascade shape
  - structured failure memory
- Scoped Autonomy/Toolsmith:
  - permission profiles
  - gap detector
  - generated tool specs
  - runtime workspace materialization
  - smoke test loop
  - web research to PDF slice

Main gaps:

- No `ComputerSessionRuntime` owns a full observe/plan/act/verify loop.
- `browser_action` is mirrored into capability storage, but is not registered as
  a real capability handler for `capability.start`.
- Generic `CapabilityDagRuntime` is not wired into daemon server as the main
  multi-step execution engine.
- ROI cascade still lacks a complete executor for tile crop, ROI OCR, detector,
  GUI parser, and VLM fallback.
- Native Windows helper is browser-window scoped and has capability mismatch:
  it advertises screenshot-like support through adapter metadata, but Rust
  helper execution reports screenshot unsupported.
- Windows full desktop control lacks foreground collision protection, signing,
  active-window leasing, user-idle detection, and rollback proof.

## Architecture Direction

The architecture should become:

```text
User request
  -> ComputerSessionRuntime
  -> permission profile and safety classification
  -> ExecutionSurfaceManager selects surface
  -> observe screenshot/DOM/UIA/OCR/terminal/file state
  -> PerceptionGraph and evidence graph
  -> planner emits normalized ComputerAction or structured fast-path operation
  -> ExecutorRouter sends to backend adapter
  -> action result and post-observation
  -> EffectVerifier
  -> failure memory / eval ledger / debug bundle
  -> completion, recovery, or blocked state
```

The first production-useful route should not be full desktop control. It should
be:

1. Isolated browser and Browser Action parity.
2. Browser Chrome deep actions with strict permission gates.
3. Toolsmith and terminal fast paths for research, document conversion, and
   local artifacts.
4. Screen/OCR/vision observe and explain.
5. Narrow Windows foreground watch-mode for browser chrome, permission prompts,
   and file picker boundaries.
6. Signed helper v2 and future VM/sandbox for broader Windows app workflows.

## Non-Negotiable Boundaries

Never treat the following as implementation details that can be bypassed:

- User approval.
- Restricted-page handling.
- Credential secrecy.
- Local-only daemon security.
- Destructive-action protections.
- Raw microphone/audio privacy.
- Raw screenshot/blob retention policy.
- Generated-code sandboxing.
- Release signing constraints.
- Browser history always requiring one-time approval.
- Debugger access requiring explicit approval.
- File upload requiring explicit local-file grants.
- High-risk Windows settings/app mutation remaining blocked until signed helper
  and rollback proof exist.

## Important Renames And Scope Corrections

`desktop_action` is currently too broad. It should be split or clarified:

- `native_browser_window_action`
  - current Windows browser UIA helper behavior
  - browser top-level windows only
  - fallback for extension/CDP limitations
- `visual_desktop_action`
  - future true desktop visual action adapter
  - must require watch-mode or isolated VM surface

`CapabilityDagRuntime` should become a real daemon-owned execution substrate,
not just a smoke/dogfood utility.

`BrowserAction` should become a normal executable backend in the capability and
computer-session stack, not only a mirrored transaction log.

## Implementation Ownership Map

Likely code areas:

- `src/shared/protocol/*`
  - computer-use action/session protocol
  - surface and permission types
  - debug bundle shape
- `src/daemon/computer-use/*`
  - new session runtime
  - surface manager
  - action adapter
  - executor router
  - verifier
- `src/daemon/capability-runtime/*`
  - handler registration
  - locks
  - approval integration
  - eval linkage
- `src/daemon/capability-dag/*`
  - run ownership
  - node cancellation
  - node rollback
  - resource linkage
- `src/daemon/browser-action/*`
  - register as backend handler
  - normalize action results
  - perception graph reads
- `src/daemon/browser-chrome/*`
  - deep action backend
  - permission evidence
- `src/daemon/scoped-autonomy/*`
  - Toolsmith backend integration
  - generated tool provenance
- `src/daemon/perception-graph/*`
  - graph merge and target grounding
- `src/daemon/perception-cascade/*`
  - executor implementation
- `src/daemon/failure-memory/*`
  - recovery calibration
- `src/daemon/server/http/routes/*`
  - session APIs
  - debug bundle APIs
- `src/renderer/*`
  - Computer Use panel
  - permission profile editor
  - session timeline
  - action preview
  - debug export
- `providers/browser-native-desktop-helper-rs/*`
  - helper v2
  - watch-mode support
  - capability truthfulness
- `scripts/*`
  - smokes
  - dogfood
  - eval rollups
