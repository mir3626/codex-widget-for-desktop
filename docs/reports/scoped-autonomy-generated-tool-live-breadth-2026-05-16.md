# Scoped Autonomy Generated-Tool Live Breadth Dogfood

Generated: 2026-05-16T10:33:25.884Z
Storage schema version: 7
Successful scenarios: 8/8
Generated capability classes: browser_download_verify, local_document_conversion, terminal_generated_tool, web_research_to_pdf
Repeated execute samples: 8
p95 latency: 849ms
Path redaction: passed

## Scenario Results

### generated-tool-live-web-research-to-pdf-1

User scenario: 사용자가 공식 OpenAI Codex 문서를 조사해 PDF 파일로 달라고 요청한다.

Capability: web_research_to_pdf

Source class: official_openai_browser_captured_web

Success: passed

Architecture workflow:
- permission profile grants only official OpenAI domains, generated code, generated-tool execution, and the dogfood output root
- Toolsmith materializes web_research_to_pdf in the runtime workspace and runs smoke before execution
- live official OpenAI pages are browser-captured when daemon-side HTTP is blocked
- generated tool creates Markdown/PDF/citation artifacts and records source hash evidence
- rerun uses the stored generated-tool manifest and compares stable output fingerprints

Follow-up:
- Keep direct-fetch and browser-fallback calibration separate; fallback content quality does not imply direct HTTP stability.
- Do not promote high-risk native workflows based on web/PDF success.

### generated-tool-live-local-document-conversion-1

User scenario: 사용자가 승인된 로컬 Markdown 파일을 PDF 문서로 변환해 달라고 요청한다.

Capability: local_document_conversion

Source class: approved_local_markdown_file

Success: passed

Architecture workflow:
- permission profile grants only generated-tool execution and the dogfood read/write roots
- gap detector classifies local_document_conversion instead of web_research_to_pdf
- Toolsmith materializes local_document_conversion in the runtime workspace and runs smoke before execution
- execution reads only the approved Markdown source path and skips crawl/extract/source-verify DAG nodes
- generated tool creates Markdown/PDF artifacts and records source/content hashes plus rerun fingerprints

Follow-up:
- Add non-Markdown text and large-document cases before claiming broad local conversion coverage.
- Pandoc remains optional and should stay profile-gated for renderer differences.

### generated-tool-live-terminal-node-version-1

User scenario: 사용자가 안전한 generated local script로 Node 런타임 버전을 확인해 달라고 요청한다.

Capability: terminal_generated_tool

Source class: local_node_runtime

Success: passed

Architecture workflow:
- gap detector classifies terminal_generated_tool
- Toolsmith writes a no-shell Node wrapper in the runtime workspace
- permission profile allows only the node command prefix and dogfood output root
- execution spawns node without shell expansion and stores stdout/stderr artifacts
- rerun compares stable generated-tool output fingerprints

Follow-up:
- Richer terminal generated tools still need explicit command parser tests and promotion review.
- Shell features remain unavailable unless a future profile explicitly grants a safe shell parser.

### generated-tool-live-browser-download-verify-1

User scenario: 사용자가 공개 웹 리소스로 받은 파일이 실제로 저장됐는지 generated verifier로 확인해 달라고 요청한다.

Capability: browser_download_verify

Source class: public_browser_backed_download

Success: passed

Architecture workflow:
- browser-backed public fetch creates a deterministic local downloaded file under the approved dogfood root
- gap detector classifies browser_download_verify
- Toolsmith materializes a bounded file verifier in the runtime workspace
- execution checks filesystem_read grant for the approved file path and writes size/SHA-256 evidence
- rerun compares stable generated-tool output fingerprints without storing raw local paths

Follow-up:
- This validates a public browser-backed downloaded file; browser shelf/download transaction correlation remains covered by the Browser Chrome public-extension dogfood.
- Keep local file paths basename-only or redacted in debug surfaces.

### generated-tool-live-web-research-to-pdf-2

