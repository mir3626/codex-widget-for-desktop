# Windows Codex Computer Use Parity

Status: active sharded implementation handoff  
Date: 2026-05-16  
Branch: `main`

## Purpose

This directory is the durable handoff for the Windows implementation of Codex
Computer Use user-outcome parity. It exists so a future Codex session can lose
all chat context, read project files only, and continue the migration without
restarting from first principles.

The goal is a daemon-owned Computer Session pipeline that can:

- accept a user task,
- choose a safe execution surface,
- observe browser/screen/terminal/file/tool state,
- ground targets through current evidence,
- execute structured or visual actions through bounded adapters,
- verify effects,
- record eval/debug/rollback evidence,
- and continue, complete, ask for exact permission, or block with a specific
  reason.

This is not unrestricted desktop automation. Exact macOS internals are unknown
and are not the implementation target. The target is public behavior and user
outcome parity under Windows safety, signing, and privacy constraints.

## Mandatory Startup Sequence

When resuming after context loss, run or inspect:

```powershell
git status --short
Get-Content docs/context/product.md -TotalCount 40
Get-Content .vibe/agent/sprint-status.json -TotalCount 40
```

Stop product work if the clone is not initialized for
`codex-widget-for-desktop`.

Then read, in order:

1. `AGENTS.md`
2. `docs/plans/windows-codex-computer-use-parity-handoff.md`
3. This file
4. `00-overview.md`
5. `09-approved-execution-handoff/README.md`
6. `09-approved-execution-handoff/07-current-status-ledger.md`
7. `10-macos-parity-implementation-handoff/README.md`
8. `10-macos-parity-implementation-handoff/09-resume-protocol.md`
9. The domain shard for the file you are about to edit

Do not trust memory over these files. The worktree is intentionally dirty and
contains many generated implementation, dogfood, and report artifacts.

## Shard Map

Core architecture shards:

- `00-overview.md` - strategic target, current repo reality, and boundaries.
- `01-contract-session-runtime.md` - session/action protocol, runtime, routes,
  events, and debug bundle contract.
- `02-surfaces-permissions-safety.md` - execution surfaces, scoped grants,
  risk classes, credentials, restricted pages, files, network, and generated
  code policy.
- `03-observation-perception-action.md` - observations, perception graphs,
  ROI cascade, target grounding, action routing, effect verification, and
  failure memory.
- `04-browser-tool-terminal-slices.md` - Browser Action, Browser Chrome,
  Toolsmith, terminal, download, file upload, document conversion, and
  research-to-PDF verticals.
- `05-windows-native-helper-watch-mode.md` - native helper scope, helper-v2
  boundaries, watch-mode, foreground safety, signing, rollback, and VM route.
- `06-eval-debug-ux-dogfood.md` - eval ledger, debug bundle, renderer UX,
  dogfood corpus, promotion gates, and release readiness.
- `07-migration-checklist.md` - phase-by-phase implementation state.
- `08-implementation-resumption-handoff.md` - operational resume guide and
  current verification ladder.

Execution packs:

- `09-approved-execution-handoff/` - product-owner approved execution map:
  target boundaries, current inventory, implementation slices, runtime
  contracts, verification gates, and status ledger.
- `10-macos-parity-implementation-handoff/` - macOS Computer Use benchmark
  parity map translated into Windows user-outcome contracts, runtime
  architecture, browser/native/tooling workstreams, safety policy, promotion
  gates, and ordered backlog.

## Current Stable Boundary

The latest verified state is `implemented_with_guarded_boundaries`, not full
completion.

Implemented and smoke-covered foundations include:

- shared Computer Use protocol and Computer Session runtime,
- execution surfaces for isolated browser, regular browser extension, tool
  workspace, PTY workspace, foreground watch, and future VM,
- capability DAG linkage, cancellation, cleanup, verification, eval, and debug
  bundle evidence,
- Browser Action prompt execution through Computer Session,
- Browser Chrome deep actions through the Browser Bridge extension:
  tab groups, bookmarks, downloads, history, debugger, file upload, and site
  permissions,
- repeated public-site real-extension dogfood for download verification,
  debugger print-to-PDF, tab groups, redacted history, camera/microphone/
  location permission rollback, multi-tab grouping, file upload, and profile
  approval,
- scoped Toolsmith web research to Markdown/PDF and artifact mirroring,
- scoped Toolsmith self-implementation breadth dogfood for web/PDF, terminal
  generated tools, browser download verification, high-risk native blocking,
  rerun stability comparisons, repeated fixture sample ledger, p95 latency,
  and path-redaction proof,
- repeated scoped Toolsmith generated-tool live breadth dogfood for
  `web_research_to_pdf`, `local_document_conversion`,
  `terminal_generated_tool`, and `browser_download_verify`, including two
  execute runs per class, rerun stability, p95 latency, browser-fallback source
  hash calibration, approved local Markdown source-file conversion, public
  download verification, and redacted sample ledgers,
