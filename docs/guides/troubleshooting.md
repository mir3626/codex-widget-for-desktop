# 트러블슈팅

## `vibe:sync` 가 `pathspec 'v1.x.y' did not match` 로 실패

업스트림에 해당 버전 tag 가 없을 때 발생. 해결책:
- `.vibe/config.json` 의 `harnessVersion` 이 실제 존재하는 tag 인지 확인 (`git ls-remote --tags origin`).
- 없으면 `harnessVersion` 을 최신 존재 tag 로 낮추거나, `--ref main` 옵션으로 main branch 강제.

## `run-codex.sh --health` 가 Windows 에서 실패

- `vibe:run-agent` 는 Windows에서 `./.vibe/harness/scripts/run-codex.sh` 를 Git Bash로 직접 실행한다. Git Bash가 설치되어 있는지 먼저 확인.
- 수동 점검은 Git Bash 경로를 명시한다: `"C:\Program Files\Git\bin\bash.exe" .vibe/harness/scripts/run-codex.sh --health`.
- 네이티브 PowerShell/cmd health check는 `.vibe\harness\scripts\run-codex.cmd --health` 를 사용.
- bare `bash` 가 `C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\bash.exe` 로 잡히면 WSL launcher이므로 Windows Codex wrapper 실행에 사용하지 않는다.
- auth 누락 시 `codex auth login` 재실행.

## Preflight 가 handoff stale WARN 표시

- 24시간 이상 `.vibe/agent/sprint-status.json` 이 갱신 안 된 경우. 새 Sprint 시작 전 `/vibe-init` 또는 `/vibe-iterate` 로 상태 refresh.

## `/vibe-iterate` 를 실행했는데 iteration-history.json 이 없다고 함

- 최초 iteration(=iter-1) 은 `/vibe-init` 의 Phase 0 에서 초기화됨. 레거시 프로젝트라 해당 파일이 없다면 `.vibe/harness/migrations/1.3.0.mjs` 를 수동 실행:
  ```bash
  node .vibe/harness/migrations/1.3.0.mjs "$(pwd)"
  ```

## HTML 보고서가 브라우저에서 자동으로 안 열림

- `xdg-open`/`open`/`start` 가 없는 최소 환경일 수 있음. 출력된 파일 경로를 수동으로 열거나 `--no-open` 플래그 활용.

---
