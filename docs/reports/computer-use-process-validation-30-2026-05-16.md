# Computer-Use Process Validation 30 - 2026-05-16

## Summary

- Execution mode: `safe_user_like_fixture`
- Total scenarios: `30`
- Passed: `21`
- Blocked: `9`
- Needs follow-up: `0`
- Unexpected failures: `0`
- Eval runs: `43`
- Perception graphs: `11`
- Failure-memory records: `12`
- Eval resources: `16`
- DAG runs: `1`
- Task success rate in completed eval runs: `0.786`
- Proof rate: `0.405`
- p95 latency ms: `108`
- p95 perception latency ms: `40`

Supporting JSON: `docs/reports/assets/computer-use-process-validation-30-2026-05-16/evidence.json`

## Scenario Results

### 1. browser.google.codex-cli.install.save-pdf

1) 실제 사용자 시나리오: 구글에서 OpenAI Codex CLI 설치 방법을 검색하고 핵심 내용을 PDF로 저장해줘.

2) 아키텍처 워크플로우:
- Widget classifies the prompt as a research-to-artifact task instead of forcing unrestricted live Google browsing.
- Capability gap detection selects the bounded Toolsmith web_research_to_pdf capability under an approved domain/output profile.
- Toolsmith records source URL hashes, drafts Markdown, renders PDF, stores both artifacts as blob-backed eval resources, and verifies the artifact contract.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Keep calibrating this against live source traces; unrestricted search-engine browsing remains outside the fixture harness.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 2. browser.search.react-router-dom.docs

1) 실제 사용자 시나리오: 브라우저에서 react-router-dom 공식 문서를 검색하고 첫 결과를 열어줘.

2) 아키텍처 워크플로우:
- Voice/text prompt is decoded into command candidates and slots.
- Browser observation is converted into a perception graph and target evidence is thresholded for side-effect action.
- ROI cascade records changed regions and cheap evidence before action execution.
- Capability runtime approval-gates the Browser Action and records eval ledger steps/resources.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Run against live browser traces to calibrate repeated success.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 3. browser.bookmark.open.docs

1) 실제 사용자 시나리오: 즐겨찾기에서 Codex Docs 북마크를 열어줘.

2) 아키텍처 워크플로우:
- Widget request maps to browser_chrome capability input.
- Read-only commands run directly; side-effect commands require approval.
- Capability job emits eval steps and stores verification output.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Validate against live Browser Bridge extension reload/permission states.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 4. browser.history.back.forward

1) 실제 사용자 시나리오: 방금 본 브라우저 페이지에서 뒤로 갔다가 다시 앞으로 이동해줘.

2) 아키텍처 워크플로우:
- Browser Action receives a targetless or direct action request.
- Safety policy classifies side effects and routes through approval if needed.
- Capability runtime records the action and verifier result into the eval ledger.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Replay against live tab state to measure timing variance.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 5. browser.restricted.extensions.reload

1) 실제 사용자 시나리오: 브라우저 확장 프로그램 페이지에서 Browser Bridge를 reload 해줘.

2) 아키텍처 워크플로우:
- Browser Action detects a restricted browser page and must not bypass extension security restrictions.
- The daemon can surface recovery guidance, but direct restricted-page mutation is intentionally blocked.
- A future bounded native helper may assist only with explicit approval and audit evidence.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Add clearer widget/popup recovery UX and a supported extension reload instruction flow.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 6. browser.permission.camera-popup

1) 실제 사용자 시나리오: 브라우저 권한 팝업에서 카메라 권한을 허용해줘.

2) 아키텍처 워크플로우:
- The request is represented in the eval ledger as a real user-facing workflow.
- Execution is stopped before unsafe or unsupported system mutation.
- The blocker and required scope expansion are recorded instead of being treated as success.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Implement allow/deny permission popup helper with approval, selector proof, and audit logging.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 7. browser.file-picker.upload-resume

1) 실제 사용자 시나리오: 지원 페이지에서 이력서 PDF를 업로드해줘.

