# Handoff

## Current State

The project is a Tauri + React + Node daemon desktop widget. The native widget launches, Vite serves renderer assets during dev, and the daemon listens on `127.0.0.1:4128`.

## Branch And Harness

- Branch: `main`
- Harness: vibe-doctor `v1.7.4`
- Upstream ref: `^v1.7.4`
- Orchestrator: `codex`
- Sprint roles: planner `codex`, generator `codex`, evaluator `codex`
- Sprint mode: `extended` enabled in `.claude/settings.local.json`

## Recent Work

- Migrated from Electron to Tauri.
- Verified Windows MSVC/Rust/WebView2 prerequisites.
- Added generated mascot icon resources for Tauri.
- Installed vibe-doctor v1.7.2 project context, provider memory, and harness files so future work can run through sprints.
- Configured Codex provider for Windows via `.\.vibe\harness\scripts\run-codex.cmd`.
- Ran `/vibe-sync` against upstream `v1.7.2`; used `--force` because the non-interactive sync path found harness files without sync history. Backup: `.vibe/sync-backup/2026-05-04T04-37-12-648Z`.
- Sync established ignored `.vibe/sync-hashes.json`, updated `.vibe/config.json` to `^v1.7.2`, appended harness ignore defaults, and added VS Code/CI harness files.
- Updated the project orchestration contract so Codex is the main Orchestrator and all sprint roles default to `codex`.
- Ran `/vibe-sync` to upstream `v1.7.4` after reviewing conflicts in `docs/context/orchestration.md` and `docs/orchestration/providers.md`. Backup: `.vibe/sync-backup/2026-05-04T15-54-12-729Z`.
- Re-applied this downstream project's Codex Orchestrator/Planner/Generator/Evaluator and Windows `run-codex.cmd` provider contract after sync while keeping the new v1.7.4 visual/experience evidence requirements for frontend/game/dashboard Sprint QA.
- Enabled `/vibe-sprint-mode` extended tier for phase-level delegation permissions.
- Replaced the widget's direct OpenAI API key path with daemon-owned OAuth PKCE login and Bearer-token agent proxy streaming.
- Removed the `openai` npm dependency from this client and updated README/context docs to describe the OAuth proxy contract.
- Added development hot services: `npm run dev` now starts `scripts/dev-hot.mjs`, which runs Vite HMR, daemon TypeScript watch, and daemon restart-on-build-change. Tauri dev skips its own daemon spawn unless `CODEX_WIDGET_DEV_SPAWN_DAEMON=1`.
- Added gitignored `.env` support for local OAuth token mode: `CODEX_WIDGET_AUTH_MODE=token`, `CODEX_WIDGET_OAUTH_ACCESS_TOKEN`, and `CODEX_WIDGET_AGENT_PROXY_URL`.
- Changed token-mode Sign in UX so the widget opens an inline token form, saves the OAuth access token/proxy URL into gitignored `.env`, and updates the running daemon without requiring users to edit env files manually.
- Switched the default local auth config back to PKCE/social-login mode and changed OAuth authorize links to open through the OS default browser via a Tauri command instead of WebView popup behavior.
- Added `scripts/dev-auth-proxy.mjs`, a local development OAuth/proxy server on `127.0.0.1:8787`, and wired `npm run dev`/`scripts/dev-hot.mjs` to start it automatically so Sign in can complete locally without manual token entry.
- Corrected the default Sign in flow to use Codex CLI OpenAI/ChatGPT authentication instead of the mock OAuth proxy: `CODEX_WIDGET_AUTH_MODE=codex`, Sign in runs `codex login` when needed, and authenticated prompts run through `codex exec --json`.
- Changed the dev auth proxy to opt-in only via `CODEX_WIDGET_DEV_AUTH_PROXY=1` or `npm run dev:auth-proxy`; it is no longer part of the default widget auth workflow.
- Codex-mode Sign out only disconnects the widget session; it does not run global `codex logout` or remove the user's Codex CLI credentials.
- Applied `taste-skill` frontend cleanup: the renderer now uses a Windows-style single panel with titlebar, system strip, mode tabs, structured conversation messages, token form labels, activity log, composer, and a smaller companion mascot zone.
- Fixed the renderer/Tauri UI mismatch after native testing: window size is now widget-scale (`360x480` config, observed about `374x488` including shadow), taskbar/shadow are enabled, titlebar has Pin/Minimize/Maximize/Close controls, and drag regions are restricted to the titlebar grip/identity so Sign in and the prompt input receive clicks.
- Removed local response evaluation/feedback controls from assistant messages. Response actions now expose copy, regenerate, and a top-right More menu with local branch and browser speech read-aloud actions; streaming markdown links and raw URLs are revealed as whole tokens to avoid visible markdown reflow.
- Switched the default Codex-mode runtime from per-request `codex exec` to a daemon-supervised background `codex app-server` JSON-RPC bridge. The daemon now starts the app-server child process, keeps one `threadId` alive, sends prompts as `turn/start`, maps `item/agentMessage/delta` to widget stream events, interrupts turns on cancel, and terminates the child process on shutdown/sign-out. `CODEX_WIDGET_CODEX_RUNTIME=exec` remains the explicit fallback.

