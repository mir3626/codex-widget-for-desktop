# Vibe Interview Section Sharding Safety

This document defines the guardrails for splitting
`.claude/skills/vibe-interview/SKILL.md` into section shards.

## Goal

Reduce `/vibe-interview` prompt size while preserving the exact Phase 3 native
interview contract: invocation order, Orchestrator-hosted LLM flow, PO-proxy
handling, uncertainty handling, termination, consensus, and product context
seed output.

## Safety Gate

Run this before and after any `vibe-interview` sharding change:

```bash
npm run vibe:interview-shard-audit
```

The same gate is wired into `vibe-preflight` when the shared `vibe-interview`
skill is present, and CI runs it before build/test.

The gate validates:

- `When To Invoke`, `Invocation Protocol`, `Operating Notes`, `PO-Proxy Mode`,
  `"I don't know" / "미정" Handling`, `Termination`, `Consensus Check`, and
  `Output Artifacts` each exist exactly once.
- The 12 numbered invocation protocol steps exist exactly once and appear in
  order.
- Critical flow signals remain present, including `--init`, `--set-domain`,
  `--continue`, `--record`, all consensus decisions, `phase: "done"`,
  `seedForProductMd`, the Orchestrator-hosted LLM rule, JSON retry rule,
  PO-proxy non-approval, deferred sub-fields, termination thresholds, consensus
  before context creation, and `docs/context/product.md` output.
- If section shard files exist under
  `.claude/skills/vibe-interview/sections/`, each file must be listed in the
  main skill shard block.
- Listed shard paths must be repository-root relative, stay under
  `.claude/skills/vibe-interview/sections/`, and must not contain `..`.

## Required Shard Block

The current shard block keeps only the high-level invocation trigger in the main
file and lists all execution sections in interview order:

```md
<!-- BEGIN:VIBE-INTERVIEW:SECTION-SHARDS -->
- `.claude/skills/vibe-interview/sections/invocation-protocol.md`
- `.claude/skills/vibe-interview/sections/operating-modes.md`
- `.claude/skills/vibe-interview/sections/termination-consensus.md`
- `.claude/skills/vibe-interview/sections/output-artifacts.md`
<!-- END:VIBE-INTERVIEW:SECTION-SHARDS -->
```

## Wrapper Injection Contract

The Codex wrapper follows explicit `*SHARDS` marker blocks in injected Markdown.
A prompt that references `.codex/skills/vibe-interview/SKILL.md` therefore
receives the Codex wrapper, shared `.claude` skill index, and all listed section
shards. Ordinary Markdown links are not recursively followed, so every section
shard must stay in the explicit block.

## Fail-Closed Rules

- Do not move invocation protocol steps into unlisted files.
- Do not duplicate required headings between the main skill and shards.
- Do not split the numbered invocation protocol unless the audit is updated to
  preserve exact step order across the new shard boundary.
- Do not widen wrapper injection to allow `..` paths. Use repository-root paths.
