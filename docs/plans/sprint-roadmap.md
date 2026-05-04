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