## Next Recommended Sprint

`sprint-02-browser-dom-bridge`: add the first real browser provider contract for active-tab DOM selection and element metadata.

## Open Issues

- Codex app-server is still marked experimental by the Codex CLI, so the bridge should preserve the `codex exec resume` fallback until the protocol is stable enough for production packaging.
- App-server approval and tool-user-input requests currently receive conservative decline/empty responses; a future sprint should add native widget UI for approval, elicitation, and permission prompts.
- External OAuth provider/backend agent proxy support remains optional for non-Codex auth modes; this repo primarily implements the desktop widget/daemon client boundary.
- OAuth refresh tokens are not persisted; users may need to sign in again when an access token expires.
- Browser DOM provider is a stub.
- Screen capture/vision provider is a stub.
- Terminal PTY provider is a stub.

## Verification

Completed after harness install:

- `npm run vibe:doctor`
- `node .vibe\harness\scripts\vibe-preflight.mjs --bootstrap`
- `npm run lint`
- `npm run build:web`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`

Completed after latest `/vibe-sync`:

- `npm run vibe:sync -- --dry-run`
- `npm run vibe:sync -- --force`
- `npm run vibe:sync -- --dry-run`
- `npx tsc -p .vibe/harness/tsconfig.harness.json --noEmit`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap` after switching all role providers to `codex`
- `node .vibe/harness/scripts/vibe-sprint-mode.mjs status`

Completed after `/vibe-sync` to v1.7.4:

- `npm run vibe:sync -- --dry-run` resolved `^v1.7.2` to `v1.7.4` and found two conflicts: `docs/context/orchestration.md`, `docs/orchestration/providers.md`.
- `npm run vibe:sync -- --force`
- Re-applied Codex role/provider overrides to the two conflicted docs after sync; the expected follow-up dry-run still reports those two files as local project overrides.
- `npx tsc -p .vibe/harness/tsconfig.harness.json --noEmit`
- `node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap`
- UTF-8/mojibake checks over touched sync/context files

Completed after OAuth proxy client conversion:

- `npm run lint`
- `npm run smoke`
- Local inline OAuth auth-start smoke with dummy provider config
- Local inline OAuth callback/token/proxy streaming smoke with a dummy HTTP provider
- UTF-8/mojibake checks over touched files

Completed after dev hot services change:

