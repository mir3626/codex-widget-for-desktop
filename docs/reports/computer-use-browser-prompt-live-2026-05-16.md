# Computer Use Browser Prompt Live Dogfood

Generated: 2026-05-15T22:13:31.475Z
Run: `computer-use-browser-prompt-live-20260516-071322`

## Metrics

- scenarios: `4`
- success: `4/4`
- p95 latency: `3045ms`
- hosts: `example.com, wikipedia.org, iana.org`
- route: `/computer-use/sessions/:id/browser-action-prompt`

## Scenarios

| Scenario | Intent | Host | Status | Steps | Evidence | Follow-up |
|---|---|---|---|---:|---|---|
| computer-session-browser-live-read-example | read_current_page | example.com | passed | 1 | 1 jobs, 2 graphs, 1 verifier nodes | 성공. 이 케이스는 public-site live evidence이며, 승격에는 같은 intent class의 반복 sample과 p95/safety regression 검사가 필요하다. |
| computer-session-browser-live-search-wikipedia | search_form_fill_submit | wikipedia.org | passed | 2 | 2 jobs, 3 graphs, 2 verifier nodes | 성공. 이 케이스는 public-site live evidence이며, 승격에는 같은 intent class의 반복 sample과 p95/safety regression 검사가 필요하다. |
| computer-session-browser-live-click-example-link | representative_content_selection | example.com | passed | 1 | 1 jobs, 1 graphs, 1 verifier nodes | 성공. 이 케이스는 public-site live evidence이며, 승격에는 같은 intent class의 반복 sample과 p95/safety regression 검사가 필요하다. |
| computer-session-browser-live-navigate-iana | navigation | iana.org | passed | 1 | 1 jobs, 2 graphs, 1 verifier nodes | 성공. 이 케이스는 public-site live evidence이며, 승격에는 같은 intent class의 반복 sample과 p95/safety regression 검사가 필요하다. |

## Architecture Workflow

### computer-session-browser-live-read-example

- renderer-equivalent request creates an isolated_browser Computer Session for a public website
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean or direct user prompt into a Browser Action prompt plan
- each prompt step is executed through the parent Computer Session operation path against a real public URL
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations without storing raw DOM or screenshots in the report
- Computer Session records action feedback, perception graph evidence where a side-effect target exists, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

### computer-session-browser-live-search-wikipedia

- renderer-equivalent request creates an isolated_browser Computer Session for a public website
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean or direct user prompt into a Browser Action prompt plan
- each prompt step is executed through the parent Computer Session operation path against a real public URL
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations without storing raw DOM or screenshots in the report
- Computer Session records action feedback, perception graph evidence where a side-effect target exists, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

### computer-session-browser-live-click-example-link

- renderer-equivalent request creates an isolated_browser Computer Session for a public website
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean or direct user prompt into a Browser Action prompt plan
- each prompt step is executed through the parent Computer Session operation path against a real public URL
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations without storing raw DOM or screenshots in the report
- Computer Session records action feedback, perception graph evidence where a side-effect target exists, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

### computer-session-browser-live-navigate-iana

- renderer-equivalent request creates an isolated_browser Computer Session for a public website
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean or direct user prompt into a Browser Action prompt plan
- each prompt step is executed through the parent Computer Session operation path against a real public URL
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations without storing raw DOM or screenshots in the report
- Computer Session records action feedback, perception graph evidence where a side-effect target exists, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

