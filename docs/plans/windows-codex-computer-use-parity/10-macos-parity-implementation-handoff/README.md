# 10 - macOS Computer Use Parity Implementation Handoff

Status: product-owner approved implementation handoff
Date: 2026-05-16

## Purpose

This shard pack translates the accepted macOS Computer Use benchmark briefing
into an executable Windows widget implementation plan.

The goal is not to clone unknown private macOS internals. The goal is
user-outcome parity:

- observe the current computer state,
- choose a safe execution surface,
- perform browser, terminal, file, document, screen, and bounded native actions,
- verify concrete effects,
- expose evidence and rollback,
- and continue toward the requested task instead of refusing only because one
  capability is missing.

Future sessions should be able to resume from these files without chat history.

## Reading Order

After context loss, read in this order:

1. `docs/context/product.md`
2. `.vibe/agent/sprint-status.json`
3. `AGENTS.md`
4. `docs/plans/windows-codex-computer-use-parity-handoff.md`
5. `docs/plans/windows-codex-computer-use-parity/README.md`
6. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/README.md`
7. This file
8. `01-parity-contract.md`
9. `02-runtime-architecture.md`
10. `03-browser-chrome-and-web.md`
11. `04-native-screen-and-windows.md`
12. `05-toolsmith-terminal-artifacts.md`
13. `06-safety-permission-release.md`
14. `07-eval-dogfood-promotion.md`
15. `08-implementation-backlog.md`
16. `09-resume-protocol.md`

Then read the older domain shard for the files being edited:

- Browser/tool/terminal:
  `docs/plans/windows-codex-computer-use-parity/04-browser-tool-terminal-slices.md`
- Native helper/watch mode:
  `docs/plans/windows-codex-computer-use-parity/05-windows-native-helper-watch-mode.md`
- Eval/debug/dogfood:
  `docs/plans/windows-codex-computer-use-parity/06-eval-debug-ux-dogfood.md`
- Current implementation ledger:
  `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/07-current-status-ledger.md`

## Product-Owner Approval

The product owner confirmed that the briefing has been reviewed and approved.
Work may proceed in this direction.

This approval authorizes implementation of the parity architecture. It does not
authorize bypassing:

- user approval,
- restricted-page handling,
- credential secrecy,
- local-only daemon security,
- destructive-action protections,
- raw microphone/audio privacy,
- raw screenshot/blob retention policy,
- generated-code sandboxing,
- browser history/debugger/file-upload one-time approval,
- release signing constraints,
- or native foreground input without signed helper v2 guards.

## Strategic Target

The final product should behave like a Windows-native Codex Computer Use
surface:

```text
User request
  -> ComputerSessionRuntime
  -> permission profile and risk classification
  -> capability gap detection
  -> surface selection
  -> observe current state
  -> perception graph
  -> plan normalized actions or structured fast paths
  -> execute through browser/chrome/tool/terminal/native adapters
  -> verify effect
  -> record eval, debug bundle, artifacts, rollback, and failure memory
  -> continue, complete, ask approval, or block with exact missing grant
```

The implementation should prefer reliable structured APIs over fragile visual
clicking when both achieve the same user-visible outcome. Visual/native control
is still required for screen-only or OS-only workflows, but it must arrive
through explicit watch-mode contracts rather than broad foreground automation.

## Main Difference From Existing State

The repo already has many modules. The missing part is a single, daemon-owned
execution pipeline that treats those modules as interchangeable surfaces under
one Computer Session contract.

Existing modules should not be deleted or rewritten wholesale. They should be
wrapped and promoted into:

- a normalized session loop,
- a capability DAG,
- a perception/evidence graph,
- permission-profile enforcement,
- effect verification,
- debug/export surfaces,
- dogfood/promotion gates.

## Shard Summary

- `01-parity-contract.md` defines the user-visible capability contract and the
  parity matrix.
- `02-runtime-architecture.md` defines the daemon/session/DAG/perception loop.
- `03-browser-chrome-and-web.md` defines browser DOM, extension, CDP/debugger,
  downloads, history, file upload, permissions, and restricted-page behavior.
- `04-native-screen-and-windows.md` defines screenshot, OCR, UIA, watch-mode,
  helper v2, Windows app/settings, and VM fallback.
- `05-toolsmith-terminal-artifacts.md` defines scoped YOLO, Toolsmith,
  terminal, document conversion, and artifact workflows.
- `06-safety-permission-release.md` defines grants, risk classes, approval,
  redaction, rollback, signing, and release constraints.
- `07-eval-dogfood-promotion.md` defines measurement, scenario corpus, gate
  requirements, and proof rules.
- `08-implementation-backlog.md` gives ordered implementation slices with files,
  tests, and acceptance criteria.
- `09-resume-protocol.md` gives operational resume instructions and the current
  interrupted-slice warning.

## Completion Rule

Do not mark this migration complete until:

- browser, browser chrome, terminal, Toolsmith, screen/OCR, native helper
  boundary, eval/debug, renderer UX, and release gates are all represented in
  one Computer Session pipeline;
- high-risk actions require exact one-time approval and show evidence;
- Browser/Windows target selection can be explained through perception graph
  evidence;
- Toolsmith can fill missing capability gaps within scoped permissions;
- repeated dogfood shows task success, proof rate, p50/p95 latency, redaction,
  rollback, and rerun stability;
- all external blockers are documented as blockers, not counted as complete.
