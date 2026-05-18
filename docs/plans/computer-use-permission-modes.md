# Computer Use Permission Modes

Date: 2026-05-18

This file is the current reference for user-facing Computer Use permission
profiles. Older notes that say credential, cookie, CAPTCHA, payment, or
purchase flows are simply blocked should be read through this mode matrix.

## Mode Matrix

| Mode | Intended use | What can proceed | Still enforced |
| --- | --- | --- | --- |
| YOLO mode | Broad one-time browser, Toolsmith, terminal, and artifact work where the user wants fewer routine prompts. | Read/write roots, network/browser domains, generated tools, package install, and command prefixes that the profile explicitly grants. | Credential/cookie/CAPTCHA and payment/purchase safety groups remain locked. Host OS mutation, foreground desktop, restricted pages, raw secret persistence, and unsupported VM/native paths keep their normal guards. |
| SUPER-YOLO mode | A confirmed one-time escalation for broad local/browser/tool work. | Broader file roots, browser/network domains, command prefixes, package install, generated code/tools, high-risk class, and OS mutation grants when the profile says so. | The two high-risk safety groups are still default-off: credential/cookie/CAPTCHA and payment/purchase. They do not proceed until each category is explicitly unlocked. |
| SUPER-YOLO + credential/cookie/CAPTCHA unlock | User has enabled SUPER-YOLO and acknowledged the credential/cookie/CAPTCHA disclaimer. | Permission-profile checks for `credential_access`, browser profile/session/account/cookie access, credential risk class, and matching command deny patterns may proceed to the runtime path. Browser evaluate can use `allowCredentialAccess` only through this mode-derived grant. | Raw secret values remain redacted or transient. Debug bundles, eval resources, semantic memory, and activity logs must not persist password, token, cookie, or credential values. Browser/profile evidence stays summary-only. Runtime confirmation/takeover may still be required. CAPTCHA solving/bypass is not treated as a silent background action. |
| SUPER-YOLO + payment/purchase unlock | User has enabled SUPER-YOLO and acknowledged the payment/purchase disclaimer. | Permission-profile checks for payment/purchase command deny patterns and high-risk payment/purchase requirements may proceed to explicit approval/execution paths. | The action is not silently committed. UI submit, checkout, payment, purchase, subscription, or order confirmation paths still need visible user intent, audit evidence, and rollback/verification where applicable. |

## Implementation Rules

- Mode unlocks satisfy profile-level permission requirements only. They do not
  disable downstream runtime safety, restricted-page handling, OS availability,
  signed-helper gates, or external contract blockers.
- SUPER-YOLO unlocks are represented by `safetyBoundaries` markers:
  - `super_yolo_requires_user_confirmation`
  - `credential_cookie_captcha_boundary_released_by_user`
  - `payment_purchase_boundary_released_by_user`
- Both unlock categories are default-off in generated SUPER-YOLO drafts.
- Disclaimers are persisted in the profile boundary list so debug bundles can
  show that the user intentionally released the category.
- `credentialAccess` may remain `"never"` in the profile. The unlock marker
  means the permission evaluator can pass profile-level requirements into the
  redacted runtime path; it does not mean the daemon stores or retrieves raw
  secrets.
- One-time profile expiry, max-use, disable/revoke, command prefix, domain,
  file-root, output-size, runtime-timeout, and eval-ledger requirements still
  apply in all modes.
