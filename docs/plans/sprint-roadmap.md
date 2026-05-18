# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: idle
> **Completed**: iter-39-sprint-01-user-yolo-mode-setting, iter-39-sprint-02-gmail-pdf-readonly-recipe, iter-39-sprint-03-calendar-draft-approval-recipe, iter-39-sprint-04-uia-foreground-action-contract, iter-39-sprint-05-browser-permission-rollback-recipe, iter-39-sprint-06-multisite-research-recipe, iter-39-sprint-07-recurring-worker-boundary, iter-39-sprint-08-vm-sandbox-readiness-recipe
> **Pending**: -
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration iter-39: Computer Use Catch-Up Capability Recipes

Status: complete.

Carryover: `computer-use-capability-comparison.html` identified the remaining
widget catch-up gaps versus Codex macOS Computer Use and Hermes Agent Computer
Use. This iteration applies one `$vibe-iterate`-style implementation slice per
gap while preserving local safety boundaries: no raw credential extraction, no
CAPTCHA bypass, no unattended purchase/submission, and no unsupported VM/native
mutation.

### iter-39-sprint-01-user-yolo-mode-setting

Goal: add a user-facing Computer Use YOLO preset that creates a scoped,
auditable permission profile for broad browser/tool work without enabling raw
credentials, host OS mutation, CAPTCHA bypass, or unattended destructive
actions.

Status: complete. Added a user-facing YOLO profile preset to the Computer Use
permission profile manager. The preset remains one-time, redacted, credential
default-deny, host-OS-mutation disabled, and CAPTCHA/purchase/payment/submit
bounded.

### iter-39-sprint-02-gmail-pdf-readonly-recipe

Goal: add regression-backed planning for Gmail/국세청/종소세 read-only flows,
including Gmail navigation/search/read, attachment download verification, PDF
summary handoff, and redacted evidence.

Status: complete. Added catch-up recipe planning for Gmail tax-mail read-only
flows, including Gmail navigation/search/read, attachment download
verification, PDF summary handoff, and redacted evidence requirements.

### iter-39-sprint-03-calendar-draft-approval-recipe

Goal: add Calendar web read/draft planning that writes only a draft until a
user approval gate explicitly confirms save/commit.

Status: complete. Added catch-up recipe planning for Calendar web read/draft
flows with `draft_requires_user_commit` before any save/send mutation.

### iter-39-sprint-04-uia-foreground-action-contract

Goal: connect UIA semantic observation to guarded native element action
contracts for prompts like reading an error dialog and clicking OK, with
foreground-watch preflight and no unsupported native input.

Status: complete. Added catch-up recipe planning for UIA semantic observation
plus guarded native element action contracts, preserving foreground watch and
unsigned-helper no-input boundaries.

### iter-39-sprint-05-browser-permission-rollback-recipe

Goal: add prompt planning and evidence requirements for browser permission
get/set/revoke flows through Browser Chrome content-settings commands with
one-time approval and rollback proof.

Status: complete. Added catch-up recipe planning for Browser Chrome
`permission.get`/`permission.set` with origin scope, one-time approval, and
rollback evidence.

### iter-39-sprint-06-multisite-research-recipe

Goal: add bounded multi-site comparison planning for browser research prompts
such as airfare comparisons, explicitly blocking purchase/booking/submit while
allowing read/extract/table synthesis.

Status: complete. Added catch-up recipe planning for read-only multi-site
comparison workflows with purchase/booking/submit and CAPTCHA/anti-bot stops.

### iter-39-sprint-07-recurring-worker-boundary

Goal: add a recurring local Computer Use worker boundary with schedule, profile
lease, run summary, revoke, and redacted evidence planning for daily
Gmail/Slack/Notion triage.

Status: complete. Added catch-up recipe planning for recurring account triage
with schedule, profile lease, summary-only runs, and revoke evidence
requirements.

### iter-39-sprint-08-vm-sandbox-readiness-recipe

Goal: add implementation-ready VM sandbox task planning that records backend
requirements, isolation, rollback, and artifact-sync evidence without claiming
execution when local Windows Sandbox/Hyper-V/RDP/cloud backend is unavailable.

Status: complete. Added catch-up recipe planning for VM sandbox readiness with
backend/isolation/lifecycle/artifact-sync requirements while preserving
fail-closed behavior until a VM backend exists.
