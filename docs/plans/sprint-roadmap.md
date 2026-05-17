# Sprint Roadmap

<!-- BEGIN:VIBE:CURRENT-SPRINT -->
> **Current**: idle
> **Completed**: iter-37-sprint-01-multi-step-prompt-decomposition
> **Pending**: -
<!-- END:VIBE:CURRENT-SPRINT -->

> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.

## Iteration iter-37: Browser Action Multi-Step Prompt Decomposition

Status: complete.

Carryover: iter-36 fixed explicit navigation false negatives. The remaining
real-use blocker is compound prompts such as "Gmail open then spam folder":
the prompt planner can collapse the whole utterance into one click target
instead of first navigating to the requested destination and then acting on the
in-page target.

### iter-37-sprint-01-multi-step-prompt-decomposition

Goal: add regression coverage and implement generic compound Browser Action
prompt decomposition for known-destination "open/go to X, then click Y" tasks.

Status: complete. The planner now splits known-destination compound prompts
into a `navigate` step followed by the follow-up in-page Browser Action intent.
`gmail 들어가서 스팸편지함 눌러줘` resolves to `navigate
https://mail.google.com/` plus `click 스팸편지함` instead of a single click
target containing the destination phrase.
