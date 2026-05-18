# Computer Use Implementation-Ready Parity

## Goal

Move the Windows Computer Use parity track from a guarded local implementation
to an implementation-ready architecture: every local code path, permission
contract, evidence trail, and fail-closed boundary should be present before
external production inputs are available.

This does not claim production parity. Authenticode signing, a stable official
app-server client tool contract, cloud VM or Windows Sandbox availability, GPU
ASR validation, and a human microphone corpus remain external or user-test
dependent.

## Local Contract Scope

Until an official app-server client tool contract is available, the product uses
the local Computer Session contract as the implementation boundary:

- typed session creation, operation execution, cancel, rollback, debug bundle,
  promotion-gate, and autonomy profile routes
- explicit permission profile evaluation before privileged surfaces
- redacted eval resources and debug bundles
- fail-closed app-server client-tool integration when a stable external contract
  is not present

The local contract should be adapter-shaped so a future official schema can be
mapped without broad feature rewrites.

## Credential Consent Scope

Credential handling must never mean unrestricted password, cookie, or token
access. The implementation-ready shape is:

- `credentialAccess: "never"` by default
- `credentialAccess: "ask"` only with the `credential` risk class
- at least one active credential consent lease for the domain, profile, session,
  or vault reference being used
- expiring and revocable leases
- vault references are handles only, not raw secret values
- debug bundles, eval resources, semantic memory, and activity logs store
  redacted summaries instead of secret values

The current implementation adds this lease/vault/redaction contract without
retrieving secrets from Windows Credential Manager or DPAPI. That retrieval can
be added later behind the same lease boundary.

### YOLO And SUPER-YOLO Mode Scope

The active mode matrix lives in
`docs/plans/computer-use-permission-modes.md`.

- YOLO mode keeps credential/cookie/CAPTCHA and payment/purchase categories
  locked.
- SUPER-YOLO mode broadens local/browser/tool grants after a user confirmation,
  but both safety categories remain default-off.
- SUPER-YOLO + credential/cookie/CAPTCHA unlock can satisfy profile-level
  `credential_access`, browser profile/session/account/cookie, credential risk,
  and matching command requirements so the runtime can continue into redacted
  approval/execution paths.
- SUPER-YOLO + payment/purchase unlock can satisfy profile-level
  payment/purchase high-risk and command requirements so the runtime can
  continue into explicit approval/execution paths.

These unlocks do not change the redaction contract: raw credential, cookie,
token, password, and payment values still must not be persisted in debug
bundles, eval resources, semantic memory, or logs.

## VM And Sandbox Deferral

High-risk host mutation should stay blocked unless an isolated execution surface
exists. The current repo keeps `future_vm_session` as a documented boundary.

Deferred implementation options:

- local Windows Sandbox where available
- local Hyper-V VM snapshot/rollback
- RDP-backed Windows VM
- cloud VM once cost and account setup are acceptable

Computer Use examples that should remain blocked on a normal host:

- run an untrusted installer and inspect the resulting app
- change registry or system settings outside a bounded reversible test key
- test driver, firewall, security, or account settings
- open unknown downloaded binaries

The implementation-ready goal is to keep those operations represented in the
surface manager and promotion gate while refusing host-side execution.

## ASR Deferral

ASR is not a blocker for browser, terminal, document, or local Computer Use
flows. GPU ASR validation and human microphone corpus benchmarking are deferred
until user test data exists.

User test evidence should include:

- audio sample metadata
- expected transcript
- command intent labels
- latency and word-error-rate or command-accuracy thresholds
- hardware/runtime profile
- privacy consent for storing benchmark artifacts

## Acceptance

- Credential access is denied without a live consent lease unless SUPER-YOLO +
  credential/cookie/CAPTCHA unlock is explicitly present.
- With that unlock, credential/profile requirements pass only as profile-level
  permission and remain subject to redaction and runtime approval.
- Credential leases can be revoked and revoke immediately blocks future
  evaluation.
- Vault references are reference-only and redacted.
- Renderer-created profiles can express one-time credential consent but block
  persistent or lease-less credential grants.
- A dedicated implementation-ready audit separates local readiness from
  deferred production inputs.
- Windows parity audit remains honest about guarded native/external blockers.
