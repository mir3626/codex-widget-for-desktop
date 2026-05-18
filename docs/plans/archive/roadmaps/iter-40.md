## Iteration iter-40: Daemon Auth Nonce CORS Hardening

Status: completed.

Carryover: the SUPER-YOLO runtime trust-boundary hardening closed forged
capability-job approval and permission-decision injection, but the local daemon
transport still needs a separate defense against malicious browser pages or
same-machine clients abusing the loopback HTTP/WS surface. This iteration keeps
the daemon loopback-only and does not replace Codex/OAuth auth; it adds local
client authentication, request replay protection, and narrowed CORS/Origin
behavior around sensitive daemon surfaces.

### iter-40-sprint-01-daemon-auth-nonce-cors-hardening

Goal: add regression-backed daemon transport hardening for sensitive HTTP and
WebSocket paths: local client token validation, per-request nonce/replay guard
for mutating HTTP routes, WebSocket Origin checks, and narrowed CORS responses
that continue to support trusted Tauri renderer/dev localhost, browser
extension/native-host, and Node smoke clients.

Acceptance:

- Sensitive HTTP mutations reject missing/wrong daemon auth tokens before route
  handling.
- Sensitive mutating HTTP requests require a fresh nonce and reject replay.
- WebSocket connections from untrusted browser origins are rejected before
  daemon message handling.
- Trusted local clients can still run existing terminal capability, Computer
  Use profile/session, browser bridge, renderer profile draft, and local smoke
  workflows.
- Wildcard CORS is removed from sensitive daemon paths; allowed origins are
  explicit localhost/Tauri/extension origins or absent native-client Origin.

Non-goals:

- No remote daemon exposure, cloud identity service, production signing, or
  official app-server client-tool contract work.
- No raw OAuth/Codex credential persistence in SQLite.

Completion:

- Added regression smoke coverage for malicious/trusted HTTP Origin, narrowed
  CORS, missing token rejection, nonce replay rejection, and WebSocket Origin
  and token behavior.
- Added daemon-local auth endpoints for renderer handshake and nonce minting.
- Removed wildcard CORS from sensitive daemon paths and preserved explicit
  trusted-Origin headers through JSON and artifact responses.
- Added HTTP mutation token+nonce checks for browser-origin sensitive routes
  while keeping no-Origin local Node/smoke clients and browser extension
  Origins compatible.
- Moved WebSocket upgrade to explicit Origin/token authorization before daemon
  message handling.
- Updated renderer WebSocket and daemon POST clients to use handshake and
  one-time nonce helpers with fake-daemon fallback for renderer smokes.

Verification:

- `npm run smoke:daemon-auth-boundary`
- `node scripts/smoke-renderer-computer-use-profile-draft.mjs`
- `npm run smoke:computer-use-credential-consent`
- `npm run smoke:terminal-capability`
- `npm run lint`
- `npm run smoke:browser-bridge`
- `npm run smoke:computer-use-one-time-profile`
