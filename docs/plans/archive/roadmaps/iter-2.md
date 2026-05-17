## Iteration iter-2: Resident Runtime Expansion

Carryover: Iteration 1 produced the resident Tauri shell, OAuth/Codex auth boundary, streaming chat UX, and default `codex app-server` runtime. The next iteration focuses on turning that foundation into a durable desktop assistant instead of a prototype conversation panel.

### iter-2-sprint-01-runtime-protocol

Goal: stabilize the renderer-daemon protocol for long-lived Codex sessions, including session reset, app-server interactions, and persistent visible conversation state.

Dependencies: `CodexAppServerBridge`, shared `ServerEvent`/`ClientMessage`, renderer chat timeline.

Expected scope: shared protocol types, app-server approval/user-input bridge, renderer interaction cards, local chat persistence, `CODEX_WIDGET_CODEX_APPROVAL_POLICY` config.

Status: app-server approval/input interactions, runtime diagnostics, local chat persistence, explicit New chat reset, app-server-backed regenerate rollback, branch-safe `session.branch` plus one-shot `branchContext`, reconnect response snapshot replay, fake app-server protocol coverage for thread reuse/approval/rollback, and optional live Codex app-server smoke coverage for real CLI protocol drift are implemented with daemon and renderer smoke coverage.

### iter-2-sprint-02-tool-provider-shell

Goal: promote DOM, Vision, and PTY modes from passive stubs to provider contracts with clear status, permission, and event surfaces.

Dependencies: runtime protocol from sprint 01.

Expected scope: provider interfaces, mode-specific state cards, PTY command lifecycle spike, browser/screen permission placeholders with testable events.

Status: DOM snapshot ingress, an unpacked browser DOM extension with local-only Options URL configuration, optional Chrome/Edge native messaging host, store listing/privacy/review metadata, generated browser store submission packet, browser store submission confirmation evidence support, Screen/Vision snapshot ingress, direct app-server image input, daemon-triggered Windows screen capture with Settings/env/visual-drag configured crop, optional OCR command support, bundled OCR runtime packaging with standard Windows install discovery, tessdata language acquisition/defaults, OCR-only PNG preprocessing, image hash/change/diff metadata with configurable thresholding, explicit terminal command execution, a node-pty/ConPTY-backed `/pty` command/raw-input session, raw-input output drain, direct `terminal.input` protocol, SGR mouse click/drag/wheel forwarding, and a renderer PTY viewport with direct input controls are implemented with smoke coverage. Final browser store account submission is deferred until after dogfooding; deeper native integrations are future enhancement work, not a current release gate.

### iter-2-sprint-03-resident-desktop-ops

Goal: harden resident desktop behavior for daily use.

Dependencies: stable runtime lifecycle.

Expected scope: tray/autostart settings, resource budget checks, crash/reconnect recovery, process cleanup verification, report/checkpoint refresh.

Status: tray/autostart, runtime status, installer builds, native daemon restart supervision, renderer-visible native daemon diagnostics, daemon parent watchdog cleanup, bundled daemon/Node/PTY runtime resources, installed `_up_` resource resolution, resident resource smoke, resident soak smoke, release exe longer soak with JSON evidence reports, bundled runtime smoke, release exe launch smoke, NSIS install/uninstall plus daemon/app crash cleanup smoke, MSI install/launch/uninstall smoke, one-command `release:verify`, browser store submission packet generation, a passed two-hour release soak evidence run, and `release:readiness` artifact/soak/manual-blocker audit gates are implemented. Browser store account submission is deferred until after dogfooding.
