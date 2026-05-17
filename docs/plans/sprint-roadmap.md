# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: idle
> **Completed**: iter-35-sprint-01-real-use-feedback-reliability
> **Pending**: -
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration iter-35: Browser Action Real-Use Feedback Reliability

Status: complete.

Carryover: the latest direct widget test logs showed that Browser Action can
complete a user-visible task while eval/debug ledgers still disagree, manual
debug success notes can be written as negative semantic corrections, and
mutating Browser Perception observations can reach side-effect execution before
the page stabilizes.

### iter-35-sprint-01-real-use-feedback-reliability

Goal: add regression coverage and fixes for manual debug feedback outcome
classification, eval/debug request correlation, timezone-safe real-use audits,
and side-effect Browser Perception stabilization retry.

Status: complete. Added outcome classification for manual debug feedback,
prevented successful/UX-only debug notes from creating negative Semantic Memory
`avoid_target` edges, stored prompt request/message ids in Browser Action eval
metrics, made the real-use audit timezone-safe and request-id-first, and added
a Browser Perception retry path for side-effect observations that are still
mutating. Focused semantic-memory, Browser Perception stabilization,
real-use-regression, audit self-test, lint, and real session audit checks passed.
