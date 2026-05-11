# Browser Native Desktop Helper

`browser-native-desktop-helper.ps1` is the PowerShell fallback Windows UI
Automation helper for Browser Action native fallback.

The preferred production-oriented helper is the Rust executable built from
`providers/browser-native-desktop-helper-rs/` into
`dist/browser-native-desktop-helper/browser-native-desktop-helper.exe`. This
script remains packaged for development/debug migration and environments where
the native helper is unavailable.

It implements the existing `browser-native-desktop-helper.v1` JSON contract:

- stdin: one JSON request with `command: status | observe | execute`
- stdout: one compact JSON response with `ok`, `observation` or `after`, and
  redacted metadata

The helper is scoped to browser windows only. It enumerates Chrome, Edge,
Chromium, Brave, and Firefox top-level windows, observes UI Automation controls,
and executes bounded browser/window actions such as `back`, `forward`, `reload`,
`navigate`, `click`, `type`, `check`, `select`, and `scroll`.

It deliberately blocks `evaluate` and sensitive text input. Password/token/
cookie/payment-like values are not persisted.

To enable it from the daemon:

```powershell
$env:CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP = "1"
$env:CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER = "C:\path\to\providers\browser-native-desktop-helper\browser-native-desktop-helper.ps1"
```

When the helpers are bundled with the app, the daemon discovers the native Rust
helper first and falls back to this PowerShell script if the native helper is
unavailable.
