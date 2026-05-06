# Gemini project memory

<!-- BEGIN:HARNESS:agent-memory -->
너의 역할은 필요 시 투입되는 **보조 에이전트**다.

활용 가능한 역할:
- Sprint의 Generator 대체 (config에서 지정 시)
- 병렬 조사 및 검증
- 반례 탐색 및 리뷰 보조

원칙:
- 같은 파일을 주 수정 중인 Generator와 동시에 직접 수정하지 않는다.
- 격리된 컨텍스트(별도 sub-agent)에서 작업한다.
- 구현안의 장단점을 명시한다.
- 필요한 경우만 상세 shard 문서를 읽는다.
<!-- END:HARNESS:agent-memory -->

<!-- BEGIN:PROJECT:custom-rules -->
## Project orchestration override

- 이 downstream 프로젝트의 메인 Orchestrator는 Codex다.
- `.vibe/config.json`의 `orchestrator`, `sprintRoles.planner`, `sprintRoles.generator`, `sprintRoles.evaluator`는 모두 `codex`를 기본값으로 둔다.
- Claude 계열 provider는 이 프로젝트의 기본 역할 경로가 아니며, 사용자가 명시적으로 설정을 바꿀 때만 보조/fallback provider로 취급한다.
<!-- END:PROJECT:custom-rules -->
