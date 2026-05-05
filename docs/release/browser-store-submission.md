# Browser Store Submission Runbook

This runbook clears the final manual release-readiness gate for the DOM snapshot browser extension.

## Scope

- Store targets: Chrome Web Store or Microsoft Edge Add-ons.
- Package source: `dist/browser-store-submission/codex-widget-dom-extension-0.1.0`.
- Package file: `codex-widget-dom-extension-0.1.0.zip`.
- Confirmation evidence: `dist/reports/browser-store-submission-confirmation.json`.

The repository can prepare and verify the packet, but a human must complete the store dashboard submission from an account that can publish the extension.

## Pre-Submission Checks

Run these from the repository root before opening the store dashboard:

```powershell
npm run release:browser-store-packet
npm run smoke:browser-store
npm run release:readiness
```

Expected result:

- `release:browser-store-packet` regenerates the submission packet.
- `smoke:browser-store` passes metadata, privacy, permission-rationale, package, and packet checks.
- `release:readiness` reports no automated blocker. It may still report `browser-store-submission` as a manual blocker.

## Dashboard Submission

Use the generated packet files in `dist/browser-store-submission/codex-widget-dom-extension-0.1.0`:

- Upload `codex-widget-dom-extension-0.1.0.zip`.
- Paste listing copy from `store-listing.md`.
- Paste privacy disclosure from `privacy.md`.
- Paste reviewer notes from `review-notes.md`.
- Use `native-host-notes.md` if the dashboard asks about native messaging or localhost behavior.
- Upload icon assets from `icons/`.
- Confirm that active-tab data is captured only after user action and is sent only to the installed native host or local daemon URL.

Do not record this gate as complete until the dashboard has accepted the submitted package for review, publication, or equivalent pending-review state.

## Record Confirmation

After the dashboard submission succeeds, record evidence with one of these commands:

```powershell
npm run release:confirm-browser-store -- --store chrome-web-store --submission-id <dashboard-submission-id>
```

```powershell
npm run release:confirm-browser-store -- --store edge-add-ons --listing-url <listing-or-dashboard-url>
```

Optional evidence fields:

```powershell
npm run release:confirm-browser-store -- --store chrome-web-store --submission-id <id> --dashboard-url <url> --notes "<dashboard status or reviewer note>"
```

## Final Gate

Run strict readiness after recording confirmation:

```powershell
node scripts/release-readiness.mjs --require-manual-gates
```

The active `/vibe-iterate` live-service objective can be marked complete only when strict readiness reports `status: pass`.

## Failure Handling

- If the dashboard rejects the package, fix the source issue, regenerate the packet, rerun `smoke:browser-store`, and submit again.
- If `release:confirm-browser-store` fails, run `node scripts/confirm-browser-store-submission.mjs --help` and provide either `--submission-id` or `--listing-url`.
- If strict readiness still reports `browser-store-submission`, inspect `dist/reports/browser-store-submission-confirmation.json` for version, store, package name, SHA-256, and timestamp mismatches.
