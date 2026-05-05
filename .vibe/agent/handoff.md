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
- Pushed checkpoint commit `d066dd5` to `origin/main` with message `CHECKPOINT BEFORE BIG PATCH`.
- Started `/vibe-iterate` Iteration `iter-2` (`Resident Runtime Expansion`) and added milestone/report state for runtime protocol, provider shell, and resident desktop ops.
- Added first-class renderer-daemon runtime interactions: app-server approval/user-input server requests now emit `interaction.required`, render compact approval/input cards in the widget, and return `interaction.respond` to the daemon instead of being silently declined.
- Added `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request` as the default app-server approval policy, with `never` still available for trusted automation experiments.
- Added app-server runtime diagnostics: `runtime.status` now includes start count, last started/exited timestamps, and latest error; the Settings panel surfaces start count and latest error.
- Added visible chat timeline persistence across renderer reloads plus a titlebar New chat control that clears local chat state and resets daemon proxy/app-server session state.
- Added daemon-owned provider status events for Agent, DOM, Vision, and PTY modes so the mode tabs now have a reusable capability/status contract before real providers are implemented.
- Added resident desktop operations: runtime health events, Settings panel, Windows start-at-login toggle, skip-taskbar native config, hide-to-tray close behavior, and a strengthened smoke gate for provider/runtime events.
- Added `npm run smoke:resident` for idle daemon health and RSS budget checks.
- Fixed production bundling by adding `icons/icon.ico` to the Tauri bundle icon list; `npm run build` now produces release exe, MSI, and NSIS installer artifacts.
- Added `npm run smoke:all` and `npm run smoke:all:live` as serial readiness gates so provider smokes do not race by rebuilding `dist` in parallel.
- Added real provider shell functionality for Iteration 2:
  - DOM mode accepts browser/page snapshots at `POST /providers/dom/snapshot`, updates provider readiness, emits DOM snapshot tool output, and injects the latest DOM context into model requests.
  - `providers/browser-dom-extension` adds an unpacked Chrome/Edge Manifest V3 extension that captures the active tab and posts a DOM snapshot to the daemon.
  - The browser DOM extension now has committed icon assets, manifest icon/action metadata, and `npm run package:extension` to generate `dist/providers/codex-widget-dom-extension-0.1.0.zip`.
  - Vision mode accepts screen snapshots at `POST /providers/screen/snapshot`, updates provider readiness, emits screen snapshot tool output, and injects screen description/OCR context into model requests.
  - `providers/screen-capture-helper/capture-screen.ps1` captures the Windows virtual desktop, compresses it to JPEG data URL, and posts it to the Vision snapshot endpoint.
  - The Vision-mode Capture action sends `provider.captureScreen` to the daemon, which runs the screen capture helper and refreshes provider status without requiring the user to run PowerShell manually.
  - Screen/Vision image data is now attached to Codex app-server Vision turns as image input instead of remaining daemon-only metadata.
  - The Windows screen capture helper now supports optional OCR text through auto-detected `tesseract` or a `CODEX_WIDGET_SCREEN_OCR_COMMAND`/`-OcrCommand` template that receives `{image}`.
  - Added bundled OCR runtime packaging: `npm run build:ocr-runtime` prepares `dist/ocr-runtime/ocr-runtime.json`, can copy a Tesseract runtime from `CODEX_WIDGET_OCR_RUNTIME_DIR`, `CODEX_WIDGET_TESSERACT_EXE`, PATH, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, or standard Windows install locations, records bundled tessdata languages, and installed helpers resolve `_up_/dist/ocr-runtime` before PATH OCR.
  - Added OCR language selection defaults: auto-generated bundled Tesseract commands choose `eng+kor` when both bundled language packs exist, fall back to available `eng`/`kor`, and allow `CODEX_WIDGET_SCREEN_OCR_LANGUAGE`/`-OcrLanguage` overrides.
  - Terminal/PTY mode executes explicit local commands (`/run`, `$`, `PS>`, `run:`, or fenced shell blocks), streams stdout/stderr as tool output, blocks dangerous command patterns by default, and returns a markdown terminal result.
