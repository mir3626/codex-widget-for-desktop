# Live Readiness Audit - 2026-05-06

Objective: continue `/vibe-iterate` until Codex Widget for Desktop is close to real live-service readiness, adding missing product capabilities and verifying them against concrete artifacts instead of treating isolated green tests as completion.

## Success Criteria

- Resident desktop widget can run as a packaged Windows app with bundled runtime resources.
- Core Agent runtime uses daemon-owned Codex app-server session state, with exec fallback preserved.
- DOM, Vision, and PTY provider surfaces have real local provider paths instead of passive stubs.
- Renderer UI supports practical chat, resize, model/reasoning selection, OAuth/Codex sign-in, provider controls, and terminal interaction.
- Release candidates have install, launch, packaged-resource, store-packet, and long-soak evidence.
- Remaining manual release-channel work is explicitly identified and cannot be mistaken for automated completion.

## Scope Decision

On 2026-05-06, the product owner deferred actual Chrome Web Store / Microsoft Edge Add-ons dashboard submission until after dogfooding. The repository-owned product, packaging, store-packet, confirmation tooling, and readiness evidence are complete for the active `/vibe-iterate` objective. Public browser-store submission remains a deferred release-channel task, not a blocker for closing this development goal. The deferral is recorded in `docs/release/deferred-gates.json`.

## Prompt To Artifact Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Use `vibe-iterate` beyond a one-off pass | `docs/plans/sprint-roadmap.md`, `.vibe/agent/session-log.md`, `.vibe/agent/iteration-history.json`, and regenerated `docs/reports/project-report.html` record Iteration 2 runtime/provider/resident work | Covered |
| Product should become a live-service desktop widget, not only UI patches | Tauri release exe/MSI/NSIS artifacts exist and `npm run release:readiness` validates them | Covered |
| Use daemon-owned app-server session instead of one-shot history prompt replay | `npm run smoke:app-server`, `npm run smoke:app-server:live`, app-server bridge docs in `docs/context/architecture.md` | Covered |
| Keep Codex exec fallback while app-server is experimental | Runtime fallback documented in `docs/context/product.md` and `docs/context/architecture.md` | Covered |
| OAuth/Codex sign-in path is not manual env editing | Codex CLI sign-in flow and auth status are documented in `README.md`; earlier renderer/daemon auth changes are present in session log | Covered |
| DOM provider is usable | `providers/browser-dom-extension`, `providers/browser-native-host`, `npm run smoke:dom`, `npm run smoke:extension`, `npm run smoke:browser-native-host` | Covered |
| Browser store submission materials exist | `dist/browser-store-submission/codex-widget-dom-extension-0.1.0/submission-manifest.json`, `npm run release:browser-store-packet`, `npm run smoke:browser-store` | Covered |
| Browser store submission can be confirmed with evidence | `npm run release:confirm-browser-store` writes `dist/reports/browser-store-submission-confirmation.json`; `node scripts/release-readiness.mjs --require-manual-gates` validates the report; `docs/release/deferred-gates.json` records the current deferral | Covered for evidence capture; actual dashboard submission deferred by product owner |
| Vision/screen capture is usable | `providers/screen-capture-helper`, `npm run smoke:screen`, `npm run smoke:screen-helper`, `npm run smoke:screen-capture:live` | Covered |
| OCR runtime/language packaging exists | `scripts/prepare-ocr-runtime.mjs`, `scripts/fetch-ocr-languages.mjs`, `npm run smoke:ocr-runtime` | Covered |
| Vision repeated-capture metadata exists | Screen snapshot hash/diff/threshold fields in provider registry and `npm run smoke:screen` | Covered |
| PTY terminal has persistent state and direct input | `npm run smoke:terminal-session`, `npm run smoke:pty-runtime`, direct `terminal.input` and `terminal.output` protocol | Covered |
| PTY mouse interaction exists | Renderer smoke verifies SGR mouse press/release/wheel forwarding in `npm run smoke:renderer-chat` | Covered |
| Chat UI supports GFM tables, code blocks, regenerate boundaries, branch, and no overlap | `npm run smoke:renderer-chat` covers table layout, prompt resize, More menu alignment, branch/regenerate behavior, and terminal viewport stability | Covered |
| Packaged app does not depend on user-installed Node | `npm run smoke:node-runtime`, `npm run smoke:release-resources` | Covered |
| Native supervisor and installed app lifecycle are verified | `npm run smoke:tauri-supervisor`, `npm run smoke:release-install`, `npm run smoke:release-msi-install` | Covered |
| Long-running resident stability has evidence | `docs/reports/release-soak-2026-05-05-2h.md`, `dist/reports/release-soak-latest.json`, `npm run release:readiness` multi-hour-soak check passes | Covered |
| Final release readiness gate exposes any remaining blockers | `dist/reports/release-readiness-latest.json` reports `status: deferred` for the public-store submission gate in default mode and fails strict manual-gate mode until submission is confirmed | Covered; public-store submission is deferred |

## Latest Readiness Result

`npm run release:readiness` result after the two-hour soak:

- Browser store readiness: pass
- Browser store submission packet: pass
- Release resources: pass
- Release exe/MSI/NSIS: pass
- Browser extension zip: pass
- Release soak report: pass, duration 7,200 seconds, 1,439 samples, 3,587 pongs, 358.5 MB working set
- Multi-hour soak: pass
- Browser store account submission: deferred release-channel task

## Completion Decision

The active development objective is complete with browser store dashboard submission deferred by the product owner for post-dogfooding follow-up.

When the deferred store step is resumed, clear the public-release gate with:

```powershell
npm run release:confirm-browser-store -- --store chrome-web-store --submission-id <id>
node scripts/release-readiness.mjs --require-manual-gates
```