User scenario: 사용자가 공식 OpenAI Codex 문서를 조사해 PDF 파일로 달라고 요청한다.

Capability: web_research_to_pdf

Source class: official_openai_browser_captured_web

Success: passed

Architecture workflow:
- permission profile grants only official OpenAI domains, generated code, generated-tool execution, and the dogfood output root
- Toolsmith materializes web_research_to_pdf in the runtime workspace and runs smoke before execution
- live official OpenAI pages are browser-captured when daemon-side HTTP is blocked
- generated tool creates Markdown/PDF/citation artifacts and records source hash evidence
- rerun uses the stored generated-tool manifest and compares stable output fingerprints

Follow-up:
- Keep direct-fetch and browser-fallback calibration separate; fallback content quality does not imply direct HTTP stability.
- Do not promote high-risk native workflows based on web/PDF success.

### generated-tool-live-local-document-conversion-2

User scenario: 사용자가 승인된 로컬 Markdown 파일을 PDF 문서로 변환해 달라고 요청한다.

Capability: local_document_conversion

Source class: approved_local_markdown_file

Success: passed

Architecture workflow:
- permission profile grants only generated-tool execution and the dogfood read/write roots
- gap detector classifies local_document_conversion instead of web_research_to_pdf
- Toolsmith materializes local_document_conversion in the runtime workspace and runs smoke before execution
- execution reads only the approved Markdown source path and skips crawl/extract/source-verify DAG nodes
- generated tool creates Markdown/PDF artifacts and records source/content hashes plus rerun fingerprints

Follow-up:
- Add non-Markdown text and large-document cases before claiming broad local conversion coverage.
- Pandoc remains optional and should stay profile-gated for renderer differences.

### generated-tool-live-terminal-node-version-2

User scenario: 사용자가 안전한 generated local script로 Node 런타임 버전을 확인해 달라고 요청한다.

Capability: terminal_generated_tool

Source class: local_node_runtime

Success: passed

Architecture workflow:
- gap detector classifies terminal_generated_tool
- Toolsmith writes a no-shell Node wrapper in the runtime workspace
- permission profile allows only the node command prefix and dogfood output root
- execution spawns node without shell expansion and stores stdout/stderr artifacts
- rerun compares stable generated-tool output fingerprints

Follow-up:
- Richer terminal generated tools still need explicit command parser tests and promotion review.
- Shell features remain unavailable unless a future profile explicitly grants a safe shell parser.

### generated-tool-live-browser-download-verify-2

User scenario: 사용자가 공개 웹 리소스로 받은 파일이 실제로 저장됐는지 generated verifier로 확인해 달라고 요청한다.

Capability: browser_download_verify

Source class: public_browser_backed_download

Success: passed

Architecture workflow:
- browser-backed public fetch creates a deterministic local downloaded file under the approved dogfood root
- gap detector classifies browser_download_verify
- Toolsmith materializes a bounded file verifier in the runtime workspace
- execution checks filesystem_read grant for the approved file path and writes size/SHA-256 evidence
- rerun compares stable generated-tool output fingerprints without storing raw local paths

Follow-up:
- This validates a public browser-backed downloaded file; browser shelf/download transaction correlation remains covered by the Browser Chrome public-extension dogfood.
- Keep local file paths basename-only or redacted in debug surfaces.

## Improvement Items

- This is repeated live/local-live generated-tool breadth evidence, not unrestricted desktop automation.
- web_research_to_pdf uses live official OpenAI browser-captured source evidence when daemon-side HTTP is blocked.
- local_document_conversion converts an approved local Markdown source file and records only source hash/artifact evidence.
- terminal_generated_tool uses a real local Node runtime command with shell expansion disabled.
- browser_download_verify validates a file produced from a public browser-backed fetch and records only hash/size/source metadata.
- Promotion remains a review decision; high-risk native Windows mutation is still covered by the separate non-promoting boundary gate.

Raw evidence: docs/reports/assets/scoped-autonomy-generated-tool-live-breadth-2026-05-16/evidence.json