- Added a persistent command-session layer for Terminal/PTY mode:
  - `/pty start` starts a daemon-owned child shell in the configured Codex widget terminal workdir.
  - `/pty <command>` streams output and returns a markdown terminal-session result while preserving shell state between commands.
  - `/pty status` and `/pty stop` expose the session lifecycle.
  - The implementation is command-oriented and not yet raw ConPTY/full-screen interactive terminal support.
- Hardened the renderer chat layout:
  - Conversation messages now use explicit grid flow so user bubbles, assistant markdown, active streaming state, and skeletons stay in separate rows.
  - GFM tables use fixed full-width layout on wide viewports and contained horizontal scrolling on narrow widget widths.
  - Prompt resize clamps against the actual panel height so the composer cannot cover the conversation region.
  - More action menus are aligned above the button with right edges matched.
- Added app-server-backed regenerate boundaries:
  - The renderer computes how many assistant turns are removed when regenerating a selected answer.
  - The daemon receives `regenerate.dropTurns` and calls Codex app-server `thread/rollback` before starting the replacement turn.
  - This preserves app-server context before the selected answer without sending the visible chat history as a prompt.
- Added `docs/providers/dom-snapshot-bookmarklet.js`, `docs/providers/screen-snapshot-example.json`, `npm run smoke:dom`, `npm run smoke:extension`, `npm run smoke:screen`, `npm run smoke:screen-capture:live`, `npm run smoke:screen-helper`, `npm run smoke:screen-helper:live`, and `npm run smoke:terminal`.
- Added `npm run smoke:renderer-chat` for browser-level validation of multi-turn chat overlap, table width, prompt resize, and response action menu placement.
- Added `npm run smoke:resident-soak` for a short resident daemon soak covering runtime samples, ping/pong health, idle active request count, app-server closed state in mock mode, RSS ceiling, and RSS growth.
- Replaced the packaged Tauri daemon child holder with a native daemon supervisor that restarts the Node daemon after unexpected exits with capped exponential backoff, keeps dev-mode duplicate spawn disabled by default, and kills the daemon child on widget shutdown.
- Added `npm run smoke:tauri-supervisor` to validate supervisor backoff and actual child restart behavior through Rust tests.
- Exposed native daemon supervisor diagnostics to the renderer via `get_native_daemon_status`; the widget status strip and Settings runtime grid can now show native daemon starting/running/restarting/error state even while the WebSocket is reconnecting.
- Added packaged daemon runtime resources: `npm run build:web` now creates `dist/daemon-bundle/standalone.js`, prepares `dist/node-runtime/node.exe`, and Tauri bundles both directories so installed Windows builds do not depend on a user-installed `node` command for the widget daemon.
- Added `npm run smoke:node-runtime` and included it in `npm run smoke:all` to verify the bundled Node runtime can run the dependency-bundled daemon without repository `node_modules`.
- Added `npm run smoke:release-resources` to verify generated MSI/NSIS build scripts include the bundled daemon, Node runtime, screen helper, and DOM extension resources.
- Added `npm run smoke:release-launch` to launch the release exe hidden, verify the packaged daemon WebSocket on `127.0.0.1:4128`, and clean up the process tree.
- Added a browser DOM extension Options page backed by `chrome.storage.sync`, so users can point the extension at another local daemon port without editing extension code. The extension only accepts local `http://127.0.0.1/...` or `http://localhost/...` snapshot URLs ending in `/providers/dom/snapshot`.
- Added `npm run smoke:release-install` for NSIS silent install/uninstall observation: it refuses to overwrite existing install state, launches the installed app hidden, verifies the daemon WebSocket, uninstalls, and checks install directory, uninstall registry entry, product install key, and desktop shortcut cleanup.
- Added `npm run release:verify` as the one-command live release gate. It runs `smoke:all:live`, `build`, release resource smoke, release exe launch smoke, NSIS install smoke, MSI install smoke, and prints release artifact sizes.
- Fixed installed-build daemon resource resolution. The native shell now checks the installed exe-adjacent `_up_` resource directory for `dist/daemon-bundle/standalone.js` and `dist/node-runtime/node.exe` before falling back to development paths or system `node`.
- Strengthened `npm run smoke:release-install` to find the installed bundled daemon process, kill it, and verify the native supervisor restarts it with a new PID before uninstall cleanup.
- Added a daemon parent watchdog through `CODEX_WIDGET_NATIVE_PARENT_PID`, so the installed daemon exits when the native app process disappears unexpectedly instead of surviving as an orphan.
- Added `providers/browser-native-host`, an optional Chrome/Edge native messaging host that receives framed `domSnapshot` messages, validates local daemon URLs, and posts snapshots to the local daemon. The browser extension now tries native messaging first and falls back to direct local HTTP when the host is not registered.
- Added browser extension store-readiness metadata: `store-listing.md`, `privacy.md`, `review-notes.md`, and `npm run smoke:browser-store` for permission rationale/privacy/package validation.
- Added `npm run release:soak`, a longer hidden release-exe soak that checks runtime samples, ping/pong health, daemon process presence, process-tree working set, and cleanup after the soak.
- Made response Branch runtime-safe: Branch now sends `session.branch` to reset daemon-side proxy/app-server session state, stores the selected user/assistant pair as a one-shot `branchContext`, sends that seed with the next prompt only, and clears it after use so visible branch state does not keep running against hidden old app-server context.
- Added daemon reconnect replay: active agent events are broadcast to connected clients, bounded assistant response snapshots are retained in the daemon, reconnecting renderers receive `message.snapshot`, and a WebSocket close no longer aborts every active request.
- Added native PTY runtime packaging and a node-pty/ConPTY backend for Terminal/PTY mode:
  - `node-pty@1.1.0` is now a runtime dependency.
  - `npm run build:pty-runtime` prepares `dist/pty-runtime` with native node-pty resources, and Tauri bundles it for installed builds.
  - `/pty` sessions prefer node-pty/ConPTY, keep the stdio shell fallback via `CODEX_WIDGET_TERMINAL_BACKEND=pipe`, and support `/pty resize`, `/pty write`, and `/pty key` raw-input commands in addition to command execution.
  - `npm run smoke:pty-runtime` and the existing terminal-session smoke cover packaged native PTY loading and the node-pty backend.
