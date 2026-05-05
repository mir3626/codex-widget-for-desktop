# Sprint Roadmap

## Iteration 1: Resident Agent Widget Foundation

### sprint-01-auth-architecture

Goal: replace the current API-key-first mental model with a documented OAuth-ready auth/backend boundary while preserving local mock and daemon development.

Dependencies: current Tauri widget and daemon.

Expected scope: docs, config, daemon auth boundary notes, optional local token abstraction.

### sprint-02-browser-dom-bridge

Goal: add the first real browser provider contract for active-tab DOM selection and element metadata.

Dependencies: shared daemon event protocol.

Expected scope: provider interface, extension/native bridge plan or scaffold, UI status events.

### sprint-03-terminal-pty-provider

Goal: add a real terminal provider using ConPTY/node-pty or a selected equivalent and stream shell output as tool events.

Dependencies: daemon provider router.

Expected scope: dependency decision, PTY lifecycle, cancel/close behavior, smoke test.

### sprint-04-screen-vision-provider

Goal: add a screen capture provider abstraction with crop/diff metadata ready for image or computer-use loops.

Dependencies: provider router and approval policy.

Expected scope: Windows capture research spike or minimal provider, safety/consent UI, testable stubs.

### sprint-05-packaging-and-startup

Goal: make the widget practical to install and run as a resident desktop utility.

Dependencies: stable shell and daemon startup.

Expected scope: Tauri bundle settings, autostart/tray behavior, release smoke checklist.

## Iteration iter-2: Resident Runtime Expansion

Carryover: Iteration 1 produced the resident Tauri shell, OAuth/Codex auth boundary, streaming chat UX, and default `codex app-server` runtime. The next iteration focuses on turning that foundation into a durable desktop assistant instead of a prototype conversation panel.

### iter-2-sprint-01-runtime-protocol

Goal: stabilize the renderer-daemon protocol for long-lived Codex sessions, including session reset, app-server interactions, and persistent visible conversation state.

Dependencies: `CodexAppServerBridge`, shared `ServerEvent`/`ClientMessage`, renderer chat timeline.

Expected scope: shared protocol types, app-server approval/user-input bridge, renderer interaction cards, local chat persistence, `CODEX_WIDGET_CODEX_APPROVAL_POLICY` config.

Status: app-server approval/input interactions, runtime diagnostics, local chat persistence, explicit New chat reset, app-server-backed regenerate rollback, branch-safe `session.branch` plus one-shot `branchContext`, and reconnect response snapshot replay are implemented with daemon and renderer smoke coverage.

### iter-2-sprint-02-tool-provider-shell

Goal: promote DOM, Vision, and PTY modes from passive stubs to provider contracts with clear status, permission, and event surfaces.

Dependencies: runtime protocol from sprint 01.

Expected scope: provider interfaces, mode-specific state cards, PTY command lifecycle spike, browser/screen permission placeholders with testable events.

Status: DOM snapshot ingress, an unpacked browser DOM extension with local-only Options URL configuration, optional Chrome/Edge native messaging host, store listing/privacy/review metadata, Screen/Vision snapshot ingress, direct app-server image input, daemon-triggered Windows screen capture with optional OCR command support, bundled OCR runtime packaging, explicit terminal command execution, and a node-pty/ConPTY-backed `/pty` command/raw-input session are implemented with smoke coverage. Remaining provider work is final browser store account submission, higher-quality OCR runtime acquisition defaults, a dedicated terminal-emulator viewport, and deeper native integrations.

### iter-2-sprint-03-resident-desktop-ops

Goal: harden resident desktop behavior for daily use.

Dependencies: stable runtime lifecycle.

Expected scope: tray/autostart settings, resource budget checks, crash/reconnect recovery, process cleanup verification, report/checkpoint refresh.

Status: tray/autostart, runtime status, installer builds, native daemon restart supervision, renderer-visible native daemon diagnostics, daemon parent watchdog cleanup, bundled daemon/Node/PTY runtime resources, installed `_up_` resource resolution, resident resource smoke, resident soak smoke, release exe longer soak, bundled runtime smoke, release exe launch smoke, NSIS install/uninstall plus daemon/app crash cleanup smoke, and a one-command `release:verify` gate are implemented. Remaining desktop-readiness work is MSI install/uninstall observation, multi-hour/manual soak coverage, and release checklist polish.