- terminal exact-command and output-root artifact evidence,
- screen/OCR/ROI cascade evidence and perception graph records,
- renderer Computer Use panels for sessions, profiles, Browser Chrome proof,
  native boundary proof, sources, artifacts, and debug bundle actions,
- native helper v2 capability manifest and observe-only watch preflight,
- disabled `foreground_watch_execute` contract evidence in Rust helper,
  release readiness, promotion gate, renderer proof, and Computer Session
  blocked visual-desktop evidence.

Guarded boundaries are intentional:

- foreground desktop mutation remains blocked before signed helper v2,
- native file picker selection remains blocked before signed helper v2,
- browser permission-bubble native click remains blocked before signed helper
  v2,
- broad Windows settings mutation remains blocked,
- future VM/sandbox backend remains blocked,
- production signing and store submission remain deferred/manual release gates.

## Latest Native Helper Evidence Invariant

The same disabled foreground executor state must remain aligned across:

- Rust helper `foreground_watch_execute`,
- helper capability manifest,
- `scripts/lib/browser-native-desktop-helper-contract.mjs`,
- `release-readiness.mjs`,
- `gate-computer-use-promotion.mjs`,
- `ComputerSessionRuntime` `visual_desktop_action` blocked output,
- debug-bundle safety decisions, observations, rollback metadata, and verifier
  records,
- renderer Native boundary proof panel.

Required schema:

```text
browser-native-desktop-helper-foreground-watch-executor.v1
enabled=false
supported=false
dryRunOnly=true
signedHelperV2Available=false
releaseGate=browser-native-helper-signing
actualInputSent=false
```

This schema is a disabled command shape and release evidence path. It is not
permission to send native foreground input.

## Non-Negotiable Boundaries

Never bypass:

- user approval for high-risk actions,
- restricted browser page limits,
- credential, cookie, token, payment, and secret redaction,
- local-only daemon control,
- destructive filesystem/registry/OS/browser/package protections,
- raw screenshot/audio retention rules,
- generated-code sandboxing,
- browser history/debugger/file-upload one-time approval,
- release signing constraints,
- native foreground input signing, countdown, active-window proof,
  process allowlist, user-idle/abort, effect verification, and rollback proof.

Memory and previous success may rank candidates only after current evidence
exists. They are never proof of current UI state.

## Implementation Policy

Work one vertical slice at a time:

1. Read the current files before patching.
2. Preserve unrelated dirty worktree changes.
3. Add or strengthen smoke coverage.
4. Add dogfood evidence for user-visible behavior.
5. Update the relevant shard, `09-approved-execution-handoff/07-current-status-ledger.md`,
   `.vibe/agent/handoff.md`, and `.vibe/agent/session-log.md`.
6. Run focused verification first.
7. Run aggregate verification before claiming a stable boundary.
8. Run `npm run vibe:checkpoint`.

Do not mark the broad goal complete until the final completion audit proves
all parity workstreams are implemented or explicitly blocked by external
non-negotiable constraints.

## Verification Ladder

Focused daemon native boundary checks:

```powershell
node --check scripts/smoke-computer-use-native-watch-boundary.mjs
node --check scripts/audit-windows-codex-computer-use-parity.mjs
npm run build:daemon
npm run smoke:computer-use-native-watch-boundary
npm run audit:computer-use-parity
npm run gate:computer-use-promotion
```

Full stable-boundary checks:

```powershell
npm run lint
npm run smoke:all
git diff --check
```

Encoding checks:

- validate touched text files as UTF-8,
- scan touched files for mojibake string literals,
- if `.cs` files are touched, verify BOM starts with `efbbbf`.

Known non-failing output:

- `git diff --check` may emit CRLF normalization warnings for
  `.vibe/agent/session-log.md`, `src/daemon/server.ts`, and
  `src/daemon/storage/storage.ts`.
- `smoke:all` may print an unsigned native helper development allowance.
- `smoke:all` may print a Windows temp cleanup deferred retry.

## Next Safe Work

Prefer one of these next, depending on product priority:

1. Broaden non-native Browser Chrome public dogfood with stable public,
   unauthenticated scenarios and repeated samples.
2. Continue live Toolsmith generated-tool breadth beyond the first promotable
   review gate with more public sources, generated ad hoc tools, and
   package-consuming scenarios when the package policy is explicitly granted.
3. Refactor very large session/runtime or renderer modules only behind
   behavior-preserving smoke coverage.
4. Prepare signed helper v2, but do not enable native foreground input until
   signing, watch-mode guards, countdown, user-abort, active-window proof,
   verifier, rollback, and release gates are real.

Native file picker selection and browser permission-bubble native clicking are
not next-safe implementation targets unless signed helper v2 work is explicitly
resumed.

## External Blockers

Keep these as blockers, not completed work:

- official app-server custom client-tool contract,
- production Authenticode signing certificate or signing service,
- unrestricted credential flow,
- authenticated browser profile/cookie default access,
- signed helper v2 for foreground input and native file picker,
- real VM/RDP/Windows Sandbox backend,
- GPU ASR validation,
- human microphone ASR corpus benchmark.
