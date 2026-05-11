# Browser Native Desktop Helper Hardening Audit

Date: 2026-05-12

## Summary

Browser Action now has a production-oriented Rust native Windows UI Automation
helper path. The daemon prefers the bundled native executable and keeps the
PowerShell helper as a development/debug fallback.

## Evidence

| Item | Evidence | Verification |
| --- | --- | --- |
| Rust helper exists | `providers/browser-native-desktop-helper-rs/` | `cargo check --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml` |
| Native dist build exists | `dist/browser-native-desktop-helper/browser-native-desktop-helper.exe` | `npm run build:browser-native-desktop-helper` |
| Existing JSON contract preserved | native helper implements `browser-native-desktop-helper.v1` | `npm run smoke:browser-native-desktop-helper-native` |
| PowerShell fallback preserved | fallback helper remains packaged under `providers/browser-native-desktop-helper/` | `npm run smoke:browser-native-desktop-helper` |
| Daemon prefers native helper | `helperClient.ts` discovery order is env -> dist native exe -> PowerShell fallback | `npm run smoke:browser-action:native` |
| Packaging resource registered | `src-tauri/tauri.conf.json` includes `../dist/browser-native-desktop-helper` | source inspection |
| Signing readiness exists | signing script supports `signtool.exe`; signature smoke can fail release when `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1` | `npm run sign:browser-native-desktop-helper`, `npm run smoke:browser-native-desktop-helper:signature` |

## Verification Run

- `cargo check --manifest-path providers/browser-native-desktop-helper-rs/Cargo.toml`
- `npm run build:browser-native-desktop-helper`
- `npm run sign:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper-native`
- `npm run smoke:browser-native-desktop-helper:signature`
- `npm run smoke:browser-native-desktop-helper`
- `npm run smoke:browser-action:native`
- `npm run build:daemon`

## BLOCKED

Item: Authenticode-signed production helper

Reason: this environment has no CurrentUser code-signing certificate, and no CI
signing secret/service is configured.

Required scope expansion: provide an Authenticode code-signing certificate or CI
signing service, then enforce `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1` during
release verification.

## Notes

- The helper remains bounded to browser windows and browser chrome fallback
  actions.
- `evaluate` is rejected by the helper.
- Password/token/cookie/payment-like text is blocked or redacted.
- The helper does not persist full page state or secret values.
