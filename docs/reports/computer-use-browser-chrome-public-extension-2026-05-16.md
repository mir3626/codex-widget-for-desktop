# Computer Use Browser Chrome Public Extension Dogfood

- generatedAt: `2026-05-16T04:12:28.774Z`
- runId: `computer-use-browser-chrome-public-extension-20260516-131121`
- evidenceClass: `real_extension_public_site_repeated`
- extension id: `eclklilhmjbijffammcbojpenhgonppb`
- public hosts: `example.com, the-internet.herokuapp.com, www.w3.org`
- sample count: `18`
- success rate: `1`
- p95 latency: `17448ms`
- profile approval: `covered`
- promotion: `public_site_repeated_browser_chrome_extension_gate`

| Scenario | Host | Command | Success | p95 | Evidence | Follow-up |
|---|---|---|---|---:|---|---|
| browser-chrome-public-extension-download-verify-1 | www.w3.org | download.start+download.verify | pass | 4101 | download_verified_file | This proves the real extension and Chrome downloads API path on a repeated public unauthenticated PDF target. |
| browser-chrome-public-extension-download-verify-2 | www.w3.org | download.start+download.verify | pass | 1734 | download_verified_file | This proves the real extension and Chrome downloads API path on a repeated public unauthenticated PDF target. |
| browser-chrome-public-extension-debugger-print-pdf-1 | example.com | debugger.print_to_pdf | pass | 1213 | job-output | This proves the real extension debugger fixed-command path on a repeated public unauthenticated page. |
| browser-chrome-public-extension-debugger-print-pdf-2 | example.com | debugger.print_to_pdf | pass | 1149 | job-output | This proves the real extension debugger fixed-command path on a repeated public unauthenticated page. |
| browser-chrome-public-extension-tab-group-1 | example.com | tab_group.claim+update+release | pass | 1632 | job-output | This proves bounded tab group claim/update/release through the real extension on a repeated public unauthenticated tab. |
| browser-chrome-public-extension-tab-group-2 | example.com | tab_group.claim+update+release | pass | 2814 | job-output | This proves bounded tab group claim/update/release through the real extension on a repeated public unauthenticated tab. |
| browser-chrome-public-extension-history-search-1 | example.com | history.search | pass | 1597 | job-output | This proves high-risk history search can run through the real extension with one-time approval and redacted evidence, without touching the user's real browser profile. |
| browser-chrome-public-extension-history-search-2 | example.com | history.search | pass | 2898 | job-output | This proves high-risk history search can run through the real extension with one-time approval and redacted evidence, without touching the user's real browser profile. |
| browser-chrome-public-extension-permission-setting-camera-1 | example.com | permission.get+set+rollback | pass | 2862 | job-output | This proves camera site permission mutation can use the Chrome contentSettings API with one-time approval, bounded origin scope, and rollback proof instead of coordinate-clicking browser chrome. |
| browser-chrome-public-extension-permission-setting-camera-2 | example.com | permission.get+set+rollback | pass | 17448 | job-output | This proves camera site permission mutation can use the Chrome contentSettings API with one-time approval, bounded origin scope, and rollback proof instead of coordinate-clicking browser chrome. |
| browser-chrome-public-extension-permission-setting-microphone-1 | example.com | permission.get+set+rollback | pass | 5702 | job-output | This proves microphone site permission mutation can use the Chrome contentSettings API with one-time approval, bounded origin scope, and rollback proof instead of coordinate-clicking browser chrome. |
| browser-chrome-public-extension-permission-setting-microphone-2 | example.com | permission.get+set+rollback | pass | 2864 | job-output | This proves microphone site permission mutation can use the Chrome contentSettings API with one-time approval, bounded origin scope, and rollback proof instead of coordinate-clicking browser chrome. |
| browser-chrome-public-extension-permission-setting-location-1 | example.com | permission.get+set+rollback | pass | 3221 | job-output | This proves location site permission mutation can use the Chrome contentSettings API with one-time approval, bounded origin scope, and rollback proof instead of coordinate-clicking browser chrome. |
| browser-chrome-public-extension-permission-setting-location-2 | example.com | permission.get+set+rollback | pass | 2862 | job-output | This proves location site permission mutation can use the Chrome contentSettings API with one-time approval, bounded origin scope, and rollback proof instead of coordinate-clicking browser chrome. |
| browser-chrome-public-extension-multi-tab-group-1 | example.com | tab_group.multi_tab_claim+update+release | pass | 2280 | job-output | This proves tab-group orchestration can handle multiple explicit public tab ids through the real extension while avoiding arbitrary browser-profile state. |
| browser-chrome-public-extension-multi-tab-group-2 | example.com | tab_group.multi_tab_claim+update+release | pass | 2452 | job-output | This proves tab-group orchestration can handle multiple explicit public tab ids through the real extension while avoiding arbitrary browser-profile state. |
| browser-chrome-public-extension-file-upload-1 | the-internet.herokuapp.com | file_upload.inspect+set_files+clear | pass | 5119 | job-output | This proves approved file selection can use the fixed Browser Bridge file-upload command with basename-only evidence and clear rollback; native picker automation remains blocked until signed helper v2. |
| browser-chrome-public-extension-file-upload-2 | the-internet.herokuapp.com | file_upload.inspect+set_files+clear | pass | 2510 | job-output | This proves approved file selection can use the fixed Browser Bridge file-upload command with basename-only evidence and clear rollback; native picker automation remains blocked until signed helper v2. |

Raw evidence: docs/reports/assets/computer-use-browser-chrome-public-extension-2026-05-16/evidence.json

