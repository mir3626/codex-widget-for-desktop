## Iteration iter-32: Native Helper V2 Dev Contract

Status: complete.

Carryover: Foreground watch and disabled helper-v2 boundaries were present, but
the dev/unsigned contract needed direct smoke coverage.

### iter-32-sprint-01-helper-v2-dev-contract-smoke

Goal: verify foreground preflight, active-window/user-input guards,
before/after evidence readiness, screenshot metadata, disabled commands, and
unsigned-helper blocker semantics.

Status: complete. Added `smoke:browser-native-desktop-helper-v2-dev-contract`,
which ties protocol, helper client, adapter, and contract verifier evidence
together without sending native input.
