# Scoped Autonomy Live Web Research Dogfood

Generated: 2026-05-14T09:43:32.321Z
Storage schema version: 6

## scoped-autonomy-live-openai-web-research-to-pdf

User scenario: 사용자가 OpenAI 웹사이트에서 Codex 관련 내용을 실제로 읽어 PDF 파일로 달라고 요청한다.

Success: passed

Architecture workflow:
- permission_check grants only openai.com and platform.openai.com live fetches
- Toolsmith materializes web_research_to_pdf.v2 in runtime workspace and passes smoke before live execution
- crawl_or_observe performs live allowed-domain fetches and records HTTP status per source
- extract and verify_sources build a citation table from live response text
- draft_markdown and render_pdf produce persistent artifacts
- store_artifact writes blob-backed eval resources and verify_artifact checks the PDF header

Live source status:
- https://openai.com/codex/: 403, 41 chars
- https://platform.openai.com/docs/codex: 403, 41 chars

Follow-up:
- OpenAI pages currently return HTTP status evidence to Node fetch in this environment; the run still records live response text and status.
- Browser-backed fetch may be needed when upstream blocks daemon-side HTTP clients.
- Promotion should require repeated live runs and p95 latency comparison, not this single dogfood result.

Raw evidence: docs/reports/assets/scoped-autonomy-web-research-live-2026-05-14/evidence.json
