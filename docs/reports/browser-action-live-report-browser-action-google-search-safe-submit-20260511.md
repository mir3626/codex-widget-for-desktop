# Browser Action Live Test Report

- Run: `browser-action-google-search-safe-submit-20260511`
- Mode: `widget-ui`
- Generated: 2026-05-10T18:21:05.545Z
- Output: `C:/Users/Tony/Workspace/codex-widget-for-desktop/docs/reports/assets/browser-action-live/browser-action-google-search-safe-submit-20260511`

| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
| public-google-search | widget-ui | pass | - | 5221 | `docs/reports/assets/browser-action-live/browser-action-google-search-safe-submit-20260511/public-google-search` |

## Notes

- `isolated` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- `widget-ui` mode launches that same target browser plus a separate browser-hosted widget UI and submits prompts through the actual composer/approval controls.
- `real` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
