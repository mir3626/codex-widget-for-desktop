# Windows Computer Use Daemon Foundation Completion Audit

Date: 2026-05-12
Scope: `docs/plans/windows-computer-use-daemon-foundation-handoff.md`
Result: PASS for the daemon foundation objective

## Objective Restatement

Build the local daemon foundation for Windows Codex computer use: durable
capability jobs, bounded helpers, resource control, common events, approval and
safety, context leases, verification/evidence, recovery/shutdown behavior, and
incremental migration paths for screen/OCR, browser, desktop UI Automation,
terminal, and agent-tool work. The daemon remains the coordinator; helpers do
not call each other and no external broker is introduced.

## Prompt-To-Artifact Checklist

| Requirement | Evidence |
| --- | --- |
| Durable capability queue and transaction store | `src/daemon/storage/migrations/v3CapabilityJobs.ts`; `src/daemon/storage/capabilityJobs.ts`; `src/daemon/capability-runtime/durableQueue.ts`; `npm run smoke:storage`; `npm run smoke:capability-runtime` |
| `capability_jobs`, `capability_job_events`, `capability_locks`, `capability_resources` | v3 migration creates all four tables and indexes; storage smoke reports schema 3 |
| Completed/pending job diagnostics | `src/daemon/server/http/routes/capabilityRoutes.ts`; `GET /capabilities/jobs` and `GET /capabilities/jobs/:id`; lock/resource diagnostics included |
| Safe startup reconciliation | `reconcileCapabilityJobsOnStartup`; `CapabilityRuntime.reconcileStartup`; smoke covers running fail-closed and read-only queued resume |
| Shutdown cancellation | `CapabilityRuntime.shutdown`; `markActiveCapabilityJobsForShutdown`; `browserChromeCommands.cancelAll`; smoke covers queued shutdown cancellation |
| Resource manager/blob offload | `src/daemon/capability-runtime/resourceManager.ts`; smoke stores evidence resources, releases active bytes, and cleans ephemeral resources |
| Helper supervision | `src/daemon/capability-runtime/helperSupervisor.ts`; timeout, abort, process-tree kill, stdout/stderr caps, invalid JSON and non-zero errors; smoke covers timeout and cancellation |
| Concurrency scheduler | `src/daemon/capability-runtime/scheduler.ts`; runtime priority dispatch; smoke covers same-lease serialization and interactive-before-background ordering |
| Durable lock diagnostics | `capability_locks` storage APIs; runtime lock acquire/release; HTTP diagnostics; smoke asserts lock persistence and release |
| Cancellation token and terminal events | `src/daemon/capability-runtime/cancellation.ts`; runtime emits one final state; smoke covers cancellation and helper kill path |
| Lease invalidation | runtime validates `contextLease`/`lease` expiry and lease-id mismatch before execution and before verification; smoke covers expired lease blocking |
| Common event contract | `src/shared/protocol/capability.ts`; `src/daemon/capability-runtime/eventMapper.ts`; WS handler `capability.start/cancel/approve/list` |
| Approval and safety policy | `src/daemon/capability-runtime/safety.ts`; side effects default to `awaiting_approval`; approval deadline expiry covered by smoke |
| Saved policy expiry/revocation | Existing Browser Action policy path: `src/daemon/browser-action/permissionPolicy/*`, `src/daemon/server/browser-action/messages/policyMessages.ts`, shared policy protocol includes `expiresAt` and `revokedAt` |
| Secret persistence boundary | runtime redacts persisted capability input recursively and rejects credential-like terminal commands before persistence; Browser Action mirror uses `redactBrowserActionSecret`; Browser Chrome payload sanitizer remains in place |
| Screen path through runtime | `provider.captureScreen` routes through `screen_observe` capability in `src/daemon/server/vision-context/screenCapture.ts` and daemon `screen_observe` handler |
| OCR path through runtime | daemon `ocr` handler in `src/daemon/server.ts`; `npm run smoke:ocr-capability` |
| Native desktop/browser path through runtime | daemon `desktop_action` handler; daemon `browser_chrome` handler; `npm run smoke:browser-chrome-capability`; native helper smokes in `smoke:all` |
| Terminal path through runtime | daemon `terminal` handler; `npm run smoke:terminal-capability` |
| Agent-tool boundary through runtime | daemon `agent_tool` handler records simulated daemon boundary and app-server client-tool BLOCKED contract; `npm run smoke:agent-tool-capability` |
| Browser Action migration compatibility | `src/daemon/server/browser-action/capabilityMirror.ts` and Browser Action message/prompt integrations; `npm run smoke:browser-action`; `npm run smoke:browser-action:e2e-control` |
| Browser chrome/bookmarks | `src/daemon/browser-chrome/commandBridge.ts`; extension `bridge/browser-chrome.js`; manifest `bookmarks` permission; store/privacy/review docs; browser chrome smoke |
| Prompt waiter cancellation | Browser Action command waiters resolve with `undefined` during daemon clear/shutdown, allowing prompt continuation to enter cancellation/failure path |
| Verification and evidence | `src/daemon/capability-runtime/verification.ts`; capability verification summaries attached to job output; expected desktop effects fail without explicit effect verification; ledger activity written for final capability states |
| Activity/ledger visibility | runtime records final capability activity for jobs with `sessionId`; smoke asserts ledger activity |
| Public API and migration plan | WS protocol and HTTP routes implemented; `docs/plans/README.md` links the handoff; `scripts/smoke-all.mjs` includes capability smokes |
| Required verification plan | Passed focused commands and final `npm run smoke:all`; `git diff --check`; strict UTF-8 and replacement-character scans |

## Verification Commands

Passed during closure:

- `npm run build:daemon`
- `npm run lint`
- `npm run smoke:capability-runtime`
- `npm run smoke:browser-chrome-capability`
- `npm run smoke:ocr-capability`
- `npm run smoke:terminal-capability`
- `npm run smoke:agent-tool-capability`
- `npm run smoke:browser-action`
- `npm run smoke:storage`
- `npm run smoke:extension`
- `npm run smoke:browser-store`
- `npm run smoke:browser-action:e2e-control`
- `npm run smoke:architecture-foundations`
- `npm run smoke:all`
- `git diff --check`
- strict UTF-8 decode scan for touched text files
- replacement-character scan for touched text files
- `.cs` touched-file check
- `npm run vibe:checkpoint`

## Residual Risk

The daemon foundation is complete. Remaining work is live product hardening, not
missing foundation code: dogfood high-risk Windows settings workflows against
real OS surfaces, add release signing credentials for native helpers, and tune
future adapter-specific verification once concrete settings/app workflows are
introduced.
