# Scoped Autonomy Self-Implementation Dogfood

Generated: 2026-05-16T10:18:59.473Z
Storage schema version: 7
Successful scenarios: 5/5
Generated capability classes: browser_download_verify, local_document_conversion, terminal_generated_tool, web_research_to_pdf
Matched reruns: 4
Repeated samples: 8
Repeated p95 latency: 821ms
Path redaction: passed

## Scenario Results

### self-implementation-full-dag-web-pdf

User scenario: 사용자가 OpenAI/Codex 관련 내용을 조사해 PDF 파일로 달라고 요청한다.

Success: passed

Architecture workflow:
- permission_check validates scoped_yolo grants before implementation
- capability_gap decomposes the request into crawl/extract/verify/draft/render/store/verify operations
- implement_capability materializes web_research_to_pdf.v2 under daemon runtime workspace
- first smoke is intentionally failed, then Toolsmith revises generated source and retries
- smoke_test activates the generated tool only after deterministic artifact checks pass
- DAG executes each web/PDF stage as a separate generated-tool command
- eval ledger and debug bundle record source hashes, commands, artifacts, timings, and resources

Follow-up:
- Repeat live runs before promoting any latency or stability claim.
- Renderer can now display profile/gaps/DAG/tools but still needs visual polish during real user trials.

### self-implementation-local-document-conversion

User scenario: 사용자가 제공한 Markdown 내용을 로컬에서 PDF 문서로 변환해 달라고 요청한다.

Success: passed

Architecture workflow:
- permission_check validates read-only generated-tool and output-root grants
- capability_gap classifies local_document_conversion instead of web_research_to_pdf
- Toolsmith materializes local_document_conversion.v1 under daemon runtime workspace
- smoke_test activates the converter only after Markdown/PDF artifact checks pass
- DAG skips crawl/extract/source verification and runs draft/render/store/verify stages
- eval ledger records artifact blobs, source hash evidence, timings, and rerun comparison

Follow-up:
- Pandoc remains optional; builtin PDF rendering is the default unless a profile grants pandoc.
- Future promotion should add source-file conversion cases with explicit filesystem_read grants.

### self-implementation-terminal-generated-tool

User scenario: 사용자가 안전한 로컬 스크립트 도구를 만들어 node 버전을 확인해 달라고 요청한다.

Success: passed

Architecture workflow:
- gap detector classifies terminal_generated_tool
- Toolsmith writes a no-shell Node wrapper in runtime workspace
- smoke test writes deterministic stdout artifacts
- execution evaluates command prefix grants before spawning node without shell expansion
- stdout/stderr artifacts and command provenance are recorded

Follow-up:
- Complex generated scripts should require promotion review before becoming repo source.
- Command splitting intentionally avoids shell features; richer command models need explicit parser tests.

### self-implementation-browser-download-verify

User scenario: 사용자가 브라우저에서 받은 파일이 실제로 저장됐는지 검증해 달라고 요청한다.

Success: passed

Architecture workflow:
- gap detector classifies browser_download_verify
- Toolsmith materializes a bounded local file verifier
- smoke test verifies a deterministic fixture file
- execution checks filesystem_read grant for the supplied path
- file size and SHA-256 evidence are stored as artifact JSON

Follow-up:
- Actual browser download shelf observation still requires browser bridge or native helper integration.
- Verifier should later correlate browser download transaction IDs with local files.

### self-implementation-native-windows-blocked

User scenario: 사용자가 Windows 설정 변경처럼 고위험 native workflow를 요청한다.

Success: passed

Architecture workflow:
- gap detector classifies native_windows_workflow
- permission evaluator requires high_risk and os_mutation grants
- run is blocked before materialization or execution
- blocker stays explicit rather than bypassing through OCR or generated code

Follow-up:
- Unattended high-risk Windows mutation remains blocked by policy.
- Signed bounded helper and release signing hardening are required before resuming this slice.

## Improvement Items

- Run-to-run stability is now measurable through rerun manifests, but promotion still needs repeated p95 latency samples.
- Terminal generated tools are intentionally command-prefix bounded; richer scripts should stay in runtime workspace until promoted by explicit user request.
- Download verification works on a supplied path; browser downloads surface integration remains a separate bridge/native-helper concern.
- Native Windows mutation stays blocked until signed helper scope, release signing, and high-risk dogfood gates are complete.

Raw evidence: docs/reports/assets/scoped-autonomy-self-implementation-2026-05-16/evidence.json
