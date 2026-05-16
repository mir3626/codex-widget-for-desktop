# Scoped Autonomy Live Web Research Dogfood

Generated: 2026-05-15T21:10:24.136Z
Storage schema version: 6

## scoped-autonomy-live-openai-web-research-to-pdf

User scenario: 사용자가 OpenAI 웹사이트에서 Codex 관련 내용을 실제로 읽어 PDF 파일로 달라고 요청한다.

Success: passed

Architecture workflow:
- permission_check grants only openai.com and platform.openai.com live fetches
- Toolsmith materializes web_research_to_pdf.v2 in runtime workspace and passes smoke before live execution
- crawl_or_observe performs live allowed-domain fetches and records HTTP status per source
- if daemon-side HTTP is blocked, browser-backed capture is supplied as bounded fallback evidence
- extract and verify_sources build a citation table from live response text
- draft_markdown and render_pdf produce persistent artifacts
- store_artifact writes blob-backed eval resources and verify_artifact checks the PDF header

Live source status:
- https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started: browser_fallback, 3160 chars, browser fallback
- https://platform.openai.com/docs/codex/overview: browser_fallback, 2078 chars, browser fallback
- https://platform.openai.com/docs/docs-mcp: browser_fallback, 2361 chars, browser fallback

Browser fallback captures:
- https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started: 200, 3160 chars, CLI – Codex | OpenAI Developers
- https://platform.openai.com/docs/codex/overview: 200, 2078 chars, Web – Codex | OpenAI Developers
- https://platform.openai.com/docs/docs-mcp: 200, 2361 chars, Docs MCP | OpenAI Developers

Timing and quality:
- elapsedMs: 5370
- p95LatencyMs: 5370
- sourceQualityReview: accepted
- fallbackOnly: true
- browserFallbackCalibration: accepted

Follow-up:
- OpenAI pages may return HTTP 403 to daemon-side fetch in this environment; browser-backed capture is therefore included as bounded fallback evidence.
- Browser fallback text has accepted content-quality evidence but still requires repeated p95 samples and non-fallback transport calibration before promotion.
- Promotion should require repeated live runs and p95 latency comparison, not this single dogfood result.

Raw evidence: docs/reports/assets/scoped-autonomy-web-research-live-2026-05-16/evidence.json
