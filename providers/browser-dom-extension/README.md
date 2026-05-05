# Codex Widget DOM Snapshot Extension

This unpacked Chrome/Edge extension sends the active tab DOM snapshot to the local widget daemon.

## Load Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this folder: `providers/browser-dom-extension`.

## Use

1. Start the widget daemon so it listens on `http://127.0.0.1:4128`.
2. Open the web page you want to send to the widget.
3. Click the `Codex Widget DOM Snapshot` extension action.
4. Switch the widget to `DOM` mode and ask about the active page, selection, or visible content.

The extension posts:

```json
{
  "url": "https://example.com",
  "title": "Example",
  "selection": "selected text",
  "text": "page text and interactive element labels"
}
```

The daemon keeps only the latest snapshot. It returns `OK`/`ERR` badge text on the extension action after each send attempt.
