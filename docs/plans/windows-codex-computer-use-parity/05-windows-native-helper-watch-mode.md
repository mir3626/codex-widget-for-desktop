# 05 - Windows Native Helper And Watch Mode

## Goal

Safely extend Windows native control without pretending the current helper is a
macOS Computer Use equivalent.

Current helper scope is browser-window fallback. Full Windows app control is
future work and must pass stricter safety gates.

## Current Helper Reality

Rust helper:

- schema: `browser-native-desktop-helper.v1`
- commands: `status`, `observe`, `execute`
- scope: browser top-level windows
- process names: Chrome, Edge, Chromium, Brave, Firefox
- actions include read/click/type/select/check/scroll/navigate/back/forward/
  reload/hotkey/screenshot/evaluate
- `evaluate` is blocked
- sensitive text is blocked
- screenshot execution is unsupported

PowerShell fallback:

- same broad contract
- uses UIAutomationClient/UIAutomationTypes/System.Windows.Forms
- SendKeys-based fallback
- blocks evaluate and sensitive text
- not release-hardened

Adapter issue:

- daemon adapter advertises screenshot-like support, but helper execution does
  not fully support screenshot.
- Fixed on 2026-05-16: native adapter no longer advertises `screenshot` for the
  v1 helper path, status diagnostics list screenshot as explicitly unsupported,
  and direct screenshot execution is rejected before invoking the helper with a
  fallback hint to `screen_observe`, Playwright, or CDP.

## Rename Required

Current `desktop_action` should not become the long-term name for this helper.

Recommended split:

- `native_browser_window_action`
  - current helper and v1 fallback
  - browser windows only
- `foreground_desktop_watch`
  - approved foreground control mode
  - broader but still bounded
- `visual_desktop_action`
  - normalized visual action on foreground/VM surfaces
  - only allowed through watch-mode or future isolated VM

## Foreground Watch Mode

Watch-mode is required before foreground input actions.

Current implemented boundary:

- `visual_desktop_action` through Computer Session is blocked before helper
  execution.
- The blocked action records `actualInputSent: false`.
- The DAG records a failed `approval` node, failed `action` node, and
  verification/eval follow-up nodes.
- The debug bundle records:
  - `foreground_watch_preconditions` safety decision
  - `foreground_watch_preflight` safety decision when an explicit preflight
    abort occurs before native input
  - `foreground_desktop_watch_boundary` observation
  - failed verifier result
  - `none_available` rollback because no foreground input was sent
- `visual_desktop_action` accepts optional `watchPreflight` metadata and
  normalizes it to `foreground-watch-preflight.v1` evidence.
- `ForegroundWatchPreflightState` is now a shared protocol contract rather
  than an untyped runtime-only blob.
- `ForegroundWatchExecutorState` is also a shared protocol contract for the
  disabled helper-v2 executor result. Computer Session blocked visual desktop
  actions now record the same `foregroundWatchExecutor` schema used by helper
  release readiness.
- The preflight contract records one-time approval, visible countdown, active
  window assertion, target title/URL/app identity assertion, process allowlist,
  surface lock, mouse/keyboard idle state, abort-on-user-input monitoring,
  timeout guard, before/after evidence readiness, verifier/rollback readiness,
  signed helper v2 availability, and `actualInputSent: false`.
- If preflight reports `abortOnUserInputArmed` plus `userInputDetected`, the
  action fails with `foreground_watch_user_input_abort` before native input.
- If preflight reports active-window drift, the action fails with
  `foreground_watch_active_window_drift_abort` before native input.
- The current v1 helper is not treated as a valid broad foreground
  watch-mode executor.
- Smoke: `npm run smoke:computer-use-native-watch-boundary`.
- Promotion/readiness gate:
  `gate:computer-use-promotion` now includes
  `windows_native_watch_boundary` as a non-promoting safety boundary. It
  verifies read-only desktop observe remains allowed, high-risk Windows
  mutation is rejected, bounded native workflow fixture cases are blocked by
  design, release signing remains deferred for unsigned helpers, the native
  watch boundary smoke is present in `smoke:all`, and foreground input is
  blocked before helper execution. It also verifies the user-input abort
  preflight guard and smoke evidence. Passing this gate does not make
  foreground mutation promotable; it proves the current release guard is intact
  until signed watch-mode helper v2 exists.

