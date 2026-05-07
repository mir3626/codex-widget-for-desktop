# Browser Action E2E Dogfood Evidence - 2026-05-08

## Scope

- Goal: prompt-driven Browser Action end-to-end control evidence.
- Coverage: prompt tool path, extension active-tab command channel, approval deny, non-submit form fill, Playwright controlled-browser real page navigation, CDP diagnostics, native Windows fallback boundary, restricted-page boundary.
- Safety: no credentials, no submit, no account mutation, no arbitrary JavaScript as default action.

## Prompt-Driven Path

- Completed: true
- Plan status: completed
- Agent response: Browser Action tool path executed.
- plan: completed
- steps: step-1:succeeded
- latest result: succeeded; verification=passed; Read action returned the current browser observation.

## Extension Active-Tab Channel

- Non-submit fill completed: true
- Fill request: browser-command-70e3c857-97c9-45eb-a4bb-d2400c4b0bbe
- Fill expected source URL: https://example.test/browser-action-e2e-dogfood
- Fill command expiry: 2026-05-07T19:08:58.973Z
- Safe expand completed: true
- Safe expand verification: passed

## Risky Approval Deny

- Completed: true
- Safety: confirm
- Reason: User declined the browser action.

## Playwright Real Page

- Observed URL: https://example.com/
- Observed title: Example Domain
- Elements: 1
- Screenshot: `docs/reports/assets/browser-action-e2e-dogfood-2026-05-08/example-com-before.png`
- Navigation completed: true
- Target: Learn more
- Before: https://example.com/
- After: https://www.iana.org/help/example-domains
- Verification: passed - Action returned a refreshed browser observation.

## Adapter Boundaries

- CDP status: unavailable - Configure one of CODEX_WIDGET_BROWSER_ACTION_CDP_URL, BROWSER_ACTION_CDP_URL, CDP_URL with a Chrome/Edge remote debugging URL.
- Native desktop status: unavailable - Set CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP=1 to enable the bounded Windows browser-window diagnostics path.
- Native desktop blocker: Windows UI Automation executable Browser Action fallback
- Restricted-page boundary: Browser DOM extension rejects restricted chrome/about/devtools/add-ons pages through assertTabCanRunBrowserAction; smoke:extension validates the marker.

## Supporting Artifact

- JSON: `docs/reports/assets/browser-action-e2e-dogfood-2026-05-08/evidence.json`

## Semantic Acceptance

This evidence demonstrates a real prompt-driven Browser Action request through the daemon, a typed extension command with source/expiry metadata, a user-denied risky action, a non-submitting field fill, and a controlled-browser task against a real public page with before/after verification. CDP/native unavailable paths are reported as diagnostics rather than silently marked complete.