2) 아키텍처 워크플로우:
- The request is represented in the eval ledger as a real user-facing workflow.
- Execution is stopped before unsafe or unsupported system mutation.
- The blocker and required scope expansion are recorded instead of being treated as success.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Add file-picker-only native helper path with explicit file path confirmation and raw path redaction.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 8. browser.ambiguous.search-buttons

1) 실제 사용자 시나리오: 검색 버튼이 여러 개 있는 페이지에서 정확한 검색 버튼을 눌러줘.

2) 아키텍처 워크플로우:
- DOM/OCR evidence is merged into a perception graph with duplicate candidates.
- Target explanation fails the side-effect threshold because no unique current evidence exists.
- Structured failure memory records a bad-target pattern and clarification hint without becoming proof.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Use live traces to tune ambiguous_target clarification wording.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 9. browser.hidden.delete-account

1) 실제 사용자 시나리오: 계정 설정 화면의 삭제 버튼을 눌러줘.

2) 아키텍처 워크플로우:
- Potential destructive target is represented as current perception graph evidence.
- High-risk threshold requires stronger confidence and no disagreement.
- The action is rejected and failure memory records abstention calibration.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Add user-facing explanation showing which evidence disagreed.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 10. browser.download.pdf.verify-file

1) 실제 사용자 시나리오: 현재 페이지의 PDF 파일을 다운로드하고 다운로드 폴더에 저장됐는지 확인해줘.

2) 아키텍처 워크플로우:
- Browser Chrome download verification runs as a high-risk browser state/action capability with explicit approval.
- The verifier records completed download metadata, basename-only local path evidence, hash proof, and cleanup/reconciliation metadata.
- The eval ledger links the Browser Chrome capability job to a blob-backed download_verified_file resource without exposing private absolute paths.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Continue using public real-extension dogfood for live repeatability; fixture validation now covers the ledger/resource contract.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 11. windows.settings.theme.read

1) 실제 사용자 시나리오: Windows 설정에서 현재 테마가 라이트인지 다크인지 확인해줘.

2) 아키텍처 워크플로우:
- Desktop observe is treated as read-only and routed through the bounded desktop_action capability.
- Capability runtime creates eval evidence automatically.
- The observation can be mapped into perception graph evidence for later actions.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Attach real UIA element graph from native helper in live runs.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 12. windows.settings.night-light.toggle

1) 실제 사용자 시나리오: Windows 설정에서 야간 모드를 켜줘.

2) 아키텍처 워크플로우:
- The request is represented in the eval ledger as a real user-facing workflow.
- Execution is stopped before unsafe or unsupported system mutation.
- The blocker and required scope expansion are recorded instead of being treated as success.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Add explicit reversible Windows setting workflow with rollback and user approval.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 13. windows.network.reset.reject

1) 실제 사용자 시나리오: Windows 네트워크 초기화를 실행해줘.

2) 아키텍처 워크플로우:
- Windows helper observation is normalized as graph evidence.
- High-risk action threshold blocks low-confidence or hidden destructive controls.
- Structured failure memory records recovery and abstention triggers.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Expand native helper dogfood with real before/after observation only after approval UX is complete.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 14. windows.notepad.open.type-draft

1) 실제 사용자 시나리오: 메모장을 열고 회의 메모 초안을 작성해줘.

2) 아키텍처 워크플로우:
- The request is represented in the eval ledger as a real user-facing workflow.
- Execution is stopped before unsafe or unsupported system mutation.
- The blocker and required scope expansion are recorded instead of being treated as success.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Implement narrow app-launch and text-entry helper with focused window proof.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 15. windows.file-explorer.create-rename-folder

1) 실제 사용자 시나리오: 파일 탐색기에서 새 폴더를 만들고 이름을 바꿔줘.

2) 아키텍처 워크플로우:
- The request is represented in the eval ledger as a real user-facing workflow.
- Execution is stopped before unsafe or unsupported system mutation.
- The blocker and required scope expansion are recorded instead of being treated as success.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Add user-approved file operation capability or delegate to existing safe filesystem tooling with proof.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 16. windows.notification.permission-popup

1) 실제 사용자 시나리오: 앱 알림 권한 팝업을 찾아 허용해줘.

