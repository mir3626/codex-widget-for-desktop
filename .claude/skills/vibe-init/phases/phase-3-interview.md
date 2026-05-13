## Phase 3 — 프로젝트 맞춤 설정 (native socratic interview: vibe-interview)

Phase 3 인터뷰는 `.vibe/harness/scripts/vibe-interview.mjs`만 사용합니다.
상세 실행 규약은 `.claude/skills/vibe-interview/SKILL.md`를 authoritative runbook으로 따릅니다.

> **CRITICAL — Phase 3는 스킵 금지**: 사용자가 "자율 진행 / 위임 / 알아서 해"라고 말해도 Phase 3 인터뷰 자체는 반드시 완주합니다. 사용자가 직접 답하지 않으면 Orchestrator가 PO-proxy로 답변하고 rationale을 남깁니다.

### Step 3-0: 도메인 추론 시작

사용자의 프로젝트 한 줄 설명을 입력으로 받아 인터뷰 세션을 시작합니다. 이 단계는 도메인 추론, probing 질문, context shard seed 생성을 준비합니다.

실행 순서:

1. 사용자에게 프로젝트 한 줄 설명을 요청합니다.
2. `node .vibe/harness/scripts/vibe-interview.mjs --init --prompt "<one-liner>" [--lang ko|en] [--max-rounds 30] [--output .vibe/interview-log/<session-id>.json]`
3. stdout의 `{ phase: "domain-inference", inferencePrompt }`를 Orchestrator가 읽습니다.
4. 적절한 domain string을 판단해 기록합니다.
5. 이후 호출은 `.claude/skills/vibe-interview/SKILL.md`의 invocation protocol을 따릅니다.

### Step 3-1: native socratic interview 진행

- `vibe-interview`는 10개 핵심 dimension을 backbone으로 삼고, 다음 질문은 Orchestrator LLM이 생성합니다.
- 각 라운드는 누락 coverage와 모호도가 높은 dimension을 중심으로 1-3개의 질문을 만듭니다.
- 사용자가 "모름 / 미정 / 추천해줘"라고 답하면 해당 sub-field를 deferred로 기록하고, 다음 우선순위 dimension으로 넘어갑니다.
- 종료 조건은 다음 중 하나입니다.
  - ambiguity <= 0.2
  - roundNumber > maxRounds
  - 전체 required dimension coverage >= 0.8 이고 ambiguity <= 0.3
- 종료 조건을 만족하면 `phase: "done"`이 아니라 먼저 `phase: "consensus"`가 반환됩니다. Step 3-2로 넘어가기 전에 `.claude/skills/vibe-interview/SKILL.md`의 Consensus Check 절차에 따라 사람 승인, 수정, 보류, 또는 PO-proxy 미확인 상태를 기록해야 합니다.

#### PO-proxy 모드

사용자가 자율 진행을 요청하거나 답변을 제공하지 않으면 Orchestrator가 PO 관점에서 답합니다.

- PO-proxy 답변도 일반 답변과 동일하게 `--continue`와 `--record` pipe로 기록합니다.
- 마지막 consensus check는 사람이 직접 확인한 경우에만 `approved`로 기록합니다. Orchestrator가 PO-proxy로 종료하면 `--consensus --decision proxy-unconfirmed`를 사용합니다.
- Phase 종료 직후 `session-log.md`에 `[decision][phase3-po-proxy]` 항목을 한 번만 남깁니다.
- 답변마다 로그를 쓰지 말고, 최종 요약과 핵심 rationale만 기록합니다.

### Step 3-2: interview seed를 context shards로 변환

인터뷰 결과의 `seedForProductMd`와 dimension coverage를 기준으로 context shards를 작성합니다.
각 shard 작성 전에 기존 파일 내용을 읽고 사용자 작성 내용을 보존합니다.

> **원칙 — Write after Read**: `docs/context/*.md` 3개 파일이 placeholder인지 확인한 뒤 작성하고, 사용자 내용은 덮어쓰지 않습니다.

