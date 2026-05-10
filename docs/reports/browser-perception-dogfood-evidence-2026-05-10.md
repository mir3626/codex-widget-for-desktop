# Browser Perception Dogfood Evidence

Generated: 2026-05-10T05:56:57.054Z

## Scenario

A prompt-driven Browser Action starts without a pre-existing manual snapshot. Browser Perception queues `observe_now`, receives ack/result, then continues a generic filter -> representative content flow.

## Result

- Status: pass
- Final answer avoided retry-later text: true
- Supporting JSON: docs\reports\assets\browser-perception-2026-05-10\evidence.json

## Steps

- heartbeat: {"step":"heartbeat","url":"https://example.test/board/lists?id=topic","permission":"allowed"}
- request_scoped_observe: {"step":"request_scoped_observe","commandId":"browser-observe-1552f025-ca31-40da-b310-bcf199697f84","progressStatus":"browser_perception_waiting","route":"https://example.test/board/lists?id=topic","result":"ready"}
- filter_click: {"step":"filter_click","requestId":"browser-command-83dcfb31-588e-4bdc-ae0b-f220921bb59d","expectedSource":"https://example.test/board/lists?id=topic","target":"개념글","afterUrl":"https://example.test/board/lists?id=topic&exception_mode=recommend"}
- representative_content_click: {"step":"representative_content_click","requestId":"browser-command-13dc54ff-d61f-4562-9d58-47608c840e23","expectedSource":"https://example.test/board/lists?id=topic&exception_mode=recommend","target":"재밌어보이는 실험 글","afterUrl":"https://example.test/board/view?id=topic&no=123","queuedEvent":"plan_paused_for_extension"}