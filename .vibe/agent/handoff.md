# Handoff

## Current State

Codex Widget for Desktop is a Tauri + React + Node daemon desktop widget. The
daemon listens on `127.0.0.1:4128`; the renderer is served by Vite in dev.

The latest completed product work is post-review hardening for mode-aware
Computer Use SUPER-YOLO safety boundary unlock execution, after the SUPER-YOLO
permission override UI and Computer Use catch-up capability recipes through
`iter-39`.
The latest report work is
`computer-use-capability-comparison.html`, a root-level Korean HTML comparison
of widget/Codex macOS/Hermes Agent Computer Use prompt capability. Active sprint
pointer is idle. Current active roadmap file is compacted to the current
iteration only; historical roadmaps live under `docs/plans/archive/roadmaps/`.

## Latest Update: SUPER-YOLO Runtime Trust Boundary Hardening

Closed the review findings for mode-aware SUPER-YOLO execution.

Applied:

- WS `capability.start` now strips client-supplied runtime-only approval and
  permission-decision fields before enqueueing, so external messages cannot
  set `requireApproval: false` or forge a SUPER-YOLO decision.
- `CapabilityRuntime` now accepts server-generated
  `trustedPermissionDecision` separately from persisted job input; terminal
  credential unlock uses that trusted context only, and persisted command input
  is redacted while transient input remains in memory for execution.
- Terminal credential-like detection now uses the same broad keyword form for
  hard-blocking, persistence redaction, transient input selection, and scoped
  autonomy redaction, covering `password placeholder` as well as
  `password=placeholder`.
- Payment/purchase prompts now infer `external_submission`, map to autonomy
  `high_risk`, and carry the original user request into terminal risk
  requirement reasons so the payment/purchase unlock applies only to matching
  payment/purchase text.
- SUPER-YOLO safety boundary unlock profile writes are validated server-side:
  category unlocks require `scoped_yolo`, `one_time`, max one use, explicit
  SUPER-YOLO confirmation, and the matching disclaimer acknowledgement marker.

Verification passed:

- `npm run build:daemon`
- `node scripts/smoke-terminal-capability.mjs`
- `node scripts/smoke-computer-use-credential-consent.mjs`
- `node scripts/smoke-computer-use-browser-profile-permission.mjs`
- `node scripts/smoke-computer-use-terminal-parity.mjs`
- `npm run lint`
- `node scripts/smoke-renderer-computer-use-profile-draft.mjs`
- `npm run smoke:computer-use-one-time-profile`
- `git diff --check` (only the existing CRLF normalization warning)
- strict UTF-8, mojibake, and `.cs` BOM touched-file checks

## Previous Update: Computer Use SUPER-YOLO Mode-Aware Execution

Connected the SUPER-YOLO safety boundary unlock model to current documentation
and runtime permission paths.

Applied:

- Added `docs/plans/computer-use-permission-modes.md` as the canonical mode
  matrix for YOLO, SUPER-YOLO, and SUPER-YOLO plus category-specific safety
  boundary unlocks.
- Updated current architecture/planning MD files so stale "always blocked"
  credential/cookie/CAPTCHA and payment/purchase wording now reflects
  mode-aware behavior.
- `evaluateAutonomyPermission` now recognizes:
  - `super_yolo_requires_user_confirmation`
  - `credential_cookie_captcha_boundary_released_by_user`
  - `payment_purchase_boundary_released_by_user`
- Credential/profile/cookie/CAPTCHA unlock can satisfy profile-level
  credential, browser profile/session/account/cookie, credential risk, and
  matching command requirements.
- Payment/purchase unlock can satisfy profile-level high-risk payment/purchase
  and matching command requirements.
- Computer Session terminal execution now lets credential-like commands pass
  the hard-block only when the active profile has the credential/cookie/CAPTCHA
  unlock; persisted capability job input is redacted and raw input remains
  transient.
- Computer Session Browser Action evaluate now derives
  `allowCredentialAccess` from the active profile unlock, while
  `full_control_dev` approval remains required.

