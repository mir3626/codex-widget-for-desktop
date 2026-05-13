# 기존 프로젝트 업그레이드

## 경로 A — `/vibe-sync` 가 이미 설치된 프로젝트 (v1.x+)

가장 간단한 경로. 단, v1.5.16부터 `/vibe-sync` 는 `/vibe-init` 으로 생성된 project state 가 있어야 실행됩니다. 아직 init 하지 않은 프로젝트라면 먼저 `/vibe-init` 을 완료하세요.

드라이런으로 변경 내역 먼저 확인:

```bash
npm run vibe:sync -- --dry-run
```

예시 출력:

```
Sync plan: vibe-doctor v1.5.17 -> 1.6.8

| action        | path                                | detail              |
|---------------|-------------------------------------|---------------------|
| replace       | .vibe/harness/scripts/vibe-preflight.mjs      | harness updated      |
| new-file      | .vibe/harness/scripts/vibe-interview.mjs      |                      |
| new-file      | .vibe/harness/scripts/vibe-project-report.mjs |                      |
| new-file      | .vibe/harness/scripts/vibe-dashboard.mjs      |                      |
| new-file      | .claude/skills/vibe-iterate/SKILL.md|                      |
| conflict      | CLAUDE.md                           | locally modified     |
| section-merge | .claude/settings.json               | hooks                |
| skip          | docs/context/product.md             | project-owned        |

Files: 40+ replace, 3 section-merge, 2 json-merge, 15+ new-file, 1 conflict, 6 skip
Migrations: 1.1.0, 1.2.0, 1.2.1, 1.3.0, 1.4.0
```

승인 UX (v1.3.0):

- Conflict 가 없으면 `Proceed? [Y/n]` 1회 확인.
- Conflict 가 있으면 `[a]ccept all / [i]ndividual / [s]kip all / [c]ancel` 4 옵션.
- `--force` 는 기존처럼 모든 conflict 무조건 replace (프롬프트 없음).
- `--json` 은 기계 출력 (approval 프롬프트 없음).

실제 적용:

```bash
npm run vibe:sync
```

특정 tag 로 강제하려면:

```bash
npm run vibe:sync -- --ref v1.6.8
```

백업은 자동으로 `.vibe/sync-backup/<timestamp>/` 에 생성. 마이그레이션은 `.vibe/harness/migrations/*.mjs` 에서 버전 순서로 idempotent 실행.

## 경로 B — `/vibe-sync` 가 없는 레거시 프로젝트

v1.0 이전 템플릿이거나 `/vibe-sync` 메커니즘 없이 시작한 프로젝트는 **one-shot bootstrap 스크립트** 로 업그레이드합니다.

> v1.5.16부터 bootstrap 도 `/vibe-init` 완료 상태를 요구합니다. 한 번도 `/vibe-init` 하지 않은 폴더에서는 먼저 `/vibe-init` 으로 project state 를 만든 뒤 bootstrap 을 실행하세요.

### B-1. 원격에서 bootstrap 실행 (macOS / Linux / Git Bash)

```bash
curl -fsSL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs \
  | node --input-type=module -
```

### B-1-Win. 원격에서 bootstrap 실행 (Windows — PowerShell / cmd.exe)

Windows 10+ 에는 `curl.exe` 가 기본 내장. 프로젝트 루트에서:

```powershell
curl -sL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs | node --input-type=module -
```

> PowerShell 5.1 이하에서는 `curl` 이 `Invoke-WebRequest` alias 라 flag 호환성 문제가 생길 수 있음. 이 경우 `curl.exe` 로 명시하거나 아래 B-2 수동 다운로드 방식 사용.

### B-1-OS. Windows / WSL shell 기준

- Windows 네이티브 PowerShell/cmd에서는 bare `bash` 를 사용하지 않는다. WindowsApps의 WSL launcher가 먼저 잡힐 수 있다.
- Windows에서 POSIX wrapper(`./.vibe/harness/scripts/run-codex.sh`)를 실행해야 할 때 harness CLI는 Git Bash를 직접 찾아 사용한다. 수동 실행은 `"C:\Program Files\Git\bin\bash.exe" .vibe/harness/scripts/run-codex.sh --health` 처럼 Git Bash 경로를 명시한다.
- WSL에서는 Windows npm shim(`/mnt/c/.../npm/codex`)을 재사용하지 않는다. WSL 안에 Linux용 `node`/`codex`를 별도로 설치하거나 Windows 쪽에서 `.vibe\harness\scripts\run-codex.cmd`를 사용한다.
- Windows→WSL로 `CODEX_*`/`VIBE_*` 변수를 넘기는 워크플로우는 `WSLENV`에 해당 변수를 명시해야 한다. 기본 템플릿은 WSL 전파를 전제로 하지 않는다.

### B-2. 수동 다운로드 방식 (모든 플랫폼)

```bash
# 1. bootstrap 스크립트 다운로드
curl -fsSL https://raw.githubusercontent.com/mir3626/vibe-doctor/main/scripts/vibe-sync-bootstrap.mjs \
  -o vibe-sync-bootstrap.mjs

# 2. 프로젝트 루트에서 실행
node vibe-sync-bootstrap.mjs

# 3. 완료 후 임시 파일 정리
rm vibe-sync-bootstrap.mjs
```

### B-3. bootstrap 가 하는 일

1. 업스트림 (`mir3626/vibe-doctor`) 을 `--ref main` 또는 `--ref v1.3.0` 으로 shallow clone.
2. 핵심 파일 복사 + 기존 파일은 `.vibe/sync-backup/bootstrap-<timestamp>/` 로 백업:
   - `.vibe/harness/src/commands/sync.ts`, `.vibe/harness/src/lib/sync.ts` 및 관련 라이브러리
   - `.vibe/harness/scripts/vibe-*.mjs`, `.vibe/harness/scripts/run-*.{sh,cmd}`
   - `.claude/skills/*`, `.claude/agents/*`
   - `.vibe/sync-manifest.json`, `.vibe/sync-manifest.schema.json`
   - `.vibe/harness/migrations/*.mjs`
3. `package.json` / `.claude/settings.json` 은 **머지** (기존 scripts·permissions 보존, `vibe:*` 스크립트만 교체).
4. `.vibe/config.json` 에 `harnessVersion`, `upstream.url`, `upstream.ref` 기록.
5. 이후부터는 `npm run vibe:sync` 로 일반 싱크 가능.

> 💡 bootstrap 자체는 git clone 권한이 필요하지만 프로젝트 git 히스토리는 건드리지 않습니다. 커밋/푸시는 사용자 책임.

### B-4. 검증

```bash
node .vibe/harness/scripts/vibe-preflight.mjs --bootstrap   # all OK 확인
npm test                                       # 기존 테스트 그대로 통과
cat .vibe/config.json | grep harnessVersion    # "1.7.0" 출력
```

## 경로 C — 완전 fresh restart (최후 수단)

기존 커스터마이즈가 거의 없고 그냥 최신 템플릿을 새로 받고 싶다면:

```bash
# 1. 기존 프로젝트의 product.md / architecture.md / conventions.md / src 백업
# 2. 새 폴더에 템플릿 clone
git clone https://github.com/mir3626/vibe-doctor my-project-v2
# 3. 백업한 project-owned 파일들을 my-project-v2 에 복사
# 4. git history 를 옮기고 싶으면 수동 rebase
```

---
