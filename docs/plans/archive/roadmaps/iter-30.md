## Iteration iter-30: Browser Profile Permission Model

Status: complete.

Carryover: Credential consent leases existed, but authenticated browser
profile/session/account/cookie access needed its own default-deny policy layer.

### iter-30-sprint-01-browser-profile-lease-policy

Goal: implement explicit browser profile/session/account/cookie requirements,
lease matching, revoke, redaction, and audit evidence.

Status: complete. Added browser profile policy evaluation, account hints on
leases, browser-profile lease revoke route/audit response, permission decision
summaries, and `smoke:computer-use-browser-profile-permission`.