Required preconditions:

- explicit one-time user approval
- visible countdown
- active window assertion
- process allowlist match
- title/URL/app identity check where available
- mouse/keyboard idle check
- surface lock
- pre-action screenshot
- pre-action UIA observation where available
- abort-on-user-input
- timeout

Required postconditions:

- post-action screenshot
- post-action UIA observation where available
- effect verifier result
- rollback action or "not reversible" record
- eval ledger step
- debug bundle record

## User Input Collision Guard

Daemon job serialization is not enough. The helper must also guard against real
user input collisions.

Current implemented boundary:

- Computer Session can record explicit `watchPreflight` metadata.
- A preflight with `abortOnUserInputArmed: true` and
  `userInputDetected: true` blocks with `foreground_watch_user_input_abort`.
- A preflight with `activeWindowDriftDetected: true` blocks with
  `foreground_watch_active_window_drift_abort`.
- The blocked run records `actualInputSent: false`, DAG/eval/verifier,
  safety-decision, observation, rollback, and failure-memory evidence.
- The shared preflight contract and smoke now cover target identity, surface
  lock, and timeout guard preconditions in addition to the earlier user-input
  abort guard.
- This is smoke-covered by `npm run smoke:computer-use-native-watch-boundary`
  and gate-covered by `windows_native_watch_boundary`.

Still needed inside future signed helper v2:

- mouse position drift detection
- keyboard focus drift detection
- continuous monitoring throughout the real countdown and execution window
- abort action if the user moves mouse/presses key during countdown/execution,
  not only during the observe-only dry run
- mark result as `foreground_watch_user_input_abort` or an equivalent
  helper-v2 abort reason before any input is sent

## Helper v2 Capabilities

Future signed helper v2 should expose explicit capability discovery.

Current implemented discovery layer:

- Rust helper `status` now includes
  `browser-native-desktop-helper-capability-manifest.v2` in metadata.
- The manifest is explicit about current v1 browser-window commands versus
  signed-helper-v2-only commands.
- Current v1 commands include `status`, `observe_uia`, `execute.read`,
  `execute.click`, `execute.type_text`, `execute.select`, `execute.check`,
  `execute.scroll`, `execute.navigate`, `execute.back`, `execute.forward`,
  `execute.reload`, and `execute.hotkey`.
- Future v2 commands are listed but remain `supported: false` with
  `status: blocked_until_signed_helper_v2`; this includes screenshot capture,
  focused foreground movement/drag/key input, scoped clipboard, native file
  picker selection, menu command execution, and browser permission-popup native
  clicks.
- The Rust helper now also accepts `foreground_watch_execute` as an explicit
  disabled helper-v2 executor contract. It returns
  `browser-native-desktop-helper-foreground-watch-executor.v1`,
  `enabled: false`, `supported: false`, `dryRunOnly: true`,
  `signedHelperV2Available: false`, `actualInputSent: false`, and the
  `browser-native-helper-signing` release gate/precondition list. This proves
  a future command path can exist without making foreground input executable.
  The promotion gate surfaces this as
  `foreground_watch_executor_disabled_contract_present`, and the renderer
  Native boundary proof panel displays `Executor: disabled`.
- The Rust helper now also accepts selected helper-v2-only commands as explicit
  disabled contracts: `capture_screenshot`, `file_picker_select`,
  `browser_permission_popup_click`, `clipboard_set_scoped`, and `menu_command`.
  They return `browser-native-desktop-helper-v2-disabled-command.v1` with
  `enabled: false`, `supported: false`, `dryRunOnly: true`,
  `signedHelperV2Available: false`, `actualInputSent: false`, and the same
  `browser-native-helper-signing` release gate. The command-specific evidence
  proves no local path disclosure/file selection, no permission-popup click or
  mutation, no screenshot capture/raw storage, no clipboard content logging or
  mutation, and no menu command dispatch before helper v2 is signed.
- Computer Session `visual_desktop_action` blocked outputs, safety decisions,
  observations, rollback metadata, and verifier results now include the same
  disabled `foregroundWatchExecutor` state, keeping daemon session evidence
  aligned with helper release-readiness evidence.
- The manifest boundary records that the current helper is not a foreground
  desktop watch executor, not a native file-picker executor, and not a browser
  permission-popup native-click executor.