| seed field | 작성 위치 / 의미 |
|---|---|
| `dimensions.goal` | `product.md` one-liner / success criteria |
| `dimensions.target_user` | `product.md` target users |
| `dimensions.platform` | `product.md` platform |
| `dimensions.data_model` | `architecture.md` data model |
| `dimensions.primary_interaction` | `product.md` user flow |
| `dimensions.success_metric` | `product.md` acceptance criteria |
| `dimensions.non_goals` | `product.md` non-goals |
| `dimensions.constraints` | `product.md` core assumptions + `conventions.md` security rules |
| `dimensions.tech_stack` | `architecture.md` tech stack |
| `dimensions.domain_specifics` | `product.md` domain notes + `conventions.md` extra rules |

작성 완료 후 Orchestrator는 `seedForProductMd`를 `docs/context/product.md`의 `## Phase 3 답변 기록 (native interview)` 섹션에 append합니다.

Also write an explicit review signal block in `docs/context/product.md` so `/vibe-review` does not infer frontend status from arbitrary prose:

```md
<!-- BEGIN:PROJECT:review-signals -->
platforms = ["<normalized platform>"]
frontend = true|false
<!-- END:PROJECT:review-signals -->
```

Use `frontend = true` only when the product is a browser/web frontend that should be considered for bundle and browser-smoke opt-in review seeds. Use `frontend = false` for workers, CLIs, data pipelines, capture/import tools, and non-browser apps.

기존 세션의 legacy interview 디렉터리가 남아 있어도 vibe-doctor는 사용하지 않습니다. 사용자가 직접 제거할 수 있습니다.

### Step 3-3: conventions.md test and lint shard links

After Step 3-2 writes the interview seed, inspect the interview log for `tech_stack.normalized_slugs[]`.
Use `.claude/skills/test-patterns/_index.md` to map each slug to a test shard path, then derive lint shards from the language prefix:

- `ts-*` -> `typescript-debt.md`
- `py-*` -> `python-debt.md`
- `rust-*` -> `rust-debt.md`
- `go-*` -> `go-debt.md`
- always include `universal-debt.md`
- include `canvas-dom-isolation.md` or `shell-bats.md` only when their test slugs are present

Rewrite only the marker blocks below in `docs/context/conventions.md`. If a marker is missing, append the full section. Re-running must be idempotent and must preserve user-authored content outside the markers.

```md
## 테스트 전략
<!-- BEGIN:VIBE:TEST-PATTERNS -->
- TypeScript unit/integration: [.claude/skills/test-patterns/typescript-vitest.md](../../.claude/skills/test-patterns/typescript-vitest.md)
<!-- END:VIBE:TEST-PATTERNS -->

## Lint 규칙
<!-- BEGIN:VIBE:LINT-PATTERNS -->
- TypeScript debt grep: [.claude/skills/lint-patterns/typescript-debt.md](../../.claude/skills/lint-patterns/typescript-debt.md)
- Universal TODO/FIXME: [.claude/skills/lint-patterns/universal-debt.md](../../.claude/skills/lint-patterns/universal-debt.md)
<!-- END:VIBE:LINT-PATTERNS -->
```

### Step 3-4: web/frontend utility opt-in

After Step 3-3, inspect `inferred_domain`, `dimensions.platform`, and `tech_stack.normalized_slugs[]` to decide whether the project is a web/frontend candidate.

Treat the project as a web/frontend candidate when either condition matches:

- `normalized_slugs[]` includes a `ts-` stack slug related to browser/frontend work such as `ts-react`, `ts-vue`, `ts-svelte`, `ts-vite`, or `ts-next`
- `platform` explicitly names a browser/web/frontend surface. Do not treat `mobile` alone as a browser/frontend signal unless it is `mobile web`.

Decision flow:

- PO-proxy mode: use `bundle.policy = "automatic"` by default, then resolve it after interview context is available:
  - browser/frontend app: set `bundle.enabled = true` with an agent-selected budget.
  - canvas/WebGL/Three.js/game or other asset-heavy frontend: either set a project-appropriate custom budget or set `bundle.enabled = false` only with rationale and replacement evidence.
  - non-frontend project: leave `bundle.enabled = false` with rationale that bundle gate is not applicable.
- Manual mode: ask exactly these questions

