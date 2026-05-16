# Computer Use Toolsmith Live Dogfood

Generated: 2026-05-15T21:10:44.604Z

## computer-use-session-live-openai-web-research-to-pdf

User scenario: 사용자가 위젯 Computer Use 세션에 OpenAI Codex 관련 공식 문서를 조사해서 PDF로 저장해 달라고 요청한다.

Success: passed

Architecture workflow:
- renderer-equivalent request creates a tool_workspace Computer Session with a scoped one-time permission profile
- ComputerSessionRuntime routes the operation to Toolsmith and links the child autonomy DAG to the parent action node
- Toolsmith materializes web_research_to_pdf.v2 in the runtime workspace and passes smoke before execution
- live official OpenAI source pages are captured through browser-backed fallback when daemon-side HTTP is blocked
- crawl_or_observe, extract, verify_sources, draft_markdown, render_pdf, store_artifact, and verify_artifact run as distinct child DAG stages
- parent Computer Session mirrors report/PDF artifacts into eval resources and debug-bundle observations
- parent DAG records action, verification, eval_ledger, store_artifact, and verify_artifact proof nodes

Source status:
- help.openai.com: browser_fallback, unknown chars, browser fallback
- platform.openai.com: browser_fallback, unknown chars, browser fallback

Browser fallback captures:
- https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started: 200, 3160 chars, CLI – Codex | OpenAI Developers
- https://platform.openai.com/docs/codex/overview: 200, 2078 chars, Web – Codex | OpenAI Developers
- https://platform.openai.com/docs/docs-mcp: 200, 2361 chars, Docs MCP | OpenAI Developers

Artifacts:
- toolsmith_report
- toolsmith_pdf
- toolsmith_citation
- toolsmith_source
- toolsmith_source
- toolsmith_citation
- toolsmith_report
- toolsmith_pdf
- toolsmith_report
- toolsmith_pdf
- toolsmith_citation
- toolsmith_report
- toolsmith_pdf

Timing and quality:
- elapsedMs: 5114
- p95LatencyMs: 5114
- sourceQualityReview: accepted
- fallbackOnly: true
- browserFallbackCalibration: accepted

Follow-up:
- Current live success depends on browser-backed public documentation capture because daemon-side HTTP can return 403.
- Promotion still needs repeated parent Computer Session live runs, p95 latency tracking, and non-fallback transport calibration.
- This dogfood proves the parent Computer Session evidence path, not only the child scoped-autonomy runtime.

Raw evidence: docs/reports/assets/computer-use-toolsmith-live-2026-05-16/evidence.json
