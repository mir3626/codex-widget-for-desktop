# Browser Action Live Test Report

- Run: `browser-action-forward-regression-20260511`
- Mode: `isolated`
- Generated: 2026-05-11T03:56:35.445Z
- Output: `C:/Users/Tony/Workspace/codex-widget-for-desktop/docs/reports/assets/browser-action-live/browser-action-forward-regression-20260511`

| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
| local-forward-single-step | isolated | pass | - | 6616 | `docs/reports/assets/browser-action-live/browser-action-forward-regression-20260511/local-forward-single-step` |

## Notes

- `isolated` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- `widget-ui` mode launches that same target browser plus a separate browser-hosted widget UI and submits prompts through the actual composer/approval controls.
- `real` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