- Added a dedicated renderer PTY viewport for Terminal mode:
  - Terminal tool events now accumulate in a sticky, scrollable PTY surface instead of only appearing in the small Activity log.
  - PTY mode exposes icon-only quick actions for `/pty start`, `/pty status`, `/pty stop`, and local viewport clear.
  - Renderer chat smoke now verifies the PTY tab, terminal quick action request, terminal output rendering, viewport containment, and prompt/conversation separation.
- Added `npm run smoke:release-msi-install` for MSI install/uninstall observation:
  - The smoke performs a silent MSI install into a per-user temp directory using `ALLUSERS=2 MSIINSTALLPERUSER=1`.
  - It verifies installed bundled daemon/Node/OCR/PTY resources, launches the installed app hidden, confirms the daemon WebSocket, silently uninstalls, and checks cleanup.
  - `npm run release:verify` now runs the MSI smoke after the existing NSIS install smoke.

## Next Recommended Sprint

`iter-2-sprint-04-provider-packaging`: continue packaging the snapshot providers into user-facing helpers, next with final browser store submission workflow, richer terminal key/mouse UX on top of the PTY viewport, OCR quality tuning, and native packaging polish.

## Open Issues

- Codex app-server is still marked experimental by the Codex CLI, so the bridge should preserve the `codex exec resume` fallback until the protocol is stable enough for production packaging.
- App-server approval and tool-user-input requests now have renderer UI, but the exact Codex app-server protocol is still experimental and may require adapter changes as CLI releases evolve.
- External OAuth provider/backend agent proxy support remains optional for non-Codex auth modes; this repo primarily implements the desktop widget/daemon client boundary.
- OAuth refresh tokens are not persisted; users may need to sign in again when an access token expires.
- Browser DOM provider is snapshot-based and has an unpacked Chrome/Edge extension bridge, local-only Options URL configuration, optional native messaging host, generated zip package, and store-readiness metadata; final browser store account submission remains manual.
- Screen capture/vision provider is snapshot-based and has a daemon-triggered Windows capture helper, optional OCR command hook, bundled OCR runtime packaging, standard Windows Tesseract discovery, bundled tessdata language defaults, and direct app-server image input; OCR quality tuning and richer language-pack acquisition remain configurable.
- Terminal/PTY provider now has a node-pty/ConPTY command/raw-input backend and a renderer PTY viewport, but richer key/mouse handling still needs product polish.
- Final browser store account submission, richer terminal key/mouse UX, OCR quality tuning, and multi-hour/manual soak tests remain open for live-service readiness.

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

