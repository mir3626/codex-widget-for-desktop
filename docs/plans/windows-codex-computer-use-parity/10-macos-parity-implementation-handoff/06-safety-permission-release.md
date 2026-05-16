# 06 - Safety, Permission, And Release

## Objective

Keep the system useful without turning scoped autonomy into unrestricted YOLO.

Safety is not an afterthought. It is part of the Computer Session runtime,
permission model, renderer UX, eval ledger, and promotion gate.

## Permission Profile Model

Profiles should cover:

- domain grants,
- network grants,
- browser automation grants,
- browser chrome command grants,
- file read roots,
- file write roots,
- terminal command allowlists,
- package install grants,
- generated-code grants,
- OS mutation grants,
- credential policy,
- risk classes,
- runtime timeout,
- output size,
- max uses,
- expiration,
- one-time vs persistent mode.

Profile modes:

- one-time: default for blocked-run approval.
- persistent: only for low/medium risk and exact bounded grants.
- disabled: cannot be used.
- expired: retained for audit but not executable.

Credentials remain denied until a future secure credential flow exists. Do not
implement credential storage as part of this migration.

## Risk Classes

Suggested classes:

- `read_only`
- `low_risk`
- `medium_risk`
- `high_risk`
- `destructive`
- `credential`
- `restricted`
- `external_submission`

High-risk examples:

- browser history,
- debugger attach,
- file upload,
- browser site-permission mutation,
- package install,
- generated code execution beyond reviewed template,
- foreground desktop input,
- Windows OS mutation,
- destructive file operations,
- external submission.

## Approval Rules

Approval must happen before:

- materializing generated code when grants are missing,
- running smoke tests with generated code,
- executing high-risk browser chrome commands,
- reading approved local download files,
- uploading local files,
- package install,
- foreground native input,
- artifact persistence outside allowed roots,
- destructive cleanup of user artifacts.

Approval card should show:

- action summary,
- exact grant requested,
- surface,
- risk class,
- evidence that led to request,
- redaction policy,
- one-time option,
- deny/manual takeover option.

## Deny Rules

Always deny or block:

- credentials/cookies/tokens/password fields,
- restricted browser pages unless supported by a safe non-bypass route,
- arbitrary user-provided CDP/eval scripts,
- native foreground input without signed helper v2,
- broad OS mutation without verifier/rollback/signing,
- raw microphone/audio persistence outside policy,
- raw screenshot/blob persistence outside policy,
- global package install by generated tools,
- repo source mutation by generated tools unless explicitly requested.

## Redaction

Default redaction:

- local paths: basename-only unless explicit evidence grant exists.
- history: origin plus redacted path.
- screenshots: blob-backed and retention-controlled.
- terminal env: secret-like keys removed.
- tool outputs: size-limited previews.
- debug bundle: no credentials, cookies, tokens, or payment data.

Redaction policy must be explicit in:

- observations,
- capability outputs,
- eval resources,
- debug bundles,
- dogfood ledgers,
- renderer evidence rows.

## Rollback

Every action should record one of:

- concrete rollback action,
- cleanup action,
- not reversible with explanation,
- skipped because no input/effect occurred,
- blocked before effect.

Rollback examples:

- remove generated runtime workspace,
- delete temporary generated artifacts,
- clear file input when supported,
- cancel/erase download,
- restore browser permission setting,
- delete app-owned registry smoke key,
- close isolated browser surface,
- restore clipboard after scoped file picker helper.

User artifacts should not be deleted by default unless the user explicitly asks
for cleanup.

## Native Signing

Release cannot treat unsigned native helper as production-ready.

Required for helper v2 promotion:

- Authenticode signing certificate or signing service,
- binary hash/provenance in helper status,
- release readiness gate verifying bundled helper signature,
- installer smoke verifying signed helper path,
- dev unsigned allowance explicitly marked non-promoting.

## Browser Extension Permissions

Expanded browser permissions require store-readiness evidence:

- `tabGroups`,
- `downloads`,
- `history`,
- `debugger`,
- `contentSettings`,
- host permissions.

Store/review copy must explain:

- local-only bridge,
- no credential harvesting,
- one-time approval for high-risk actions,
- redacted history/path evidence,
- debugger fixed commands only,
- restricted-page handling.

## Release Gates

Release readiness must stay blocked or guarded when:

- production signing missing,
- helper v2 unsigned,
- browser extension store packet stale,
- expanded permissions lack review notes,
- high-risk actions lack repeated dogfood,
- promotion gate reports non-promoting passed guards only.

