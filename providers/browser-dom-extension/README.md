# Codex Widget Browser Bridge Extension

This unpacked Chrome/Edge extension connects approved browser pages to the local Codex Widget daemon. It is the Browser Action active-tab bridge, not a manual page capture button.

## Load Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this folder: `providers/browser-dom-extension`.

## Package

Run:

```powershell
npm run package:extension
```

The package is written to `dist/providers/codex-widget-dom-extension-0.1.0.zip`
with `manifest.json` at the zip root.

## Use

1. Start the widget daemon so it listens on `http://127.0.0.1:4128`.
2. Load or reload the extension.
3. Click the extension icon to open the Browser Bridge popup.
4. Confirm the daemon base URL.
5. Open the site you want to control and choose **Enable site** in the popup.
6. Use Browser mode in the widget. Direct Browser Action buttons and natural prompts can observe, read, click, type, scroll, and navigate through the same daemon safety and audit pipeline.

The icon does not trigger page capture in the default flow. The badge shows bridge state:

```text
OFF  daemon disconnected or auto-connect disabled
IDLE connected and waiting
RUN  observe/action in progress
ASK  site permission needed
ERR  last bridge/action error
```

## Options

The default daemon base URL is:

```text
http://127.0.0.1:4128
```

Endpoint URLs are derived internally:

```text
GET  /storage/health
POST /providers/dom/snapshot              legacy/internal page-context transport
GET  /browser-action/extension/poll
POST /browser-action/extension/result
POST /browser-action/extension/heartbeat
GET  /browser-action/extension/status
```

The popup and options page only accept local `http://127.0.0.1/...` or `http://localhost/...` daemon base URLs.

## Native Messaging

The service worker can use the optional native messaging host `com.mir3626.codex_widget_dom`. If the host is not registered or is disabled in settings, the extension falls back to direct local HTTP.

Register the host with:

```powershell
.\providers\browser-native-host\install-native-messaging-host.ps1 -ExtensionId <extension-id>
```

See [../browser-native-host](../browser-native-host) for host details and uninstall instructions.

## Privacy Boundary

The extension observes only supported http/https pages that have explicit site permission. Sensitive input values are redacted by the page collector. Page context is sent only to the local daemon or optional local native host.
