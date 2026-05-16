# Computer Use Browser Chrome Dogfood

- generatedAt: `2026-05-16T02:12:01.649Z`
- runId: `computer-use-browser-chrome-dogfood-20260516-111200`
- evidenceClass: `fixture_bridge_repeated_dogfood`
- sample count: `4`
- success rate: `1`
- p95 latency: `272ms`
- promotion: `non_promoting_until_real_extension_live_samples_exist`

| Scenario | Command | Samples | Success | p95 | Evidence | Follow-up |
|---|---|---:|---|---:|---|---|
| browser-chrome-download-verify-repeat | download.verify | 2 | pass | 272 | download_verified_file | 반복 dogfood는 성공했지만 Browser Bridge result를 fixture로 주입한 증거다. 실제 확장 프로그램 live samples와 p95 비교가 있어야 live promotion이 가능하다. |
| browser-chrome-debugger-print-pdf-repeat | debugger.print_to_pdf | 2 | pass | 145 | job-output | 반복 dogfood는 성공했지만 Browser Bridge result를 fixture로 주입한 증거다. 실제 확장 프로그램 live samples와 p95 비교가 있어야 live promotion이 가능하다. |

Raw evidence: docs/reports/assets/computer-use-browser-chrome-dogfood-2026-05-16/evidence.json

