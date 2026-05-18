# 04 - Browser, Tool, And Terminal Slices

## Goal

Deliver most user-visible parity before attempting broad foreground Windows
desktop control.

The first useful computer-use outcomes should come from:

- isolated browser automation
- Browser Chrome deep actions
- Toolsmith generated/reviewed tools
- terminal/PTY execution
- document artifact generation

## Slice 1: Isolated Browser Computer Use

Target:

- public unauthenticated sites
- local dev pages
- file-backed pages
- reproducible browser dogfood

Implementation:

- Use Playwright/CDP as default isolated browser backend.
- Use a session-owned temp profile.
- Load extension bridge when the workflow needs DOM bridge or chrome APIs.
- Keep user browser profile out of scope unless explicitly requested.
- Record all navigation, clicks, typed text, screenshots, downloads, and
  verifier results.

Needed changes:

- Register Browser Action as a real capability handler.
- Let ComputerSessionRuntime start Browser Action through DAG node execution.
- Normalize Browser Action results to the computer-use evidence model.
- Add screenshot feedback after Browser Action batches.
- Add isolated browser surface lifecycle:
  - create
  - observe
  - execute
  - verify
  - teardown

Acceptance:

- A task can open a public site, search, click a result, extract content, and
  produce a verified result through a single computer-use session.

## Slice 2: Browser Chrome Deep Actions

Existing capability:

- bookmarks
- tab groups
- downloads
- history
- debugger
- file upload commands

Design:

- Treat Browser Chrome as structured backend operations, not visual actions.
- Keep `history`, `debugger`, and `file_upload` high-risk.
- Use one-time approval for history.
- Use explicit absolute file paths for file upload.
- Use fixed debugger commands only; no arbitrary user-provided CDP script.
- Record browser state mutation evidence.

Computer-use mapping:

- "Add this page to bookmarks"
  - observe active tab
  - command `bookmark.create`
  - verify bookmark exists
- "Group these research tabs"
  - list tabs
  - create/claim tab group
  - verify group state
- "Download the PDF and confirm it finished"
  - start/observe download
  - verify path/basename/hash/state
- "Upload this file"
  - inspect file input
  - request explicit file grant
  - set files
  - verify basename evidence
- "Allow camera permission for this site"
  - observe active tab origin
  - command `permission.get`
  - request one-time approval for `permission.set`
  - use Chrome `contentSettings` instead of coordinate-clicking browser chrome
  - verify requested setting is applied and record `nativePopupClick: false`

Acceptance:

- Browser chrome commands appear as DAG nodes with safety decisions and proof.
  Current implementation note: Browser Chrome also exposes `permission.get`
  and `permission.set` for bounded site-permission workflows. `permission.get`
  is read-only; `permission.set` is high-risk one-time approval and records
  origin/pattern/setting evidence without raw path leakage.

## Slice 3: Web Research To PDF

This is the highest-value Toolsmith slice.

Example request:

"OpenAI homepage and docs에서 Codex supported commands를 조사해서 PDF로 제공해줘."

Desired DAG:

```text
permission_check
  -> capability_gap
  -> select web_research_to_pdf tool
  -> dependency_prepare
  -> crawl_openai_pages
  -> extract_relevant_sections
  -> verify_sources
  -> draft_markdown
  -> render_pdf
  -> store_artifact
  -> verify_artifact
  -> eval_ledger_record
```

Implementation:

- Prefer reviewed `web_research_to_pdf` template for stable path.
- Use live allowed-domain fetch.
- Support browser-backed fetch fallback when direct HTTP is blocked.
  Current implementation note: `web_research_to_pdf` accepts
  `browserFallbackDocuments` and uses matching browser-captured evidence when
  direct fetch fails for an allowed browser domain. Browser Chrome
  `debugger.print_to_pdf` provides the bounded document-capture primitive; live
  extension-driven fallback capture is still a promotion gate.
- Extract source title, URL, headings, and relevant sections.
- Generate Markdown with citation table.
- Render PDF:
  - use allowed `pandoc` if granted and available
  - otherwise use built-in minimal PDF renderer
- Store artifacts under allowed output root.
- Record source hashes and artifact hashes.

Acceptance:

- The output Markdown and PDF include source citations.
- Debug bundle lists URLs read, commands run, files created, and verifier proof.
- Rerun mode can execute from stored manifest and compare artifact stability.
- Current implementation note: `dependency_prepare` is now a first-class
  Toolsmith run/eval step instead of only DAG metadata. It records manifest
  dependency provenance, optional system dependency notes, and isolated runtime
  workspace information. Future npm dependencies require explicit
  `package_install`, `npm` command, and runtime workspace write grants before
  `npm install --package-lock-only --ignore-scripts` can create lock/provenance
  in the runtime workspace; pip remains blocked until a virtualenv policy is
  defined.
