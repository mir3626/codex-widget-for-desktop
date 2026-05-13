## Phase 2 — Sprint 역할별 Provider 배정 및 인증

사용자에게 Sprint의 3가지 역할에 대해 **각각** 어떤 AI를 사용할지 물어봅니다.

### Step 2-1: 역할별 Provider 선택

> **Fast-path (기본값 일괄 수용)**: 사용자가 "기본", "default", "엔터", "그대로" 등으로
> 답하거나, 이미 `.vibe/config.local.json`이 존재하고 `sprintRoles`가 채워져 있으면
> 세 역할을 모두 기본값(`claude-opus` / `codex` / `claude-opus`)으로 즉시 확정하고
> Step 2-2의 인증 확인으로 바로 넘어갑니다. 역할별 개별 질문을 반복하지 않습니다.
> dogfood/재실행 케이스에서 Phase 2가 불필요하게 질문을 반복하는 것을 방지합니다.

아래와 같이 질문합니다:

```
Sprint 역할별 AI를 설정합니다. 각 역할에 어떤 AI를 사용할지 선택해주세요.
기본값은 괄호 안에 표시됩니다. 그대로 쓰려면 엔터만 누르면 됩니다.
(전체 기본값을 한 번에 수용하려면 "기본" 이라고 답하면 됩니다.)

1. Planner (스펙 정의 — "무엇을" 만들지 정의) [기본: claude-opus]
   선택지: claude-opus / codex / 기타

2. Generator (코드 구현 — 체크리스트 기반 구현) [기본: codex (CLI)]
   선택지: codex / claude-opus / 기타

3. Evaluator (판정 — 합격/불합격 판정) [기본: claude-opus]
   선택지: claude-opus / codex / 기타

"기타"를 선택하면 커스텀 AI agent를 연결할 수 있습니다.
```

사용자가 **"기타"**를 선택한 경우, 추가 질문:

```
커스텀 AI agent 설정:
  - provider 이름은 뭔가요? (예: deepseek, grok, gemini, aider)
  - CLI 명령어는 뭔가요? (예: deepseek, grok)
  - 프롬프트를 전달하는 인자 형식은 어떻게 되나요?
    예시) deepseek --prompt "{prompt}"
    예시) grok chat "{prompt}"
    모르면 비워두세요. 나중에 .vibe/config.local.json에서 직접 수정할 수 있습니다.
```

### Step 2-2: 선택된 Provider 인증 확인

각 선택된 provider에 대해 CLI가 설치되어 있는지 Phase 1 결과를 참조하여 확인합니다.

**CLI가 미설치인 경우**, 해당 provider의 설치 및 인증 방법을 step-by-step으로 안내합니다:

| Provider | 설치 안내 | 인증 안내 |
|----------|-----------|-----------|
| codex | `npm install -g @openai/codex` 으로 Codex CLI 설치. `codex --version`으로 설치 확인 | 아래 인증 방식 선택 안내 참조 |
| claude-opus | Claude Code 사용 중이므로 이미 인증됨 | - |
| 기타 (custom) | 사용자가 알려준 설치 방법 또는 "해당 AI의 공식 문서를 참고하세요" | 사용자에게 인증 방법 확인 |

**Codex CLI 인증 방식 선택** (codex가 선택된 경우):

Codex CLI 설치 후, 사용자에게 인증 방식을 선택하도록 안내합니다:

```
Codex CLI 인증 방식을 선택해주세요:

  1. OAuth 로그인 (기본, 권장)
     → `codex auth login` 실행 후 브라우저에서 OpenAI 계정 로그인
     → API 키 관리 없이 간편하게 사용 가능

  2. API 키 직접 설정
     → OPENAI_API_KEY 환경변수에 API 키를 설정
     → .env 파일에 추가하거나, 터미널에서 직접 설정
```

사용자가 **1 (OAuth)**를 선택한 경우:
- `! codex auth login` 실행을 안내합니다 (사용자가 직접 실행)
- 브라우저 로그인 완료 후 `codex auth status`로 인증 상태를 확인합니다

