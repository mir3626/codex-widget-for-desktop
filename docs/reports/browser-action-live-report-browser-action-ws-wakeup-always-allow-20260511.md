# Browser Action Live Test Report

- Run: `browser-action-ws-wakeup-always-allow-20260511`
- Mode: `isolated`
- Generated: 2026-05-10T16:45:35.443Z
- Output: `C:/Users/Tony/Workspace/codex-widget-for-desktop/docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511`

| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
| local-concept-random-post | isolated | pass | - | 554 | `docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511/local-concept-random-post` |
| local-current-page-read | isolated | pass | - | 113 | `docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511/local-current-page-read` |
| local-back-fast-path | isolated | pass | - | 178 | `docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511/local-back-fast-path` |
| local-back-single-step | isolated | pass | - | 185 | `docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511/local-back-single-step` |
| local-navigate-always-allow-prime | isolated | pass | - | 329 | `docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511/local-navigate-always-allow-prime` |
| local-navigate-always-allow-grouped | isolated | pass | - | 199 | `docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511/local-navigate-always-allow-grouped` |
| local-navigate-always-allow-reuse | isolated | pass | - | 198 | `docs/reports/assets/browser-action-live/browser-action-ws-wakeup-always-allow-20260511/local-navigate-always-allow-reuse` |

## Notes

- `isolated` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- `real` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
