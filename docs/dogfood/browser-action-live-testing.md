# Browser Action Live Testing

This runner automates Browser Action dogfood loops so failures produce reusable evidence instead of requiring manual log gathering.

## Isolated Mode

Run deterministic tests in a dedicated Chromium profile with the unpacked Browser Bridge extension and a local fixture page:

```powershell
npm run dogfood:browser-action:live
```

Useful variants:

```powershell
npm run dogfood:browser-action:live -- --scenario local-concept-random-post
npm run dogfood:browser-action:live -- --headless
npm run dogfood:browser-action:live -- --keep-browser
npm run dogfood:browser-action:live -- --run-id browser-action-live-debug
```

`--headed` is the default because unpacked Manifest V3 extensions may not start in Chromium headless mode. Use `--keep-browser` when you want to inspect the controlled browser after a failure.

The reported `Elapsed ms` is measured from the widget prompt send to the final answer/action result. Browser launch, fixture navigation, extension setup, and active-tab readiness waits are excluded so latency regressions reflect user-visible prompt time.

## Real Browser Mode

Run against the installed Browser Bridge extension and the currently active user browser tab:

```powershell
npm run dogfood:browser-action:live:real
```

While a real-mode scenario runs, do not switch tabs, navigate, scroll, or click in the target browser window. This mode is intentionally observational: it does not launch or isolate a browser, so the active tab is the test surface.

## Scenarios

Default scenarios live in:

```text
docs/dogfood/browser-action-live-scenarios.jsonl
```

Each JSONL row defines:

- `id`
- `mode`: `isolated` or `real`
- `url`: optional; `fixture:/...` is resolved against the local fixture server in isolated mode
- `setupUrls`: optional ordered fixture/site navigation list for scenarios such as history/back testing
- `prompt`
- `approval`: optional automatic approval behavior, including `always_allow`
- `expect`: semantic assertions such as URL/text includes, forbidden raw receipt text, and latency budget

Current isolated defaults cover:

- representative content opening without choosing notice/survey rows
- current-page read summaries
- fast `back`
- single-step `back` from a three-entry history stack
- first approval with final result replacement
- `always_allow` grouped navigation reuse across a different URL without a second approval prompt
- same-URL `always_allow` reuse without a second approval prompt

## Artifacts

Each run writes:

```text
docs/reports/browser-action-live-report-<run-id>.md
docs/reports/assets/browser-action-live/<run-id>/
```

Scenario packets include daemon events, bridge status before/after, screenshots when a controlled browser page exists, and a machine-readable `result.json`. Real browser mode redacts active-tab page strings in saved artifacts by default.