사용자가 **2 (API 키)**를 선택한 경우:
- `.env` 파일에 `OPENAI_API_KEY=sk-...` 추가를 안내합니다
- 또는 `! export OPENAI_API_KEY=sk-...` 로 현재 세션에서 직접 설정하도록 안내합니다

---

안내 후 사용자에게 확인합니다:
```
설치/인증을 지금 진행하시겠어요?
  - "예" → 사용자가 터미널에서 직접 명령 실행하도록 안내 (! 명령어 prefix 안내)
  - "나중에" → 건너뛰고 다음 단계로 진행
  - "건너뛰기" → 해당 provider를 일단 설정만 해두고 나중에 연결
```

### Step 2-3: 설정 파일 업데이트

선택 결과를 바탕으로 아래 파일들을 업데이트합니다:

#### `CLAUDE.md` (CRITICAL — 반드시 수행)

`<!-- BEGIN:SPRINT_ROLES -->` ~ `<!-- END:SPRINT_ROLES -->` 영역의 역할 테이블을 선택된 provider 이름으로 교체합니다.
또한 CRITICAL 블록 내 `Generator sub-agent(현재 설정: **{이전 값}**)` 부분을 선택된 generator provider로 업데이트합니다.

이 업데이트는 context 압축 후에도 올바른 모델이 참조되도록 보장하기 위해 필수입니다.

예시 (generator를 deepseek로 선택한 경우):
```markdown
<!-- BEGIN:SPRINT_ROLES (vibe-init 자동 업데이트 영역) -->
| 역할 | Provider | 상주 여부 | 책임 |
|------|----------|-----------|------|
| **Orchestrator** | **claude-opus** (메인 대화) | 상주 | Sprint 생명주기 관리, 사용자 소통, context 전달, 보고서 |
| **Planner** | **claude-opus** (sub-agent) | Sprint 내 | "무엇을(WHAT)" 정의 + 완료 체크리스트 작성 |
| **Generator** | **deepseek** (sub-agent) | Sprint 내 | 체크리스트 기반 코드 구현 (HOW는 Generator 재량) |
| **Evaluator** | **claude-opus** (sub-agent) | Sprint 내 | 체크리스트 기준 합격/불합격 판정 |
<!-- END:SPRINT_ROLES -->
```

CRITICAL 블록도 업데이트:
```markdown
> 모든 코드 구현은 반드시 Generator sub-agent(현재 설정: **deepseek**)를 생성하여 위임한다.
```

#### `.vibe/config.local.json`

선택한 Sprint 역할 구성을 반영합니다. 커스텀 provider는 `providers` 맵에 추가합니다.

##### OS 경계 + provider command 표준 (CRITICAL — Windows / WSL 지원)

`config.local.json`을 작성할 때 Codex provider는 기본적으로 모든 OS에서
`./.vibe/harness/scripts/run-codex.sh`를 유지합니다. 이 wrapper가 UTF-8 locale, common rules,
retry, session-start를 담당하므로 Windows에서도 raw `codex.cmd exec`를 표준 경로로
기입하지 않습니다.

**표준 원칙**:

1. Codex provider command:
   ```json
   "codex": {
     "command": "./.vibe/harness/scripts/run-codex.sh",
     "args": ["{prompt}"],
     "env": {}
   }
   ```
2. Windows 네이티브 PowerShell/cmd에서 `vibe:run-agent`가 `.sh` wrapper를 실행할 때는
   harness가 Git Bash 실행 파일을 직접 탐색합니다. bare `bash`는 사용하지 않습니다.
   - `where bash`가 `C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\bash.exe`를
     반환하면 WSL launcher입니다. Windows Codex wrapper 실행 경로로 사용하지 않습니다.
   - Git Bash 기본 경로는 `C:\Program Files\Git\bin\bash.exe`입니다.
   - 특수 설치 경로는 `VIBE_GIT_BASH` 환경변수로 지정할 수 있습니다.
