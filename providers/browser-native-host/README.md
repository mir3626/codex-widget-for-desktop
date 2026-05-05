# Codex Widget Browser Native Host

This provider is the optional Chrome/Edge native messaging bridge for the DOM snapshot extension.

The browser extension still works through direct local HTTP. Native messaging is for store/native deployment paths where the extension should hand the snapshot to an installed local host first, and only fall back to HTTP when the host is not registered.

## Install for Chrome or Edge

1. Install the Codex Widget NSIS build, or run from the repository after `npm run build:web`.
2. Load or install the browser extension from `providers/browser-dom-extension`.
3. Copy the extension ID from `chrome://extensions` or `edge://extensions`.
4. Run:

```powershell
.\providers\browser-native-host\install-native-messaging-host.ps1 -ExtensionId <extension-id>
```

The script writes a native host manifest under `%LOCALAPPDATA%\Codex Widget\NativeMessaging` and registers it under the current user for Chrome and Edge.

To remove the registration:

```powershell
.\providers\browser-native-host\install-native-messaging-host.ps1 -ExtensionId <extension-id> -Uninstall
```

The native host accepts `domSnapshot` messages, validates that the daemon URL is local, and posts the snapshot to `http://127.0.0.1:4128/providers/dom/snapshot` by default.
