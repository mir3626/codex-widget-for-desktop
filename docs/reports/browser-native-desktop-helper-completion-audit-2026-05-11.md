# Browser Native Desktop Helper Completion Audit

Generated: 2026-05-11

## Objective

Implement a bounded Windows UI Automation helper for Browser Action so the
native desktop adapter can move beyond mock-only diagnostics.

## Deliverables

| Requirement | Evidence | Verification |
| --- | --- | --- |
| Bounded helper exists | `providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1` | PowerShell parse check, helper smoke |
| Existing JSON contract is used | helper implements `browser-native-desktop-helper.v1` `status`, `observe`, and `execute` | `npm run smoke:browser-native-desktop-helper` |
| Daemon adapter can discover helper | `src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts` resolves env or bundled default helper | `npm run smoke:browser-action:native` |
| Normalized observations include UIA metadata | helper emits `windows`, `elements`, role/label/selector/bbox; adapter maps helper bbox/value fields | `npm run smoke:browser-native-desktop-helper`, `npm run smoke:browser-action:native` |
| Safe bounded actions are implemented | helper supports read, click, type, check, select, scroll, navigate, back, forward, reload | direct helper smoke and live reload smoke |
| Sensitive paths are blocked | helper rejects `evaluate` and sensitive text such as password/token/cookie/payment-like values | `npm run smoke:browser-native-desktop-helper` |
| Live browser path is verified | live smoke launches isolated Chrome/Edge profile and runs UIA observe/read/reload | `npm run smoke:browser-native-desktop-helper:live` |
| Packaging resource is registered | `src-tauri/tauri.conf.json` includes `providers/browser-native-desktop-helper` | source inspection; next release build will include it |
| Observability/docs updated | `docs/architecture/open-blockers.md`, `surface-control.md`, `testing-observability.md` | source inspection |

## Verification Commands

Passed:

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath "providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1")); "parse ok"'`
- `node --check scripts/smoke-browser-native-desktop-helper.mjs`
- `node --check scripts/smoke-browser-native-desktop-helper-live.mjs`
- `npm run smoke:browser-native-desktop-helper`
- `npm run smoke:browser-native-desktop-helper:live`
- `npm run smoke:browser-action:native`
- `npm run lint`
- `npm run smoke:all`

## Remaining Follow-Up

- The helper is a bounded PowerShell implementation because this machine has
  .NET runtimes but no .NET SDK. A signed Rust/.NET/native helper remains a
  future hardening track for store/enterprise deployment, stronger cancellation,
  and lower-latency native input.
- `npm run smoke:browser-native-desktop-helper:live` may print the standard
  Windows deferred temp cleanup warning after killing the isolated browser
  profile. The smoke schedules cleanup retry and still validates the live UIA
  path.
- Broader arbitrary desktop automation remains intentionally out of scope.
  Browser Action native fallback remains scoped to browser windows, browser
  chrome, permission prompts, file picker boundaries, and restricted-page
  recovery.
