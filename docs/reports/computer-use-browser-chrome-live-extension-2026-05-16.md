# Computer Use Browser Chrome Live Extension Dogfood

- generatedAt: `2026-05-16T02:44:02.829Z`
- runId: `computer-use-browser-chrome-live-extension-20260516-114356`
- evidenceClass: `real_extension_local_fixture`
- extension id: `kpjnacfpjfgaboojnpipncmjhehdlogd`
- sample count: `2`
- success rate: `1`
- p95 latency: `2473ms`
- promotion: `non_promoting_until_public_site_repeated_samples_exist`

| Scenario | Command | Success | p95 | Evidence | Follow-up |
|---|---|---|---:|---|---|
| browser-chrome-live-extension-download-verify | download.start+download.verify | pass | 2473 | download_verified_file | This proves the real extension and Chrome downloads API path on a local fixture. Public-site repeated samples are still required for promotion. |
| browser-chrome-live-extension-debugger-print-pdf | debugger.print_to_pdf | pass | 1065 | job-output | This proves the real extension debugger fixed-command path on a local fixture. Public-site repeated samples and store-permission review remain required for promotion. |

Raw evidence: docs/reports/assets/computer-use-browser-chrome-live-extension-2026-05-16/evidence.json

