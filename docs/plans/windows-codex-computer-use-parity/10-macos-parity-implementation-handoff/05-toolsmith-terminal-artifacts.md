# 05 - Toolsmith, Terminal, And Artifacts

## Objective

When a user request needs a capability the widget does not already have, the
agent should try to build or materialize a bounded tool inside the permission
profile instead of refusing too early.

This is scoped YOLO, not unrestricted YOLO.

## Capability Gap Detection

The daemon should decompose a request into operations:

- web navigation,
- source extraction,
- browser chrome action,
- document conversion,
- local file read/write,
- terminal command,
- generated script,
- package/dependency preparation,
- Windows/native helper workflow,
- external service/API,
- credential/authenticated profile need.

For each operation, decide:

- existing built-in capability,
- reviewed template,
- generated ad hoc tool,
- blocked external capability,
- missing permission grant,
- unsafe/non-negotiable blocker.

Gap output must include:

- required grants,
- risk class,
- proposed tool spec,
- evidence needs,
- fallback plan,
- blocker classification,
- rollback behavior.

## Toolsmith Runtime

Required loop:

```text
capability spec
  -> create runtime workspace
  -> write source files
  -> write smoke tests
  -> prepare dependencies under granted policy
  -> run smoke
  -> parse failures
  -> revise within iteration budget
  -> activate only after pass
  -> execute task
  -> verify artifacts
  -> record evidence
  -> rollback/cleanup
```

Generated tools live under daemon runtime workspace, not repo source, unless
the user explicitly asks for promotion.

Failed tools remain inspectable but inactive.

## Manifest Contract

Every generated or materialized tool needs a manifest:

- id,
- capability class,
- entrypoint,
- source file hashes,
- command allowlist,
- dependency list,
- package lock/provenance when installed,
- smoke commands,
- artifact contract,
- network/domain requirements,
- file read/write roots,
- timeout/output-size limits,
- rollback cleanup,
- provenance,
- stability rating.

## Dependency Policy

Allowed:

- system tools already installed when command grants allow them,
- package install into isolated runtime directories when profile grants
  package install and command prefix,
- lock/provenance recording.

Denied:

- repo-source dependency mutation unless user explicitly asks,
- global package install by default,
- pip/venv paths until virtualenv policy is explicit,
- postinstall/script execution unless explicitly allowed by future policy.

## Web Research To PDF

Primary vertical:

"OpenAI homepage/docs에서 Codex supported commands를 조사해서 PDF로 제공해줘."

DAG:

```text
permission_check
  -> capability_gap
  -> select web_research_to_pdf
  -> dependency_prepare
  -> crawl_or_observe
  -> extract_relevant_sections
  -> verify_sources
  -> draft_markdown
  -> render_pdf
  -> store_artifact
  -> verify_artifact
  -> eval_ledger_record
```

Required behavior:

- Fetch only allowed domains.
- Use browser fallback when HTTP fetch is blocked and browser automation is
  granted.
- Extract title, URL, headings, and relevant sections.
- Generate Markdown with citation table.
- Render PDF using approved `pandoc` when granted and available, otherwise
  built-in minimal renderer.
- Store artifacts under approved output root.
- Record URLs, source hashes, artifact hashes, commands, files, and verifier
  result.

## Terminal And PTY

Use terminal/PTY for:

- local diagnostics,
- safe file transforms,
- artifact rendering,
- generated script execution,
- test/smoke commands.

Rules:

- Commands must match exact or prefix allowlist.
- Avoid shell expansion for generated tools unless explicitly allowed.
- Record cwd, redacted env, exit code, duration, stdout/stderr preview, output
  truncation, and artifact effects.
- PTY sessions must be owned by session id when used as Computer Session nodes.

## Artifact Model

Artifacts should include:

- artifact id,
- kind,
- filename/basename,
- redacted path,
- blob resource id when stored,
- byte length,
- SHA-256 when available,
- MIME type,
- producer node id,
- source citations or command provenance,
- retention/cleanup policy.

Renderer should show:

- artifact list,
- source/provenance summary,
- verification status,
- rollback availability,
- debug bundle export.

## Rerun And Stability

Rerun mode should:

- load stored manifest,
- re-run the same capability under a compatible profile,
- compare scalar output and artifacts,
- record changed/missing/added artifact counts,
- mark external dependency warnings.

Promotion requires repeated stability evidence, not a single successful run.

