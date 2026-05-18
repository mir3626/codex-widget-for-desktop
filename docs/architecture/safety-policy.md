# Safety Policy Architecture

## Purpose

Safety decisions must be consistent across shell commands, Browser Action,
Vision-derived actions, app-server tool requests, evaluate/full-control mode,
and future desktop automation.

## Shared Decision Model

Every action-capable path should produce a safety decision with:

- subject kind and capability
- action family
- target summary
- risk level
- decision: allow, confirm, clarify, block
- reason
- destructive/sensitive flags
- secret redaction summary
- policy match metadata
- audit-safe details only

## Non-Negotiable Rules

- Low-confidence side effects clarify.
- Destructive, credential-sensitive, submit, send, post, publish, pay, purchase,
  auth, password, token, upload, download, cross-origin side effects, and
  permission prompts require confirmation or block according to the active
  Computer Use permission mode.
- Passwords, tokens, cookies, payment values, and credentials are never
  persisted.
- `full_control_dev` evaluate remains explicit, previewed, approved, audited,
  timed, result-limited, and secret-guarded.

## Computer Use Permission Modes

The current mode reference is
`docs/plans/computer-use-permission-modes.md`.

- YOLO mode keeps credential/cookie/CAPTCHA and payment/purchase safety groups
  locked.
- SUPER-YOLO mode is a confirmed one-time escalation, but the two safety groups
  remain default-off.
- SUPER-YOLO plus a category unlock can satisfy profile-level permission
  requirements for that category so the runtime reaches approval/execution
  paths. It does not permit silent raw-secret persistence, restricted-page
  bypass, unattended CAPTCHA solving, or unreviewed purchase commits.

## Consolidation Target

Create a daemon safety kernel under `src/daemon/safety/`. Feature-specific
policies may still classify their domain, but the final decision shape,
redaction policy, approval expiry, revocation, audit metadata, and tests should
be shared.
