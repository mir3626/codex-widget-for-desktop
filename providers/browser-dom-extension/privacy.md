# Privacy Practices

Codex Widget DOM Snapshot sends page context only when the user clicks the extension action.

## Data Sent

- Active tab URL
- Active tab title
- Current text selection
- Visible page text and labels from interactive elements

## Destination

The extension sends data to the local Codex Widget daemon at `http://127.0.0.1:4128/providers/dom/snapshot` by default. If the optional native messaging host is registered, the extension sends the same snapshot to the local native host first; that host forwards it to the local daemon.

## Storage

The extension stores only the local daemon snapshot URL in Chrome/Edge sync storage. It does not store page content.

## Sharing

The extension does not sell, share, or transfer user data to third parties. The local widget daemon may include the latest user-triggered snapshot in the user's active Codex Widget conversation context.

## Remote Code

The extension does not load remote JavaScript.
