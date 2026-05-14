# Scoped Autonomy Self-Implementation Handoff

Date: 2026-05-14

## Goal

Deliver scoped YOLO computer-use behavior without unrestricted YOLO. The daemon can now plan a request, detect missing capability, materialize a bounded generated tool in the runtime workspace, smoke-test it, activate it for the run, execute a staged DAG, record evidence, export debug bundles, rerun a generated tool, and roll back runtime-generated assets.

## Implemented Slices

- Permission profiles now include scope, use count, max uses, network/browser/generated-code/risk/timeout/output grants, and durable update routes.
- Capability inventory records built-in, generated, blocked, and externally unavailable capability classes.
- Gap detector decomposes requests into operations and emits required grants, risk class, evidence needs, fallback plan, proposed tool spec, and blocker classification.
- Toolsmith runtime supports:
  - reviewed `web_research_to_pdf.v2`
  - ad hoc `terminal_generated_tool.v1`
  - generated `browser_download_verify.v1`
  - bounded iteration with smoke failure parsing and retry
  - manifest/source hash/provenance/stability recording
  - activation only after smoke pass
  - failed tools kept inspectable but inactive
- Autonomy DAG executes distinct nodes for permission, gap, implementation, dependency preparation, smoke, task planning, crawl/extract/source verification, markdown, PDF, storage, artifact verification, cleanup, and eval ledger recording.
- Evidence covers URLs read, files created, commands run, generated source hashes, smoke outcomes, DAG nodes, artifacts, verifier results, debug bundles, rerun stability, and rollback actions.
- Renderer Activity details include an Autonomy Toolsmith panel for profiles, runs, gaps, DAG nodes, tools, blocked grants, debug bundle copy, and a sample DAG run.

## Safety Boundaries

- Credential storage remains unimplemented and credential access defaults to denied.
- Generated code only materializes in daemon runtime workspace unless a future explicit promotion flow is added.
- Generated tools execute only after permission checks and smoke pass.
- Command execution is prefix-bounded and terminal generated tools avoid shell expansion.
- Browser restricted pages and high-risk Windows mutation remain blocked rather than bypassed.
- Rollback deletes runtime generated tool workspaces by default; user artifacts are not deleted unless explicitly requested.

## Vertical Dogfood

- `npm run smoke:scoped-autonomy-self-implementation`
- `npm run dogfood:scoped-autonomy-self-implementation`
- `npm run dogfood:scoped-autonomy-web-research-live`

Generated evidence:

- `docs/dogfood/scoped-autonomy-self-implementation-2026-05-14.json`
- `docs/reports/scoped-autonomy-self-implementation-2026-05-14.md`
- `docs/dogfood/scoped-autonomy-web-research-live-2026-05-14.json`
- `docs/reports/scoped-autonomy-web-research-live-2026-05-14.md`

## Known External Blockers

- Official app-server custom client-tool contract.
- Production signing certificate/service.
- Unrestricted credential flows.
- Unattended high-risk Windows mutation.
- Authenticated browser profile/cookie access.
- GPU ASR validation.
- Human microphone corpus benchmark.

## Follow-Up

- Run repeated live web dogfood to establish p50/p95 and rerun stability before promotion.
- Add browser-backed fetch fallback for upstream sites that block daemon-side HTTP clients.
- Promote generated tools to repo source only through an explicit reviewed promotion workflow.
- Add package-install helper only after isolated runtime install directories and lock/provenance enforcement are dogfooded.
- Continue renderer polish for profile creation, narrower one-time approval, and artifact preview.
