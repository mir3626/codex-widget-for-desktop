# Browser Action Live Test Report

- Run: `browser-action-post-fix-regression-20260511`
- Mode: `isolated`
- Generated: 2026-05-11T04:06:33.544Z
- Output: `C:/Users/Tony/Workspace/codex-widget-for-desktop/docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511`

| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
| local-concept-random-post | isolated | pass | - | 8154 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-concept-random-post` |
| local-current-page-read | isolated | pass | - | 139 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-current-page-read` |
| local-back-fast-path | isolated | pass | - | 381 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-back-fast-path` |
| local-back-single-step | isolated | pass | - | 1177 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-back-single-step` |
| local-forward-single-step | isolated | pass | - | 366 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-forward-single-step` |
| local-navigate-always-allow-prime | isolated | pass | - | 410 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-navigate-always-allow-prime` |
| local-navigate-always-allow-grouped | isolated | pass | - | 3540 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-navigate-always-allow-grouped` |
| local-navigate-always-allow-reuse | isolated | pass | - | 337 | `docs/reports/assets/browser-action-live/browser-action-post-fix-regression-20260511/local-navigate-always-allow-reuse` |

## Notes

- `isolated` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- `widget-ui` mode launches that same target browser plus a separate browser-hosted widget UI and submits prompts through the actual composer/approval controls.
- `real` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
