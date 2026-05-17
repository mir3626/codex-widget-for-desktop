## Iteration iter-4: Backlog Closure And Dogfood Polish

Carryover: The product owner clarified that the `/goal` directive means repeated `/vibe-iterate` execution until the categorized product backlog is actually closed, not stopping after the Iteration 3 sprint set. Iteration 3 established daemon-owned SQLite, session tabs/trash, artifact/activity ledger, and Vision recording/streaming foundations. Iteration 4 continues from the remaining dogfooding backlog: UI/interaction polish, Agent awareness of widget capabilities, richer artifacts/version UX, interactive Vision/voice foundations, PTY popup behavior, mascot/persona behavior, and durable runtime/provider history gaps.

### iter-4-sprint-01-ui-polish-and-tab-interactions

Goal: close the immediately visible dogfooding UI defects and tab/session affordance gaps before deeper runtime work.

Dependencies: renderer chat/session tabs, durable session state, existing resize handles, More action menu, model/reason controls, `smoke:renderer-chat`.

Expected scope: widen resize hit areas without visual clutter, fix Reason select minimum-width overlap, set user bubble radius to 12px, audit More action popup top-right alignment, add branch-to-new-session toast, improve Chrome-like internal tab behavior, animate per-session model/reason changes with a restrained gradient border, and run a taste-skill UI review pass.

Status: implemented. The renderer now has wider window and prompt resize hit areas, a safer minimum-width model/reason layout, 12px user message bubbles, polished active session tabs, branch-to-new-session toast feedback, and a restrained model/reason pulse when the active session changes. Renderer smoke coverage now checks minimum-width controls, resize hitbox sizes, user bubble radius, More menu top-right alignment, branch toast, session-control pulse, and existing prompt/table/terminal layout invariants.

### iter-4-sprint-02-widget-context-agent-awareness

Goal: make Agent conversations aware of the widget's own UI, modes, settings, providers, and limitations so questions like "what does the PTY button do?" receive correct contextual answers.

Dependencies: daemon app-server bridge, provider registry, settings/model state, shared prompt/context helpers.

Expected scope: widget capability/context snapshot owned by the daemon, safe developer-context injection for app-server turns, renderer-visible help metadata where useful, and smoke coverage proving Agent prompts receive current mode/provider/control context without exposing credentials or unrelated repo history.

Status: implemented. The daemon now builds a compact `Codex Widget desktop context` snapshot per Agent turn, including current mode, model/reasoning, sanitized auth state, mode/provider status, session/artifact/activity controls, Vision/DOM/PTY use cases, and source/secret safety boundaries. App-server and exec turns receive this as a dedicated context section, OAuth proxy payloads receive `widgetContext`/`widget_context`, and fake app-server smoke coverage verifies a PTY button question receives the widget context in the turn input.

### iter-4-sprint-03-artifact-rendering-and-version-browser

Goal: turn the artifact ledger from metadata into a usable artifact surface in chat and trash.

Dependencies: SQLite/blob storage, artifact/activity ledger, `artifact.open`, chat markdown/code rendering, trash popover.

Expected scope: inline rendering for generated images/documents/scripts where practical, file icons/thumbnails and full filenames, version accordion for created/modified/deleted file groups, restore/open flows from chat and trash, artifact retention metadata, and Python-generated output handling.

Status: implemented. Artifact files now expose current-version metadata plus bounded text/image previews from the daemon-owned blob store, and the renderer shows file type icons, full filename/meta rows, inline preview cards, and version accordions from both the active chat artifact surface and the session trash artifact viewer. `artifact.open` accepts an optional version id so older snapshots can be opened explicitly. Storage smoke verifies before/after/diff availability, preview content, and versioned open-path resolution; renderer smoke verifies trash-session preview rendering and versioned open requests.

### iter-4-sprint-04-vision-voice-interactive-loop

Goal: evolve Vision from one-shot capture/recording into an interactive screen-sharing foundation suitable for later voice-driven sessions.

Dependencies: Vision popup, WebM recording, Agent screen stream, provider snapshot ingress, app-server image input, storage metadata.

Expected scope: clearer popup choice between video recording and Agent screen streaming, live stream cadence/resource controls, user-consent and stop affordance hardening, optional voice prompt input spike or documented boundary, and tests for starting/stopping streams without retaining unwanted video files.

Status: implemented. Vision tools now separate snapshot capture, WebM recording, and Agent screen share into clearer menu groups. Agent share exposes cadence and max-duration controls persisted in local settings; start requests carry consent, retention, cadence, and duration metadata into the daemon-owned Vision stream record. The menu now closes on outside click/Escape, active sessions show stronger stop/status affordances, and the prompt row includes a Web Speech API voice prompt input boundary for browser-supported dictation. Renderer smoke verifies cadence/duration protocol values, recording vs metadata-only retention, menu dismissal, voice prompt dictation, and existing start/stop behavior without retaining Agent-share video files.

### iter-4-sprint-05-pty-popup-and-mascot-persona

Goal: clarify and extend the PTY and mascot surfaces so they behave like intentional product modules rather than debug panels.

Dependencies: PTY viewport, terminal input protocol, Tauri window commands, mascot preset tables, app-server prompt context.

Expected scope: list PTY use cases/history, implement or scope a separate PTY popup window connected to the parent widget, preserve direct terminal behavior, add default dog mascot persona/tone hooks for Agent responses, and keep future custom theme/mascot/module platform data boundaries explicit.

Status: implemented. The PTY viewport now includes an inline guide explaining when to use PTY, how direct input connects to the daemon PTY session, and the current popout boundary. A PTY popout entry opens a terminal-focused widget window on the same daemon port with `mode=terminal&surface=pty`, preserving the existing direct terminal behavior. Agent widget context now includes the Default Dog mascot persona, tone expectations, and mascot state hints so Agent responses can align with the current companion preset. Renderer smoke verifies the PTY guide/popout affordance remains available, and app-server smoke verifies PTY/widget context includes the mascot persona.
