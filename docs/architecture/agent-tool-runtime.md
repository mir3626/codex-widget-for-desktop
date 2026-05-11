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

