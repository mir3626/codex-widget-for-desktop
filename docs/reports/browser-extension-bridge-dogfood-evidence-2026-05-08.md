# Browser Extension Bridge Dogfood Evidence

Generated: 2026-05-08T01:25:52.574Z
Daemon base URL: `http://127.0.0.1:41369`

## Scope

This evidence exercises the new snapshotless Browser Bridge contract through the daemon-facing heartbeat/status path, automatic page-context ingress, permission-needed recovery, and restricted-page boundary. It keeps the legacy DOM provider endpoint only as the extension's internal compatibility transport, not as user-facing UX.

## Evidence

| Check | Status | Mode |
| --- | --- | --- |
| daemon connected | pass |  |
| extension heartbeat visible to daemon/widget | pass | idle |
| automatic page context path uses legacy provider without manual extension click | pass |  |
| missing site permission recovery state | pass | permission_needed |
| restricted page boundary | pass | restricted |

## Supporting Asset

- `docs/reports/assets/browser-extension-bridge-dogfood-2026-05-08/evidence.json`

## Notes

- The extension icon is now configured as a popup surface; normal Browser Action does not require clicking it to capture a page.
- Site permission remains explicit. Missing permission is surfaced as `permission_needed` rather than silently observing a page.
- Restricted browser pages are reported as `restricted`; the bridge does not bypass browser security boundaries.
