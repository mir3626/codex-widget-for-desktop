# 04 - Native Screen And Windows Workflows

## Objective

Add Windows-native computer-use capability without treating the current helper
as unrestricted desktop control.

The first native goal is observe/explain and narrow browser-window fallback.
Foreground input comes later through signed helper v2.

## Current Native Reality

Existing helper paths:

- Rust browser-native helper v1.
- PowerShell fallback.
- Browser top-level window scope.
- UIA-style observe/execute commands.
- Screenshot execution explicitly unsupported on helper v1.
- Broad `evaluate` and sensitive text are blocked.

Current safe boundary:

- `visual_desktop_action` is blocked before native input.
- `watchPreflight` can record user-input abort or active-window drift.
- `actualInputSent` remains false.
- Debug bundle records the boundary, verifier failure, rollback state, and
  failure memory.

Do not present helper v1 as macOS-equivalent desktop automation.

## Screen Observation

Required observation sources:

- screenshot metadata,
- OCR text and boxes,
- screen tile hash,
- dirty region list,
- UIA tree where available,
- previous observation freshness,
- Vision task capsule summary.

Implementation direction:

- Screen observe becomes a Computer Session observation node.
- Repeated screen observe should use tile hashing to avoid expensive rework.
- OCR regions should map into perception graph nodes.
- Raw screenshot blobs must follow retention policy.
- Renderer should show summary/evidence, not raw blobs by default.

## ROI And Cascade Runtime

Cascade order:

1. Cached perception graph hit.
2. Fresh DOM/UIA observe when available.
3. Tile diff and dirty-region detection.
4. ROI OCR.
5. Detector/recognizer split.
6. GUI parser.
7. VLM fallback.

Early exit:

- If the screen is unchanged and graph evidence is fresh enough, avoid full
  OCR/VLM rework.
- If DOM/UIA proves a target for side-effect action, avoid coordinate-only
  screenshot targeting.
- If evidence disagrees, abstain or clarify for side-effect/high-risk actions.

Metrics:

- p50/p95 per cascade stage,
- dirty tile count,
- OCR region count,
- skipped expensive stages,
- target proof source.

## UIA Policy

UIA selectors are evidence, not durable truth.

Rules:

- Reobserve before action.
- Rebind target from current UIA/screenshot evidence.
- Record selector mismatch.
- Prefer stable automation id/name/control type when available.
- Coordinates are allowed only after active-window, bbox, and target proof.

## Foreground Watch Mode

Foreground native input requires all of:

- signed helper v2 provenance,
- explicit one-time approval,
- visible countdown,
- active window assertion,
- process allowlist,
- title/URL/app identity proof,
- user idle proof,
- abort-on-user-input,
- pre-action screenshot/UIA evidence,
- surface lock,
- bounded timeout,
- post-action screenshot/UIA evidence,
- effect verifier,
- rollback proof or explicit non-reversible record.

If any item is missing, the action must block before input.

## Helper v2 Contract

Future signed helper v2 should expose explicit capabilities:

- `status`
- `observe_uia`
- `capture_screenshot`
- `focus_window`
- `click`
- `double_click`
- `move`
- `drag`
- `scroll`
- `key`
- `type_text`
- `clipboard_set_scoped`
- `clipboard_restore`
- `file_picker_select`
- `menu_command`

Each command reports:

- supported,
- requires foreground,
- requires approval,
- reversible,
- redaction behavior,
- allowed process/window constraints,
- max timeout.

Helper v2 output must include:

- helper binary hash/signature status,
- active window before/after,
- user-input guard status,
- target bbox/label proof,
- input sent flag,
- verifier hint,
- rollback hint.

Current helper-v2 preparation:

- Helper v1 now exposes helper-v2-only commands as explicit disabled command
  contracts instead of vague unsupported errors.
- `foreground_watch_execute` returns
  `browser-native-desktop-helper-foreground-watch-executor.v1` with
  `enabled: false`, `dryRunOnly: true`, and `actualInputSent: false`.
- `capture_screenshot`, `file_picker_select`,
  `browser_permission_popup_click`, `clipboard_set_scoped`, and
  `menu_command` return
  `browser-native-desktop-helper-v2-disabled-command.v1` with the same release
  gate and side-effect proof. File picker reports
  `localFilePathDisclosed: false`, permission popup reports
  `nativePopupClick: false` and `permissionChanged: false`, screenshot reports
  `screenshotCaptured: false`, and clipboard reports
  `clipboardContentLogged: false`.
- Release readiness probes those disabled contracts before evaluating the
  separate Authenticode signing gate. Passing this contract does not promote
  native input; it only proves helper-v2 commands fail closed until signing and
  policy gates are real.

## Native File Picker

Current status:

- Native file picker action is represented and blocked.
- Extension/debugger file-input path can cover many upload tasks without native
  picker.

Future helper v2 workflow:

```text
file_upload.inspect
  -> one-time approval with explicit file path
  -> ensure file picker active and expected process/window
  -> scoped clipboard set or direct path entry
  -> select file
  -> clipboard restore
  -> verify basename selected in page
  -> record rollback/non-reversible evidence
```

Rules:

- Never automate arbitrary Explorer browsing as a substitute.
- Never expose full local path without explicit grant.
- Never handle credential/security/admin prompts.

## Windows App And Settings Workflows

Current safe routes:

- read-only registry/app observation,
- bounded reversible HKCU app-owned smoke key,
- broad settings mutation blocked.

Future route:

- Start with read-only evidence and app-owned reversible actions.
- Then allow narrow user-approved workflows with helper v2 and rollback proof.
- Do not implement unattended high-risk OS mutation.

Examples:

- Read installed app version: allowed if privacy-safe and redacted.
- Open Settings page and observe title: allowed read-only with no mutation.
- Toggle real OS setting: blocked until helper v2, approval, verifier, rollback.
- Change registry outside app-owned sandbox: blocked unless explicit future
  policy and rollback proof exist.

## VM/Sandbox Future

A future VM/sandbox surface may approximate macOS-style broad computer use more
safely than host foreground automation.

Blocked until:

- backend selected,
- lifecycle create/observe/execute/teardown implemented,
- network policy implemented,
- clipboard/file sync policy implemented,
- artifact export implemented,
- screenshot retention policy implemented,
- debug/eval evidence implemented.

Do not fake VM support with host foreground automation.
