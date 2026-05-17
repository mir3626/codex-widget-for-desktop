# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: idle
> **Completed**: iter-38-sprint-01-background-browser-chrome-control
> **Pending**: -
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration iter-38: Background Browser Chrome Control

Status: complete.

Carryover: iter-37 fixed compound prompt decomposition. The remaining real-use
control gap is browser chrome operations such as tab switching: they should use
background Chrome control when available instead of OS hotkeys, mouse movement,
or page DOM clicks.

### iter-38-sprint-01-background-browser-chrome-control

Goal: add regression coverage and implement prompt routing plus command support
for safe background Browser Chrome controls, starting with ordinal tab
activation such as "첫번째 탭으로 전환해줘".

Status: complete. Ordinal tab-switch prompts such as "첫번째 탭으로
전환해줘" now route through Browser Chrome `tab.activate`, which the extension
executes with `chrome.tabs.update` and verifies with active-tab state. The path
records browser-chrome/background metadata and no native input, hotkey, or
pointer usage.
