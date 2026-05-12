# Windows Computer-Use High-Risk Dogfood Evidence - 2026-05-12

## Scope

- Matrix: `docs/plans/windows-computer-use-high-risk-dogfood-matrix.md`
- Daemon port: `31886`
- Mode: safe baseline collector
- Real Windows setting mutation: no
- Supporting JSON: `docs/reports/assets/windows-computer-use-high-risk-dogfood-2026-05-12/evidence.json`

## Scenario Results

| Scenario | Surface | Risk | Status | Notes |
| --- | --- | --- | --- | --- |
| `settings.theme.read` | Windows Settings | `read_only` | passed | Read current theme state only; no Windows setting was changed. |
| `browser.bookmark.crud` | Browser Chrome | `reversible_side_effect` | passed | Uses simulated Browser Bridge command/result exchange against the daemon command bridge. |
| `terminal.credential.blocked` | Terminal | `credential_sensitive` | passed | Credential-like terminal command should be rejected before capability job persistence. |

## Capability Jobs

- settings.theme.read: `dogfood-settings-theme-read-1778587853027` terminal/completed, verification `passed`
- browser.bookmark.crud: `dogfood-browser-bookmark-list` browser_chrome/completed, verification `passed`
- browser.bookmark.crud: `dogfood-browser-bookmark-create` browser_chrome/completed, verification `passed`
- browser.bookmark.crud: `dogfood-browser-bookmark-update` browser_chrome/completed, verification `passed`
- browser.bookmark.crud: `dogfood-browser-bookmark-open` browser_chrome/completed, verification `passed`
- browser.bookmark.crud: `dogfood-browser-bookmark-remove` browser_chrome/completed, verification `passed`

## Acceptance

- Safe baseline only: passed
- Executed scenarios passed or skipped: passed
- Capability details captured: passed
- Credential-like terminal blocked before persistence: passed

## Notes

This collector intentionally avoids live Windows setting mutation. The next
expansion should enable reversible OS/app workflows one at a time with explicit
approval, before/after evidence, and rollback proof.
