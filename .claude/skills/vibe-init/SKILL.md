---
name: vibe-init
description: 프로젝트 초기 세팅을 대화형으로 진행합니다. 환경 점검, provider 인증, 프로젝트 맞춤 설정까지 자동으로 안내합니다.
---

이 스킬은 프로젝트 초기 세팅을 Claude Code 대화형으로 진행합니다.
총 4단계(Phase 1~4)로 구성되며, 각 Phase를 순서대로 진행합니다.

> **용어 정리**: CLAUDE.md 의 "Phase 0 — 프로젝트 최초 1회" 는 이 Phase 1~4 전체를
> 묶는 umbrella term 입니다. 개별 sub-step 은 "Phase N Step N-M" 로 표기합니다
> (예: Sprint 로드맵 작성 = Phase 3 Step 3-5). "Phase 0" 을 개별 task 이름으로
> 사용하지 마십시오 (naming 혼란 방지).

<!-- BEGIN:VIBE-INIT:PHASE-SHARDS -->
- `.claude/skills/vibe-init/phases/phase-2-providers.md`
- `.claude/skills/vibe-init/phases/phase-3-interview.md`
- `.claude/skills/vibe-init/phases/phase-4-complete.md`
- `.claude/skills/vibe-init/phases/rules.md`
<!-- END:VIBE-INIT:PHASE-SHARDS -->

The shard files above are mandatory continuation context. They are listed in
execution order and are covered by `npm run vibe:init-shard-audit`.

---

## Phase 1 — 환경 점검 (doctor)

### Step 1-0: 세션 진행 모드 확인 (CRITICAL — 환경 점검 전에 선행)

이번 세션에서 프로젝트를 **사람이 주도**할지 **에이전트가 주도**할지를 먼저 확인합니다.
이후 모든 Phase 의 interactivity / fast-path / PO-proxy 기본값이 이 선택에 연동됩니다.

질문:

```
이번 세션에서 이 프로젝트를 어떤 방식으로 진행할까요?

  1. human (기본) — 사람이 각 단계 질문에 직접 답하고 승인합니다.
  2. agent — 에이전트가 초기 prompt 를 분석하여 모든 단계를 자동으로 진행합니다.
```

선택 결과는 `.vibe/config.json` 의 `mode` 필드에 기록합니다 (값: `"human"` 또는 `"agent"`).
답을 얻지 못하면 기본값 `"human"` 으로 진행합니다.

- `mode=human`: Phase 2 Fast-path 은 사용자가 "기본" 등으로 답했을 때만 활성. Phase 3 는 사용자 상호작용 기본. Step 1-1 로 진행.
- `mode=agent`: **아래 Step 1-0-agent 분기 로 이동** — 본 `/vibe-init` 세션은 agent delegation prompt 를 터미널에 출력한 뒤 즉시 종료. 사용자가 출력된 prompt 를 새 agent 세션에 copy-paste 하면 그 새 세션의 agent 가 Phase 2~4 를 자율 진행한다.

---

### Step 1-0-agent: mode=agent 선택 시 분기 (CRITICAL)

Step 1-0 에서 사용자가 `agent` 를 선택하면 다음을 순차 수행:

1. **ONE_LINER 질문**:

   ```
   무엇을 만들고 싶은지 한 줄로 정의해주세요.
   (예: "커맨드라인 가계부 도구 — 태그별 월간 요약 + 일일 지출 cap 경고")
   ```

   사용자 답변을 `<ONE_LINER>` 변수로 저장.

2. **machine-checkable delegation command 실행**:

   Claude Code에서 실행 중이면:

   ```bash
   npm run vibe:init -- --from-agent-skill --mode=agent --runtime=claude --one-liner "<ONE_LINER>"
   ```

   Codex에서 실행 중이면:

   ```bash
   npm run vibe:init -- --from-agent-skill --mode=agent --runtime=codex --one-liner "<ONE_LINER>"
   ```

   이 command 는 `.vibe/config.json.mode = "agent"` 만 기록하고, `.claude/templates/agent-delegation-prompt.md` 의 실제 prompt 본문을 runtime에 맞게 렌더링해 stdout에 출력한 뒤 종료한다.

3. **완성 prompt 를 터미널에 출력**:

   치환 완료된 prompt 본문을 아래 형식으로 사용자에게 표시한다:

   ````
   ─────────────────────────────────────────────────────────────
   Agent Delegation Prompt (복사해서 새 agent 세션에 주입)
   ─────────────────────────────────────────────────────────────

   ```md
   <치환된 prompt 본문 전체>
   ```

   ─────────────────────────────────────────────────────────────
   ```

4. **안내 + 세션 종료**:

   ```
   위 prompt 를 copy-paste 하여 새 agent 세션에 전달하세요.
   그 세션의 agent 가 /vibe-init Phase 2~4 + Sprint 로드맵 + Sprint 실행 + closure
   를 자율적으로 진행합니다.

   본 /vibe-init 세션은 여기서 종료합니다.
   ```

   `.vibe/config.json.mode` 를 `"agent"` 로 기록한 뒤 본 `/vibe-init` skill 흐름은 **즉시 중단**. Phase 1-1 이하로 진행하지 않는다. (환경 점검 / provider 설정 등은 새 세션의 agent 가 담당.)
   특히 `.env`, `.vibe/config.local.json`, `.vibe/agent/*`, `.vibe/interview-log/*` 를 생성하거나 수정하지 않는다.

5. **왜 새 세션으로 넘기는가**:
   - 현재 세션은 사용자가 mode 선택을 위해 열었을 뿐, agent delegation 의 "첫 prompt" 가 아니다. Prompt 를 first-class instruction 으로 받는 건 "fresh agent session 의 initial user turn" 이어야 CLAUDE.md Charter 가 권고가 아닌 명령으로 해석된다.
   - 기존 대화 맥락 (사용자와의 이전 turn) 이 새 세션에는 없어야 agent 가 prompt 만으로 Charter 를 재해석한다. Context 오염 방지.

---

### Step 1-1: 환경 점검 실행

`npm run vibe:init -- --from-agent-skill --mode=human`을 실행하여 기본 파일(`.env`, `.vibe/config.local.json`)을 생성한 뒤,
아래 환경 점검을 직접 수행합니다:

1. **필수 도구 확인** — `node` (>=24, Active LTS), `npm`, `git`, `bash` (Windows는 Git Bash)
   - 하나라도 없으면 설치 방법을 안내하고 중단합니다.

2. **AI Agent CLI 확인** — `claude`, `codex` CLI 등 존재 여부를 확인합니다.
   - Codex는 **CLI** (`codex exec`)로 직접 호출합니다. 플러그인(`codex:rescue`)은 Windows 불안정·속도 저하로 보류.

3. **Native interview 확인** — 별도 설치는 필요 없습니다. `.vibe/harness/scripts/vibe-interview.mjs`는 Node 24+만으로 동작합니다.

   결과를 사용자에게 보여줍니다. 예:
     ```
     환경 점검 결과:
       node (v22.x)      ✓
       npm                ✓
       git                ✓
       claude CLI         ✓
       codex CLI          ✗ (미설치)
     ```
    - 이 결과는 Phase 2에서 provider 선택/인증 안내에 사용됩니다.
