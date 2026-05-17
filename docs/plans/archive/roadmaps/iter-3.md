## Iteration iter-3: Durable Product State

Carryover: Iteration 2 made the widget viable for dogfooding with a daemon-owned `codex app-server`, provider ingress, PTY runtime, release/install gates, and renderer chat hardening. The next iteration shifts the product from reload-tolerant UI state to durable local-first product state: sessions, tabs, branches, trash, artifacts, provider snapshots, activity logs, and extension-ready theme/mascot/module metadata should be owned by the daemon and backed by SQLite plus a blob store.

### iter-3-sprint-01-storage-foundation

Goal: add a daemon-owned SQLite storage foundation and migration layer for sessions, messages, runtime metadata, provider snapshots, artifacts, activity, preferences, themes, mascots, and future modules.

Dependencies: `src/daemon/server.ts`, shared renderer-daemon protocol, Tauri app data path decisions, current localStorage keys.

Expected scope: storage adapter, migrations, app data directory and blob store path resolution, schema for core entities, SQLite WAL/foreign-key setup, no-secret persistence boundary, smoke coverage for migration/open/health behavior.

Status: implemented with `src/daemon/storage/*`, daemon `/storage/health`, runtime storage diagnostics, Tauri `CODEX_WIDGET_APP_DATA_DIR` propagation, `npm run smoke:storage`, and `smoke:all` coverage. The first migration creates core durable product-state tables, seeds the default dog mascot preset, keeps large blobs out of SQLite, and rejects secret-like app setting keys.

### iter-3-sprint-02-session-tabs-trash

Goal: replace single visible chat persistence with durable session, internal tab, branch, restore, and trash semantics.

Dependencies: storage foundation, current `session.reset`, `session.branch`, reconnect replay, app-server rollback behavior.

Expected scope: session/tab protocol, renderer tab UI, app restart session restore, branch-to-new-session behavior, session trash/restore, per-session model/reasoning/mode state, compatibility migration from existing localStorage chat where practical.

Status: implemented first durable slice with shared `session.snapshot`/create/open/trash/restore/branch protocol, daemon SQLite session/message persistence, renderer internal session tabs, New chat durable session creation, branch-to-new-tab seeded with the selected exchange, restorable session trash, and per-session model/reasoning/mode restoration. Smoke coverage now exercises storage session prepare/complete/branch/trash/restore and daemon branch snapshot replay. Remaining risk: persisted visible messages restore across app restart, but hidden Codex app-server thread rebinding per restored/switched session is not durable yet and should be handled in a later runtime/session sprint.

### iter-3-sprint-03-artifact-activity-ledger

Goal: track files and secondary outputs created, modified, or deleted during Agent work, and expose the same artifact viewer from chat and trashed sessions.

Dependencies: storage foundation, app-server file-change/tool events, blob store, renderer markdown/action surfaces.

Expected scope: artifact/version/file/blob tables, before/after/diff preservation for text files, full snapshot preservation for binary or generated files, artifact accordion UI, click-to-open behavior, activity one-line summary plus detail drawer, retention and size-limit defaults.

Status: implemented with daemon-owned artifact/activity ledger APIs on top of the SQLite/blob storage foundation. Tool output is captured into file-backed blobs, app-server file-change events are recorded as generated/modified/deleted artifacts with before/after snapshots and text diffs when available, `ledger.snapshot`/`ledger.refresh`/`artifact.open` protocol messages expose the ledger to the renderer, and the chat timeline plus session trash popover reuse the artifact accordion viewer. Activity now has a one-line footer summary plus a detail popover backed by daemon activity records. Smoke coverage exercises storage artifact persistence/open-path resolution, daemon tool-output ledger recording, and renderer trash artifact viewing.

### iter-3-sprint-04-vision-streaming-and-ux-foundation

Goal: evolve Vision and desktop UX foundations for real dogfooding: choose WebM recording or Agent screen streaming, preserve recording metadata, prepare non-persistent live screen-stream sessions, and polish status/mascot/activity affordances.

Dependencies: Vision provider snapshot/crop/diff/OCR path, storage foundation, activity log, renderer provider menus.

Expected scope: Vision popup menu for record vs stream, WebM-first screen recording path with metadata/blob references, Agent screen-stream metadata without mandatory video file storage, CPU/memory guardrails, default dog mascot preset metadata, status-aware mascot hooks, UI review pass using taste-skill guidance.

Status: implemented as the first Vision streaming/recording UX foundation. Vision mode now exposes a compact popup menu for snapshot capture, WebM recording, and Agent screen share. WebM recording uses browser display capture plus `MediaRecorder`, sends completion metadata to the daemon, and the daemon stores recording metadata in `vision_streams` with the video blob in the file-backed blob store. Agent screen stream starts a non-recording display-capture session, records metadata only, and sends low-frequency JPEG frames to the daemon's existing Vision snapshot endpoint so later Agent turns can consume live screen context without persisting a video file. Guardrails include local and daemon ingest limits, two-minute auto-stop, 1 fps stream cadence, and metadata-only retention for Agent streams. The mascot now reflects offline/working/recording/streaming states through lightweight CSS animation, and smoke coverage exercises storage metadata, daemon start/stop/recording completion, renderer menu interactions, and the full `smoke:all` gate.
