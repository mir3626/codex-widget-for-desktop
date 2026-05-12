# Windows Computer-Use High-Risk Dogfood Matrix

Status: active planning and evidence collection
Owner: Codex
Date: 2026-05-12

## Objective

Prove that the daemon capability foundation can run real Windows computer-use
workflows with observable before/after evidence, bounded approvals, rollback, and
explicit blocks for destructive or credential-sensitive work.

This matrix is intentionally conservative. The first dogfood pass should prefer
read-only and reversible workflows, then expand only after diagnostics and
release signing controls are visible in the widget.

## Risk Classes

| Class | Meaning | Default policy |
| --- | --- | --- |
| `read_only` | Observe UI, read state, capture screen/OCR, list browser chrome state | Allowed without side-effect approval |
| `reversible_side_effect` | Change isolated app/browser/temp state and verify rollback | Requires approval and rollback evidence |
| `high_risk_side_effect` | OS setting changes that affect connectivity, privacy, security, startup, files, or accounts | Requires explicit scenario design and manual checkpoint |
| `credential_sensitive` | Passwords, tokens, cookies, payment data, account secrets | Block or redact; no persistence of raw values |
| `destructive` | Delete real user data, disable protections, irreversible settings | Block by default |

## Scenario Matrix

| ID | Surface | Workflow | Risk | Automation path | Required evidence | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| `settings.theme.read` | Windows Settings/registry | Read current app/system theme state from HKCU Personalize keys | `read_only` | `terminal` capability, approved read command | command stdout, capability detail JSON, verification status | none |
| `settings.theme.toggle.reversible` | Windows Settings | Toggle app theme and return to original value | `reversible_side_effect` | `desktop_action` + `screen_observe` + registry readback | before registry value, approval id, after value, screenshot/OCR, restored value | restore original registry/UI value |
| `settings.network.blocked` | Windows Settings | Attempt proxy/firewall/network security mutation | `high_risk_side_effect` | policy-only negative test | blocked decision, no persisted secret or mutation | none |
| `browser.bookmark.crud` | Browser chrome | Create, update, open, remove an isolated bookmark | `reversible_side_effect` | `browser_chrome` capability via Browser Bridge | bookmark tree before/after, command payload, verification metadata | remove test bookmark |
| `browser.credential.blocked` | Browser/page | Attempt to persist or operate on password/token/payment-like data | `credential_sensitive` | policy-only negative test | blocked/redacted payload, no raw secret in job input | none |
| `app.notepad.tempfile` | Notepad | Open a temp file, write text, save, verify content | `reversible_side_effect` | `desktop_action` + temp file readback | temp path, UIA/window evidence, file hash/content, cleanup result | delete temp file |
| `app.calculator.readonly` | Calculator | Enter arithmetic and verify displayed result | `reversible_side_effect` | `desktop_action` + OCR/UIA observe | before/after OCR or UIA text, expected result | close app |
| `terminal.credential.blocked` | Terminal | Attempt command containing credential-like inline text | `credential_sensitive` | `terminal` capability enqueue guard | daemon error event, absence of persisted job | none |
| `screen.ocr.read` | Desktop screen | Capture current screen and OCR bounded text | `read_only` | `screen_observe` + `ocr` | resource id/blob id, preview, redaction metadata | none |

## Guardrails

- Every `reversible_side_effect` and `high_risk_side_effect` job must enter
  `awaiting_approval` before execution.
- A scenario must not be marked passed unless it has before/after evidence.
- Live Windows mutation scenarios must preserve the original state and prove
  rollback before the report is accepted.
- Credential-like input must fail before persistence or be redacted before
  storage. Raw credentials must not appear in capability job input, resources,
  ledger activity, or reports.
- Stale context, wrong window, helper timeout, helper signature failure, and
  verification mismatch are expected failure classes, not reasons to bypass the
  daemon.

## Current Evidence Collector

`npm run dogfood:windows-computer-use` runs the safe baseline collector:

- reads current Windows theme state through an approved terminal capability on
  Windows,
- exercises an isolated Browser Chrome bookmark CRUD workflow through the daemon
  command bridge with simulated extension results,
- verifies credential-like terminal commands are rejected before persistence,
- writes `docs/reports/windows-computer-use-high-risk-dogfood-<date>.md` plus a
  JSON evidence file under `docs/reports/assets/`.

The collector does not mutate real Windows settings by default. Add explicit
flags/env gates before enabling live OS setting changes.

## Next Expansion

1. Add a renderer Capability Jobs panel to make job state, approvals,
   diagnostics, locks, and resources visible during dogfood.
2. Add live Browser Bridge mode for `browser.bookmark.crud` using a real browser
   extension profile.
3. Add manual-checkpoint guarded `settings.theme.toggle.reversible`.
4. Add app-specific temp-sandbox workflows for Notepad and Calculator.
5. Add release-mode signing enforcement before expanding native helper reach.
