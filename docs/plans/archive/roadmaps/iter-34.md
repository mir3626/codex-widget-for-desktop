# Iteration iter-34: ASR Benchmark Harness

Status: complete.

Carryover: ASR candidate benchmarking existed, but corpus-level WER and command
accuracy validation needed a standalone report/evidence harness.

## iter-34-sprint-01-asr-benchmark-corpus-harness

Goal: add audio metadata corpus, expected transcript, WER, command accuracy,
CPU fixture smoke, and report/evidence output.

Status: complete. Added `docs/eval/asr-benchmark-corpus.fixture.json`,
`scripts/benchmark-asr-corpus.mjs`, generated fixture report/evidence, and
`smoke:asr-benchmark-harness`. GPU and microphone-corpus validation remain
future user/environment-dependent work.
