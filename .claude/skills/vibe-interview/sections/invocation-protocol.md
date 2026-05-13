## Invocation Protocol

1. Ask the user for a one-liner prompt.
2. `node .vibe/harness/scripts/vibe-interview.mjs --init --prompt "<one-liner>" [--lang ko|en] [--max-rounds 30] [--output .vibe/interview-log/<session-id>.json]`
   Script stdout: `{ phase: "domain-inference", inferencePrompt: "<string>" }`.
3. Orchestrator internally evaluates `inferencePrompt` against its own LLM context. Produce `inferred_domain` as a 1-2 sentence string.
4. `node .vibe/harness/scripts/vibe-interview.mjs --set-domain --domain "<inferred_domain>"`
   Script stdout: `{ phase: "round", roundNumber: 1, dimension: { ... }, synthesizerPrompt: "<string>", priorCoverage: { ... } }`.
5. Orchestrator evaluates `synthesizerPrompt` internally and obtains 1-3 probing questions in the interview language.
6. Orchestrator asks the user, or answers on the user's behalf in PO-proxy mode. Collect the answer text verbatim.
7. `node .vibe/harness/scripts/vibe-interview.mjs --continue --answer "<text>"`
   Script stdout: `{ phase: "parse", answerParserPrompt: "<string>", pendingDimensionId: "<id>" }`.
8. Orchestrator evaluates `answerParserPrompt` internally and returns structured JSON attribution.
9. `node .vibe/harness/scripts/vibe-interview.mjs --record --attribution '<json>'`
   Script stdout returns either another `{ phase: "round", ... }` or `{ phase: "consensus", consensusPrompt, summary, consensus }`.
10. When `phase === "consensus"`, show the user the consensus summary before writing product context.
11. Record the outcome:
   - Approved: `node .vibe/harness/scripts/vibe-interview.mjs --consensus --decision approve --rationale "<short rationale>"`
   - Needs correction: `node .vibe/harness/scripts/vibe-interview.mjs --consensus --decision revise --correction "<user correction>"`
   - Proceed with unresolved items: `node .vibe/harness/scripts/vibe-interview.mjs --consensus --decision defer --rationale "<short rationale>"`
   - PO-proxy / no human confirmation: `node .vibe/harness/scripts/vibe-interview.mjs --consensus --decision proxy-unconfirmed --rationale "<short rationale>"`
12. Repeat consensus correction until stdout returns `{ phase: "done", summary: { ambiguity_final, dimensions, answers, rationale, consensus }, seedForProductMd: "<markdown>" }`.