- Daemon native adapter diagnostics propagate the manifest under
  `helperCapabilities` and expose `helperV2Boundary` with
  `nativeInputEnabled: false` and
  `actualInputSentForGuardedCommands: false`.
- Daemon native adapter diagnostics also perform a bounded disabled-contract
  probe for `capture_screenshot`, `file_picker_select`, and
  `browser_permission_popup_click` when the helper is configured. The status
  payload includes `helperV2DisabledContracts` plus
  `helperV2Boundary.disabledCommandContractsPresent`, count, and no-side-effect
  booleans for input, path disclosure, permission mutation, and screenshot
  capture. This lets live diagnostics confirm the helper fails closed without
  waiting for a release-readiness run.
- Rust helper also supports an observe-only `watch_preflight` command. It
  checks active browser-window identity, process allowlist, active-window drift,
  and Win32 last-input idle age, then returns `foreground-watch-preflight.v1`
  plus `browser-native-desktop-helper-watch-preflight-guards.v1` metadata.
  It never sends native input and records `actualInputSent: false`.
- `watch_preflight` can also run a bounded dry-run monitor when called with
  `watchPreflight.monitorMs`. The monitor samples last-input tick changes and
  focused-window drift for a capped interval, records sample count and abort
  reason, and still sends no native input.
- Daemon native adapter status now includes `helperWatchPreflight` diagnostics
  and marks `helperV2Boundary.helperSideWatchPreflightPresent` when the helper
  returns this observe-only preflight evidence. It also marks
  `helperSideContinuousMonitorPresent` when the bounded dry-run monitor ran.
- Smoke coverage:
  - `npm run smoke:browser-native-desktop-helper-native` asserts the real Rust
    helper manifest and observe-only `watch_preflight` response.
  - `npm run smoke:browser-action:native` asserts daemon diagnostics propagate
    helper-v2 guarded command state and helper-side watch preflight evidence
    without enabling native input, including bounded dry-run monitoring.

Suggested commands:

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

Each command should report:

- supported
- requires foreground
- requires approval
- reversible
- redaction behavior
- max timeout

## UIA Selector Policy

Windows UIA selectors are not durable enough to reuse blindly.

Rules:

- Store selectors as evidence, not permanent truth.
- Reobserve before acting.
- Rebind target based on current tree and screenshot evidence.
- Record mismatch when selector changed.
- Prefer stable name/automation id/control type when available.
- Use coordinates only after bbox and active window are confirmed.

## Browser Permission Popup Workflow

Allowed as narrow watch-mode slice:

- permission prompt appears in browser chrome
- user approves session-specific browser chrome fallback
- helper confirms active browser window
- pre-screenshot captures prompt
- action clicks a bounded button target
- post-screenshot verifies prompt disappeared or permission changed

Implemented helper-v2-free route:

- Browser Chrome now supports bounded `permission.get` and `permission.set`
  commands through Chrome `contentSettings`.
- This covers common permission-popup outcomes by changing a specific
  http(s) origin permission to `allow`, `block`, or `ask` with one-time
  approval and redacted origin/pattern evidence.
- It records `nativePopupClick: false`, so the UIA/watch-mode click workflow
  remains blocked until helper v2 exists.
- The native-click workflow is now explicitly represented as
  `browser_permission_bubble_action` in Computer Session. It blocks before
  native input with `browser_permission_bubble_helper_v2_not_available`,
  records `actualInputSent: false`, `nativePopupClick: false`, and
  `permissionChanged: false`, adds approval/action/verification/eval DAG
  nodes, safety-decision evidence, a skipped rollback action, verifier failure,
  and structured failure memory.
- Smoke: `npm run smoke:computer-use-native-watch-boundary`.
- Promotion/readiness gate:
  `windows_native_watch_boundary` now verifies the permission-bubble boundary
  implementation and smoke evidence. Passing this gate still means
  "blocked by design", not permission to click browser chrome prompts.

Blocked:

- credential prompts
- OS security prompts
- admin prompts
- extension install prompts unless future policy explicitly allows

## File Picker Workflow

Current status:

