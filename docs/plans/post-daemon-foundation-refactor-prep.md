# Post Daemon Foundation Refactor Prep

Status: ready for next implementation pass
Owner: Codex
Date: 2026-05-12

## Objective

Prepare a low-risk refactor pass after the Windows computer-use daemon
foundation, Capability Jobs panel, and safe dogfood baseline landed. The next
pass should reduce coupling and file size without changing behavior.

The refactor should be mechanical and verification-heavy. Do not expand Windows
automation reach, signing policy, or live OS mutation scope inside the same
refactor.

## Current Pressure Points

| Area | Current signal | Refactor intent |
| --- | --- | --- |
| `src/daemon/server.ts` | about 596 lines after capability handler registration | Move capability registration into a daemon runtime module and leave `server.ts` as composition/bootstrap |
| `src/renderer/styles/composer-activity-mascot.css` | about 736 lines after Activity/Capability panel styles | Split activity/capability styles into a dedicated stylesheet import |
| `src/renderer/WidgetRuntime.tsx` | about 655 lines, still under architecture budget | Extract capability job controller hook if more renderer capability controls are added |
| Capability dogfood scripts | safe baseline is implemented in one collector | Keep collector scenario helpers small before adding live/manual-gated OS mutation |

## Recommended Sequence

### 1. Extract Daemon Capability Registration

Target files:

- add `src/daemon/capabilities/registerCapabilities.ts`
- move `capabilityRuntime.register(...)` blocks out of `src/daemon/server.ts`
- keep helper scripts/constants near the registration module unless reused

Boundary:

- no protocol/schema changes
- no behavior changes
- no new capability kinds
- `server.ts` should only create services, call registration, wire HTTP/WS, and own shutdown

Verification:

- `npm run build:daemon`
- `npm run smoke:capability-runtime`
- `npm run smoke:browser-chrome-capability`
- `npm run smoke:ocr-capability`
- `npm run smoke:terminal-capability`
- `npm run smoke:agent-tool-capability`
- `npm run smoke:screen`

### 2. Split Activity/Capability Renderer Styles

Target files:

- add `src/renderer/styles/activity-capability.css`
- move `.log-*`, `.activity-*`, `.provider-history-*`, `.capability-*` blocks out of `composer-activity-mascot.css`
- update `src/renderer/styles.css` import order so Activity/Capability styles still load before animation overrides

Boundary:

- no DOM structure changes
- no new layout behavior
- no visual redesign

Verification:

- `npm run lint`
- `npm run build:renderer`
- quick widget check: Activity details opens, Capability Jobs section scrolls, copy/refresh buttons remain clickable

### 3. Optional Renderer Capability Hook

Only do this if the Capability Jobs panel grows beyond the current MVP.

Target files:

- add `src/renderer/hooks/useCapabilityJobsController.ts`
- move `capabilityJobs`, refresh, approve, cancel state/actions out of `WidgetRuntime.tsx`

Boundary:

- keep WebSocket event state updates in the existing event handler path
- avoid a second HTTP polling loop unless live events prove insufficient

Verification:

- `npm run lint`
- `npm run build:renderer`
- seed an `ocr` capability job against the live daemon and confirm the panel updates

### 4. Keep Dogfood Expansion Separate

After refactor is green, expand dogfood in a separate change:

- real Browser Bridge bookmark CRUD against a dedicated browser profile
- manual-gated `settings.theme.toggle.reversible`
- Notepad temp-file workflow
- Calculator result workflow

Each expansion should write evidence under `docs/reports/` and keep rollback
proof in the report.

## Acceptance Criteria

- No user-visible behavior change except unchanged panel availability.
- `npm run smoke:all` remains green.
- `git diff --check` has no new whitespace errors; existing CRLF normalization
  warnings are acceptable until the repo normalizes those files.
- UTF-8 strict decode and replacement-character scans pass for touched files.
- `.vibe/agent/handoff.md` and `.vibe/agent/session-log.md` are updated before
  final checkpoint.

## Risks

- Moving capability registration can accidentally change startup ordering. Keep
  `capabilityRuntime.reconcileStartup()` after HTTP server listen.
- `screen_observe` depends on the daemon port; pass a lazy `getDaemonPort`
  function into the registration module rather than capturing `0`.
- CSS extraction can alter cascade order. Move blocks without selector changes
  and keep the import near the original `composer-activity-mascot.css` import.
- Dogfood scripts should not be expanded into live OS mutation during the
  refactor pass.
