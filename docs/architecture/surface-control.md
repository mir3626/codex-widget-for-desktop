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
- `desktop`: future bounded Windows UI Automation/native input helper

## Current Foundation

`src/daemon/capability-transaction/surfaceControl.ts` defines the common stage
names and capability description. `src/daemon/prepared-context/adapters/`
contains projections for screen snapshots, Vision TaskCapsules, and Terminal
state so those surfaces can enter the same prepared-context/semantic pipeline as
Browser Action.

Desktop control remains intentionally bounded: future helpers should target
browser windows, permission prompts, file-picker boundaries, and restricted-page
fallbacks before any broader desktop automation is considered.
