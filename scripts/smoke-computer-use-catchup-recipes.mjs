import assert from "node:assert/strict";
import {
  planComputerUseCatchUpRecipe,
  recipeCreatesLocalArtifact,
  recipeRequiresBrowserChrome,
  recipeRequiresBrowserProfile,
  recipeRequiresForeground,
  recipeRequiresGeneratedTool
} from "../dist/daemon/computer-use/index.js";

const gmail = requireRecipe("gmail열어서 국세청에서 온 종소세 관련 이메일 내용 확인해줘");
assert.equal(gmail.id, "gmail_tax_pdf_readonly");
assert.equal(gmail.preferredSurface, "regular_browser_extension");
assert.equal(gmail.riskClass, "profile_private_data");
assert.equal(gmail.commitPolicy, "read_only");
assert.equal(recipeRequiresBrowserProfile(gmail), true);
assert.equal(gmail.operations.some((operation) => operation.kind === "browser_action"), true);

const gmailPdf = requireRecipe("국세청 종소세 이메일 첨부 PDF를 저장하고 납부 기한과 금액만 정리해줘 gmail");
assert.equal(gmailPdf.id, "gmail_tax_pdf_readonly");
assert.equal(recipeRequiresBrowserChrome(gmailPdf), true);
assert.equal(recipeRequiresGeneratedTool(gmailPdf), true);
assert.equal(recipeCreatesLocalArtifact(gmailPdf), true);
assert.equal(gmailPdf.operations.some((operation) => operation.kind === "browser_chrome" && operation.input?.command === "download.verify"), true);
assert.equal(gmailPdf.safetyBoundaries.includes("no_reply_forward_delete_archive"), true);

const calendar = requireRecipe("Gmail의 종소세 메일과 첨부 PDF를 읽고 납부 기한을 캘린더 초안으로 만들고 저장 전에는 물어봐");
assert.equal(calendar.id, "calendar_draft_approval");
assert.equal(calendar.commitPolicy, "draft_requires_user_commit");
assert.equal(calendar.riskClass, "browser_state_mutation");
assert.equal(calendar.operations.some((operation) => operation.input?.approvalGate === "calendar_save_requires_user_approval"), true);

const permission = requireRecipe("example.com의 Chrome 카메라 권한을 이번 한 번만 allow로 바꿔줘");
assert.equal(permission.id, "browser_permission_rollback");
assert.equal(permission.commitPolicy, "approval_before_mutation");
assert.equal(recipeRequiresBrowserChrome(permission), true);
assert.equal(permission.operations.filter((operation) => operation.kind === "browser_chrome").length, 3);
assert.equal(permission.evidenceNeeds.includes("rollback_command_with_previous_setting"), true);

const native = requireRecipe("화면의 오류 메시지를 읽고 확인 버튼을 눌러줘");
assert.equal(native.id, "uia_foreground_action_contract");
assert.equal(native.preferredSurface, "foreground_desktop_watch");
assert.equal(recipeRequiresForeground(native), true);
assert.equal(native.rolloutStatus, "guarded_contract");
assert.equal(native.operations.some((operation) => operation.kind === "find_elements"), true);

const research = requireRecipe("항공권 3개 사이트에서 같은 조건을 검색하고 최저가와 수하물 조건을 표로 비교해줘. 결제는 절대 하지 마");
assert.equal(research.id, "multisite_research_compare");
assert.equal(research.riskClass, "read_only");
assert.equal(research.safetyBoundaries.includes("no_payment"), true);
assert.equal(research.safetyBoundaries.includes("no_booking_submit"), true);

const recurring = requireRecipe("매일 아침 Gmail, Slack, Notion을 확인해서 오늘 처리할 일을 우선순위별로 정리해줘");
assert.equal(recurring.id, "recurring_account_triage_boundary");
assert.deepEqual(recurring.operations[0]?.input?.accounts, ["gmail", "slack", "notion"]);
assert.equal(recurring.safetyBoundaries.includes("user_can_revoke_schedule"), true);

const vm = requireRecipe("다운로드한 알 수 없는 설치 파일을 격리 VM에서 실행해 보고 생성 파일과 레지스트리 변경을 요약한 뒤 롤백해줘");
assert.equal(vm.id, "vm_sandbox_readiness");
assert.equal(vm.preferredSurface, "future_vm_session");
assert.equal(vm.rolloutStatus, "backend_deferred");
assert.equal(vm.commitPolicy, "blocked_until_backend");

assert.equal(planComputerUseCatchUpRecipe("내 브라우저 쿠키와 저장된 비밀번호를 읽어서 자동 로그인 스크립트를 만들어줘"), null);

console.log("computer use catch-up recipe smoke ok");

function requireRecipe(prompt) {
  const recipe = planComputerUseCatchUpRecipe(prompt);
  if (!recipe) {
    throw new Error(`Expected catch-up recipe for prompt: ${prompt}`);
  }
  return recipe;
}
