# Store Listing

## Name

Codex Widget DOM Snapshot

## Short Description

Send the active tab context to the local Codex Widget desktop app.

## Detailed Description

Codex Widget DOM Snapshot is the browser companion for Codex Widget for Desktop. When the user clicks the extension action, it captures the active tab URL, page title, current selection, visible page text, and labels from interactive elements. The snapshot is sent to the local Codex Widget daemon so the desktop assistant can answer questions about the current page in DOM mode.

The extension does not run continuously and does not capture pages in the background. It sends a snapshot only after a user action.

The extension can use an optional Chrome/Edge native messaging host installed with the desktop app. If the host is not registered, it falls back to direct local HTTP on `127.0.0.1` or `localhost`.

## Permission Rationale

- `activeTab`: required to access the clicked tab only after user activation.
- `scripting`: required to inject the DOM snapshot collector into the clicked tab.
- `storage`: required to save the local daemon snapshot URL option.
- `nativeMessaging`: required for the optional installed desktop host bridge.
- `http://127.0.0.1/*` and `http://localhost/*`: required to post the snapshot to the local desktop daemon.

## Privacy Summary

The extension sends data only to the local desktop app or its local native messaging host. It stores only the configured local daemon URL. It does not sell data, does not transfer data to third parties, and does not load remote code.
