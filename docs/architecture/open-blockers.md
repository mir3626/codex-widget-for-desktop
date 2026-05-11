# Open Blockers

This file records items that should not be silently downgraded to complete.

## Browser Action App-Server Client Tool

- Status: `BLOCKED`
- Current path: daemon-owned simulated Browser Action tool runtime.
- Evidence: `src/daemon/agent-tools/appServerClientTool.ts` records the blocked
  app-server client-tool contract and safe fallback runtime.
- Required scope expansion: an official Codex app-server client-tool contract
  that defines schema advertisement, request ids, streaming tool-call events,
  user approval handoff, result/error delivery, persistence, and redaction.

## Windows UI Automation Browser Helper

- Status: `BLOCKED` for live executable browser chrome/restricted-page control.
- Current path: Browser Action has a mockable native helper JSON contract and
  browser-window diagnostics.
- Evidence: `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER` can point to a
  helper executable, and `npm run smoke:browser-action:native` covers the mock
  helper contract.
- Required scope expansion: signed Rust/.NET/native helper scoped to browser
  windows, permission prompts, file picker boundaries, cancellation, sensitive
  redaction, and daemon approval/audit integration.

## Restricted Browser Pages

- Status: intentional security boundary, not a bypass target.
- Current path: extension/CDP/native adapters report restricted or unsupported
  state and expose recovery text.
- Required scope expansion: only a bounded native helper may improve recovery
  for browser chrome or permission prompts; extension security restrictions must
  not be bypassed.

## Vision Context Real Local ASR

- Status: sidecar contract implemented; local model/runtime selection remains
  environment-owned.
- Current path: mock ASR for deterministic tests plus executable JSON sidecar
  support through `CODEX_WIDGET_ASR_SIDECAR_COMMAND`.
- Required scope expansion: choose and install the first local ASR runtime/model
  for dogfood, then provide a sidecar command that reads the documented JSON
  request from stdin and returns transcript JSON on stdout.

## Mascot Motion Assets

- Status: implementation path exists; final acceptance remains asset-quality
  dependent.
- Current path: renderer uses authored sprite-sheet assets and smoke coverage
  verifies frame progression.
- Required scope expansion: if product-owner dogfood still rejects current
  motion quality, regenerate or author improved pose/expression sheets rather
  than adding transform-only proxy motion.
