# Codex Widget DOM Snapshot Extension

This unpacked Chrome/Edge extension sends the active tab DOM snapshot to the local widget daemon.

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
2. Open the web page you want to send to the widget.
3. Click the `Codex Widget DOM Snapshot` extension action.
4. Switch the widget to `DOM` mode and ask about the active page, selection, or visible content.

## Options

The default daemon endpoint is:

```text
http://127.0.0.1:4128/providers/dom/snapshot
```

Use the extension Options page if the widget daemon is running on another local port. The extension only accepts local `http://127.0.0.1/...` or `http://localhost/...` snapshot URLs ending in `/providers/dom/snapshot`.

The extension posts:

```json
{
  "url": "https://example.com",
  "title": "Example",
  "selection": "selected text",
  "text": "page text and interactive element labels"
}
```

## Native Messaging

The service worker first tries the optional native messaging host `com.mir3626.codex_widget_dom`. If the host is not registered, it falls back to direct local HTTP.

Register the host with:

```powershell
.\providers\browser-native-host\install-native-messaging-host.ps1 -ExtensionId <extension-id>
```

See [../browser-native-host](../browser-native-host) for host details and uninstall instructions.

The daemon keeps only the latest snapshot. It returns `OK`/`ERR` badge text on the extension action after each send attempt.
