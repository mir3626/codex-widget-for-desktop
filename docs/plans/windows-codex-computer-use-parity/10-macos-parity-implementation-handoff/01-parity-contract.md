# 01 - Parity Contract

## Objective

Define what "Windows parity with macOS Computer Use" means for this project.

Because exact macOS internals are not part of the repo, parity is defined by
observable user outcomes and host responsibilities, not by hidden
implementation details.

## Behavioral Contract To Match

The widget should support the following loop:

1. Observe: capture the relevant state of a browser, app window, screen,
   terminal, file, or generated-tool workspace.
2. Reason: choose the safest surface that can complete the requested task.
3. Act: execute normalized computer actions or structured fast-path operations.
4. Verify: prove that the action had the intended effect.
5. Recover: reobserve, retry, ask for clarification, ask for approval, switch
   surfaces, or block with a precise reason.
6. Record: persist redacted evidence, resources, timings, eval metrics, and
   rollback information.

## Normalized Action Vocabulary

The public computer-use action vocabulary to support through the session loop:

- `screenshot`
- `click`
- `double_click`
- `move`
- `drag`
- `scroll`
- `type`
- `keypress`
- `wait`

The widget may execute a user outcome through richer structured operations when
that is safer or more reliable:

- DOM click/type/read through Browser Action.
- Chrome downloads/history/tab/bookmark/debugger APIs.
- File input set through bounded extension/debugger APIs.
- Terminal command through exact command grants.
- Toolsmith generated script through a scoped runtime workspace.
- Windows UIA/native helper when signed watch-mode is available.
- Document rendering through built-in PDF or an approved local tool.

All structured fast paths must still produce evidence equivalent to what a
visual computer-use loop would need: what was observed, what target was chosen,
what action was taken, what changed, and how it was verified.

## Parity Matrix

| Capability | macOS-style user outcome | Current Windows widget path | Required target |
|---|---|---|---|
| Browser page observe | Inspect page state before acting | DOM extension, Playwright/CDP observations, Browser Action snapshots | Computer Session owns observation, perception graph, and post-action feedback. |
| Browser click/type/scroll | Interact with web page elements | Browser Action prompt path and adapters | Register as first-class capability DAG nodes with current graph evidence and verifier proof. |
| Browser navigation/search | Open site, search, follow result | Browser Action prompt planner and Playwright/CDP/extension backends | Isolated browser default for public tasks; regular browser only when user requests current profile/tabs. |
| Browser chrome actions | Bookmarks, tab groups, downloads, history, debugger, permissions, file inputs | Browser Chrome bridge commands mostly implemented | Keep high-risk commands one-time; add repeated live dogfood and renderer/gate evidence. |
| Download proof | Confirm downloaded file exists and is safe to reference | `download.verify` plus approved path blob resource | Store basename/hash/size as eval resource; avoid full paths unless explicitly granted. |
| File upload | Select a local file for a web file input | Extension/debugger file input path, native picker blocked | Use explicit file grants and basename evidence; native picker waits for signed helper v2. |
| Screen observe | Read visible screen/app state | Vision snapshots, screen capture, OCR, ROI cache | Route through perception graph and cascade with dirty-region early exits. |
| Native UI action | Click/type in non-web app | Boundary exists; broad input blocked | Signed helper v2 with active-window proof, countdown, abort-on-input, rollback, verifier. |
| Terminal work | Run local commands safely | terminal/PTY capability and exact allowlist | Computer Session terminal nodes with cwd/env/output redaction, artifacts, rollback. |
| Generated tools | Build missing local capability | Scoped Autonomy/Toolsmith exists | Use gap detector, smoke-test loop, activation only after pass, rerun and rollback evidence. |
| Artifact production | Produce Markdown/PDF/report/files | Toolsmith web research to PDF and artifact resources | Parent Computer Session should expose sources, commands, files, hashes, verifier proof. |
| Permission model | Ask at risk boundary | Permission profiles and one-time profile UX in progress | Durable renderer UX plus daemon enforcement before materialization, smoke, execution, persistence. |
| Debug and audit | Explain what happened | Debug bundle and eval ledger foundation | One exportable bundle per session with graph, DAG, resources, verifier, memory, rollback. |
| Recovery | Reobserve/retry/ask/block | Partial failure memory and prompt continuation | Structured failure memory can calibrate but never prove current UI state. |

## User-Outcome Scenarios

The parity contract is accepted when the widget can handle these scenario
classes through one session model:

- "Search the web, collect sources, and produce a PDF."
- "Open this page, click a visible result, and verify the destination."
- "Create a bookmark or tab group for these research tabs."
- "Download the linked PDF and confirm it completed."
- "Upload this explicit local file to this explicit file input."
- "Use current screen context to explain what changed."
- "Run a local conversion command and attach the generated artifact."
- "Generate a small bounded helper script when the needed capability is absent."
- "Refuse a dangerous Windows settings mutation with exact missing grants."
- "Pause for one-time approval at history/debugger/file/native boundaries."

## Implementation Principle

When a structured API can achieve the same user-visible outcome with stronger
proof, prefer it over visual clicking.

Examples:

- Use Chrome `downloads` API to verify completion instead of looking at a
  downloads shelf.
- Use Chrome `contentSettings` for site permission state instead of clicking a
  permission bubble when possible.
- Use DOM/accessibility selectors for web targets before screenshot-only
  coordinates.
- Use Toolsmith/terminal for document conversion instead of GUI print dialogs.

When structured APIs cannot cover the outcome, use visual/native control only
inside explicit foreground watch-mode or an isolated VM/sandbox.