- `node --check scripts/dev-hot.mjs`
- `npm run lint`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`

Completed after OAuth token config mode:

- `npm run lint`
- `npm run smoke`
- Local inline static OAuth token proxy smoke
- WebSocket daemon status reports `missing CODEX_WIDGET_OAUTH_ACCESS_TOKEN` while `.env` token is blank
- UTF-8/mojibake checks over touched files

Completed after inline token-mode Sign in UX:

- `npm run lint`
- `npm run smoke`
- Local inline token save smoke: `auth.save-token` -> `.env` upsert -> Bearer proxy stream
- WebSocket daemon status reports `signInAvailable: true` while token is blank
- UTF-8/mojibake checks over touched files

Completed after PKCE/social-login Sign in path:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`
- WebSocket auth-start smoke returns a PKCE authorize URL using `http://127.0.0.1:4128/oauth/callback`
- Running daemon reports `signInMethod: "pkce"`, `configured: true`, and `authenticated: false` until the external OAuth backend completes login
- UTF-8/mojibake checks over touched files

Completed after local dev auth/proxy server:

- `node --check scripts/dev-auth-proxy.mjs`
- `node --check scripts/dev-hot.mjs`
- `npm run lint`
- `npm run smoke`
- `GET http://127.0.0.1:8787/health` returns `{"ok":true}`
- End-to-end PKCE smoke: `auth.start` -> dev auth proxy authorize redirect -> daemon `/oauth/callback` -> token exchange -> authenticated WebSocket status -> Bearer `/agent/stream` response

Completed after Codex CLI OpenAI/ChatGPT auth flow:

- `codex login status` reports `Logged in using ChatGPT`
- `npm run lint`
- `npm run smoke`
- Running daemon WebSocket auth status reports `mode: "codex"`, `authenticated: true`, `signInMethod: "codex"`
- Running daemon prompt smoke returns `widget-codex-live-ok` through `codex exec --json`
- UTF-8/mojibake checks over touched files

Completed after renderer UI redesign:

- `npm run lint`
- `npm run smoke`
- Playwright screenshot at `430x610` for idle widget state
- Playwright screenshot at `430x610` after composer submission/streaming state
- UTF-8/mojibake checks over touched renderer files

Completed after widget-scale/window-control fix:

- `npm run lint`
- `npm run smoke`
- `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-msvc-env.ps1; Push-Location src-tauri; cargo check --no-default-features; Pop-Location"`
- Playwright `360x480` interaction smoke: auth button toggles `OpenAI -> Sign in -> OpenAI`, prompt input accepts typed text
- Native window rect check reports the running Tauri process at approximately `374x488` including window shadow/bounds
- UTF-8/mojibake checks over touched renderer/Tauri config files

Completed after Pin/Opacity/native window-control update:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Playwright `360x480` UI smoke: Pin label changes `Pinned -> Unpinned`; opacity slider updates the displayed value to `80%`
- Rolled maximize back to the native Tauri maximize/unmaximize command after confirming custom widget-size expansion is not needed
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after webview-edge/native-titlebar layout update:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: panel starts at `left=0, top=0`, titlebar height is `32px`, mascot is `88x88`, opacity slider updates to `85%`, and prompt input remains clickable
- Playwright maximized layout smoke with `.is-maximized` at `1366x768`: panel fills the viewport and mascot moves to the bottom-right with right padding on the prompt/activity area
- UTF-8/mojibake checks over touched renderer/context files

