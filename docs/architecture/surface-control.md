# Surface Control Architecture

## Purpose

Windows computer-use parity should not become a separate automation stack.
Browser Action, Vision Context, Terminal, Workspace, and future Desktop UI
control should all implement the same surface-control stages.

## Stages

```text
observe -> understand -> propose -> gate -> bind -> act -> verify -> remember
```

## Surface Types

- `browser_page`: Browser Bridge, CDP, Playwright, native browser fallback
- `screen`: Vision Context and screen capture
- `terminal`: one-shot command and PTY session state
- `workspace`: repository/project context
- `desktop`: bounded Windows UI Automation/native input helper

## Current Foundation

`src/daemon/capability-transaction/surfaceControl.ts` defines the common stage
names and capability description. `src/daemon/prepared-context/adapters/`
contains projections for screen snapshots, Vision TaskCapsules, and Terminal
state so those surfaces can enter the same prepared-context/semantic pipeline as
Browser Action.

Desktop control remains intentionally bounded. The production-oriented helper is
the Rust executable built from `providers/browser-native-desktop-helper-rs/` to
`dist/browser-native-desktop-helper/browser-native-desktop-helper.exe`; the
PowerShell helper at
`providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`
remains a development/debug fallback. Both implement the Browser Action native
helper JSON contract for browser windows, permission prompts, file-picker
boundaries, and restricted-page recovery paths. Broader arbitrary desktop
automation remains out of scope.