Completed after `/vibe-iterate` iter-2 runtime protocol pass:

- `npm run lint`
- `npm run smoke`
- Daemon provider/reset protocol smoke confirmed `provider.status` and `session.reset` events.
- Renderer Playwright smoke confirmed localStorage chat restore, provider status dots, and New chat reset cleanup.
- Renderer Playwright fake-WebSocket smoke confirmed approval and user-input interaction cards return `interaction.respond` payloads.
- Live daemon app-server smoke confirmed two-turn context preservation still works with `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request`.
- Regenerated `docs/reports/project-report.html`.

Completed after resident desktop ops pass:

- `npm run lint`
- `npm run smoke` with strengthened provider/runtime event checks
- `npm run smoke:resident`
- `cargo fmt --check`
- `cargo check --no-default-features`
- Renderer Playwright smoke confirmed Settings runtime/provider layout and hidden prompt rows at `360x480`.
- `npm run build` produced:
  - `src-tauri/target/release/codex-widget-for-desktop.exe`
  - `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi`
  - `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe`

Completed after DOM/Terminal provider shell pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:dom`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `node --check scripts/smoke-dom-provider.mjs`
- `node --check scripts/smoke-terminal.mjs`
- `node --check src/daemon/providers/providerRegistry.ts`
- `node --check src/daemon/providers/terminalProvider.ts`

Completed after Screen/Vision snapshot provider pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:screen`
- `npm run smoke:dom`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `node --check scripts/smoke-screen-provider.mjs`
- `node --check src/daemon/server.ts`
- `node --check src/daemon/providers/providerRegistry.ts`

Completed after browser DOM extension bridge pass:

- `npm run smoke:extension`
- `node --check scripts/smoke-browser-extension.mjs`
- `node --check providers/browser-dom-extension/service-worker.js`

Completed after Windows screen capture helper pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:dom`
- `npm run smoke:screen`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:live`
- `npm run smoke:terminal`
- `npm run smoke:resident`
- `npm run smoke:all:live`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-live.mjs`
- `node --check scripts/smoke-all.mjs`
- `node --check src/daemon/server.ts`

Completed after app-server diagnostics pass:

- `npm run lint`
- `npm run smoke:resident`
- `npm run smoke:all:live`
- `node --check src/daemon/codexAppServer.ts`

Completed after daemon-triggered Vision capture pass:

- `npm run lint`
- `npm run smoke:screen-capture:live`
- `npm run smoke:all:live`
- `node --check scripts/smoke-screen-capture-request.mjs`
- `node --check src/daemon/providers/screenCaptureProvider.ts`

Completed after screen helper OCR hook pass:

- `npm run lint`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run smoke:screen-helper:live`
- `npm run smoke:screen`
- Screen helper live smoke now posts fake OCR output and asserts it reaches the daemon snapshot.