- Current implementation note: `dogfood:scoped-autonomy-self-implementation`
  now records a repeated fixture breadth gate for `web_research_to_pdf`,
  `local_document_conversion`, `terminal_generated_tool`, and
  `browser_download_verify`. `local_document_conversion.v1` is a dedicated
  Markdown/text-to-PDF Toolsmith template, not a web-research alias; its DAG
  skips crawl/extract/source verification, then records draft/render/store/
  verify stages, source-content hash, Markdown/PDF blob resources, and rerun
  stability. The dogfood also proves an unsupported high-risk native Windows
  workflow blocks before materialization, records redacted evidence only, runs
  `toolsmith-rerun-comparison.v1` stability checks for all four generated tool
  classes, and appends redacted execute/rerun latency rows to
  `docs/reports/assets/scoped-autonomy-self-implementation-runs.jsonl`. The
  promotion gate tracks this as `scoped_autonomy_self_implementation_breadth`,
  verifies per-class repeated samples and p95 latency, and remains
  non-promoting until repeated live generated-tool evidence exists.
- Current implementation note: `dogfood:scoped-autonomy-generated-tool-live-breadth`
  now adds repeated live/local-live breadth evidence for four generated
  classes. It runs two live `web_research_to_pdf` OpenAI official-doc PDF jobs
  with browser-fallback source hashes, two `local_document_conversion` jobs
  against approved Markdown source files under the dogfood root, two real local
  `terminal_generated_tool` Node version jobs, and two
  `browser_download_verify` jobs against a public browser-backed download from
  `example.com`. The gate `scoped_autonomy_generated_tool_live_breadth`
  requires two execute samples per class, p95 samples, matched reruns, web
  source-quality calibration, local conversion proof, terminal command proof,
  public download proof, and redaction before marking the slice eligible for
  generated-tool promotion review.

## Slice 4: Terminal And PTY Workspace

Use for:

- local build/test
- file transformations
- CLI research helpers
- generated scripts
- project diagnostics

Rules:

- Commands must match allowlist/profile.
- Category deny patterns for credential/cookie/CAPTCHA or payment/purchase
  remain active in YOLO and default SUPER-YOLO. SUPER-YOLO plus the matching
  safety boundary unlock can satisfy those profile-level blocks, after which
  terminal input is redacted for persistence and raw sensitive input is kept
  transient.
- No shell expansion for generated tools unless explicitly allowed.
- PTY sessions must be owned by session id when run as computer-use nodes.
- Terminal output must be redacted and size-limited.
- Commands should record cwd, environment redaction, exit code, duration, and
  artifact effects.

Acceptance:

- A generated local script can run smoke tests, execute, store artifacts, and be
  rolled back without modifying repo source.

## Slice 5: Download Verification

Use Browser Chrome downloads API or browser runner download events.

Record:

- source URL
- download id
- state
- danger state
- total bytes
- received bytes
- MIME/type
- basename-only path evidence
- hash when file root grant allows reading
- cancellation/erase if invoked

Acceptance:

- A download task can prove completion without exposing full local paths by
  default.
- Current implementation note: Computer Session `browser_chrome`
  `download.verify` operations can include `approvedDownloadPath`. When the
  active scoped autonomy profile grants that file root and the Browser Chrome
  result verifies completion, the session runtime stores the local file as a
  blob-backed `download_verified_file` eval resource and exposes only
  basename/SHA-256/size metadata plus a `browser_chrome_download_verify` file
  observation in the debug bundle.

## Slice 6: File Upload

Current safe path:

- inspect DOM file inputs
- use extension debugger path to set files when explicitly approved
- store basename-only evidence

Future native path:

- signed helper v2 file picker workflow
- explicit path grant
- active window assertion
- pre/post screenshot/UIA proof

Acceptance:

- File upload cannot execute without explicit local file grant.
- Debug bundle explains selected input and file basename evidence.

## Slice 7: Local Document Conversion

Use cases:

- Markdown to PDF
- HTML to PDF
- plain text report to PDF
- local file summarization with explicit grant

Implementation:

- Built-in renderer for minimal PDF fallback.
- Optional `pandoc` only when command grant allows it.
- Dependency detection must not install packages silently.
- Package install remains isolated runtime-only and approval-gated.

Acceptance:

- User receives artifact path, hash, and proof of existence.

## Slice 8: Browser/Profile Tasks

Regular browser extension should be used only when:

- user explicitly refers to current browser state
- task requires existing open tabs
- task requires bookmark/history/download state from profile

Risks:

- profile privacy
- cookies/auth state
- browser history sensitivity
- extension permission expansion

Rules:

- Use least command surface.
- Avoid exporting raw profile data.
- Prefer redacted evidence.
- Never treat profile access as default YOLO.
- Authenticated profile/session/account/cookie access is blocked in YOLO and
  default SUPER-YOLO unless explicit leases cover it.
- SUPER-YOLO + credential/cookie/CAPTCHA unlock can satisfy the profile-level
  browser profile requirements and let the operation reach runtime approval and
  redacted evidence paths. It does not export raw cookies, passwords, tokens,
  or browser history.

## Mode Reference

Use `docs/plans/computer-use-permission-modes.md` when adding new browser,
tool, or terminal slices. New slices must state whether they work under YOLO,
SUPER-YOLO, or SUPER-YOLO plus one of the safety boundary unlock categories.

## Acceptance Criteria For This Shard

- Browser, Browser Chrome, Toolsmith, and Terminal can all run as session DAG
  backends.
- The research-to-PDF scenario runs through distinct nodes, not one monolithic
  command.
- All artifacts are linked to eval ledger resources.
- High-risk browser profile commands require one-time approval.
