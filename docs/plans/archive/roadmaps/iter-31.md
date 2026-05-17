## Iteration iter-31: Computer Use Live Task Benchmark Harness

Status: complete.

Carryover: Existing process gates did not provide a dedicated benchmark corpus
for Windows app, browser, and terminal live task classes.

### iter-31-sprint-01-live-task-benchmark-and-gate

Goal: add corpus format, success/latency/rollback/evidence metrics,
report/evidence output, and promotion gate integration.

Status: complete. Added `docs/eval/computer-use-live-task-corpus.fixture.json`,
`scripts/benchmark-computer-use-live-tasks.mjs`,
`smoke:computer-use-live-task-benchmark`, generated fixture report/evidence,
and `live_task_benchmark_harness` promotion gate integration. Fixture evidence
is non-promotable until user-captured live traces are supplied.
