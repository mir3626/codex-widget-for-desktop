# Browser Native Desktop Helper Hardening Handoff

Status: in progress
Owner: Codex
Date: 2026-05-12

## Objective

Move Browser Action's Windows native desktop fallback from a PowerShell-first helper
to a production-oriented native helper track. The helper remains bounded to browser
windows and browser chrome fallback behavior; it is not a general desktop
computer-use agent.

## Baseline

- `providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`
  implements `browser-native-desktop-helper.v1` for `status`, `observe`, and
  `execute`.
- `nativeDesktopAdapter` can auto-discover that PowerShell helper when
  `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP=1`.
- Live validation exists for isolated browser UI Automation observe/read/reload.
- Production hardening is still incomplete because unsigned script execution is a
  weaker long-term boundary than a versioned native executable.

## Target Architecture

The daemon should discover helpers in this order:

1. Explicit `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER`.
2. Bundled native Rust helper executable.
3. Bundled PowerShell helper fallback for development/debug migration.

The native helper must keep the existing JSON contract:

- stdin: one UTF-8 JSON request.
- stdout: one compact UTF-8 JSON response.
- stderr: diagnostics only.
- schema: `browser-native-desktop-helper.v1`.
- commands: `status`, `observe`, `execute`.

## Workstreams

### 1. Rust Native Helper

- Add `providers/browser-native-desktop-helper-rs/`.
- Use Windows UI Automation through Rust bindings.
- Scope observation to browser top-level windows only.
- Emit normalized `windows`, `elements`, text, title, role, selector, bbox,
  enabled/visible/editable, and risk hints.
- Execute bounded actions only: `read`, `click`, `type`, `select`, `check`,
  `scroll`, `navigate`, `back`, `forward`, and `reload`.
- Block `evaluate`.
- Block or redact password/token/cookie/payment-like values.

### 2. Build and Packaging

- Add a build script that compiles the Rust helper and copies the executable to
  `dist/browser-native-desktop-helper/browser-native-desktop-helper.exe`.
- Include the dist helper directory in Tauri resources.
- Keep the PowerShell helper packaged as fallback while migration is active.

### 3. Signing Readiness

- Add a signature smoke that validates the bundled executable signature when
  `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1`.
- Add a signing script that can run `signtool.exe` when a certificate is
  supplied through environment configuration.
- In normal development, report unsigned helper status without failing.
- Actual Authenticode signing is blocked until a code-signing certificate or
  CI signing secret is provided.

### 4. Daemon Integration

- Update helper discovery diagnostics to identify native vs PowerShell fallback.
- Keep timeout, error normalization, and audit metadata stable.
- Preserve existing `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER` override.

### 5. Verification

Required checks:

- `cargo check --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml`
- `npm run build:browser-native-desktop-helper`
- `npm run sign:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper-native`
- `npm run smoke:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper:signature`
- `npm run smoke:browser-action:native`
- `npm run lint`
- `npm run smoke:all`
- UTF-8/mojibake check for touched text files
- `npm run vibe:checkpoint`

## Non-Negotiable Rules

- The helper must not generalize into arbitrary desktop control.
- The helper must not persist full page state, password/token/payment/cookie
  values, or secret text.
- `evaluate` remains outside this helper and stays gated by explicit
  `full_control_dev`.
- Browser Action safety/approval remains daemon-owned.
- PowerShell fallback must remain available until native helper packaging is
  verified across dev and release paths.

## Known Blocker

No CurrentUser code-signing certificate is installed in this environment.
Native helper implementation can proceed, but producing a valid signed
production helper is blocked on providing an Authenticode certificate or CI
signing service.