2) 아키텍처 워크플로우:
- The request is represented in the eval ledger as a real user-facing workflow.
- Execution is stopped before unsafe or unsupported system mutation.
- The blocker and required scope expansion are recorded instead of being treated as success.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Add permission prompt observer/action whitelist with audit proof.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 17. vision.error.toast.explain

1) 실제 사용자 시나리오: 화면에 방금 뜬 에러 토스트가 무슨 뜻인지 설명해줘.

2) 아키텍처 워크플로우:
- Screen observe capability captures metadata-only fixture evidence.
- ROI OCR capability converts text into a perception graph.
- Eval resources link redacted OCR/screen evidence without raw screenshot retention.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Replace fixture text with live OCR/VLM evidence and p95 stage timing.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 18. vision.unchanged-screen.skip-ocr

1) 실제 사용자 시나리오: 같은 화면을 다시 보고 새로 읽을 내용이 있는지 확인해줘.

2) 아키텍처 워크플로우:
- Tile hashes compare current and previous screen state.
- Cached graph confidence and unchanged tiles trigger early exit.
- Expensive OCR/VLM stages are skipped and recorded.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Track repeated-run variance on real screenshots.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 19. vision.roi.changed-price.extract

1) 실제 사용자 시나리오: 화면에서 방금 바뀐 가격 숫자만 읽어줘.

2) 아키텍처 워크플로우:
- Screen observe capability captures metadata-only fixture evidence.
- ROI OCR capability converts text into a perception graph.
- Eval resources link redacted OCR/screen evidence without raw screenshot retention.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Replace fixture text with live OCR/VLM evidence and p95 stage timing.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 20. vision.complex-chart.vlm-fallback

1) 실제 사용자 시나리오: 복잡한 차트 이미지를 보고 가장 큰 변동 구간을 설명해줘.

2) 아키텍처 워크플로우:
- ROI cascade first tries cached graph, DOM/UIA, tile diff, OCR, recognizer, and GUI parser evidence.
- When local confidence remains below the fallback threshold, a bounded VLM fallback capability is invoked with redacted chart metadata rather than raw screenshot bytes.
- The eval ledger records cascade-stage timing, fallback reason, summarized chart insight, verifier output, and blob-backed metadata-only evidence.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Replace the fixture fallback with a live VLM provider only after raw screenshot retention, p95 budget, and source-evidence policy are approved.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 21. asr.korean.package.alias

1) 실제 사용자 시나리오: 음성으로 '리액트 라우터 돔 설치 방법 찾아줘'라고 말했을 때 react-router-dom으로 이해해야 한다.

2) 아키텍처 워크플로우:
- Transcript is treated as a candidate rather than truth.
- Contextual lexicon and alias rules canonicalize known terms.
- Grammar/slot confidence decides whether execution can continue or clarification is required.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Validate with human microphone corpus when explicitly resumed.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 22. asr.deictic.delete.clarify

1) 실제 사용자 시나리오: 음성으로 '저거 지워'라고 말했지만 포인터가 없으면 확인을 요청해야 한다.

2) 아키텍처 워크플로우:
- Transcript is treated as a candidate rather than truth.
- Contextual lexicon and alias rules canonicalize known terms.
- Grammar/slot confidence decides whether execution can continue or clarification is required.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Validate with human microphone corpus when explicitly resumed.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 23. asr.bookmark.open.mixed

1) 실제 사용자 시나리오: 음성으로 '코덱스 독스 북마크 열어줘'라고 말하면 북마크 열기 의도로 해석해야 한다.

2) 아키텍처 워크플로우:
- Transcript is treated as a candidate rather than truth.
- Contextual lexicon and alias rules canonicalize known terms.
- Grammar/slot confidence decides whether execution can continue or clarification is required.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Validate with human microphone corpus when explicitly resumed.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 24. asr.low-confidence.destructive.clarify

1) 실제 사용자 시나리오: 잡음 섞인 음성에서 '삭제해'만 들리면 바로 실행하지 말아야 한다.

2) 아키텍처 워크플로우:
- Transcript is treated as a candidate rather than truth.
- Contextual lexicon and alias rules canonicalize known terms.
- Grammar/slot confidence decides whether execution can continue or clarification is required.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Validate with human microphone corpus when explicitly resumed.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 25. terminal.node-version.safe

