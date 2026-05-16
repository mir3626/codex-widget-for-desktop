# Computer Use Browser Prompt Dogfood

Generated: 2026-05-15T22:01:25.559Z
Fixture: `http://127.0.0.1:<port>`

## Metrics

- scenarios: `4`
- success: `4/4`
- p95 latency: `1005ms`
- route: `/computer-use/sessions/:id/browser-action-prompt`
- promotion: `fixture evidence only; live public-site corpus still required`

## Scenarios

| Scenario | Intent | Status | Steps | Evidence | Follow-up |
|---|---|---|---:|---|---|
| computer-session-browser-read-current-page | read_current_page | passed | 1 | 1 jobs, 0 graphs, 1 verifier nodes | 성공했지만 현재 증거는 local fixture 기반이다. 반복 실행 가능성은 높지만 public-site live promotion에는 별도 live Computer Session browser prompt corpus가 필요하다. |
| computer-session-browser-search-form-submit | search_form_fill_submit | passed | 2 | 2 jobs, 4 graphs, 2 verifier nodes | 성공했지만 현재 증거는 local fixture 기반이다. 반복 실행 가능성은 높지만 public-site live promotion에는 별도 live Computer Session browser prompt corpus가 필요하다. |
| computer-session-browser-representative-content-selection | representative_content_selection | passed | 2 | 2 jobs, 3 graphs, 2 verifier nodes | 성공했지만 현재 증거는 local fixture 기반이다. 반복 실행 가능성은 높지만 public-site live promotion에는 별도 live Computer Session browser prompt corpus가 필요하다. |
| computer-session-browser-navigation | navigation | passed | 1 | 1 jobs, 2 graphs, 1 verifier nodes | 성공했지만 현재 증거는 local fixture 기반이다. 반복 실행 가능성은 높지만 public-site live promotion에는 별도 live Computer Session browser prompt corpus가 필요하다. |

## Architecture Workflow

### computer-session-browser-read-current-page

- renderer-equivalent request creates an isolated_browser Computer Session with scenario metadata
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean user prompt into a Browser Action prompt plan
- each prompt step is executed through the Computer Session operation path, not through the legacy Browser Action endpoint alone
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations for every action step
- Computer Session records action feedback, perception graph evidence, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

### computer-session-browser-search-form-submit

- renderer-equivalent request creates an isolated_browser Computer Session with scenario metadata
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean user prompt into a Browser Action prompt plan
- each prompt step is executed through the Computer Session operation path, not through the legacy Browser Action endpoint alone
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations for every action step
- Computer Session records action feedback, perception graph evidence, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

### computer-session-browser-representative-content-selection

- renderer-equivalent request creates an isolated_browser Computer Session with scenario metadata
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean user prompt into a Browser Action prompt plan
- each prompt step is executed through the Computer Session operation path, not through the legacy Browser Action endpoint alone
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations for every action step
- Computer Session records action feedback, perception graph evidence, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

### computer-session-browser-navigation

- renderer-equivalent request creates an isolated_browser Computer Session with scenario metadata
- ComputerSessionRuntime selects the isolated browser surface and creates an eval run plus capability DAG skeleton
- the /browser-action-prompt route deterministically decomposes the Korean user prompt into a Browser Action prompt plan
- each prompt step is executed through the Computer Session operation path, not through the legacy Browser Action endpoint alone
- the Playwright Browser Action adapter captures pre-action and post-action DOM observations for every action step
- Computer Session records action feedback, perception graph evidence, verifier output, follow-up verification nodes, and eval-ledger nodes
- the debug bundle exports prompt runs, capability jobs, DAG nodes, observations, action feedback, eval resources, verifier audit, and rollback cleanup

