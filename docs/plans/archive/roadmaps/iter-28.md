## Iteration iter-28: Computer Use Credential Consent And Implementation-Ready Parity

Status: complete.

Carryover: Windows Codex Computer Use parity is locally implemented with guarded
boundaries, but production signing, official app-server client-tool contract,
VM/sandbox backend, and ASR corpus validation remain external or user-test
dependent. The user chose to defer signing, VM/cloud, and ASR work, keep the
app-server path local-contract only, and implement credential consent/revoke/
redaction plus a local implementation-ready audit as far as possible.

### iter-28-sprint-01-credential-consent-lease-boundary

Goal: implement user-consented credential handling without opening unrestricted
credential access.

Expected scope: shared protocol types for credential consent leases, redacted
vault references, redaction policy, fail-closed permission evaluation, profile
storage normalization, explicit revoke route, renderer profile validation, and
focused smoke coverage.

Status: complete. Added shared credential consent lease, vault-reference, and
redaction policy types; fail-closed evaluator logic; profile storage
normalization; explicit HTTP lease revoke; renderer validation/evidence display;
and focused daemon/renderer smoke coverage. The implementation does not retrieve
raw secrets from any vault.

### iter-28-sprint-02-implementation-ready-parity-audit

Goal: separate local implementation readiness from production/external blockers
so Computer Use parity status remains honest.

Expected scope: implementation-ready design doc, local contract/deferred VM/ASR
documentation, dedicated audit/report/evidence script, package script wiring,
and refreshed context/checkpoint state.

Status: complete. Added `docs/plans/computer-use-implementation-ready-parity.md`
and `npm run audit:computer-use-implementation-ready`, which reports
`implementation_ready_with_external_deferred` when local readiness evidence is
present while production signing, official app-server contract, VM/cloud, and
ASR corpus inputs remain deferred.