- DOM file input set is available through extension/debugger path.
- Native OS file picker execution is not implemented.
- Computer Session now represents native picker needs as
  `native_file_picker_action` and blocks them before local path disclosure or
  native input. The boundary records approval/action/verification/eval DAG
  nodes, a `native_file_picker_preconditions` safety decision, a
  `native_file_picker_boundary` file observation, a skipped rollback action,
  verifier failure, and structured failure memory with
  `native_file_picker_helper_v2_unavailable`.

Future helper workflow:

- explicit file path grant
- explicit browser/window assertion
- open file picker already visible or opened by prior approved action
- type/paste path using scoped clipboard
- verify selected basename
- restore clipboard
- record evidence

Do not implement broad Explorer automation as a substitute.

## Windows Settings/App Workflows

Current safe route:

- read-only registry/terminal checks for dogfood
- bounded reversible app-registry dogfood under
  `HKCU\Software\CodexWidgetComputerUseSmoke`, gated by exact command
  allowlist, `osMutation`, `high_risk`, and rollback proof
- blocked mutation with explanation

Future route:

- signed helper
- app allowlist
- reversible settings only first
- before/after state verifier
- rollback verifier
- manual approval every run
- no unattended high-risk mutation

Examples:

- read current Windows theme: allowed through terminal/registry read
- change bounded app-owned smoke setting: allowed only through the reversible
  app-registry dogfood path with set/query/delete proof
- change theme: blocked until signed helper and product rollback proof exists
- change security/privacy setting: blocked
- uninstall app: blocked

## Signing And Release Hardening

Production native helper requires:

- Authenticode signing certificate or CI signing service
- signature verification in release smoke
  - implemented as runtime helper release-readiness diagnostics plus the
    `browser-native-helper-signing` release readiness gate; the production
    certificate/service remains externally blocked
- helper hash/provenance record
  - implemented in runtime helper status and in
    `browser-native-desktop-helper-signing.v1` reports written by
    `npm run sign:browser-native-desktop-helper`
- helper contract readiness
  - implemented in `scripts/lib/browser-native-desktop-helper-contract.mjs` and
    wired into `npm run release:readiness` as
    `browser-native-helper-contract`
  - verifies the built helper returns
    `browser-native-desktop-helper-capability-manifest.v2`, declares current
    v1 browser-window commands, keeps helper-v2 foreground/file-picker/
    permission-popup commands blocked, returns `foreground-watch-preflight.v1`,
    returns `browser-native-desktop-helper-watch-preflight-guards.v1`, and can
    run a bounded observe-only dry-run monitor with `actualInputSent: false`
  - also probes the disabled `foreground_watch_execute` helper-v2 executor
    contract and verifies it names the signing gate and sends no native input
  - the embedded contract report stores basename/hash/schema/timing evidence
    without raw local paths or secrets
  - the release readiness summary uses repo-relative paths or `<repo>`
    redaction in check details so generated readiness evidence does not leak
    absolute local workspace paths
- dry-run signing preflight
  - `CODEX_WIDGET_SIGNING_DRY_RUN=1` validates the signing path and writes the
    same redacted report without mutating the helper binary
  - `npm run smoke:browser-native-desktop-helper:signing-readiness` verifies
    helper contract readiness, development-mode deferral, strict-mode failure
    when no certificate/service is configured, helper hash evidence, and
    password/path redaction
- no PowerShell ExecutionPolicy Bypass as hardened release path
- least privilege
- no network
- bounded stdin/stdout JSON protocol
- timeout enforcement
- structured errors

Development fallback can remain available, but release readiness must not count
PowerShell fallback as hardened.

## Future VM/Sandbox Route

For full Windows desktop parity, foreground watch-mode is still weaker than an
isolated desktop.

Future options:

- Hyper-V VM
- Windows Sandbox
- RDP session
- container-like browser desktop

Required components:

- session display capture
- input injection channel
- file transfer policy
- clipboard policy
- network policy
- snapshot/rollback
- artifact export
- session teardown

Do not block near-term browser/tool parity on this future route.

## Acceptance Criteria

- Helper capabilities match actual helper support.
- Foreground actions cannot run without watch-mode approval and active-window
  checks.
- User input during execution aborts the action.
- Browser permission popup/file picker workflows are explicitly bounded.
- Broad Windows settings mutation remains blocked until signed helper and
  rollback proof exist. The only current reversible mutation is the app-owned
  smoke registry key above.
