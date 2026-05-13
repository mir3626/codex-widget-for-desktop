## Operating Notes

- The Orchestrator is the LLM host. There is no external model call, MCP server, or sidecar service in this flow.
- Keep the synthesizer output JSON and parser output JSON in the Orchestrator context. The engine depends on the structured handoff, and the final transcript rationale should reference the same question set.
- If the synthesizer output fails JSON parsing, retry once with an extra postscript that says the output MUST be parseable JSON and MUST not contain code fences.

## PO-Proxy Mode

- When the user delegates or says "알아서", the Orchestrator may answer on the user's behalf under the normal Phase 0-1 PO-proxy rules.
- Answers still flow through the exact same `--continue` and `--record` pipe.
- The final consensus step MUST NOT be marked `approved` unless a human actually confirms it. Use `--consensus --decision proxy-unconfirmed` when the Orchestrator finalizes as PO-proxy.
- Capture the rationale once at the end in `session-log.md` under `[decision][phase3-po-proxy]`.

## "I don't know" / "미정" Handling

- Pass the answer text exactly as spoken or inferred.
- The parser prompt maps uncertainty to `deferred` sub-fields.
- The engine does not stop on deferred answers. It keeps probing adjacent dimensions until termination criteria are met.
