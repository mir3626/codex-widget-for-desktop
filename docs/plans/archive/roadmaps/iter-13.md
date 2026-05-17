## Iteration iter-13: Browser Extension Bridge UX

Carryover: Iteration 12 completed the direct Browser Action control surface, but the extension UX was still centered on manual DOM snapshot capture. Iteration 13 follows `docs/plans/browser-extension-bridge-handoff.md` and converts the extension into a first-class Browser Bridge: popup/settings instead of snapshot-on-click, badge heartbeat state, explicit site permission, automatic approved-page observation, command-first polling/execution, and simplified widget Browser UI.

### iter-13-sprint-01-extension-popup-options-and-settings

Goal: replace the extension action click snapshot trigger with a Browser Bridge popup and base-URL settings.

Dependencies: iter-12 Browser Action extension executor and existing package/store metadata.

Expected scope: Manifest V3 `default_popup`, popup HTML/JS, daemon base URL settings, toggles for auto-connect, page context sharing, safe read/scroll, click/type approval, native fallback, debug capture, and options page migration from snapshot URL to base URL.

Status: complete. The extension is now named Codex Widget Browser Bridge, the action opens `popup.html`, default click-to-snapshot behavior is removed, popup/options store a daemon base URL, and debug page capture is secondary behind diagnostics.

### iter-13-sprint-02-badge-heartbeat-and-daemon-status

Goal: make extension connection and permission state visible to the daemon and widget without a manual page capture.

Dependencies: shared protocol and daemon HTTP endpoints.

Expected scope: OFF/IDLE/RUN/ASK/ERR badge states, extension alarms/heartbeat, `/browser-action/extension/heartbeat`, `/browser-action/extension/status`, status normalization, WebSocket event, and renderer state handling.

Status: complete. The service worker refreshes badge/status from startup, install, popup, alarms, health checks, permission state, auto-observe, and command execution. The daemon stores normalized `BrowserExtensionBridgeStatus`, broadcasts `browserExtensionBridge.status`, exposes status over HTTP, and the widget shows connected/permission/restricted/error bridge states.

### iter-13-sprint-03-command-first-extension-channel-and-permission-flow

Goal: remove the required manual snapshot step from normal Browser Action execution.

Dependencies: existing extension typed executor, daemon extension poll/result endpoints, optional host permissions.

Expected scope: automatic approved-site observation, command polling, permission-state poll metadata, command execution with before/after observations, result retry, restricted-page errors, site enable flow, and native host fallback preservation.

Status: complete. The extension polls the daemon while auto-connect is enabled, checks active tab/source/permission, auto-observes approved sites through the internal legacy DOM provider transport, executes queued typed actions without icon clicks, posts results with permission/source metadata, surfaces missing permission and restricted pages, and preserves native host fallback plus legacy `POST /providers/dom/snapshot` compatibility.

### iter-13-sprint-04-widget-simplification-smokes-and-dogfood

Goal: simplify the widget Browser Action UX and close the Browser Bridge work with verification and evidence.

Dependencies: Sprints 01-03, renderer Browser Action menu/panel, existing Browser Action smokes.

Expected scope: rename DOM mode to Browser, hide adapter/debug complexity behind advanced diagnostics, add Browser Bridge status to menu/panel, update extension/store/readme/privacy/review copy, add Browser Bridge smoke/dogfood scripts, refresh reports/context, and run full verification.

Status: complete. The Browser mode button now uses Browser wording, Browser Action menu foregrounds bridge state and direct actions while moving adapters/screenshots under diagnostics, the panel foregrounds bridge status, extension/store/privacy/review docs describe Browser Bridge behavior, `npm run smoke:browser-bridge` and `npm run dogfood:browser-bridge` were added, and full verification passed including `npm run smoke:all` and cargo check.
