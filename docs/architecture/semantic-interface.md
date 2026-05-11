# Semantic Interface Architecture

## Purpose

Semantic Interface is the source-agnostic interpretation layer. It should not be
Browser Action specific. Browser, Vision, Terminal, Workspace, and future
Desktop contexts should all project evidence into a shared semantic snapshot and
candidate model.

## Inputs

- Browser View Graph / Prepared Browser View Context
- Vision TaskCapsule and visual references
- Terminal session state and command/output summaries
- Workspace/project evidence
- Future Desktop UI Graph evidence
- Redacted Semantic Memory read sets

## Rules

- Semantic Memory is advisory only.
- Memory cannot override freshness, visibility, safety, approval, or current
  evidence.
- Typed abstention is valid and preferable to low-confidence side effects.
- Deterministic scoring should preserve multidimensional evidence axes instead
  of collapsing prematurely into one opaque score.
- Durable traces store metadata, hashes, reason codes, scores, and redacted
  labels only.

## Current Code Boundary

- `src/daemon/semantic-interface/` owns hypotheses, ranking, traces, ontology,
  transition grammar, operating profiles, and memory features.
- `src/daemon/semantic-interface/adapters/` projects feature-specific evidence
  into `SemanticSnapshot`.
- `preparedContextToSemanticSnapshot()` provides the first generic bridge from
  shared prepared contexts to semantic evidence.

## Target Direction

Each capability should publish:

- prepared context identity
- semantic evidence packets
- candidate proposals
- safety hints
- verification feedback
- redacted correction/memory feedback

The semantic layer ranks and explains interpretations; capability transactions
own gating, binding, execution, and verification.

