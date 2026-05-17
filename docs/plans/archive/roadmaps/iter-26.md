## Iteration iter-26: Browser Native Desktop Helper Hardening

Status: complete with signing BLOCKED.

Carryover: Iteration 25 supplied a working bounded PowerShell UI Automation
helper, but the production direction called for a native Rust/.NET/helper track
with signing readiness.

### iter-26-sprint-01-rust-native-helper-and-signing-readiness

Goal: add a Rust native helper, make it the daemon's preferred bundled helper,
preserve PowerShell fallback compatibility, and add signing-readiness gates.

Status: complete. Added
`providers/browser-native-desktop-helper-rs/`, which builds a bounded Rust UIA
helper implementing `browser-native-desktop-helper.v1` for `status`, `observe`,
`read`, browser chrome navigation commands, bounded element actions,
secret-text blocking, and `evaluate` rejection. `npm run
build:browser-native-desktop-helper` copies the release executable to
`dist/browser-native-desktop-helper/browser-native-desktop-helper.exe`, Tauri
resources include the native helper dist directory, and daemon discovery now
prefers explicit env override, then bundled Rust helper, then PowerShell
fallback. Added native and signature smokes. Actual Authenticode signing remains
BLOCKED because no local code-signing certificate or CI signing service is
available; `npm run sign:browser-native-desktop-helper` can run `signtool.exe`
when a certificate is configured, and release verification can enforce signing
by setting `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1`.
