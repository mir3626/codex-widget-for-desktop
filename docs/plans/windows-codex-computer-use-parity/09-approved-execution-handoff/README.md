# 09 - Approved Execution Handoff

Status: product-owner approved execution pack
Date: 2026-05-16

## Purpose

This directory is the durable implementation handoff for the approved Windows
Codex Computer Use parity migration. It is intentionally sharded so future
sessions can recover after context loss by reading files only.

The product owner has approved the current design direction and wants work to
continue. Because the scope is large, this pack records:

- the accepted target architecture,
- the current implementation inventory,
- the ordered implementation backlog,
- the runtime contracts that must not drift,
- the verification and dogfood gates,
- and exact restart rules for future Codex sessions.

This pack is not a scope reduction. It is an execution map for the broader
handoff in:

- `docs/plans/windows-codex-computer-use-parity-handoff.md`
- `docs/plans/windows-codex-computer-use-parity/00-overview.md`
- `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/README.md`
- `docs/plans/windows-codex-computer-use-parity/07-migration-checklist.md`
- `docs/plans/windows-codex-computer-use-parity/08-implementation-resumption-handoff.md`

## Reading Order After Context Loss

If a future agent starts with no chat context, read in this exact order:

1. `docs/context/product.md`
2. `.vibe/agent/sprint-status.json`
3. `AGENTS.md`
4. `docs/plans/windows-codex-computer-use-parity-handoff.md`
5. `docs/plans/windows-codex-computer-use-parity/README.md`
6. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/README.md`
7. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/01-target-boundaries.md`
8. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/02-current-inventory.md`
9. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/03-implementation-slices.md`
10. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/04-runtime-contracts.md`
11. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/05-verification-dogfood-promotion.md`
12. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/06-resume-maintenance.md`
13. `docs/plans/windows-codex-computer-use-parity/09-approved-execution-handoff/07-current-status-ledger.md`
14. `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/README.md`
15. `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/01-parity-contract.md`
16. `docs/plans/windows-codex-computer-use-parity/10-macos-parity-implementation-handoff/02-runtime-architecture.md`
17. The older domain shard for the files being edited:
    - Browser/tool/terminal: `04-browser-tool-terminal-slices.md`
    - Native helper/watch-mode: `05-windows-native-helper-watch-mode.md`
    - Eval/debug/dogfood: `06-eval-debug-ux-dogfood.md`
    - Checklist state: `07-migration-checklist.md`
    - Last rolling notes: `08-implementation-resumption-handoff.md`

## Product-Owner Approval

The product owner confirmed:

- The current briefing is accepted.
- Work should proceed in this direction.
- The implementation volume is large, so handoff must be detailed enough to
  survive context loss.
- If the handoff becomes large, shard it.

Treat this approval as authorization to continue implementing the parity track,
but not as authorization to bypass safety boundaries, skip verification, or push
without an explicit push request.

## Active Goal

Implement Windows parity for Codex macOS Computer Use user outcomes through the
existing widget/daemon architecture:

- daemon-owned Computer Session runtime,
- explicit execution surfaces,
- capability DAG scheduling,
- perception graph evidence,
- permission profiles and one-time grants,
- scoped Toolsmith self-implementation,
- browser chrome deep actions,
- terminal and document/artifact workflows,
- native Windows helper/watch-mode boundaries,
- unified eval ledger,
- debug bundle and renderer control surfaces,
- dogfood corpus and promotion gates.

Exact macOS internals are unknown and are not the implementation target. The
target is public behavior parity and user-outcome parity under Windows safety
constraints.

## Non-Negotiable Boundaries

Never implement a shortcut that violates these boundaries:

- User approval is required for high-risk actions.
- Restricted browser pages remain restricted.
- Credentials, cookies, tokens, payment data, and secrets stay redacted.
- Daemon control remains local-only.
- Destructive filesystem, registry, OS, browser history, and package actions
  need explicit bounded grants.
- Raw screenshot/blob/audio retention policy must be respected.
- Generated code must run only inside scoped runtime workspaces and permission
  profiles.
- Native helper paths that mutate the foreground desktop require signing,
  active-window proof, visible countdown/abort controls, effect verification,
  rollback proof, and audit evidence.
- Release signing constraints remain explicit blockers until the production
  certificate/service path exists.

## Latest Completed Slice

Completed post-handoff implementation slices:

- `User input aborts foreground watch-mode action`
- `Renderer one-time profile draft preview`
- `Renderer selected profile detail and lifecycle controls`
- `Renderer permission profile manager and promotion gate`
- `Renderer Browser Chrome evidence UX and promotion gate`

Rationale:

Foreground watch result:

- Optional watch-mode preflight metadata was added to visual desktop
  operations.
- Runtime evaluates visible countdown, active-window assertion, process allowlist,
  user-idle/user-input state, abort-on-user-input guard, verifier readiness,
  rollback readiness, and signed-helper availability.
- It aborts before native input when user input or active-window drift is
  detected.
- It keeps `actualInputSent: false`.
- It records DAG, safety decision, observation, verifier failure, failure memory,
  debug bundle, and promotion-gate evidence.
- It does not claim helper v2 or foreground native input is complete.

Renderer profile-draft result:

- Blocked runs show a draft one-time profile preview before attachment.
- The preview names scope, max uses, credential policy, risk classes, browser
  grants, exact command count, and write-root count.
- The POSTed profile remains one-time and keeps `credentialAccess: "never"`.
- Smoke coverage verifies the renderer draft and profile payload.

Renderer selected-profile result:

- Selecting an active profile shows scope, mode, status, risk, browser grants,
  command/write counts, generated-code state, credential policy, use count,
  expiry, and exact domain/command/write-root grant details.
- Disable/Expire lifecycle actions use the existing profile update route.
- Smoke coverage verifies profile detail rendering, exact grant values, and
  Disable POST wiring.

Renderer profile-manager result:

- The Computer Use panel lists all profiles for management while new sessions
  only select active profiles.
- Users can create a safe one-time profile draft, edit/save a managed profile,
  and disable/expire managed profiles.
- Renderer validation blocks credential grants and persistent high-risk/package/
  OS grants before POST.
- `smoke:renderer-computer-use-profile-draft` verifies unsafe draft blocking,
  safe one-time manager creation, selected-profile detail, and lifecycle POST.
- `renderer_permission_profile_ux` is now tracked by the promotion gate as a
  passed but non-promoting renderer safety UX gate.

Renderer Browser Chrome evidence result:

- Browser Chrome capability jobs are summarized in a dedicated renderer section.
- Download verification, history redaction, fixed debugger commands, site
  permission mutation, and file-upload evidence rows show verifier labels,
  redaction summaries, and linked resource roles.
- `smoke:renderer-computer-use-browser-chrome-evidence` verifies the renderer
  with a fake daemon bundle.
- `browser_chrome_deep_action_evidence_ux` is tracked by the promotion gate as
  a passed but non-promoting renderer evidence UX gate.

Next recommended slice:

Repeated Browser Chrome live dogfood for downloads/print-to-PDF, or live
profile-approval dogfood

Detailed steps remain in `03-implementation-slices.md`. For the fastest resume
state after context loss, read `07-current-status-ledger.md`; it records the
latest stable boundary, implemented/started/blocked matrix, next safe slice,
and verification command set.

## Completion Rule

Do not mark the global goal complete until all of the following are true:

- All explicit workstreams in the parity handoff are implemented or documented
  as blocked by an external non-negotiable constraint.
- Browser, Toolsmith, terminal, Windows helper, eval/debug, renderer, dogfood,
  and promotion-gate paths have code and verification coverage.
- The renderer can explain what was allowed, what was blocked, what evidence was
  used, what artifacts were created, what rollback can do, and what still needs
  approval.
- The promotion gate can distinguish eligible, guarded, blocked, and deferred
  slices without relying on prose-only status.
- Full verification has passed or failures are documented with exact commands,
  logs, and next actions.