Completed after Activity/opacity/titlebar cleanup:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` UI smoke: opacity slider accepts `0`, panel background alpha reaches `0`, text/input remains visible, Pin button has no text content, Activity log content is separated into a non-overlapping two-line area, and panel bottom border reports `0px`
- Playwright responsive titlebar smoke: opacity controller is visible at `360px` next to `Codex Widget` and hidden at `320px`
- UTF-8/mojibake checks over touched renderer/context files

Completed after native Tauri border removal:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Runtime Win32 style check on the Tauri window reports `WS_CAPTION=false`, `WS_BORDER=false`, `WS_DLGFRAME=false`, and `WS_THICKFRAME=false`
- Native maximize/restore smoke keeps those frame bits disabled while moving between `360x480` and maximized bounds
- UTF-8/mojibake checks over touched Tauri/context files

Completed after radius/mascot/opacity-control refinement:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: widget panel has `12px` top radius, `0px` bottom radius, `0px` bottom border, mascot is `116x116`, and mascot does not overlap panel/prompt/activity
- Playwright maximized layout smoke: panel radius is `0px`, panel fills `1366x768`, mascot is `136x136` at bottom-right, and prompt/activity right padding clears the mascot
- Opacity controller is iconless and reduced to a `58px` titlebar range control
- UTF-8/mojibake checks over touched renderer/context files

Completed after prompt click/focus repair:

- `npm run lint`
- `npm run smoke`
- Browser Playwright focus smoke: prompt input is enabled after reconnect, pointer click focuses it, and typed text is accepted
- Native Tauri click smoke: after WebView reload, clicking the prompt area and sending keys writes `nativefocus` into the input
- Added WebSocket auto-reconnect so daemon restarts no longer leave the prompt disabled in `Offline`
- Added prompt-row pointer focus capture and raised prompt row z-index to keep input focus reliable in the transparent native window
- UTF-8/mojibake checks over touched renderer/context files

Completed after model/reasoning selector UI:

- `npm run lint`
- `npm run smoke`
- Playwright `360x480` layout smoke: Model and Reason selectors render between status and mode rows, no panel rows overlap, and selected values persist in localStorage.
- Playwright submit-packet smoke: selecting `gpt-5.3-codex-spark` and `xhigh` sends `{ model, reasoningEffort }` with the `ask` WebSocket message.
- Prompt focus smoke remains valid after the new controls: clicking the prompt row focuses the input and typed text is accepted.
- Codex daemon path now passes selected values to `codex exec --json -m <model> -c model_reasoning_effort="<level>"`; OAuth proxy requests include `model`, `reasoningEffort`, and `reasoning_effort`.
- UTF-8/mojibake checks over touched renderer/daemon/protocol/env-example files

Completed after panel-based resize handles:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added eight resize hit areas on the white `.widget-panel` only; the transparent mascot/agent area has no resize handle.
- Implemented Tauri manual resize fallback through `outerPosition`, `outerSize`, `scaleFactor`, `setPosition`, and `setSize` so resizing works even with the Windows native frame stripped.
- Native smoke confirmed right panel-edge drag changed the window from `360x480` to `450x480`, then restored it.
- Native smoke confirmed white panel bottom-edge drag changed the window from `360x480` to `360x550`, then restored it.
- Playwright DOM smoke confirmed close button hit testing still resolves to the close button, panel right/bottom edges resolve to resize handles, and mascot area resolves to the shell rather than a handle.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after diagonal resize responsiveness fix:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Replaced per-frame paired renderer `setPosition`/`setSize` calls with one custom Tauri `set_window_frame` command backed by Windows `SetWindowPos`.
- Coalesced renderer resize updates so drag movement keeps only the newest pointer coordinates while an IPC frame update is in flight; this avoids request backlog during diagonal drags.
- Native smoke confirmed panel bottom-right diagonal drag changed the window from `360x480` to `448x557`, then restored it.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after widget affordance/UI follow-up:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added mascot window dragging through a Tauri drag region plus `startDragging`; native smoke moved the window by `72x45` from the mascot and restored it.
- Slimmed the titlebar opacity range control to a `10px` input, `1px` track, and `7px` thumb aligned to the track center.
- Filled the active Pin icon interior with the same accent color used by the opacity slider.
- Changed the auth button copy to `Sign in` / `Sign out` instead of provider names.
- Moved the model/reasoning selector row directly above the `Ask Codex` prompt row.
- Suppressed the default right-side `codex` model label in the status strip.
- Raised the app minimum height to `480px` and added explicit min dimensions for the shell, panel, fixed rows, and key controls; Playwright `320x480` and `360x480` layout smokes reported no row overlap.
- Taste-skill review pass confirmed controls keep their click targets, model row is above the prompt, mascot hit testing resolves to the image drag target, and Pin fill uses the accent color.
- UTF-8/mojibake checks over touched renderer/Tauri files

Completed after native diagonal resize loop fix:

- `npm run lint`
- `npm run smoke`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Added a Tauri `start_window_resize` command that temporarily enables the Windows resize frame only for the active resize loop, posts the matching native hit-test resize message, then restores the borderless style after mouse release.
- Updated renderer resize startup so panel handles try the native resize loop first and keep the coalesced manual `set_window_frame` path only as a fallback.
- Native smoke confirmed panel bottom-right diagonal drag changed the window from `360x480` to `456x564`, then restored it.
- Native style smoke confirmed `WS_CAPTION`, `WS_BORDER`, `WS_DLGFRAME`, and `WS_THICKFRAME` are all false after the drag.

Completed after prompt composer layout update:

- `npm run lint`
- `npm run smoke`
- Converted the prompt field from a single-line input to a vertically resizable textarea with Enter-to-submit and Shift+Enter newline behavior.
- Moved the model/reasoning selector row below the prompt composer.
- Added extra padding to the Ready empty-state panel under the mode selector.
- Playwright `360x480` layout smoke confirmed the prompt row is before the model row, the model row is before Activity, Ready padding is `12px`, and dragging the textarea resize handle grew the textarea from `38px` to `84px` while the conversation region shrank from `96px` to `50px`.

Completed after prompt area resize clarification:

- `npm run lint`
- `npm run smoke`
- Removed the browser-native textarea resize affordance and added a thin prompt-composer top drag handle instead.
- Composer drag now changes the prompt row height, and the textarea height follows the row height.
- Send/stop button is vertically centered within the prompt row.
- Playwright `360x480` layout smoke confirmed the prompt row grew from `46px` to `90px`, textarea grew from `38px` to `82px`, textarea CSS `resize` is `none`, and model/activity row order stays intact.

Completed after prompt composer max-height expansion:

- `npm run lint`
- `npm run smoke`
- Raised the prompt composer absolute max height from `96px` to `192px`.
- Added viewport-aware clamping so the composer only reaches `192px` when the panel has enough height to keep the conversation region visible.
- Playwright smoke confirmed `360x480` clamps at `96px` with a `48px` conversation area, while `360x640` reaches `192px` with a `111px` conversation area; textarea follows at `88px` and `184px`, and the send button remains vertically centered.

Completed after conversation overflow UX fix:

- `npm run lint`
- `npm run smoke`
- Removed the assistant bubble's internal `max-height` and nested `overflow-y: auto` behavior.
- Kept scrolling at the conversation timeline level only and auto-pinned the timeline to the bottom during streamed responses.
- Long-response Playwright mock session confirmed a `2995` character assistant response renders as one natural bubble with `overflow-y: visible`, `max-height: none`, no assistant-level scroll, and the conversation timeline scrolled to bottom.

Completed after realtime conversation streaming fix:

- `npm run lint`
- `npm run smoke`
- Replaced the single `lastPrompt`/`answer` renderer state with a persistent `chatMessages[]` timeline so follow-up prompts preserve previous user/assistant bubbles.
- Added per-response stream buffers and a UI typewriter loop so large backend deltas reveal progressively instead of appearing as one static text jump.
- Slowed the loading skeleton animation to `2.4s`.
- Added assistant response states (`Queued`, `Thinking`, `Working`, `Streaming`, `Typing`, `Done`, `Stopped`, `Error`) with animated dots and a live cursor so long-running/tooling phases remain visible after the first text arrives.
- Playwright mock stream confirmed: skeleton duration is `2.4s`, a `670` character response had only `90` visible characters shortly after first delta with dots/cursor active, a second prompt left `2` user and `2` assistant bubbles, and no assistant bubble had nested scroll.
- Playwright tooling smoke confirmed a post-answer tool phase shows `Working` with dots/cursor while assistant text remains visible.

Completed after GPT-style conversation layout pass:

- `npm install react-markdown remark-gfm`
- `npm run lint`
- `npm run smoke`
- Removed visible per-message `You` / `Codex` / `Agent / GPT-*` labels from active chat messages.
- Restyled user prompts as right-aligned dark bubbles with left padding; assistant responses now use full-width document-style text instead of a boxed assistant bubble.
- Added `react-markdown` plus `remark-gfm` rendering for assistant messages, including GFM table styling, code, links, blockquotes, lists, and zebra table rows.
- Added compact response actions matching the available widget scope: copy, positive feedback, negative feedback, regenerate, and more-action logging.
- Made the typing reveal more natural by using smaller variable character steps and punctuation/newline delays instead of fixed large chunks.
- Playwright GFM/UI smoke confirmed no `.message-meta` nodes, no `You`/`Codex`/`Agent / GPT` label text, right-aligned user bubble with left padding, full-width assistant response, rendered markdown table, 5 action buttons, active streaming state, and cursor during partial reveal.

Completed after widget Codex execution context separation:

- `npm run lint`
- `npm run smoke`
- Changed widget-launched Codex CLI sessions so they no longer run from this repository by default.
- Default live widget prompts now invoke `codex exec --skip-git-repo-check -C <user-home>` outside the widget repo while preserving normal user-file search/edit/delete capability.
- Added a protected-source instruction wrapper around widget prompts so source changes for this repo are redirected to CLI sessions.
- Added `CODEX_WIDGET_CODEX_WORKDIR`, `CODEX_WIDGET_CODEX_ADD_DIRS`, and `CODEX_WIDGET_CODEX_SANDBOX` documentation/env examples for explicit local-file boundary overrides.

Completed after widget shutdown / sandbox setup fix:

- `npm run lint`
- `npm run smoke`
- Killed one stuck widget-launched `codex exec` process tree whose Windows sandbox setup was consuming CPU.
- Changed the widget default Codex sandbox to `danger-full-access` to avoid the Windows home-directory `workspace-write` sandbox setup path while keeping requested desktop file operations possible.
- Added Windows `taskkill /T /F` process-tree cleanup when a widget Codex request is aborted so `cmd -> node -> codex -> sandbox` descendants do not survive cancel, socket close, or reload.
- WebSocket cancel smoke confirmed a live request launched with `-s danger-full-access`, no `codex-windows-sandbox-setup` process appeared, and no `codex exec` process remained after cancel.

Completed after conversation UI/action bugfix pass:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Made user prompt bubbles fully rounded and centered the streaming dots/loading indicator alignment.
- Moved the prompt height CSS variable to the widget panel grid so prompt resizing reallocates layout height instead of overlapping the conversation.
- Added a codeblock renderer with language label and per-block copy action; tightened markdown/code/table width rules and hid conversation horizontal overflow.
- Reduced side resize handle width so the conversation scrollbar remains clickable while the outermost edge still resizes.
- Fixed response copy to use the full buffered assistant response, added visible feedback logs/states, and changed regenerate to replace the old assistant answer with a pending response instead of appending a second answer.
- Playwright narrow-width smoke confirmed uniform user bubble radii, no conversation horizontal overflow at `330px`, codeblock/table rendering, full response copy, feedback visibility, regenerate replacement, prompt resize without overlap, and usable scrollbar area at `320px`.

Completed after feedback popup and prompt resize hardening:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Added local feedback submission state so selected negative feedback reasons and details are stored in the widget session after submitting the popup.
- Negative feedback now opens a modal-style feedback popup; while either good or bad feedback is selected, the opposite icon is hidden until the selected icon is toggled off.
- Added CSS tooltips and hover/toggled backgrounds for response action icons, and removed native button borders from the action icons.
- Moved the prompt resize hit area fully inside the prompt row and clipped prompt row overflow so textarea resizing cannot paint over the conversation.
- Playwright feedback/resize smoke confirmed bad feedback opens the popup, reason/details submit into visible state/logs, opposite feedback icon hides and returns after toggle-clear, hover tooltip opacity reaches `1`, and textarea/prompt resize no longer overlaps the conversation or paints outside the prompt row.

Completed after response action simplification:

- `npm run lint`
- `npm run build:renderer`
- `npm run smoke`
- Browser Playwright action/link smoke confirmed response evaluation buttons are gone, `Copy markdown` and `Clear feedback` no longer render, More opens above the button with right edges aligned, Read aloud invokes `speechSynthesis`, Branch leaves a focused user/assistant pair, and split markdown links do not expose raw `[label](url)` syntax while streaming.
- UTF-8/mojibake checks over touched renderer/context files

Completed after Codex app-server runtime transition:

- `npm run lint`
- `npm run smoke`
- `npm run build:renderer`
- Live daemon app-server smoke confirmed two-turn context preservation through one background `codex app-server` thread.
- Added `src/daemon/codexAppServer.ts` for JSON-RPC process/session ownership and `src/daemon/codexRuntime.ts` for shared workdir/sandbox/policy helpers.
- Updated `docs/context/product.md`, `docs/context/architecture.md`, and `.env.example` with `CODEX_WIDGET_CODEX_RUNTIME=app-server` default and `exec` fallback.
- UTF-8/mojibake checks over touched daemon/context files

## Restart Steps

1. Run `git status --short --untracked-files=all` and inspect the sync diff.
2. Default local live auth is Codex CLI auth. Use `CODEX_WIDGET_AUTH_MODE=codex`; Sign in should invoke `codex login` if the user is not already logged into Codex/ChatGPT.
3. Default Codex runtime is `CODEX_WIDGET_CODEX_RUNTIME=app-server`, which starts a daemon-owned background `codex app-server`. Set `CODEX_WIDGET_CODEX_RUNTIME=exec` only to force the older `codex exec resume` fallback.
4. Widget-launched Codex sessions default to `CODEX_WIDGET_CODEX_WORKDIR=<user-home>` and `CODEX_WIDGET_CODEX_SANDBOX=danger-full-access`; override only when testing a different desktop file boundary.
5. Use the dev auth proxy only for mock backend OAuth experiments: run `npm run dev:auth-proxy` or set `CODEX_WIDGET_DEV_AUTH_PROXY=1` before `npm run dev`.
6. For production-style backend OAuth proxy live responses, set `CODEX_WIDGET_AUTH_MODE=pkce` and replace `CODEX_WIDGET_AUTH_BASE_URL`/`CODEX_WIDGET_AGENT_PROXY_URL` with a real backend that implements `/oauth/authorize`, `/oauth/token`, redirects to `http://127.0.0.1:4128/oauth/callback`, and serves streaming model responses.
7. For token-mode fallback responses, set `CODEX_WIDGET_AUTH_MODE=token`, press Sign in in the widget, and use the inline token form to save the OAuth access token and backend proxy URL into gitignored `.env`.
8. Run `node .vibe/harness/scripts/vibe-sprint-mode.mjs status` to confirm whether extended mode is still active.
9. Use `npm run dev` for renderer HMR plus daemon restart-on-change; use `npm run dev:services` only when testing the service loop without launching Tauri.
10. Run `npm run lint && npm run smoke` after follow-up TypeScript/widget changes.
11. For renderer UI work, capture a `360x480` Playwright smoke against `http://127.0.0.1:5173/?daemonPort=4128` to check overlap in the fixed Tauri viewport. Model/reasoning selectors live between the status strip and mode tabs and persist to localStorage keys `codex-widget-model` and `codex-widget-reasoning-effort`.
12. Run `npm run vibe:checkpoint` before ending any follow-up maintenance session.

Use `docs/context/qa.md` for routine follow-up commands.