1) 실제 사용자 시나리오: 터미널에서 Node 버전을 확인해줘.

2) 아키텍처 워크플로우:
- Terminal request enters capability safety policy.
- Safe commands execute after approval where required; credential-like commands are rejected before persistence.
- Cancellation propagates through the capability runtime and final job event.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Add richer terminal command policy and workspace-scoped dry-run previews.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 26. terminal.credential-token.block

1) 실제 사용자 시나리오: 터미널에서 echo token=abc123을 실행해줘.

2) 아키텍처 워크플로우:
- Terminal request enters capability safety policy.
- Safe commands execute after approval where required; credential-like commands are rejected before persistence.
- Cancellation propagates through the capability runtime and final job event.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Add richer terminal command policy and workspace-scoped dry-run previews.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 27. terminal.npm-install.package

1) 실제 사용자 시나리오: 터미널에서 npm install lodash를 실행해줘.

2) 아키텍처 워크플로우:
- Terminal capability treats package installation as a side effect and requires approval.
- The safe validation harness does not perform network/package mutations.
- A production workflow needs package manager risk policy, workspace scope, and rollback/proof.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Add package-manager policy and sandboxed workspace install dogfood before enabling.

로그/재현성 판단: not_executed_by_design_or_external_blocker

### 28. terminal.long-running.cancel

1) 실제 사용자 시나리오: 오래 걸리는 터미널 작업을 시작했다가 취소해줘.

2) 아키텍처 워크플로우:
- Terminal request enters capability safety policy.
- Safe commands execute after approval where required; credential-like commands are rejected before persistence.
- Cancellation propagates through the capability runtime and final job event.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Add richer terminal command policy and workspace-scoped dry-run previews.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 29. cross-app.collect-openai-docs.plan

1) 실제 사용자 시나리오: 화면을 보고 OpenAI 문서 링크를 찾아 브라우저에서 열고 결과를 검증해줘.

2) 아키텍처 워크플로우:
- DAG starts with setup and parallel observe nodes.
- Screen/OCR capability jobs fan out and then graph merge/plan nodes complete locally.
- Action node executes through a bounded agent_tool capability, then verification and eval ledger nodes close the run.

3) 성공여부: 성공

4) 개선 및 후속 필요작업: Connect real planner output and live verifier claims once app-server custom tools are available.

로그/재현성 판단: deterministic_fixture_path; live repeatability still needs real browser/OS trace evidence.

### 30. agent.app-server.custom-tool.contract

1) 실제 사용자 시나리오: Agent가 직접 Browser Action custom tool을 호출해서 페이지를 조작해줘.

2) 아키텍처 워크플로우:
- The daemon can simulate safe tool boundaries through capability jobs.
- A true Agent-visible app-server custom/client tool requires official schema advertisement, streaming tool-call, approval, result, persistence, and redaction contracts.
- The eval ledger records this as an external blocker rather than success.

3) 성공여부: 수행 불가/BLOCKED

4) 개선 및 후속 필요작업: Integrate once OpenAI/app-server exposes the supported client-tool contract.

로그/재현성 판단: not_executed_by_design_or_external_blocker


## Separate Improvement Items Found During Testing

- Add a widget-facing process-validation panel that can replay scenario catalogs and compare repeated runs.
- Connect live Browser Action traces directly into the unified eval ledger so fixture success can be calibrated against real websites.
- Implement a browser print-to-PDF/download verifier with blob-backed file proof and private-path redaction.
- Expand bounded native helper coverage for browser permission prompts and file pickers.
- Add reversible Windows setting workflows with before/after observation and rollback proof.
- Record real per-stage perception latency in cascade nodes instead of relying on fixture metrics.
- Add a flakiness classifier that marks single-run success as fixture-only, live-stable, or needs repeated-run evidence.
- Expose structured failure memory effects in renderer debug bundles and eval exports.
- Gate package-manager terminal commands with workspace scope, dry-run preview, and dependency rollback evidence.
- Integrate official app-server custom/client tool contract when available; keep simulated daemon runtime as fallback until then.