Completed after bundled OCR runtime packaging pass:

- `npm run lint`
- `npm run build:ocr-runtime`
- `npm run smoke:ocr-runtime`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- The default local build created `dist/ocr-runtime/ocr-runtime.json` with `available: false` because no local Tesseract runtime is installed; the packaging smoke used a mock Tesseract runtime source and verified copy/manifest generation plus daemon-side bundled OCR command resolution.

Completed after browser DOM extension Options pass:

- `node --check providers\browser-dom-extension\service-worker.js`
- `node --check providers\browser-dom-extension\options.js`
- `node --check scripts\smoke-browser-extension.mjs`
- `npm run smoke:extension`
- `npm run smoke:dom`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-launch`
- Extension smoke now verifies the Options page, storage permission, local-only host permissions, Options script syntax, and packaged zip entries.

Completed after NSIS release install smoke pass:

- `node --check scripts\smoke-release-install.mjs`
- `npm run smoke:release-install`
- Post-smoke checks confirmed no `Codex Widget` install directory under `%LOCALAPPDATA%`, no uninstall registry entry, no `Software\mir3626\Codex Widget` product install key, and no desktop shortcut remained.

Completed after release verification gate pass:

- `node --check scripts\release-verify.mjs`
- `npm run release:verify`
- Release verification ran the live smoke gate, Tauri release build, release resource smoke, release exe launch smoke, NSIS install smoke, and MSI install smoke, then reported release exe/MSI/NSIS artifact sizes.

Completed after installed daemon resource/restart pass:

- `cargo fmt --check --manifest-path src-tauri\Cargo.toml`
- `cargo check --manifest-path src-tauri\Cargo.toml --no-default-features`
- `npm run build`
- `node --check scripts\smoke-release-install.mjs`
- `npm run smoke:release-install`
- Manual diagnostic confirmed the installed app spawned `%LOCALAPPDATA%\Codex Widget\_up_\dist\node-runtime\node.exe` with `_up_\dist\daemon-bundle\standalone.js`, not repo `dist` or system `node`.
- `npm run release:verify` passed after the parent-watchdog change; release install smoke now verifies bundled daemon restart and app-process kill orphan cleanup.

Completed after browser native messaging host pass:

- `node --check providers\browser-native-host\native-host.mjs`
- `node --check providers\browser-dom-extension\service-worker.js`
- `node --check scripts\smoke-browser-native-host.mjs`
- `node --check scripts\smoke-browser-extension.mjs`
- `npm run smoke:browser-native-host`
- `npm run smoke:extension`
- `npm run release:verify`
- Native host smoke framed a DOM snapshot over stdio, verified the host posted it to a local daemon-compatible endpoint, and checked Chrome/Edge registry installer markers.
- Release verification confirmed the native host provider files are bundled into MSI/NSIS resources and installed by the NSIS smoke.

Completed after browser store-readiness pass:

- `node --check scripts\smoke-browser-store-readiness.mjs`
- `npm run smoke:browser-store`
- `npm run release:verify`
- Store readiness smoke verifies extension name/description length, icon files, permission rationales, host permissions, privacy/review notes, native messaging disclosure, no-remote-code statement, and generated package presence.
- Release verification now includes browser store readiness through `smoke:all:live`.

Completed after release longer soak pass:

- `node --check scripts\smoke-release-soak.mjs`
- `npm run release:soak`
- The release soak built the release app, launched the release exe hidden for 60 seconds, collected 13 runtime samples and 29 pong responses, detected the root app and daemon processes, and ended with a 463.6MB process-tree working set across 10 processes.
- `npm run smoke:release-soak`
- The standalone release soak smoke reused the current release build, collected 13 runtime samples and 29 pong responses, detected the root app and daemon processes, and ended with a 409.1MB process-tree working set across 9 processes.

Completed after branch-safe runtime pass:

- `npm run lint`
- `npm run smoke`
- `npm run smoke:renderer-chat`
- `npm run smoke:screen`
- `npm run smoke:all`
- Daemon smoke now verifies `session.branch` does not broadcast a visible `session.reset`; renderer chat smoke verifies Branch sends `session.branch`, the next prompt includes one-shot `branchContext`, and the following branch prompt does not replay that seed.

Completed after reconnect replay pass:

- `npm run lint`
- `npm run smoke:daemon-reconnect`
- `npm run smoke`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- Reconnect smoke verifies an active response survives the first WebSocket closing, a second client receives a `message.snapshot` containing the already-streamed text, and the final `message.completed` reaches the reconnected client.

Completed after persistent terminal session pass:

- `npm run lint`
- `npm run smoke:terminal-session`
- `npm run smoke:terminal`
- `npm run smoke:all:live`
- `npm run build`
- Added `npm run smoke:terminal-session` and included it in the serial readiness gate.

Completed after native PTY runtime pass:

- `node --check scripts/prepare-pty-runtime.mjs`
- `node --check scripts/smoke-pty-runtime.mjs`
- `npm run lint`
- `npm run smoke:pty-runtime`
- `npm run smoke:terminal-session`
- `npm run build:web`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- PTY runtime smoke verifies `dist/pty-runtime` contains a loadable `node-pty` package, spawns a native PTY, and checks daemon PTY runtime resolution.
- Terminal session smoke now verifies `/pty resize` and the node-pty backend when `CODEX_WIDGET_TERMINAL_BACKEND` is not forced to `pipe`.
- Release resource/install smokes now verify `_up_/dist/pty-runtime/pty-runtime.json` and `_up_/dist/pty-runtime/node_modules/node-pty/package.json` are bundled and installed.

Completed after renderer PTY viewport pass:

- `npm run lint`
- `node --check scripts/smoke-renderer-chat-layout.mjs`
- `npm run smoke:renderer-chat`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- `npm run smoke:release-install`
- Renderer chat smoke now covers the PTY tab, terminal quick action request, terminal output rendering, terminal viewport containment, and prompt/conversation separation.

Completed after MSI release install smoke pass:

- `node --check scripts/smoke-release-msi-install.mjs`
- `node --check scripts/release-verify.mjs`
- JSON parse check for `package.json`
- `npm run smoke:release-msi-install`
- `npm run release:verify`
- MSI smoke installs into `%TEMP%\codex-widget-msi-smoke`, launches the installed app hidden, verifies daemon WebSocket startup, uninstalls, and confirms no test install directory or port `4128` daemon remains.

Completed after standard OCR runtime discovery pass:

- `node --check scripts/prepare-ocr-runtime.mjs`
- `node --check scripts/smoke-ocr-runtime.mjs`
- `npm run smoke:ocr-runtime`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- OCR runtime preparation now finds explicit runtime dirs, explicit executables, PATH `tesseract`, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, and standard Windows install layouts before writing the bundled `dist/ocr-runtime/ocr-runtime.json` manifest.

Completed after OCR language defaults pass:

- `node --check scripts/prepare-ocr-runtime.mjs`
- `node --check scripts/smoke-ocr-runtime.mjs`
- `node --check scripts/smoke-screen-helper.mjs`
- `node --check scripts/smoke-screen-helper-ocr.mjs`
- `npm run smoke:ocr-runtime`
- `npm run smoke:screen-helper`
- `npm run smoke:screen-helper:ocr`
- `npm run lint`
- `npm run smoke:all`
- `npm run build`
- `npm run smoke:release-resources`
- OCR runtime manifests now include bundled `.traineddata` languages, and bundled OCR command resolution auto-selects `eng+kor` when `eng` and `kor` language packs are both present.

Completed after renderer chat layout hardening:

- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run smoke:all:live`
- `npm run build`

