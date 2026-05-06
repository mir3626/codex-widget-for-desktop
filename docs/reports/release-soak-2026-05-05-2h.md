# Release Soak Evidence - 2026-05-05

Command:

```powershell
$env:CODEX_WIDGET_RELEASE_SOAK_MS='7200000'
$env:CODEX_WIDGET_RELEASE_SOAK_REPORT='C:\Users\Tony\Workspace\codex-widget-for-desktop\dist\reports\release-soak-2026-05-05-2h.json'
node scripts/smoke-release-soak.mjs
```

Result:

- Duration: 7,200 seconds
- Runtime samples: 1,439
- Ping/pong responses: 3,587
- Active requests at end: 0
- Root app process present at end: true
- Daemon process present at end: true
- Start working set: 412.4 MB
- End working set: 358.5 MB
- Growth: -54.0 MB
- Process count at end: 9
- Thresholds: max working set 1,024 MB, max growth 256 MB
- Log stderr: empty

`npm run release:readiness` passes the `multi-hour-soak` gate with `dist/reports/release-soak-latest.json` copied from this report. Browser store account submission was later deferred until after dogfooding and is tracked in `docs/release/deferred-gates.json`.
