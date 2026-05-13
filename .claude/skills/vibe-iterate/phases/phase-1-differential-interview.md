# vibe-iterate Phase 1 - Differential Interview

Run:

```bash
node .vibe/harness/scripts/vibe-interview.mjs --mode iterate --carryover <prior-iter-id> --output .vibe/interview-log/iter-<N>.json
```

Build the carryover seed from previous unresolved items, confirmed decisions,
and new user requests. Inject that seed into the synthesizer prompt so the
interview deepens the prior plan without contradicting it. If `--mode iterate`
runs without a carryover seed, start the iteration with empty carryover; this is
equivalent to a fresh restart.