Completed after regenerate rollback pass:

- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run smoke:all:live`
- `npm run build`
- The renderer smoke asserts that regenerating the first of three assistant answers sends `regenerate.dropTurns: 3`.

Completed after direct Vision image input pass:

- `npm run lint`
- `npm run smoke:screen`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:screen` now asserts that screen snapshots become app-server image input items.

Completed after resident soak gate pass:

- `npm run lint`
- `npm run smoke:resident-soak`
- `npm run smoke:all:live`

Completed after browser DOM extension packaging pass:

- `npm run package:extension`
- `npm run smoke:extension`
- `npm run lint`
- `npm run smoke:all:live`
- `npm run build`
- `npm run smoke:extension` now verifies manifest icons, service worker syntax, zip creation, and required zip entries.

Completed after native daemon supervisor pass:

- `npm run smoke:tauri-supervisor`
- `npm run lint`
- `npm run smoke:renderer-chat`
- `npm run build`
- Added packaged-app daemon restart supervision with capped exponential backoff and shutdown cleanup; the smoke now verifies both delay capping and actual child restart after an exit.
- Added renderer-visible native daemon diagnostics so offline/reconnecting states can distinguish dev-services mode, daemon restart, and daemon errors.

Completed after bundled daemon runtime pass:

- `npm run smoke:node-runtime`
- `npm run lint`
- `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features`
- `npm run smoke:tauri-supervisor`
- `npm run smoke:all:live`
- `npm run build`
- `Select-String` over generated MSI/NSIS installer scripts confirmed `_up_\dist\daemon-bundle\standalone.js` and `_up_\dist\node-runtime\node.exe` are included.
- `npm run smoke:release-resources`
- `npm run smoke:release-launch`

