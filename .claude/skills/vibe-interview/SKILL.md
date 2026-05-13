---
name: vibe-interview
description: Native socratic interview runbook for `/vibe-init` Phase 3. The Orchestrator hosts the LLM internally and pipes structured prompts through `.vibe/harness/scripts/vibe-interview.mjs`.
---

## When To Invoke

Use this skill in `/vibe-init` Phase 3. It replaces the previous Ouroboros interview flow.

The sections below are mandatory and ordered. Codex wrapper injection follows
only explicit shard blocks, so every section shard must stay listed here.

<!-- BEGIN:VIBE-INTERVIEW:SECTION-SHARDS -->
- `.claude/skills/vibe-interview/sections/invocation-protocol.md`
- `.claude/skills/vibe-interview/sections/operating-modes.md`
- `.claude/skills/vibe-interview/sections/termination-consensus.md`
- `.claude/skills/vibe-interview/sections/output-artifacts.md`
<!-- END:VIBE-INTERVIEW:SECTION-SHARDS -->
