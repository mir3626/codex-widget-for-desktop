# Semantic Memory Dogfood Evidence - 2026-05-09

## Summary

This deterministic dogfood run verifies the first Semantic Memory path:

- unresolved Browser Action target ambiguity is recorded with redacted utterance data
- clarification feedback creates typed memory graph edges
- ranker integration consumes an immutable MemoryReadSet with hashes
- memory contributes separate evidence axes instead of one opaque prior
- safety remains unchanged and target execution still requires fresh observed candidates

## Input Case

```text
개념글 눌러서 재밌어보이는 글 보여줘
```

The ambiguity is the universal duplicate-label class: a main filter/control candidate and a partial sidebar/content link candidate can share similar text.

## Evidence

- unresolved case id: `sem-unresolved-e0390f0c-303c-4ffd-ad67-5533ea418bc0`
- feedback id: `sem-feedback-2de399f7-d9d3-41ae-bf14-9c008076900c`
- memory read set id: `mem-read-h5f4e74c7117fb3c-h5733626e31f3d58`
- memory query hash: `h5f4e74c7117fb3c`
- memory result hash: `h5733626e31f3d58`
- memory edges: 6
- replay outcome: `act`
- selected hypothesis: `hyp-a2472cce`
- selected score bp: `8638`

## Safety Boundary

Semantic Memory did not select an executable target by itself. The replay path still used the current BrowserObservation fixture, Semantic Interface gates, pairwise margin, target fingerprint, and Browser Action-owned execution semantics.

## Supporting Asset

See `docs/reports/semantic-memory-dogfood-evidence-2026-05-09.json` for the redacted JSON evidence.
