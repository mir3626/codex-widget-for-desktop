## Iteration iter-27: Browser Action Latency Optimization

Status: complete.

Carryover: Manual Browser Action testing showed that the architecture had become
safer and more reliable, but request-scoped perception, extension wake/poll,
DOM snapshot stabilization, post-action verification, and ledger persistence
could still add unnecessary latency for simple browser actions.

### iter-27-sprint-01-fast-paths-hot-context-and-latency-trace

Goal: execute the Browser Action speed roadmap without weakening safety:
measure the actual prompt/action phases, avoid unnecessary DOM observes for
targetless navigation, keep prepared context hot, reduce extension wake/poll
delay, shorten action-specific post-observe waits, and prevent background
perception from flooding durable ledger state.

Status: complete. Prompt transactions now record detailed timing marks;
targetless `navigate`/`back`/`forward`/`reload` can use lightweight active-tab
metadata instead of request-time DOM observe; Browser Bridge action/observe
results include redacted latency traces; tab navigation uses lightweight before
snapshots; extension wake retries and daemon WebSocket poll waits are shorter;
background observe defaults are hotter; normal auto-observe refresh is
command-first instead of legacy snapshot-first; and background observe results
refresh in-memory prepared context without persisting every observation to
provider history. Focused and aggregate Browser Action, Browser Perception,
Bridge, Extension, DOM, transaction, app-server, and adapter smokes passed.
