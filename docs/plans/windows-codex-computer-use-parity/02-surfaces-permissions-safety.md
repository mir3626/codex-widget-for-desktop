# 02 - Surfaces, Permissions, And Safety

## Goal

Make execution surface explicit. The widget should not treat browser extension,
isolated browser, terminal, generated tools, and foreground desktop control as
one undifferentiated "computer use" permission.

## Execution Surface Model

Suggested type:

```ts
export type ExecutionSurfaceKind =
  | "isolated_browser"
  | "regular_browser_extension"
  | "tool_workspace"
  | "pty_workspace"
  | "foreground_desktop_watch"
  | "future_vm_session";
```

Surface record:

```ts
type ExecutionSurface = {
  id: string;
  kind: ExecutionSurfaceKind;
  ownerSessionId?: string;
  isolationLevel: "process" | "profile" | "workspace" | "foreground" | "vm";
  supportsVisualActions: boolean;
  supportsStructuredDom: boolean;
  supportsBrowserChrome: boolean;
  supportsTerminal: boolean;
  supportsGeneratedTools: boolean;
  supportsFileArtifacts: boolean;
  requiresForeground: boolean;
  requiresUserProfileAccess: boolean;
  defaultRiskClass: RiskClass;
};
```

## Surface Priority

1. `isolated_browser`
   - Default for public unauthenticated web workflows.
   - Best match for Codex in-app Browser behavior.
   - Should use Playwright/CDP with a session-owned temp profile where possible.
   - Can load the browser bridge extension when needed.

2. `tool_workspace`
   - Default for research, source extraction, Markdown/PDF generation, local
     file artifacts, and deterministic transformations.
   - Uses Toolsmith or reviewed built-in tools.

3. `pty_workspace`
   - Default for command-line tasks that are clearly shell-native.
   - Must remain command/profile bounded.

4. `regular_browser_extension`
   - Use only when the task explicitly targets the user's current browser
     context or requires browser profile state.
   - Higher privacy risk.
   - History/debugger/file upload remain one-time approval surfaces.

5. `foreground_desktop_watch`
   - Use only for bounded Windows UI workflows that cannot be represented by
     browser/tool/terminal fast paths.
   - Requires explicit user approval, countdown, active-window assertion,
     idle check, abort-on-user-input, pre/post evidence, and rollback/effect
     verification.

6. `future_vm_session`
   - Long-term route for full desktop parity.
   - Current runtime blocks this surface with
     `future_vm_session_backend_not_available` before VM creation, network
     bridge, host mutation, clipboard/file sync, or screenshot retention.
   - Required preconditions remain explicit: VM backend provider, pinned image
     or snapshot, network isolation, clipboard/file sync policy, lifecycle
     cleanup, observation retention policy, and effect verifier.
   - Do not mark current implementation complete based on this future route.

## Permission Profile Completion

Permission profile must express:

- allowed domains
- denied domains
- browser automation grant
- browser profile access grant
- extension chrome API grant
- debugger grant
- history grant
- downloads grant
- file upload grant
- file read roots
- file write roots
- command allowlist
- package install grant
- generated code grant
- network grant
- runtime timeout
- output size limit
- OS mutation grant
- credential policy
- risk class ceiling
- one-time vs persistent
- expiry time
- max uses

Default:

- No credentials.
- No browser history persistent grant.
- No debugger persistent grant.
- No file upload without explicit paths.
- No OS settings mutation.
- No foreground desktop action without active watch-mode approval.

## Permission Checkpoints

Do not rely on a single initial profile check. Enforce permissions at:

1. Session creation.
2. Surface selection.
3. Tool materialization.
4. Dependency installation.
5. Smoke execution.
6. Task execution.
7. Artifact persistence.
8. Browser chrome command execution.
9. File upload path binding.
10. History/debugger access.
11. Foreground desktop action execution.
12. Rollback cleanup.

Any generated tool must call back into permission evaluation before executing
network, file, command, or browser operations.

## Risk Classes

Suggested classes:

- `read_only`
- `local_artifact_create`
- `browser_state_mutation`
- `local_file_disclosure`
- `profile_private_data`
- `external_submission`
- `destructive_local_change`
- `os_settings_mutation`
- `credential_or_secret`
- `security_boundary`

Risk must be attached to:

- plan
- DAG node
- action batch
- capability job
- generated tool operation
- verifier result
- eval ledger step

## Approval Rules

Approval should be required for:

- posting/submitting content to third-party services
- purchases, payments, financial actions
- account settings changes
- credential entry
- local file upload/disclosure
- browser history read/open
- debugger inspection
- download start/cancel/erase when user-visible or risky
- OS setting mutation
- foreground desktop control
- destructive file operations
- package install
- generated code execution beyond reviewed template

Direct takeover or user/manual completion should be required for:

- passwords
- CAPTCHA
- paywalls requiring user identity
- admin authentication
- OS privacy/security permission prompts
- signing certificate operations

## Restricted Page Handling

Restricted browser pages should not be bypassed.

Expected behavior:

- Explain that extension DOM injection is unavailable.
- Offer safe alternatives:
  - use a normal http/https tab
  - use browser chrome API if the command is explicitly supported
  - use native helper diagnostics for approved browser chrome fallback
  - ask the user to complete the restricted step manually
- Record blocked reason and recovery suggestion.

Do not implement hidden workarounds for Chrome Web Store pages, browser
settings pages, extension pages, password manager pages, or security prompts.

## Credential Policy

Current policy:

- Do not store credentials.
- Do not read secrets from UI fields.
- Do not type passwords automatically.
- Redact token/cookie/payment/password-like data from evidence.
- If a task requires authentication, ask the user to take over for the
  credential step, then continue only after a safe post-auth observation.

Future secure credential flow is out of scope for this handoff.

## File Policy

File reads:

- Require explicit root grants or explicit absolute paths.
- Evidence may include basename and hash, not arbitrary full content unless
  requested and allowed.

File writes:

- Require explicit output root.
- Generated artifacts must record:
  - path
  - hash
  - size
  - MIME/type
  - producing tool
  - rollback policy

File upload:

- Requires explicit absolute `approvedFilePaths`.
- Evidence stores basename-only previews.
- Native OS file picker remains future unless helper v2 implements a bounded
  picker workflow.

## Network Policy

Network operations require:

- domain allowlist match
- request purpose
- source evidence retention
- redirect handling
- size/time limits
- content-type validation

For research tasks, record:

- URL
- fetch time
- status
- content type
- title
- extracted sections
- citation mapping
- redaction result

## Safety Audit Outputs

Each blocked or approved action should produce a structured safety record:

```ts
type SafetyDecision = {
  decisionId: string;
  sessionId: string;
  nodeId?: string;
  actionId?: string;
  riskClass: RiskClass;
  decision: "allow" | "require_approval" | "block";
  reasons: string[];
  missingGrants: string[];
  redactions: string[];
  createdAt: string;
};
```

This record must be included in debug bundles and eval ledger resources.

## Acceptance Criteria

- A blocked run shows exact missing grants.
- A user can approve a narrower one-time profile from a blocked run.
  Implemented first for Computer Sessions on 2026-05-16: the renderer derives
  scoped autonomy requirements from safety decisions, selected surface grants,
  and awaiting jobs, then creates and attaches a one-time profile. Permission
  attachment is evidence-recorded and does not override external safety
  blockers.
- History/debugger/file upload cannot be made always-allow by accident.
- Foreground desktop action cannot execute without watch-mode conditions.
- Generated tools cannot bypass profile enforcement.
