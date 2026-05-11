# Agent Tool Runtime Boundary

## Purpose

The product currently uses daemon-owned simulated tool paths for Browser Action
because a stable Codex app-server custom client-tool contract is not guaranteed.
That is the correct runtime choice, but it needs a stable abstraction so future
app-server tools can be adopted without rewriting Browser Action.

## Runtime Variants

- Simulated daemon tool: deterministic daemon path used today.
- App-server client tool: future stable app-server tool request/response path.
- Direct UI command: user-triggered request from renderer controls.

All variants must normalize into the same capability transaction shape.

## Current App-Server Tool Status

Browser Action's app-server client-tool path is explicitly `BLOCKED` until the
app-server exposes a stable custom tool contract. The product must keep using
the daemon-simulated tool runtime rather than prompt-only claims. The current
blocked contract lives in `src/daemon/agent-tools/appServerClientTool.ts` and is
covered by `npm run smoke:architecture-foundations`.

## Contract

Tool runtime adapters should expose:

- tool id and capability kind
- input schema and redaction policy
- request id and session id
- approval and clarification hooks
- result, error, and audit event output
- deterministic fake/smoke runner

The agent/tool boundary must never become prompt-only claims when protocol or
daemon simulation can prove behavior.
