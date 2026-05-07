# Vision Context Dogfood Evidence - 2026-05-07

## Purpose

Collect real Vision Context dogfood evidence before marking semantic acceptance complete.

This run used the actual downstream `/vibe-review` v1.7.8 dogfood report as the task source, not a synthetic fixture. The captured task asked Vision Context to inspect the report's `Semantic acceptance evidence` residual and decide whether semantic acceptance should be marked complete.

## Source

- Review report: `docs/reports/review-0-2026-05-07-v1.7.8-dogfood.md`
- Visual input: `docs/reports/vision-context-dogfood-assets/semantic-acceptance-context.png`
- Protocol/input artifact: `docs/reports/vision-context-dogfood-assets/semantic-acceptance-turn-capture.json`
- Repro script: `scripts/dogfood-vision-context-semantic-evidence.mjs`

## Execution

Commands:

```powershell
npm run build:daemon
node scripts/dogfood-vision-context-semantic-evidence.mjs
```

The script rendered the real residual review section as a screenshot, started a daemon Vision Context session over the renderer-compatible `visionContext.*` WebSocket protocol, sent a Korean speech request plus the screenshot event, stopped the session with `sendToAgent: true`, and captured the fake Codex app-server `turn/start` input.

## Evidence

- Capsule intent: `summarize_content`
- Capsule evidence count: `3`
- Raw media deletion count: `2`
- Raw media still present after processing: `false`
- App-server input types: `text`, `localImage`
- `localImage` count: `1`
- Raw WebM/audio path leaked into app-server input: `false`
- Fake app-server decision: `semantic-decision=hold-semantic-acceptance`

The app-server input contained the residual state (`PASS WITH RESIDUAL`) plus the semantic guidance that Vision Context was dogfood-ready but not semantically accepted yet. The image path was passed as `localImage`, and only capsule text plus the selected image were sent to the app-server-compatible input path.

## Outcome

This is now a real task-quality dogfood artifact for Vision Context: the daemon protocol and app-server input path preserved enough report context to reach the correct task decision, which is to hold semantic acceptance instead of marking it complete.

Semantic acceptance is still not marked complete from this single run. The remaining stronger evidence would be a live UI screen-share transcript or live-model before/after task outcome, but the prior state has moved from "no semantic evidence" to "first dogfood evidence collected."