3. `.vibe/harness/scripts/run-codex.cmd`는 Windows-native health/debug wrapper입니다.
   `node .vibe/harness/scripts/vibe-preflight.mjs`는 Windows에서 이 `.cmd` wrapper의 `--health`를
   우선 사용합니다. Generator 실행 표준은 여전히 `run-codex.sh`입니다.
4. WSL에서 Codex를 실행하려면 WSL 내부에 Linux용 `node`와 `codex`를 별도로 설치합니다.
   `/mnt/c/.../npm/codex` 같은 Windows npm shim은 WSL 실행 경로로 사용하지 않습니다.
5. `CODEX_*`/`VIBE_*`를 Windows에서 WSL로 넘기는 워크플로우는 `WSLENV`에 명시 등록해야
   합니다. 기본 템플릿은 Windows와 WSL의 env 공유를 전제로 하지 않습니다.
6. Claude/custom provider처럼 wrapper가 없는 일반 CLI는 OS별 native command를 사용할 수
   있습니다. 예: Windows `C:\Users\{user}\.local\bin\claude.exe`, POSIX `claude`.

**Windows 결과 예시**:
```json
"providers": {
  "claude-opus": {
    "command": "C:\\Users\\{user}\\.local\\bin\\claude.exe",
    "args": ["-p", "{prompt}"],
    "env": {}
  },
  "codex": {
    "command": "./.vibe/harness/scripts/run-codex.sh",
    "args": ["{prompt}"],
    "env": {}
  }
}
```

**POSIX (macOS/Linux/WSL) 결과 예시**:
```json
"providers": {
  "claude-opus": {
    "command": "claude",
    "args": ["-p", "{prompt}"],
    "env": {}
  },
  "codex": {
    "command": "./.vibe/harness/scripts/run-codex.sh",
    "args": ["{prompt}"],
    "env": {}
  }
}
```

탐색 실패 시 해당 CLI가 미설치 상태로 간주하고 Phase 2의 "CLI 미설치" 흐름으로
분기합니다. Windows에서 Git Bash가 없으면 Git for Windows 설치 또는 `VIBE_GIT_BASH`
지정을 안내합니다.

> 로컬에서 의도적으로 wrapper를 우회해야 하는 실험이 아니라면 `config.local.json`에
> `codex.cmd exec`를 직접 기입하지 않습니다.
##### 커스텀 generator provider 예시

예시 (generator를 deepseek로 선택한 경우):
```json
{
  "orchestrator": "claude-opus",
  "sprintRoles": {
    "planner": "claude-opus",
    "generator": "deepseek",
    "evaluator": "claude-opus"
  },
  "sprint": {
    "unit": "feature",
    "subAgentPerRole": true,
    "freshContextPerSprint": true
  },
  "providers": {
    "claude-opus": {
      "command": "claude",
      "args": ["-p", "{prompt}"],
      "env": {}
    },
    "codex": {
      "command": "./.vibe/harness/scripts/run-codex.sh",
      "args": ["{prompt}"],
      "env": {}
    },
    "deepseek": {
      "command": "deepseek",
      "args": ["--prompt", "{prompt}"],
      "env": {}
    }
  }
}
```

#### `AGENTS.md`

Generator로 선택된 provider에 맞게 파일 내용을 수정합니다.
- 기본 codex가 아닌 경우, 파일 상단의 provider 이름을 변경합니다.
- 예: generator가 deepseek인 경우:
  ```markdown
  # DeepSeek project memory

  너의 기본 역할은 Sprint의 **Generator (코드 구현)** 다.
  ...
  ```

#### `CLAUDE.md` 의 `<!-- BEGIN:SPRINT_ROLES -->` 영역

선택된 역할 배정을 이 영역의 표에 반영합니다. 이 표가 Sprint 역할의 single source of truth입니다.

#### `docs/orchestration/providers.md`

커스텀 provider가 추가된 경우, 해당 provider 섹션을 문서에 추가합니다.
