# Review Notes

## Purpose

Codex Widget Browser Bridge connects approved browser pages to the local Codex Widget desktop app. It is a companion extension for the desktop app, not a standalone web service.

## How To Test

1. Start Codex Widget so the local daemon listens on `127.0.0.1:4128`.
2. Load this extension unpacked in Chrome or Edge.
3. Click the extension icon and confirm the Browser Bridge popup opens.
4. Confirm the daemon base URL is `http://127.0.0.1:4128` or update it for the local test daemon.
5. Open a supported http/https page.
6. Choose **Enable site** in the popup.
7. In the widget, switch to Browser mode and run a safe action such as read, scroll, or click a harmless link.
8. Confirm the extension badge shows `IDLE`, `RUN`, `ASK`, `ERR`, or `OFF` according to bridge state.

The default extension-icon click opens settings/status. It does not send a page capture as the default action.

## Optional Native Messaging

The extension requests `nativeMessaging` so it can communicate with the installed local host `com.mir3626.codex_widget_dom` when the desktop app has registered it. If the native host is not registered or native fallback is disabled, the extension falls back to direct local HTTP.

The native host can be registered for local testing with:

```powershell
.\providers\browser-native-host\install-native-messaging-host.ps1 -ExtensionId <extension-id>
```

## Permissions

- `activeTab`: fallback active-tab access when the user opens the popup.
- `alarms`: heartbeat and command polling for the Manifest V3 service worker.
- `bookmarks`: execute daemon-approved browser chrome bookmark actions and verify bookmark tree changes.
- `scripting`: run the page observation collector and typed Browser Action executor on approved pages.
- `storage`: store local Browser Bridge settings.
- `tabs`: read active tab metadata for status and source matching.
- `nativeMessaging`: communicate with the optional installed desktop host.
- `http://127.0.0.1/*`, `http://localhost/*`: communicate with the local desktop daemon.
- Optional `http://*/*`, `https://*/*`: requested only when the user enables a site.
