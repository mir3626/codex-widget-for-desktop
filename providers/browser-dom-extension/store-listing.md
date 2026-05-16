# Store Listing

## Name

Codex Widget Browser Bridge

## Short Description

Connect approved browser pages to the local Codex Widget desktop app.

## Detailed Description

Codex Widget Browser Bridge is the browser companion for Codex Widget for Desktop. It lets the local widget observe and safely act on approved browser pages through the Browser Action pipeline.

After installation, the extension icon opens a compact connection and permission popup. The icon badge shows whether the local widget is disconnected, idle, running an action, waiting for site permission, or in an error state. The icon is not the default page-capture trigger.

When the user enables a site, Browser Action requests from the widget can automatically observe the current tab, resolve a target, apply daemon-owned safety policy, request approval for risky actions, execute typed actions, verify the result, and return evidence to the widget.

The extension can use an optional Chrome/Edge native messaging host installed with the desktop app. If the host is not registered or is disabled, it falls back to direct local HTTP on `127.0.0.1` or `localhost`.

## Permission Rationale

- `activeTab`: provides a one-time fallback when the user opens the popup from the active tab.
- `alarms`: wakes the Manifest V3 service worker to refresh heartbeat, badge, and command polling state.
- `bookmarks`: lets the local daemon run explicitly approved browser-chrome bookmark actions such as listing, creating, updating, removing, or opening bookmarks.
- `debugger`: lets the local daemon run explicitly approved, bounded debugger inspection and file-input commands. Arbitrary debugger code execution is not exposed.
- `contentSettings`: lets the local daemon read or change bounded site permissions such as camera, microphone, location, notifications, popups, or automatic downloads after explicit approval for mutations.
- `downloads`: lets the local daemon start, observe, verify, cancel, or erase narrowly scoped downloads after the daemon approval policy allows the action.
- `history`: lets the local daemon run one-time-approved history search/open commands with redacted evidence. There is no always-allow path for history access.
- `scripting`: required to collect page observations and execute typed Browser Action commands on approved pages.
- `storage`: required to save local Browser Bridge settings.
- `tabGroups`: lets the local daemon create, update, list, and release tab groups for a specific widget run.
- `tabs`: required to identify the active tab, URL, title, and window for bridge status and source matching.
- `nativeMessaging`: required for the optional installed desktop host bridge.
- `http://127.0.0.1/*` and `http://localhost/*`: required to communicate with the local desktop daemon.
- Optional `http://*/*` and `https://*/*` origins: requested only when the user enables a site for Browser Bridge access.

## Privacy Summary

The extension sends data only to the local desktop app or its local native messaging host. It stores only Browser Bridge settings, not page content. It does not sell data, does not transfer data to third parties, and does not load remote code. The extension does not observe or act on sites until permission is granted, and restricted browser pages remain unsupported.