Verification passed:

- `npm run build:daemon`
- `node scripts/smoke-computer-use-credential-consent.mjs`
- `node scripts/smoke-computer-use-browser-profile-permission.mjs`
- `node scripts/smoke-browser-action-evaluate.mjs`
- `npm run lint`
- `node scripts/smoke-renderer-computer-use-profile-draft.mjs`
- `node scripts/audit-computer-use-implementation-ready-parity.mjs`
  (`implementation_ready_with_external_deferred`, passed=9, missing=0)
- `node scripts/smoke-architecture-foundations.mjs`
- `npm run smoke:all`

## Previous Update: Computer Use SUPER-YOLO Permission Overrides

Added user-facing SUPER-YOLO override controls in the Computer Use permission
profile manager.

Applied:

- SUPER-YOLO remains gated behind the existing YOLO draft and still requires a
  user confirmation dialog before creating the one-time profile draft.
- Added two default-off override categories:
  - `Credential / Cookie / CAPTCHA`
  - `Payment / Purchase`
- Both categories show explicit disclaimer text in the UI and store disclaimer
  acknowledgement markers in the profile `safetyBoundaries` when enabled.
- Enabling a category removes its profile-level deny patterns and replaces the
  default safety boundary markers with user-release markers. Disabling restores
  the default-off boundary and deny patterns.
- Credential access remains `never` unless a separate explicit credential lease
  flow is authored; redaction and runtime policy layers still apply.

Verification passed:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke:renderer-computer-use-profile-draft`
- `npm run audit:computer-use-implementation-ready`
- `npm run smoke:all`
- `git diff --check`
- Strict UTF-8 read and mojibake scan over changed text files

## Previous Update: Computer Use Catch-Up Capability Recipes

Completed `$vibe-iterate` iteration `iter-39`.

Applied:

- Added a user-facing Computer Use YOLO one-time profile preset in the
  permission profile manager. It remains scoped/auditable and keeps credential
  access, cookie storage, host OS mutation, package install, CAPTCHA bypass,
  purchase/payment/submit, and raw debug leakage blocked.
- Added `computer-use-catchup-recipe.v1` planning for the HTML comparison gaps:
  Gmail tax-mail/PDF read-only workflows, Calendar draft approval, UIA guarded
  foreground action contracts, Browser Chrome permission get/set rollback,
  multi-site read-only research, recurring account triage, and VM sandbox
  readiness.
- Computer Session startup now records catch-up recipe evidence and uses recipe
  surface/risk hints while still failing closed on missing browser profile
  grants, native helper boundaries, and unavailable VM backends.
- Split Browser Bridge navigation helpers into a separate shard so the
  architecture source-size budget remains enforced.

Verification passed:

- `npm run smoke:computer-use-catchup-recipes`
- `npm run smoke:renderer-computer-use-profile-draft`
- `npm run smoke:computer-use-session`
- `npm run smoke:computer-use-browser-profile-permission`
- `npm run smoke:browser-chrome-capability`
- `npm run smoke:computer-use-vm-sandbox-boundary`
- `npm run audit:computer-use-parity` (`implemented_with_guarded_boundaries`,
  passed=61, guarded=7, blocked=0, missing=0)
- `npm run audit:computer-use-implementation-ready`
  (`implementation_ready_with_external_deferred`, passed=9, missing=0)
- `npm run smoke:all`

Remaining product follow-ups:

- Recipes are implementation-ready planning/evidence contracts. Live Gmail,
  Calendar, Slack, Notion, and multi-site execution still depends on user login,
  Browser Bridge permissions, and site layout.
- UIA foreground actions remain guarded until signed/watch-mode helper
  preconditions are available.
- VM execution remains fail-closed until a real Windows Sandbox/Hyper-V/RDP or
  cloud backend is configured.

## Previous Update: Computer Use Prompt Capability Comparison Report

Created `computer-use-capability-comparison.html` in the repository root.

Covered:

- Representative prompt: `gmail열어서 국세청에서 온 종소세 관련 이메일 내용 확인해줘`.
- General Spec prompts for common everyday Computer Use requests.
- Medium Spec prompts for less frequent but realistic user requests.
- Max Spec Benchmark prompts that combine implemented boundaries into upper-end
  capability tests.
- Per-prompt feasibility for the local widget, Codex macOS Computer Use, and
  Hermes Agent Computer Use with guarded/auth/destructive-flow notes.

Grounding:

- Local widget status is based on current parity and implementation-ready
  ledgers plus iter-37/iter-38 Browser Action and Browser Chrome behavior.
- Codex macOS and Hermes Agent status is based on current public product
  documentation checked during the report slice.

Verification passed:

- HTML report content sanity check
- `git diff --check`
- Strict UTF-8 read and mojibake scan over changed/new text files
- No `.cs` files touched

## Previous Update: Background Browser Chrome Control

Completed `$vibe-iterate` iteration `iter-38`.

Applied:

- Prompt routing now recognizes ordinal browser tab-switch requests such as
  `첫번째 탭으로 전환해줘` and sends Browser Chrome `tab.activate` instead of
  falling through to Browser Action DOM click or native hotkey paths.
- Browser Chrome command contract now includes `tab.list` and `tab.activate`;
  `tab.list` is read-only, while `tab.activate` remains side-effecting.
- Browser Bridge extension executes `tab.activate` with `chrome.tabs.update`,
  optionally focuses the browser window through Chrome API, verifies the active
  tab, and records no native input, hotkey, or pointer usage in metadata.
- The Browser Action e2e-control smoke now waits for the exact direct command
  `resultId` instead of accidentally matching an earlier chained click result.

Verification passed:

- `npm run smoke:browser-chrome-capability`
- `npm run smoke:extension`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-action:real-use-regressions`
- `npm run lint`
- `npm run audit:computer-use-parity` (`implemented_with_guarded_boundaries`,
  passed=61, guarded=7, blocked=0, missing=0)
