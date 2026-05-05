# Review Notes

## Purpose

Codex Widget DOM Snapshot connects the user's active browser tab to the local Codex Widget desktop app. It is a companion extension for the desktop app, not a standalone web service.

## How To Test

1. Start Codex Widget so the local daemon listens on `127.0.0.1:4128`.
2. Load this extension unpacked in Chrome or Edge.
3. Open any web page.
4. Click the extension action.
5. Confirm the action badge changes to `OK`.
6. Switch the widget to DOM mode and ask about the active page.

## Optional Native Messaging

The extension requests `nativeMessaging` so it can communicate with the installed local host `com.mir3626.codex_widget_dom` when the desktop app has registered it. If the native host is not registered, the extension falls back to direct local HTTP.

The native host can be registered for local testing with:

```powershell
.\providers\browser-native-host\install-native-messaging-host.ps1 -ExtensionId <extension-id>
```

## Permissions

- `activeTab`: capture the tab only after the user clicks the extension action.
- `scripting`: run the DOM snapshot collector in the clicked active tab.
- `storage`: store the local daemon snapshot URL option.
- `nativeMessaging`: communicate with the optional installed desktop host.
- `http://127.0.0.1/*`, `http://localhost/*`: post snapshots to the local desktop daemon.
