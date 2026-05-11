# Prepared Context Architecture

## Purpose

Prepared context exists to prevent slow and stale prompt-time snapshots. The
daemon should maintain or request fresh context before planning, then bind every
side-effect action to a context identity and revision.

## Shared Context Identity

Every prepared context should provide:

- `surface`: browser page, screen, terminal, workspace, or desktop
- `sourceId`: adapter/provider identity
- `surfaceId`: tab, window, terminal session, screen, or workspace identity
- `url`, `routeKey`, `title`, or equivalent location metadata when available
- `revision`: stable view revision
- `mutationRevision`: dynamic content revision when available
- `digest`: graph or summary digest
- `capturedAt`, `updatedAt`, `expiresAt`
- `freshness` and `stability`
- redaction summary

## Lease Rules

- Read-only actions may proceed with explicit `settling_ready` diagnostics.
- Side-effect actions require a fresh/stable lease.
- A lease is invalidated by incompatible source, route, view revision, mutation
  revision, graph digest, cancellation, or expiry.
- Same-tab route/query transitions should be treated by identity/revision, not
  raw URL equality alone.

## Browser Implementation

Browser Perception currently implements the first complete prepared-context
store. Browser View Graph v2 is the prepared browser evidence graph consumed by
Browser Action and Semantic Interface.

## Generalization Target

Move common prepared-context identity, freshness, stability, lease, redaction,
and diagnostics helpers into `src/daemon/prepared-context/`, then let Browser
Perception implement the browser-specific adapter.

