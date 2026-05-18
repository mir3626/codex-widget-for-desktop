## Iteration iter-41: Post-Review Local Boundary Hardening

Status: completed.

Carryover: follow-up code review found five remaining local-boundary issues
after the daemon auth, Browser Bridge, and SUPER-YOLO work. This iteration uses
one `$vibe-iterate` item per finding and keeps the implementation focused on
server-owned trust decisions rather than widening user-facing autonomy.

### iter-41-sprint-01-daemon-auth-bootstrap-boundary

Goal: prevent daemon auth bootstrap from issuing tokens to no-Origin native
clients or arbitrary loopback browser origins.

Completion:

- `/daemon/auth/handshake` now only serves widget bootstrap origins: Tauri,
  `tauri.localhost`, dev `127.0.0.1/localhost/[::1]:5173`, or explicit
  `CODEX_WIDGET_DAEMON_TRUSTED_ORIGINS`.
- Non-extension browser-origin WebSocket upgrades require the daemon token, while
  existing native no-Origin smoke/local clients remain compatible.
- Sensitive browser-origin HTTP mutations still require daemon token/nonce; the
  auth bootstrap token itself is no longer available to no-Origin callers.

### iter-41-sprint-02-browser-bridge-extension-origin-required

Goal: ensure Browser Bridge extension routes cannot be driven by no-Origin
same-machine clients.

Completion:

- Browser Bridge heartbeat, status, poll, ack, action-ack, observe-result,
  result, and browser-chrome-result routes require an extension `Origin`.
- Heartbeat still enrolls and validates `extensionRuntimeId` against the
  extension Origin, and command routes require the enrolled Origin.
- Auth boundary smoke now proves no-Origin extension status/poll are rejected.

### iter-41-sprint-03-browser-action-approval-server-owned

Goal: remove external client control over Browser Action approval state.

Completion:

- `browserAction.execute` WebSocket messages ignore client-provided
  `approved: true`.
- Computer Session browser-action operations ignore client-provided
  `approved: true`; only stored approval records can continue an action.
- Browser Action smoke now proves a forged `approved: true` destructive click
  still produces an approval request and can be declined.

### iter-41-sprint-04-evaluate-credential-unlock-server-owned

Goal: stop clients from setting evaluate credential/cookie/CAPTCHA unlock flags
directly and make the guard fail closed for arbitrary code.

Completion:

- Browser Action plan/execute entrypoints strip client-provided
  `allowCredentialAccess`.
- Computer Session evaluate actions only receive `allowCredentialAccess` from
  the active server-side permission profile unlock.
- Evaluate code without the unlock is limited to a small read-only whitelist;
  arbitrary snippets and obfuscated cookie access fail closed.

### iter-41-sprint-05-toolsmith-network-guard-coverage

Goal: extend generated Node tool network guards beyond fetch/http/https/net/tls.

Completion:

- Toolsmith generated-tool preload guards now patch DNS callback APIs, DNS
  promises APIs, UDP sockets, and `http2.connect`.
- The npm dependency prepare smoke now verifies forbidden fetch, DNS, UDP, and
  http2 attempts are all blocked.

### Architecture Gate Follow-Up

Final aggregate verification exposed a source-size budget failure in
`src/daemon/browser-perception/service.ts` (716/700). The service was reduced
below budget by moving pure observe helpers and the required request type into
`src/daemon/browser-perception/observeUtils.ts`.

Verification:

- `npm run build:daemon`
- `npm run smoke:daemon-auth-boundary`
- `npm run smoke:browser-action`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:browser-action:evaluate`
- `npm run smoke:browser-bridge`
- `npm run smoke:browser-perception:extension-command`
- `npm run smoke:browser-chrome-capability`
- `npm run smoke:computer-use-session-http`
- `npm run smoke:computer-use-browser-chrome`
- `npm run smoke:scoped-autonomy-npm-dependency-prepare`
- `npm run lint`
- `npm run smoke:architecture-foundations`
- `npm run smoke:all`
