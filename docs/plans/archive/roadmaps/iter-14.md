## Iteration iter-14: Browser Action Semantic Target Pipeline

Carryover: Iteration 13 removed the manual snapshot UX, but Browser Action prompt execution still had a semantic gap: Korean commands like `새 채팅 눌러줘` were planned with the full command phrase as the target, and broad DOM containers could tie with the intended actionable link/button.

### iter-14-sprint-01-vision-style-intent-and-lexicon-layer

Goal: benchmark Vision Context's intent/reference resolver separation and add a dedicated Browser Action intent normalization layer.

Dependencies: iter-13 Browser Bridge, `src/daemon/browser-action/promptTool.ts`, Vision Context `intentResolver`/`referenceResolver` structure.

Expected scope: target/action suffix stripping, Korean command phrase extraction, target alias/compact/token lexicon, and prompt planner wiring.

Status: complete. Added `src/daemon/browser-action/intentResolver.ts` and `targetLexicon.ts`; prompt planning now resolves `새 채팅 눌러줘` into a click action targeting `새 채팅` rather than the full command sentence.

### iter-14-sprint-02-target-resolver-confidence-and-actionable-ranking

Goal: make DOM target resolution favor the actual actionable element over broad page/sidebar containers.

Dependencies: element graph, target resolver, structured Browser Bridge observations.

Expected scope: normalized alias matching, Korean token handling, compact text matching, actionable-role/tag preference, and smoke coverage for exact/ambiguous cases.

Status: complete. `targetResolver` now expands aliases, scores compact Korean labels, accepts short CJK tokens, and caps non-actionable container candidates for text targets so visible links/buttons/inputs win with safety-threshold confidence.

### iter-14-sprint-03-bridge-auto-observe-hardening-and-verification

Goal: keep the snapshotless Browser Bridge pipeline reliable for prompt-driven actions.

Dependencies: browser extension service worker, DOM provider endpoint, Browser Action smokes.

Expected scope: ensure approved-site auto-observe persists current DOM to the daemon without relying on a native-host-only success path, and verify prompt/resolver behavior.

Status: complete. Browser Bridge auto-observe now posts the DOM snapshot to the daemon over HTTP first and falls back to native host only if HTTP fails. Verification passed daemon build, Browser Action core/e2e/prompt-classification smokes, extension smoke, and Browser Bridge smoke.
