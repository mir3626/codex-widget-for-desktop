## Iteration iter-25: Browser Native Desktop Helper

Status: complete.

Carryover: Browser Action already had a native-desktop adapter and mockable JSON
helper contract, but live Windows UI Automation browser fallback was still a
BLOCKED item. The user requested implementation of the Windows UIA helper.

### iter-25-sprint-01-bounded-windows-uia-helper

Goal: implement the maximum practical bounded Windows UI Automation helper
without turning Browser Action into arbitrary desktop automation.

Status: complete. Added
`providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`,
which implements the existing `browser-native-desktop-helper.v1` JSON contract
for browser-window-scoped `status`, `observe`, and bounded `execute`. The daemon
native adapter now auto-discovers the bundled helper when native desktop Browser
Action is enabled, maps helper UIA bbox/value metadata into normalized
observations, and keeps `evaluate` plus sensitive text blocked. Added helper
contract and live launched-browser smokes, Tauri resource registration, and
architecture docs. A signed Rust/.NET/native helper remains a future hardening
track, not the current adapter blocker.
