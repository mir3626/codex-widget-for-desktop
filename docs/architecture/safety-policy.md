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
  permission prompts require confirmation or block.
- Passwords, tokens, cookies, payment values, and credentials are never
  persisted.
- `full_control_dev` evaluate remains explicit, previewed, approved, audited,
  timed, result-limited, and secret-guarded.

## Consolidation Target

Create a daemon safety kernel under `src/daemon/safety/`. Feature-specific
policies may still classify their domain, but the final decision shape,
redaction policy, approval expiry, revocation, audit metadata, and tests should
be shared.