Completed latest release build after provider/runtime readiness passes:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,307,072 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (4,161,536 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (3,063,170 bytes)
- Tauri resources include `_up_/providers/screen-capture-helper/capture-screen.ps1` and `_up_/providers/browser-dom-extension/manifest.json`.

Completed latest release build after persistent terminal session pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe`
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe`

Completed latest release build after native PTY runtime pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,312,704 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,497,728 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,760,198 bytes)
- Release bundles include `_up_/dist/pty-runtime/pty-runtime.json` and `_up_/dist/pty-runtime/node_modules/node-pty/package.json`.

Completed latest release build after renderer PTY viewport pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,501,824 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,764,420 bytes)

Completed latest release build after standard OCR runtime discovery pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,762,752 bytes)

Completed latest release build after OCR language defaults pass:

- `npm run build`
- `src-tauri/target/release/codex-widget-for-desktop.exe` (10,314,752 bytes)
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi` (39,505,920 bytes)
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe` (26,758,248 bytes)

## Restart Steps

1. Run `git status --short --untracked-files=all` and inspect the sync diff.
2. Default local live auth is Codex CLI auth. Use `CODEX_WIDGET_AUTH_MODE=codex`; Sign in should invoke `codex login` if the user is not already logged into Codex/ChatGPT.
3. Default Codex runtime is `CODEX_WIDGET_CODEX_RUNTIME=app-server`, which starts a daemon-owned background `codex app-server`. Set `CODEX_WIDGET_CODEX_RUNTIME=exec` only to force the older `codex exec resume` fallback.
4. Widget-launched Codex sessions default to `CODEX_WIDGET_CODEX_WORKDIR=<user-home>`, `CODEX_WIDGET_CODEX_SANDBOX=danger-full-access`, and `CODEX_WIDGET_CODEX_APPROVAL_POLICY=on-request`; override only when testing a different desktop file boundary or trusted no-approval automation path.
5. Use the dev auth proxy only for mock backend OAuth experiments: run `npm run dev:auth-proxy` or set `CODEX_WIDGET_DEV_AUTH_PROXY=1` before `npm run dev`.
6. For production-style backend OAuth proxy live responses, set `CODEX_WIDGET_AUTH_MODE=pkce` and replace `CODEX_WIDGET_AUTH_BASE_URL`/`CODEX_WIDGET_AGENT_PROXY_URL` with a real backend that implements `/oauth/authorize`, `/oauth/token`, redirects to `http://127.0.0.1:4128/oauth/callback`, and serves streaming model responses.
7. For token-mode fallback responses, set `CODEX_WIDGET_AUTH_MODE=token`, press Sign in in the widget, and use the inline token form to save the OAuth access token and backend proxy URL into gitignored `.env`.
8. Run `node .vibe/harness/scripts/vibe-sprint-mode.mjs status` to confirm whether extended mode is still active.
9. Use `npm run dev` for renderer HMR plus daemon restart-on-change; use `npm run dev:services` only when testing the service loop without launching Tauri.
10. Run `npm run smoke:all` after follow-up TypeScript/widget/provider changes. Use `npm run smoke:all:live` when validating Windows desktop capture behavior.
11. For renderer UI work, run `npm run smoke:renderer-chat` and capture a `360x480` Playwright smoke against `http://127.0.0.1:5173/?daemonPort=4128` when a visual screenshot is needed. Model/reasoning selectors live between the status strip and mode tabs and persist to localStorage keys `codex-widget-model` and `codex-widget-reasoning-effort`.
12. Renderer visible chat persists under `codex-widget-chat-messages:v1`; use the titlebar New chat control or `session.reset` protocol event to clear both UI and daemon session state.
13. The titlebar close button hides the widget to tray; use tray Quit to exit the resident app.
14. Run `npm run smoke:resident` when resident lifecycle, daemon health, or resource behavior changes.
15. Run `npm run smoke:tauri-supervisor` after Tauri/Rust daemon lifecycle changes.
16. Run `npm run smoke:node-runtime` after daemon bundle, Node runtime resource, or Tauri resource packaging changes; run `npm run smoke:pty-runtime` after PTY runtime packaging changes.
17. Run `npm run smoke:release-resources` after `npm run build` when release bundle resources change.
18. Run `npm run smoke:release-launch` after `npm run build` when native daemon startup, bundled runtime resolution, or release exe behavior changes.
19. Run `npm run smoke:release-install` after `npm run build` when NSIS installability, bundled installed resources, or installer cleanup behavior changes. Run `npm run smoke:release-msi-install` after MSI installability, WiX, or release verification changes. Both refuse to run over existing install state unless `CODEX_WIDGET_RELEASE_INSTALL_SMOKE_ALLOW_EXISTING=1` is set for a controlled test machine.
20. Run `npm run smoke:dom` after browser/DOM provider ingress changes, `npm run smoke:extension` after browser extension or packaging changes, `npm run smoke:browser-native-host` after native messaging host changes, `npm run smoke:browser-store` after browser store metadata changes, `npm run smoke:screen` after Vision provider changes, `npm run smoke:screen-capture:live` after daemon-triggered capture changes, `npm run smoke:screen-helper`, `npm run smoke:screen-helper:ocr`, and `npm run smoke:ocr-runtime` after screen helper/OCR changes, `npm run smoke:terminal` after one-shot terminal provider changes, and `npm run smoke:terminal-session` plus `npm run smoke:pty-runtime` after `/pty` session changes.
21. DOM snapshot testing can use `providers/browser-dom-extension` as an unpacked Chrome/Edge extension or `docs/providers/dom-snapshot-bookmarklet.js` as a fallback against the local daemon on port `4128`.
22. Screen snapshot testing can use `providers/screen-capture-helper/capture-screen.ps1` for live capture or `docs/providers/screen-snapshot-example.json` as the raw payload shape against `POST /providers/screen/snapshot`.
23. Run `npm run release:verify` as the full live release gate before treating a build as releasable; it includes NSIS and MSI install smokes.
24. Run `npm run release:soak` for longer release-exe resident validation before manual release candidates or resident lifecycle changes.
25. Run `npm run build` before individual release checks when not using `release:verify`; MSI/NSIS bundle creation is now part of the installability gate.
26. Run `npm run vibe:checkpoint` before ending any follow-up maintenance session.

Use `docs/context/qa.md` for routine follow-up commands.
