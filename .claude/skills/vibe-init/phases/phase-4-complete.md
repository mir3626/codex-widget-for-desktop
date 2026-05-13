## Phase 4 — 설정 요약 및 완료

### Step 4-0: Git 초기화 (CRITICAL — Codex/에이전트 위임 전제 조건)

Sprint Generator가 **Codex CLI**(또는 trust-based sandbox를 쓰는 다른 provider)인 경우,
프로젝트 루트에 `.git`이 존재하지 않으면 Codex가 `Not inside a trusted directory` 에러로
**첫 Sprint부터 즉시 실패**합니다. 따라서 여기서 git 초기화를 강제합니다.

절차:
1. `git rev-parse --is-inside-work-tree`로 기존 git 저장소 여부 확인
2. 없으면 다음을 **자동 실행** (사용자 추가 승인 불필요 — 이건 템플릿 규약):
   ```bash
   git init
   git add -A
   git -c commit.gpgsign=false commit -m "chore: initial vibe-doctor scaffold"
   ```
3. 실행 실패 시(이름/이메일 미설정 등) 실패 원인을 표시하고 사용자에게 1회 수동 실행을 요청합니다.

이 단계는 Phase 2에서 Codex/기타 샌드박스형 provider를 선택한 경우에만 필수지만,
선택과 무관하게 git 저장소가 있으면 이후 작업(커밋, 리뷰, 복구)이 모두 수월해지므로
**언제나 실행**하는 것을 기본값으로 삼습니다.

### Step 4-0a: Phase 0 seal commit

Immediately after Step 4-0 finishes, run:

```bash
node .vibe/harness/scripts/vibe-phase0-seal.mjs
```

Expected outcomes:

- exit `0` with `[phase0-seal] committed: ...` after staging the Phase 0 artifacts and creating the seal commit
- exit `0` with `[phase0-seal] already sealed (no changes)` when nothing changed
- exit `0` with `[phase0-seal] no candidate files present` when the Phase 0 files are absent

If the command exits non-zero, print the reason, tell the user to run it manually once, and continue Phase 4 without blocking.

### Step 4-0b: Agent delegation 권한 프리셋 (opt-in)

Orchestrator asks:

> Sprint 자율 실행 시 권한 프롬프트를 줄이는 agent-delegation 프리셋을 적용하시겠습니까?
> (npm install/build/test/git 등 scope 제한된 명령만 자동 허용)
> [Y/n]

- User answers Y (or PO-proxy auto-yes): run `node .vibe/harness/scripts/vibe-sprint-mode.mjs on`.
- User answers N: skip. Print "프리셋 미적용. 나중에 `/vibe-sprint-mode on`으로 활성화할 수 있습니다."
- If the script exits non-zero, print warning and continue.

### Step 4-1: 설정 요약 출력

모든 단계가 끝나면 아래를 출력합니다:

```
초기 세팅이 완료되었습니다!

  환경:
    node {버전}  ✓
    npm          ✓
    git          ✓

  Sprint 역할 설정:
    Orchestrator : claude-opus (기본)
    Planner      : {선택된 planner}  {✓ 인증됨 / ⚠ 미연결}
    Generator    : {선택된 generator}  {✓ 인증됨 / ⚠ 미연결}
    Evaluator    : {선택된 evaluator}  {✓ 인증됨 / ⚠ 미연결}

  작성/수정된 파일:
    - CLAUDE.md                        (Sprint 역할 테이블 + CRITICAL 블록)
    - .vibe/config.local.json          (Sprint 역할 + provider 설정)
    - docs/context/product.md          (프로젝트 목표)
    - docs/context/architecture.md     (기술 스택)
    - docs/context/conventions.md      (코드 규칙)
    - AGENTS.md                        (Generator 규칙)

이제 목표를 말씀해주시면 Sprint 단위로 작업을 시작할 수 있습니다.
예) "Goal: 로그인 페이지를 만들어줘"
```
