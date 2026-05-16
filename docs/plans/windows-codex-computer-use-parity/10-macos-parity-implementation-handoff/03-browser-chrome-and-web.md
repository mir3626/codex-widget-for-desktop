# 03 - Browser, Chrome, And Web Workflows

## Objective

Make browser work the first production-useful Computer Use route. Browser tasks
cover the highest-value user outcomes while avoiding the risk of broad native
desktop input.

## Browser Surface Split

Use three browser paths deliberately:

| Path | Purpose | Notes |
|---|---|---|
| Browser Action DOM path | Normal web page click/type/read/scroll | Uses DOM/Playwright/CDP/extension observations and Browser Action target selection. |
| Browser Chrome command path | Tabs, bookmarks, groups, downloads, history, debugger, permissions, file inputs | Structured Chrome extension APIs with permission gates. |
| Native browser-window fallback | Browser chrome UI or permission/file picker fallback | Bounded helper only; not general desktop automation. |

Do not collapse these into one broad "browser control" adapter. Each has
different permissions and evidence requirements.

## Browser Action Parity

Target user outcomes:

- open a public URL,
- search within a page or search engine,
- click a visible element,
- type into a normal field,
- scroll and reobserve,
- continue multi-step plans,
- recover from stale/ambiguous targets.

Implementation direction:

- Register Browser Action as a real Computer Session capability backend.
- Run Browser Action prompt plans through DAG nodes.
- Always capture pre-action and post-action observations.
- Write target evidence into perception graph and eval ledger.
- Add action feedback rows linking result to observation/verifier proof.
- For isolated browser, keep a persistent page per session and close it on
  cancel/cleanup.

Acceptance:

- A Korean or English prompt can produce a multi-step Browser Action plan,
  execute through the session, auto-continue after extension result, and expose
  the observe/action/verify/eval chain in the debug bundle.

## Browser Chrome Deep Actions

Current command classes:

- `tab_group.list`
- `tab_group.create`
- `tab_group.claim`
- `tab_group.update`
- `tab_group.release`
- `bookmark.list`
- `bookmark.create`
- `bookmark.update`
- `bookmark.open`
- `bookmark.remove`
- `download.search`
- `download.observe`
- `download.verify`
- `download.start`
- `download.cancel`
- `download.erase`
- `history.search`
- `history.open`
- `debugger.inspect`
- `debugger.screenshot`
- `debugger.print_to_pdf`
- `permission.get`
- `permission.set`
- `file_upload.inspect`
- `file_upload.set_files`
- `file_upload.clear`

Risk model:

- Read-only tab/bookmark/download observe operations can run without high-risk
  approval.
- Browser history is high-risk and must stay one-time.
- Debugger is high-risk and must expose only fixed commands, not arbitrary CDP
  scripts.
- File upload is high-risk local-file disclosure and must require explicit file
  grants.
- Browser site permission mutation is high-risk and one-time.
- Download file verification can read local file content only when the path is
  under an approved output/download root.

Evidence rules:

- Downloads expose basename, state, byte counts, danger state, hash/size when
  approved, and blob-backed resource id.
- History exposes origin and redacted path, not full browsing history.
- Debugger screenshot/PDF exposes byte length/hash/resource metadata, not raw
  bytes by default.
- File upload exposes input label/accept/multiple state and basename-only file
  evidence.
- Permission set exposes origin/pattern/type/requested/verified setting and
  `nativePopupClick: false` when using Chrome content settings.

## Restricted Page Handling

Restricted pages include:

- browser internal pages,
- extension pages,
- store pages that block injection,
- protected payment/credential surfaces,
- pages denied by manifest permissions or host grants.

Behavior:

- Do not bypass restriction by switching silently to debugger/native input.
- Explain the exact blocked surface.
- Offer supported alternatives:
  - manual takeover,
  - isolated browser with public URL,
  - Toolsmith HTTP fetch when allowed,
  - Browser Chrome command if it achieves the same outcome safely.
- Record `restricted_page` or equivalent failure class.

## Downloads

Target workflow:

```text
observe page/link
  -> choose download.start or browser click
  -> download.observe
  -> download.verify
  -> artifact/resource persist
  -> verifier proof
```

Implementation requirements:

- `download.verify` should verify only approved paths.
- Full local path should be redacted unless a future stronger grant exists.
- Blob-backed eval resources should store content when approved.
- Gate repeated dogfood on success rate, p95, redaction, and resource proof.

## Print To PDF

Preferred path:

- Use `debugger.print_to_pdf` as a fixed command.
- Require explicit one-time debugger approval.
- Store PDF bytes as a blob resource or path-redacted artifact metadata.
- Expose hash/byte length.
- Never allow arbitrary `Runtime.evaluate` from user text.

Fallback:

- Use Toolsmith/document renderer for HTML/Markdown to PDF.
- Use browser-backed fetch only when direct HTTP is blocked and domain is
  allowed.

## File Upload

Safe extension path:

```text
file_upload.inspect
  -> show input evidence
  -> ask explicit file grant
  -> file_upload.set_files
  -> verify selected basename/input state
```

Rules:

- Do not disclose full local paths in evidence by default.
- Do not infer file permission from a broad output-root grant.
- Do not automate native picker until signed helper v2 exists.
- Record rollback or clear-file action when available.

## Site Permission Workflows

Preferred route:

- Use `permission.get` and `permission.set` through Chrome `contentSettings`.
- Require exact origin/pattern and one-time approval for mutation.
- Record `nativePopupClick: false`.

Native popup clicking is future helper v2 work and must include active-window
proof, countdown, abort-on-user-input, target bbox proof, and post-verifier.

## Extension Reload UX

When manifest or bridge code changes require reload:

- daemon/extension should expose `reloadRequired`,
- renderer and popup should show a direct instruction,
- extension popup may include a `Reload bridge` button if Chrome APIs allow it,
- smoke should verify messaging state before/after reload indicator.

Do not make reload required state look like task failure. It is an operational
blocker with a clear recovery step.

## Browser Dogfood Requirements

Minimum repeated cases:

- public page click/type/search,
- Korean prompt navigation,
- download verify repeated,
- debugger print-to-PDF repeated,
- history one-time approval and redaction,
- restricted page blocked,
- file upload blocked without grant and approved with grant,
- site permission set/get,
- extension reload required recovery.

Promotion must require repeated samples and p95 reporting, not one live pass.

