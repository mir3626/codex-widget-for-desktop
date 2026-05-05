# Token and Context Context

## Operating Notes

- Keep root memory short. Put durable product and architecture facts in `docs/context/*`.
- Use `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md` to preserve sprint continuity.
- Sprint prompts should include only the relevant context shard excerpts and the target checklist.

## Model/Cost Notes

- Mock streaming should remain available so UI and daemon work can proceed without model spend.
- Live model calls should be opt-in through OAuth proxy environment configuration.
- Provider additions should stream compact tool events rather than large raw dumps unless the user requests detail.
