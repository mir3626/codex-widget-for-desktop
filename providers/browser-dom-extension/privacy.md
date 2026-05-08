# Privacy Practices

Codex Widget Browser Bridge sends page context only for approved sites and only to the local Codex Widget daemon or optional local native messaging host.

## Data Sent

- Active tab URL and title
- Current text selection
- Visible page text and labels from interactive elements
- Structured metadata for interactive elements such as role, label, selector, bounding box, enabled state, and low-level risk hints
- Before/after observations for typed Browser Action execution

Password, token, payment, cookie, and other credential values are not persisted by the extension. Sensitive input values are redacted before page context leaves the tab.

## Destination

The extension talks to the local Codex Widget daemon at `http://127.0.0.1:4128` by default. It uses local endpoints for health checks, heartbeat/status, command polling, result posting, and a legacy/internal page-context transport. If the optional native messaging host is registered and enabled, the extension may send the same page context to the local native host first; that host forwards it to the local daemon.

## Storage

The extension stores only local Browser Bridge settings such as daemon base URL, auto-connect, site-sharing preferences, native-host fallback, debug mode, and polling interval. It does not store page content.

## Permissions

Site access is explicit. If a site has not been enabled, the extension reports that permission is needed instead of silently observing or acting on the page. Restricted browser pages are reported as unsupported.

## Sharing

The extension does not sell, share, or transfer user data to third parties. The local widget daemon may use the current approved page context in the user's active Codex Widget conversation or Browser Action request.

## Remote Code

The extension does not load remote JavaScript.
