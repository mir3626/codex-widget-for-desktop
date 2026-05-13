---
name: vibe-review
description: Template/harness review for vibe-doctor process health
---

`/vibe-review` is a **vibe-doctor template/harness review**, not a normal product code review.

Use it to review the orchestration harness, template rules, sync behavior, agent contracts, and process health. If the user asks for "code review" in a downstream product repo without naming `/vibe-review`, review project-owned product code directly and do not run this workflow unless they explicitly ask for template/harness/process review.

The sections below are mandatory and ordered. Codex wrapper injection follows
only explicit shard blocks, so every section shard must stay listed here.

<!-- BEGIN:VIBE-REVIEW:SECTION-SHARDS -->
- `.claude/skills/vibe-review/sections/protocol.md`
- `.claude/skills/vibe-review/sections/rubric-and-findings.md`
- `.claude/skills/vibe-review/sections/automatic-checks.md`
- `.claude/skills/vibe-review/sections/report-shape.md`
<!-- END:VIBE-REVIEW:SECTION-SHARDS -->
