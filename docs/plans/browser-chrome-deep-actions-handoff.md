# Browser Chrome Deep Actions Handoff

Status: active implementation handoff

## Objective

Extend the Browser Bridge and daemon capability runtime beyond bookmark-only
browser chrome actions so the widget can cover practical computer-use browser
workflows without pretending unrestricted browser control is safe.

This work keeps the existing `browser_chrome` capability kind and adds bounded
commands for tab groups, downloads, high-risk history access, debugger-backed
inspection, browser site-permission changes, file upload preflight, and
native/browser-chrome fallback coordination.

## Non-Negotiable Boundaries

- Browser history is high-risk. It must require explicit approval for each run,
  return redacted evidence by default, and must not get an always-allow policy.
- Debugger access is high-risk because it can inspect page internals and should
  remain a separate bounded command surface, not arbitrary CDP execution.
- Browser site-permission mutation is high-risk. It must use explicit origin
  patterns, require one-time approval, and record redacted origin/setting
  evidence rather than clicking arbitrary browser chrome coordinates.
- File upload is a local-file disclosure workflow. The bridge may inspect file
  inputs and explain blockers, but selecting or sending files requires a future
  explicit local-file grant and bounded native picker helper.
- Restricted browser pages remain unsupported by extension DOM injection.
- Credential, cookie, payment, token, and secret fields remain redacted in daemon
  payloads and evidence.
- Native app/browser chrome fallback must stay narrow, signed, auditable, and
  workflow-specific.

## Capability Plan

| Gap | Capability commands | Permission model | Evidence model |
|---|---|---|---|
| Tab groups | `tab_group.list`, `tab_group.create`, `tab_group.claim`, `tab_group.update`, `tab_group.release` | `tab_group.list` is read-only. Mutations require normal approval. | Group id, title, color, collapsed state, window id, tab ids, run/thread claim metadata. |
| Downloads | `download.search`, `download.observe`, `download.verify`, `download.start`, `download.cancel`, `download.erase` | `download.search`, `download.observe`, and `download.verify` are read-only. Start/cancel/erase require approval. | URL, state, byte counts, danger state, basename-only filename preview. |
| History | `history.search`, `history.open` | Always one-time approval. No always-allow. | Origin plus redacted path, bounded title, visit metadata. |
| Debugger | `debugger.inspect`, `debugger.screenshot` | Always approval. No arbitrary runtime code from the user. | Fixed inspection fields, page title/url, screenshot metadata or data URL. |
| Browser permissions | `permission.get`, `permission.set` | `permission.get` is read-only. `permission.set` requires one-time approval and a bounded http(s) origin pattern. | Permission type, origin, primary pattern, requested/verified setting, path-redacted marker, and native-popup-click=false. |
| File upload | `file_upload.inspect`, `file_upload.set_files`, `file_upload.clear`, `file_upload.blocked` | Always approval because file input context can reveal local disclosure intent. File paths must be explicit absolute `approvedFilePaths`. | File input labels/accept/multiple/disabled/bbox, basename-only file evidence, and explicit blocker/rollback state. |
| Native fallback | `desktop_action` bounded browser helper remains the fallback path | Approval for actions, no approval for observe/status. | Helper command, target, action, verification result. |

## Architecture

1. Daemon accepts the expanded command vocabulary in
   `src/daemon/browser-chrome/commandBridge.ts`.
2. Capability safety policy classifies read-only browser chrome commands
   conservatively and requires approval for history, debugger, file upload, and
   all browser chrome mutations.
3. The extension manifest declares the needed browser APIs:
   `tabGroups`, `downloads`, `history`, `debugger`, and `contentSettings`.
4. `providers/browser-dom-extension/bridge/browser-chrome.js` executes each
   command through Chrome extension APIs and posts bounded results back to the
   daemon.
5. Capability verification reports browser chrome effects generically rather
   than treating every command as a bookmark effect.
6. Smoke coverage asserts queueing, approval boundaries, redaction shape, and
   verification output for representative commands.

## Implementation Notes

- Tab-group commands use the active tab by default when no tab id list is
  provided. `tab_group.claim` records run/thread ownership in evidence and uses
  the group title as the visible browser affordance.
- Downloads sanitize local paths to basename-only evidence. Requested download
  filenames must be relative and cannot contain drive roots or parent traversal.
- History search returns a redacted URL shape and does not return full browser
  history URLs unless a future explicit evidence policy is introduced.
- Debugger commands use fixed Chrome DevTools Protocol methods only:
  `Runtime.evaluate` with an internal inspection expression and
  `Page.captureScreenshot`. They do not expose raw arbitrary evaluation.
  Screenshot bytes are omitted by default and only inlined when explicitly
  requested within the daemon result-size budget.
- Browser permission commands use Chrome `contentSettings` for bounded
  site-level permissions. This is the preferred helper-v2-free route for
  permission popup outcomes such as camera/microphone/location/notification
  allow/block/ask. It does not visually click native browser permission
  bubbles; that path remains a signed watch-mode helper v2 workflow.
- File upload supports inspect, debugger-backed `DOM.setFileInputFiles`, and
  rollback-oriented clear for explicitly approved absolute local paths. Evidence
  stores basename-only previews. A native file picker helper remains future work
  for user-driven file selection.

## Follow-Up Blockers

- Production signing and distribution hardening for expanded extension
  permissions.
- User-facing permission profile UX that can label history/debugger/file upload
  as one-time grants.
- Signed native helper support for browser chrome UI and file picker workflows.
- Official app-server custom client tool contract for agent-visible direct tool
  invocation.
