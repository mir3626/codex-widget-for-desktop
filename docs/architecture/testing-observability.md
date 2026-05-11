# Testing And Observability

## Test Tiers

- Fast: TypeScript checks and pure daemon unit/smoke tests that do not launch a
  browser.
- Capability: Browser Action, Vision Context, Terminal, Semantic Interface, and
  Semantic Memory focused smokes.
- Live dogfood: real browser/site/widget runs, opt-in and redacted.
- Release: installer, bundled daemon, extension packaging, and readiness gates.

## Live Artifact Policy

Live-run artifacts are useful for debugging but should not make `git status`
noisy by default. Default output belongs in ignored live-run paths. Curated
evidence should be promoted into tracked reports only after review.

## Debug Bundle

Every failed or ambiguous capability transaction should be exportable as one
redacted bundle containing:

- prompt/request
- transaction id
- context lease identity
- candidates and score breakdown
- gate decision
- safety decision
- approval/clarification decisions
- adapter command/ack/result events
- before/after context summaries
- expected-effect verification
- timing breakdown
- redaction summary

Browser Action publishes this information to the renderer through
`browserAction.diagnostics` for non-completed prompt transactions. The event is
diagnostic-only: it may include timing summaries, redacted debug bundle metadata,
transaction/request ids, and plan status, but it must not persist full page
state or sensitive field values.

## Timing

Latency should be measured per stage:

- request received
- context wait
- planning
- clarification/approval wait
- adapter pickup
- execution
- reobserve
- verification
- assistant response completion

## Semantic Trace Corpus

`docs/dogfood/semantic-trace-corpus.jsonl` is the deterministic seed corpus for
Semantic Interface calibration. `npm run smoke:semantic-trace-corpus` verifies
that the corpus maps to golden trace cases, covers the suite, and keeps current
pass/fail metrics at the expected baseline. Real dogfood traces should be
reviewed and redacted before promotion into this corpus.

`docs/dogfood/browser-action-semantic-live-corpus.jsonl` records reviewed live
Browser Action report rows as semantic feedback evidence. It references tracked
report markdown, not raw screenshots or full page dumps.
`npm run smoke:browser-action:semantic-live-corpus` verifies the referenced
scenarios and intent coverage.

`scripts/browser-action-live-runner.mjs` is the repeatable live Browser Action
runner. It supports isolated, widget-UI, and real active-tab modes. The
completion gate uses `npm run smoke:browser-action:live-harness` to verify the
scenario parser and dry-run artifact path without launching a browser, while
live dogfood remains opt-in through `npm run dogfood:browser-action:live`,
`:widget-ui`, or `:real`.

## Native Desktop Helper

`npm run build:browser-native-desktop-helper` builds the Rust native UIA helper
and copies it into `dist/browser-native-desktop-helper/`.

`npm run smoke:browser-native-desktop-helper-native` verifies the built Rust
helper contract without mutating the user's browser. It checks `status`,
`observe`, safe `read`, sensitive-text blocking, and `evaluate` blocking.

`npm run smoke:browser-native-desktop-helper` verifies the PowerShell fallback
helper contract without mutating the user's browser. It checks `status`,
`observe`, safe `read`, and sensitive-text blocking.

`npm run smoke:browser-native-desktop-helper:signature` reports Authenticode
signature state for the built native helper. In development it allows unsigned
or unavailable signature state; release verification should set
`CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1` after a code-signing certificate or CI
signing service is available.

`npm run sign:browser-native-desktop-helper` invokes `signtool.exe` when
`CODEX_WIDGET_SIGN_HELPERS=1` and either
`CODEX_WIDGET_SIGN_CERT_THUMBPRINT` or `CODEX_WIDGET_SIGN_CERT_PATH` is
configured.

`npm run smoke:browser-native-desktop-helper:live` launches an isolated
Chrome/Edge profile, verifies that the helper observes a real browser window,
and executes a bounded browser chrome `reload` action. This live smoke is
included only in `npm run smoke:all -- --include-live`.
