# Research Computer-Use Scenario Evidence - 2026-05-14

## Scope

These scenarios exercise the research-driven performance architecture across
safe, realistic computer-use workflows. They avoid real destructive OS/browser
mutation and use local fixtures where needed, while still running the daemon
storage, capability runtime, perception, ASR, failure memory, ROI cascade, and
DAG code paths.

- Scenario catalog: `docs/dogfood/research-computer-use-scenarios-2026-05-14.json`
- JSON evidence: `docs/reports/assets/research-computer-use-scenarios-2026-05-14/evidence.json`
- Storage schema: `4`

## Scenario Results

| Scenario | Surface | Risk | Status | Modalities | Coverage |
| --- | --- | --- | --- | --- | --- |
| `browser.search.asr.perception` | Browser | `side_effect` | passed | browser, asr, vision | asr_decode, perception_graph_target, roi_cascade, browser_action_capability |
| `browser.bookmark.open.approval` | Browser Chrome | `reversible_side_effect` | passed | browser | bookmark_list, bookmark_open |
| `windows.settings.observe.high_risk_reject` | Windows Settings | `high_risk` | passed | windows, vision | desktop_observe, high_risk_threshold, failure_memory |
| `terminal.safe_command.credential_reject` | Terminal | `credential_sensitive` | passed | terminal | terminal_safe_command, credential_rejection |
| `cross_app.dag.observe_plan_verify` | Cross-app | `side_effect` | passed | cross_app, vision, browser, terminal | dag_nodes |

## Acceptance

- allScenariosPassed: `true`
- evalRunsRecorded: `true`
- modalitiesCovered: `asr, browser, cross_app, terminal, vision, windows`
- perceptionGraphsRecorded: `true`
- evalResourcesRecorded: `true`
- failureMemoryRecorded: `true`
- dagRunsRecorded: `true`
- taskSuccessRate: `1`
- p95LatencyTracked: `true`
- p95PerceptionLatencyTracked: `true`
- proofRate: `1`

## Metrics

- Runs: `6`
- Task success rate: `1.000`
- Proof rate: `1.000`
- p95 latency ms: `256`
- p95 perception latency ms: `58`
- Average action count: `6.67`

## Remaining External Deferrals

- Official app-server client-tool contract
- Production signing certificate/service
- GPU ASR validation
- Human microphone corpus benchmark
- ASR fine-tuning/LoRA
