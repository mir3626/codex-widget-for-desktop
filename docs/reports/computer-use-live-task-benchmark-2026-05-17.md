# Computer Use Live Task Benchmark

- Date: 2026-05-17
- Corpus: docs/eval/computer-use-live-task-corpus.fixture.json
- Fixture only: true
- Gate: fixture_only
- Success rate: 1.000
- P95 latency: 1040 ms
- Rollback coverage: 1.000
- Evidence coverage: 1.000

## Tasks

- passed browser.read.account-page (browser) latency=820ms rollback=true evidence=true
- passed windows.settings.read-theme (windows_app) latency=640ms rollback=true evidence=true
- passed terminal.create-report-artifact (terminal) latency=1040ms rollback=true evidence=true

Fixture evidence is a harness smoke only. Live promotion requires user-captured traces with real Windows app, browser, and terminal execution evidence.
