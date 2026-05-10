# Browser Action Live Test Report

- Run: `browser-action-widget-ui-final5-20260511`
- Mode: `widget-ui`
- Generated: 2026-05-10T17:27:15.735Z
- Output: `C:/Users/Tony/Workspace/codex-widget-for-desktop/docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511`

| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
| local-concept-random-post | widget-ui | pass | - | 1138 | `docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511/local-concept-random-post` |
| local-current-page-read | widget-ui | pass | - | 165 | `docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511/local-current-page-read` |
| local-back-fast-path | widget-ui | pass | - | 225 | `docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511/local-back-fast-path` |
| local-back-single-step | widget-ui | pass | - | 195 | `docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511/local-back-single-step` |
| local-navigate-always-allow-prime | widget-ui | pass | - | 2658 | `docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511/local-navigate-always-allow-prime` |
| local-navigate-always-allow-grouped | widget-ui | pass | - | 226 | `docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511/local-navigate-always-allow-grouped` |
| local-navigate-always-allow-reuse | widget-ui | pass | - | 1108 | `docs/reports/assets/browser-action-live/browser-action-widget-ui-final5-20260511/local-navigate-always-allow-reuse` |

## Notes

- `isolated` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- `widget-ui` mode launches that same target browser plus a separate browser-hosted widget UI and submits prompts through the actual composer/approval controls.
- `real` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