- `git diff --check`

Remaining product follow-ups:

- Live real-browser verification should be repeated through the installed
  extension after restarting/reloading Browser Bridge so the new extension code
  is active.
- Wider browser chrome/window operations should remain explicit, bounded, and
  fail-closed before adding more prompts.

## Previous Update: Browser Action Multi-Step Prompt Decomposition

Completed `$vibe-iterate` iteration `iter-37`.

Applied:

- Known-destination compound Browser Action prompts now decompose into a
  destination navigation step followed by the follow-up in-page action.
- `gmail 들어가서 스팸편지함 눌러줘` resolves to `navigate
  https://mail.google.com/` plus `click 스팸편지함`, instead of a single
  unusable click target containing the destination phrase.
- The decomposition stays conservative: if the destination is not a URL or a
  known alias, the resolver falls back to existing behavior rather than guessing
  a navigation target.

Verification passed:

- `npm run smoke:browser-action:prompt-classification`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:real-use-regressions`
- `npm run lint`
- `git diff --check`

## Previous Update: Browser Action Navigation Verifier Finalization

Completed `$vibe-iterate` iteration `iter-36`.

Applied:

- Browser Bridge explicit `navigate` commands can now finalize success from a
  lightweight Chrome tab-state proof when the active tab reaches the requested
  destination URL but the full changed DOM after-observation is unavailable.
- The fallback is intentionally limited to explicit `navigate` with URL
  destination matching. `back`/`forward`/`reload` are not loosened because a URL
  change alone can still be the wrong user-visible destination.
- Extension smoke now verifies destination hash-insensitive matching, mismatch
  rejection, and no history-navigation lightweight finalization.
- Browser Action real-use regression smoke now verifies daemon result
  finalization and passed verification for lightweight explicit navigation
  proof.

Verification passed:

- `npm run smoke:extension`
- `npm run smoke:browser-action:real-use-regressions`
- `npm run lint`
- `node scripts/audit-real-use-widget-session.mjs --since 2026-05-18T02:55:59+09:00 --json`

## Previous Update: Browser Action Real-Use Feedback Reliability

Completed `$vibe-iterate` iteration `iter-35` after reviewing the latest direct
widget debug logs.

Applied:

- Manual debug feedback now records an `outcome`
  (`success`/`failure`/`partial`/`ux_issue`/`unknown`).
- Successful and UX-only manual debug notes no longer write negative Semantic
  Memory `avoid_target` corrections; wrong-target/failure notes still do.
- Prompt Browser Action eval metrics now include `requestId`, `messageId`,
  `actionSessionId`, and `transactionId`.
- `audit-real-use-widget-session.mjs` normalizes timezone-bearing `--since`
  values to UTC and correlates debug feedback to eval runs by request ids first,
  only falling back to prompt text when the prompt is unique.
- Browser Perception now requeues a fresh observe for side-effect requests when
  the extension returns a still-mutating context instead of handing that context
  to action execution.

Verification passed:

- `npm run build:daemon`
- `node scripts/audit-real-use-widget-session.mjs --self-test`
- `node scripts/smoke-semantic-memory.mjs`
- `node scripts/smoke-browser-perception.mjs stabilization`
- `node scripts/smoke-browser-action-real-use-regressions.mjs`
- `npm run lint`
- `git diff --check`
- Actual session audit with `--since 2026-05-18T02:55:59+09:00` now normalizes
  to `2026-05-17T17:55:59.000Z` and reports 26 messages / 10 manual debug
  entries instead of an empty range.

## Previous Update: Harness Sync v1.7.18

Ran `$vibe-sync` from `vibe-doctor` `v1.7.17` to `v1.7.18`.

Applied:

- Added v1.7.18 roadmap maintenance support:
  `.vibe/harness/scripts/vibe-roadmap-maintenance.mjs`,
  `.vibe/harness/test/roadmap-maintenance.test.ts`, and migration
  `.vibe/harness/migrations/1.7.18.mjs`.
- Updated harness runtime/tests/docs/skills and package/config sync metadata to
  `harnessVersion` / `harnessVersionInstalled` `1.7.18`.
- Compacted `docs/plans/sprint-roadmap.md` to the current iteration and archived
  old iteration sections under `docs/plans/archive/roadmaps/`.
- Preserved downstream project overrides after forced sync conflicts:
  Codex remains the default Orchestrator/Planner/Generator/Evaluator contract,
  Windows `run-codex.cmd` remains documented, and template hygiene tests keep
  the initialized-downstream guard.

Backup:

- `.vibe/sync-backup/2026-05-17T18-01-59-625Z`

Verification passed:

- `npm run vibe:sync-audit`
- `npm run vibe:typecheck`
- `npm run vibe:self-test` (`440` pass, `1` skip)

`node .vibe/harness/scripts/vibe-preflight.mjs` was run before commit and only
failed `git.clean` because the sync diff was intentionally uncommitted at that
point; all other sync/audit/version checks were OK, with non-blocking warnings
for stale handoff state and missing planner prompt while the sprint pointer is
idle.

## Current Resume Point

Worktree should be clean after the mode-aware SUPER-YOLO execution commit/push.
Next useful work is live dogfood of the unlocked paths in a controlled profile:
Browser Action evaluate with credential access, authenticated browser profile
read-only flow, and an explicit payment/purchase approval dry run that does not
commit a real transaction.

## Product Boundaries

- Production signing and the official app-server client-tool contract remain
  external blockers.
- VM/RDP/Windows Sandbox backends, GPU ASR, and human microphone corpus
  validation remain deferred environment/user-input work.
- Raw credential persistence, unattended high-risk Windows mutation, and
  unattended payment/purchase commits remain blocked by policy.
- Authenticated browser profile/cookie access is profile-level blocked in YOLO
  and default SUPER-YOLO, but can proceed to redacted runtime paths under
  SUPER-YOLO plus credential/cookie/CAPTCHA unlock.
- Credential implementation remains redacted/reference-only for vault handles
  and does not retrieve raw secrets from Windows Credential Manager or DPAPI.
