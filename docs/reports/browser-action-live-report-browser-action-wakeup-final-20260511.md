# Browser Action Live Test Report

- Run: `browser-action-wakeup-final-20260511`
- Mode: `isolated`
- Generated: 2026-05-10T17:02:03.170Z
- Output: `C:/Users/Tony/Workspace/codex-widget-for-desktop/docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511`

| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
| local-concept-random-post | isolated | pass | - | 3027 | `docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511/local-concept-random-post` |
| local-current-page-read | isolated | pass | - | 128 | `docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511/local-current-page-read` |
| local-back-fast-path | isolated | pass | - | 192 | `docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511/local-back-fast-path` |
| local-back-single-step | isolated | pass | - | 198 | `docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511/local-back-single-step` |
| local-navigate-always-allow-prime | isolated | pass | - | 337 | `docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511/local-navigate-always-allow-prime` |
| local-navigate-always-allow-grouped | isolated | pass | - | 2820 | `docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511/local-navigate-always-allow-grouped` |
| local-navigate-always-allow-reuse | isolated | pass | - | 204 | `docs/reports/assets/browser-action-live/browser-action-wakeup-final-20260511/local-navigate-always-allow-reuse` |

## Notes

- `isolated` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- `real` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