```
1) 번들 크기 검증 정책을 어떻게 둘까요? [automatic]
   choices: automatic / custom / off
   - automatic: 인터뷰 이후 에이전트가 프로젝트 유형에 따라 켜거나 끄고 rationale을 남김
   - custom: 사용자가 gzip budget을 입력
   - off: 끄되 rationale + replacement evidence 필요
2) custom이면 gzip budget KB를 입력해주세요. 예: 250KB [80]
3) 브라우저 UI 가 있어 smoke 검증을 활성화할까요? [y/N]
```

If the user answer is unclear, missing, "모름", "미정", "추천해줘", "default", or equivalent, record `bundle.policy = "automatic"`.

Apply the result by patching `.vibe/config.json`:

```json
"bundle": {
  "enabled": false,
  "policy": "automatic",
  "dir": "dist",
  "limitGzipKB": 80,
  "excludeExt": [".map"],
  "rationale": "automatic bundle policy deferred to post-interview project classification"
},
"browserSmoke": {
  "enabled": false,
  "configPath": ".vibe/smoke.config.js"
}
```

When `bundle.policy = "custom"`, set `bundle.enabled = true`, `bundle.limitGzipKB` to the user-provided number, and `bundle.rationale` to the user/agent budget reason.
When `bundle.policy = "off"` or the agent resolves automatic to `bundle.enabled = false` for a frontend/browser project, include both:

```json
"rationale": "<why the bundle gate is not the right check>",
"replacementEvidence": "<manual smoke, Lighthouse run, screenshot/playthrough evidence, or other calibrated replacement>"
```

Do not treat `off` as silent success. `/vibe-review` will suppress the old default opt-in warning for explicit decisions, but it may raise a replacement-evidence finding when rationale or replacement evidence is missing.

If the product build output uses a custom path such as `app/dist`, set `.vibe/config.json` `bundle.path` and `browserSmoke.dist` to that path (default: `dist`).

Always append one session log entry with the rationale and, when a frontend/browser gate is disabled, replacement evidence:

```md
- 2026-04-16T00:00:00.000Z [decision][phase3-utility-opt-in] bundle=false browserSmoke=false rationale=... replacement=...
```

If `browserSmoke.enabled` becomes `true`, create `.vibe/smoke.config.js` only when it does not already exist. Use this skeleton:

```js
export default {
  url: 'http://localhost:5173',
  viewport: { width: 375, height: 812 },
  expectDom: ['#stage'],
  expectConsoleFree: true,
  canvasAssertions: []
};
```

Also create a root `README.md` from `.claude/skills/vibe-init/templates/readme-skeleton.md` when the file does not already exist. Replace:

- `{{project_name}}` with the first heading from `docs/context/product.md`
- `{{one_liner}}` with the interview seed one-liner
- `{{status}}` with `WIP (Phase 0 complete)`

If `README.md` already exists, skip it and print:

```text
[vibe-init] README.md exists, skipping skeleton write
```

### Step 3-5: Sprint 로드맵 작성 (Orchestrator 전담)

Step 3-4 의 context shard 작성 직후, Orchestrator 가 **product 맥락을 가장 풍부하게
보유한 상태** 에서 Sprint 로드맵을 직접 작성합니다. **이 단계는 Planner 에 위임하지
않습니다** (CLAUDE.md §Sub-agent 소환 트리거 매트릭스 > "Sprint 로드맵 분할" 참조).
위임 시 인터뷰 context 손실로 품질이 저하됩니다.

절차:

1. 입력: `docs/context/product.md` + `docs/context/architecture.md` + 인터뷰 seed
2. 산출: `docs/plans/sprint-roadmap.md` 에 Iteration 1 섹션 append
3. 각 Sprint 항목은 `{id, name, 한 줄 목표, 의존, 예상 LOC}` 형태
4. N 은 프로젝트 규모에 따라 3~10 개 권장. 너무 많은 Sprint 는 재평가 필요.

포맷 예시:

```md
# Iteration 1 — <project-slug> (v0.1.0)

## Sprint M1 — <one-line-goal>
- id: sprint-M1-<slug>
- 목표: <한 줄>
- 의존: 없음 (첫 slot)
- 예상 LOC: ~<N>
```

작성 완료 후 `session-log.md` 에 `[decision][sprint-roadmap-drafted]` 한 줄 기록을
남깁니다. 이 산출물은 Phase 4 Step 4-0a 의 seal commit 에 포함됩니다.
