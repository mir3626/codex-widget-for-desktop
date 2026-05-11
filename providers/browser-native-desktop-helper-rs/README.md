# Browser Native Desktop Helper (Rust)

This directory contains the native Windows UI Automation helper for Browser
Action's native desktop fallback.

It implements the existing `browser-native-desktop-helper.v1` JSON contract:

- stdin: one UTF-8 JSON request
- stdout: one compact UTF-8 JSON response
- stderr: diagnostics only
- commands: `status`, `observe`, `execute`

The helper is intentionally bounded to browser top-level windows and browser
chrome fallback actions. It is not a general desktop automation bridge.

## Build

```powershell
npm run build:browser-native-desktop-helper
```

The build script copies the release executable to:

```text
dist/browser-native-desktop-helper/browser-native-desktop-helper.exe
```

## Signing

Development builds may be unsigned. Production release verification should set:

```powershell
$env:CODEX_WIDGET_REQUIRE_SIGNED_HELPERS = "1"
npm run smoke:browser-native-desktop-helper:signature
```

When a certificate is available:

```powershell
$env:CODEX_WIDGET_SIGN_HELPERS = "1"
$env:CODEX_WIDGET_SIGN_CERT_THUMBPRINT = "<thumbprint>"
npm run sign:browser-native-desktop-helper
```

Alternatively set `CODEX_WIDGET_SIGN_CERT_PATH` and
`CODEX_WIDGET_SIGN_CERT_PASSWORD` for a PFX file. `CODEX_WIDGET_SIGNTOOL_PATH`
can point to a specific `signtool.exe`.

Actual Authenticode signing requires a code-signing certificate or CI signing
service. The signature smoke reports unsigned state in development and fails
when `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1`.

## Fallback

`providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`
remains packaged as a development/debug fallback while native helper packaging
and release signing are hardened.
