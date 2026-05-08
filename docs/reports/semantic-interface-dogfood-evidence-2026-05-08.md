# Semantic Interface Dogfood Evidence

Date: 2026-05-08

## Summary

- Golden trace cases: 11
- Golden trace failures: 0
- Browser live gate target: concept-posts
- Browser live gate confidence: 0.8385
- Browser live gate result status: pending
- Browser live gate command queued: true
- Redacted trace attached: true

## Golden Trace Results

| Case | Mode | Adversarial class | Outcome | Pass | Reason |
| --- | --- | --- | --- | --- | --- |
| typed-browser-concept-filter | typed |  | act | yes | passed |
| untyped-vision-read | untyped |  | act | yes | passed |
| duplicate-label | adversarial | duplicate_label | abstain | yes | passed |
| post-hydration-drift | adversarial | post_hydration_drift | act | yes | passed |
| aria-visible-mismatch | adversarial | aria_visible_mismatch | act | yes | passed |
| offscreen-occluded | adversarial | offscreen_or_occluded_target | abstain | yes | passed |
| i18n-alias | adversarial | i18n_alias | act | yes | passed |
| dynamic-id-churn-a | adversarial | dynamic_id_churn | act | yes | passed |
| dynamic-id-churn-b | adversarial | dynamic_id_churn | act | yes | passed |
| shadow-dom-boundary | adversarial | shadow_dom_boundary | act | yes | passed |
| nested-form-scope | adversarial | nested_form_scope | act | yes | passed |

## Browser Live Gate

The Browser Action executor remained feature-owned. Semantic Interface only supplied a target-resolution decision and redacted trace metadata.

```json
{
  "semantic": {
    "primary": "concept-posts",
    "confidence": 0.8385,
    "reason": "Semantic Interface selected button 개념글 for activate.",
    "outcome": "act"
  },
  "execution": {
    "resultStatus": "pending",
    "safetyDecision": "allow",
    "verification": {
      "status": "unknown",
      "reason": "Action has not completed yet."
    },
    "commandQueued": true
  }
}
```

## Notes

- This evidence is deterministic and redacted.
- No raw browser profile state, password, token, cookie, payment, or credential values are persisted.
- This report proves semantic target resolution and live low-risk Browser Action gating on a fixture; real-site Browser Bridge dogfood remains covered by Browser Action/Bridge evidence reports.
