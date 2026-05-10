# Browser Action Live Test Report

- Run: `browser-action-public-sites-search-final-20260511`
- Mode: `widget-ui`
- Generated: 2026-05-10T18:22:55.279Z
- Output: `C:/Users/Tony/Workspace/codex-widget-for-desktop/docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511`

| Scenario | Mode | Status | Failure class | Elapsed ms | Artifacts |
| --- | --- | --- | --- | ---: | --- |
| public-dcinside-read | widget-ui | pass | - | 308 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-dcinside-read` |
| public-dcinside-concept-click | widget-ui | pass | - | 3224 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-dcinside-concept-click` |
| public-fmkorea-read | widget-ui | pass | - | 305 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-fmkorea-read` |
| public-fmkorea-back | widget-ui | pass | - | 1395 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-fmkorea-back` |
| public-naver-read | widget-ui | pass | - | 1229 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-naver-read` |
| public-naver-search | widget-ui | pass | - | 5612 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-naver-search` |
| public-google-read | widget-ui | pass | - | 217 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-google-read` |
| public-google-search | widget-ui | pass | - | 5188 | `docs/reports/assets/browser-action-live/browser-action-public-sites-search-final-20260511/public-google-search` |

## Notes

- `isolated` mode launches a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page.
- `widget-ui` mode launches that same target browser plus a separate browser-hosted widget UI and submits prompts through the actual composer/approval controls.
- `real` mode uses the currently installed Browser Bridge extension and the active user browser tab. Do not touch that tab while a real-mode scenario is running.
- Failure packets include daemon events, bridge status before/after, screenshots when a controlled browser page is available, and a machine-readable result JSON.
