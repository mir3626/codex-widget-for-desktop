import type {
  ComputerStructuredOperation,
  ExecutionSurfaceKind,
  RiskClass
} from "../../shared/protocol.js";

export type ComputerUseCatchUpRecipeId =
  | "gmail_tax_pdf_readonly"
  | "calendar_draft_approval"
  | "uia_foreground_action_contract"
  | "browser_permission_rollback"
  | "multisite_research_compare"
  | "recurring_account_triage_boundary"
  | "vm_sandbox_readiness";

export type ComputerUseCatchUpRecipe = {
  schemaVersion: "computer-use-catchup-recipe.v1";
  id: ComputerUseCatchUpRecipeId;
  title: string;
  confidence: "high" | "medium";
  preferredSurface: ExecutionSurfaceKind;
  riskClass: RiskClass;
  requiredGrants: string[];
  operations: ComputerStructuredOperation[];
  evidenceNeeds: string[];
  safetyBoundaries: string[];
  commitPolicy: "read_only" | "draft_requires_user_commit" | "approval_before_mutation" | "blocked_until_backend";
  rolloutStatus: "implemented_recipe" | "guarded_contract" | "backend_deferred";
  summary: string;
};

export function planComputerUseCatchUpRecipe(userRequest: string): ComputerUseCatchUpRecipe | null {
  const text = normalizePrompt(userRequest);
  if (!text) {
    return null;
  }
  return planBlockedUnsafeRecipe(text) ??
    planVmSandboxRecipe(text) ??
    planRecurringAccountTriageRecipe(text) ??
    planCalendarDraftRecipe(text) ??
    planGmailTaxPdfRecipe(text) ??
    planBrowserPermissionRecipe(text) ??
    planUiaForegroundActionRecipe(text) ??
    planMultisiteResearchRecipe(text);
}

export function recipeRequiresBrowserProfile(recipe: ComputerUseCatchUpRecipe | null): boolean {
  return recipe?.preferredSurface === "regular_browser_extension";
}

export function recipeRequiresForeground(recipe: ComputerUseCatchUpRecipe | null): boolean {
  return recipe?.preferredSurface === "foreground_desktop_watch";
}

export function recipeRequiresGeneratedTool(recipe: ComputerUseCatchUpRecipe | null): boolean {
  return Boolean(recipe?.operations.some((operation) => operation.kind === "toolsmith"));
}

export function recipeRequiresBrowserChrome(recipe: ComputerUseCatchUpRecipe | null): boolean {
  return Boolean(recipe?.operations.some((operation) => operation.kind === "browser_chrome"));
}

export function recipeCreatesLocalArtifact(recipe: ComputerUseCatchUpRecipe | null): boolean {
  return Boolean(recipe?.operations.some((operation) => operation.kind === "toolsmith" || operation.kind === "terminal"));
}

function planGmailTaxPdfRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (!/(gmail|지메일|구글메일|mail\.google)/i.test(text) || !/(국세청|홈택스|종소세|종합소득세|tax|nts)/i.test(text)) {
    return null;
  }
  const needsAttachment = /(첨부|pdf|납부|기한|금액|저장|다운로드)/i.test(text);
  return {
    schemaVersion: "computer-use-catchup-recipe.v1",
    id: "gmail_tax_pdf_readonly",
    title: "Gmail tax mail read-only and PDF summary",
    confidence: needsAttachment ? "high" : "medium",
    preferredSurface: "regular_browser_extension",
    riskClass: "profile_private_data",
    requiredGrants: ["browser.profile", "browser.chrome"],
    operations: [
      browserNavigate("https://mail.google.com/"),
      browserType("검색창", "from:(국세청 OR 홈택스) (종소세 OR 종합소득세)"),
      browserClick("검색"),
      browserClick("가장 관련도 높은 국세청 종소세 메일"),
      browserRead("메일 본문과 첨부 목록"),
      ...(needsAttachment ? [
        browserClick("첨부 PDF 다운로드"),
        browserChrome("download.verify", {
          expectedState: "complete",
          expectedMime: "application/pdf",
          evidenceRole: "tax_mail_attachment_pdf"
        }),
        toolsmith("local_document_conversion", {
          source: "verified_download_pdf",
          extractionGoal: "납부 기한, 금액, 발신자, 문서 제목만 요약"
        })
      ] : [])
    ],
    evidenceNeeds: [
      "gmail_search_query_redacted",
      "selected_message_subject_sender_date",
      "attachment_download_verified",
      "pdf_summary_without_raw_tax_values_in_debug_bundle"
    ],
    safetyBoundaries: [
      "read_only_email_access",
      "no_reply_forward_delete_archive",
      "credentials_and_cookies_never_stored",
      "tax_values_redacted_in_debug_bundle"
    ],
    commitPolicy: "read_only",
    rolloutStatus: "implemented_recipe",
    summary: "Routes Gmail tax-mail prompts through logged-in browser profile read-only steps, download verification, and redacted PDF summary handoff."
  };
}

function planCalendarDraftRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (!/(calendar|캘린더|일정|구글\s*캘린더|google\s*calendar)/i.test(text)) {
    return null;
  }
  const draftWrite = /(만들|추가|등록|저장|draft|초안|납부\s*기한)/i.test(text);
  return {
    schemaVersion: "computer-use-catchup-recipe.v1",
    id: "calendar_draft_approval",
    title: "Calendar read and draft-with-approval",
    confidence: "high",
    preferredSurface: "regular_browser_extension",
    riskClass: draftWrite ? "browser_state_mutation" : "profile_private_data",
    requiredGrants: ["browser.profile"],
    operations: draftWrite
      ? [
          browserNavigate("https://calendar.google.com/"),
          browserClick("만들기"),
          browserType("제목", "사용자 요청에서 추출한 일정 제목"),
          browserType("날짜", "사용자 요청에서 추출한 날짜"),
          browserType("설명", "redacted source summary"),
          browserRead("저장 전 일정 초안"),
          browserActionGate("calendar_save_requires_user_approval")
        ]
      : [
          browserNavigate("https://calendar.google.com/"),
          browserRead("요청한 날짜 범위의 일정")
        ],
    evidenceNeeds: [
      "calendar_visible_range",
      "calendar_draft_fields_before_commit",
      "user_commit_approval_for_save"
    ],
    safetyBoundaries: [
      "calendar_save_send_invite_requires_user_approval",
      "calendar_delete_or_modify_existing_events_blocked_without_explicit_request",
      "account_data_redacted"
    ],
    commitPolicy: draftWrite ? "draft_requires_user_commit" : "read_only",
    rolloutStatus: "implemented_recipe",
    summary: "Plans Calendar web reads and draft creation but requires explicit user approval before saving or sending invitations."
  };
}

function planBrowserPermissionRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (!/(권한|permission|카메라|마이크|위치|알림|camera|microphone|location|notification)/i.test(text) || !/(allow|block|허용|차단|확인|바꿔|변경|set|get)/i.test(text)) {
    return null;
  }
  const permissionType = readPermissionType(text);
  const requestedSetting = readPermissionSetting(text);
  const url = readFirstUrl(text) ?? "https://example.com/";
  const isMutation = requestedSetting !== "ask";
  return {
    schemaVersion: "computer-use-catchup-recipe.v1",
    id: "browser_permission_rollback",
    title: "Browser permission get/set with rollback evidence",
    confidence: "high",
    preferredSurface: "regular_browser_extension",
    riskClass: isMutation ? "browser_state_mutation" : "profile_private_data",
    requiredGrants: ["browser.profile", "browser.chrome"],
    operations: [
      browserChrome("permission.get", { type: permissionType, url }),
      ...(isMutation ? [
        browserChrome("permission.set", {
          type: permissionType,
          url,
          setting: requestedSetting,
          requireOneTimeApproval: true,
          rollback: {
            command: "permission.set",
            restoreFrom: "permission.get.before"
          }
        }),
        browserChrome("permission.get", {
          type: permissionType,
          url,
          verifySetting: requestedSetting
        })
      ] : [])
    ],
    evidenceNeeds: [
      "permission_before_setting",
      "permission_after_setting",
      "rollback_command_with_previous_setting",
      "origin_scoped_permission_target"
    ],
    safetyBoundaries: [
      "origin_must_match_requested_site",
      "permission_set_requires_one_time_approval",
      "native_permission_popup_click_not_used",
      "rollback_proof_required_for_mutation"
    ],
    commitPolicy: isMutation ? "approval_before_mutation" : "read_only",
    rolloutStatus: "implemented_recipe",
    summary: "Routes browser permission requests through Browser Chrome content settings with before/after verification and rollback metadata."
  };
}

function planUiaForegroundActionRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (!/(오류|에러|확인\s*버튼|ok\s*button|메모장|notepad|notes|native|uia|창|대화상자)/i.test(text)) {
    return null;
  }
  const textEntry = /(메모|작성|써줘|입력|type|notepad|notes)/i.test(text);
  return {
    schemaVersion: "computer-use-catchup-recipe.v1",
    id: "uia_foreground_action_contract",
    title: "UIA foreground action guarded contract",
    confidence: "medium",
    preferredSurface: "foreground_desktop_watch",
    riskClass: "security_boundary",
    requiredGrants: ["desktop.foreground_watch", "desktop.abort_on_user_input"],
    operations: [
      { kind: "computer_use_snapshot", input: { source: "native_helper_uia", includeRefs: true } },
      { kind: "find_elements", input: textEntry ? { role: "textbox", visibleOnly: true, enabledOnly: true } : { role: "button", text: "확인", visibleOnly: true, enabledOnly: true } },
      {
        kind: "native_browser_window_action",
        input: {
          command: textEntry ? "type_text" : "click_element",
          targetRef: "uia_ref_from_find_elements",
          text: textEntry ? "사용자 요청에서 추출한 메모 초안" : undefined,
          requireForegroundWatch: true,
          dryRunIfUnsignedHelper: true
        }
      }
    ],
    evidenceNeeds: [
      "uia_snapshot_ref_map",
      "active_window_identity",
      "foreground_watch_preflight",
      "actual_input_sent_or_unsigned_helper_block"
    ],
    safetyBoundaries: [
      "user_input_abort_guard",
      "active_window_drift_abort",
      "visible_countdown_before_native_input",
      "unsigned_helper_records_no_input_sent"
    ],
    commitPolicy: "approval_before_mutation",
    rolloutStatus: "guarded_contract",
    summary: "Plans UIA element lookup plus guarded element action. Actual native input remains blocked unless foreground watch helper preconditions are satisfied."
  };
}

function planMultisiteResearchRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (!/(항공권|최저가|수하물|비교|3개\s*사이트|세\s*개\s*사이트|multi.?site|compare)/i.test(text)) {
    return null;
  }
  return {
    schemaVersion: "computer-use-catchup-recipe.v1",
    id: "multisite_research_compare",
    title: "Multi-site browser research comparison",
    confidence: "medium",
    preferredSurface: "isolated_browser",
    riskClass: "read_only",
    requiredGrants: [],
    operations: [
      browserNavigate("site-1-search-url"),
      browserRead("site-1 visible fare and baggage results"),
      browserNavigate("site-2-search-url"),
      browserRead("site-2 visible fare and baggage results"),
      browserNavigate("site-3-search-url"),
      browserRead("site-3 visible fare and baggage results"),
      toolsmith("web_research_to_pdf", {
        output: "comparison_table",
        columns: ["site", "price", "baggage", "restrictions", "source"]
      })
    ],
    evidenceNeeds: [
      "source_url_per_site",
      "visible_result_timestamp",
      "comparison_table_with_citations",
      "submit_purchase_block_proof"
    ],
    safetyBoundaries: [
      "no_booking_submit",
      "no_payment",
      "captcha_or_antibot_stops_run",
      "prices_are_observed_not_guaranteed"
    ],
    commitPolicy: "read_only",
    rolloutStatus: "implemented_recipe",
    summary: "Plans multi-site comparison as read-only browser research and table synthesis, with purchase/booking submission explicitly blocked."
  };
}

function planRecurringAccountTriageRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (!/(매일|매주|매월|아침|정기|recurring|daily|schedule)/i.test(text) || !/(gmail|slack|notion|캘린더|메일)/i.test(text)) {
    return null;
  }
  return {
    schemaVersion: "computer-use-catchup-recipe.v1",
    id: "recurring_account_triage_boundary",
    title: "Recurring account triage worker boundary",
    confidence: "medium",
    preferredSurface: "regular_browser_extension",
    riskClass: "profile_private_data",
    requiredGrants: ["browser.profile"],
    operations: [
      {
        kind: "toolsmith",
        input: {
          capability: "recurring_computer_use_worker",
          schedule: readScheduleHint(text),
          accounts: readMentionedApps(text),
          runMode: "summary_only",
          requiresProfileLease: true,
          revokeRoute: "/computer-use/recurring/:id/revoke"
        }
      }
    ],
    evidenceNeeds: [
      "schedule_timezone",
      "profile_lease_scope",
      "per_run_redacted_summary",
      "revoke_status"
    ],
    safetyBoundaries: [
      "no_background_send_submit_delete",
      "profile_lease_required",
      "raw_messages_not_persisted",
      "user_can_revoke_schedule"
    ],
    commitPolicy: "approval_before_mutation",
    rolloutStatus: "guarded_contract",
    summary: "Creates a bounded recurring-worker plan: scheduled read-only triage with explicit profile lease, redacted summaries, and revoke semantics."
  };
}

function planVmSandboxRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (!/(vm|sandbox|샌드박스|격리|hyper-v|rdp|알\s*수\s*없는\s*설치|설치\s*파일|exe|레지스트리|rollback|롤백)/i.test(text)) {
    return null;
  }
  return {
    schemaVersion: "computer-use-catchup-recipe.v1",
    id: "vm_sandbox_readiness",
    title: "VM sandbox execution readiness",
    confidence: "high",
    preferredSurface: "future_vm_session",
    riskClass: "security_boundary",
    requiredGrants: ["vm.session_backend", "vm.network_isolation", "vm.lifecycle_cleanup", "vm.artifact_sync_policy"],
    operations: [
      {
        kind: "toolsmith",
        input: {
          capability: "vm_sandbox_execution",
          backendPreference: ["windows_sandbox", "hyper_v", "rdp", "cloud"],
          allowHostMutation: false,
          requiredEvidence: ["process_trace", "filesystem_delta", "registry_delta", "rollback_status"]
        }
      }
    ],
    evidenceNeeds: [
      "vm_backend_capability",
      "network_isolation",
      "filesystem_delta",
      "registry_delta",
      "rollback_or_discard_proof"
    ],
    safetyBoundaries: [
      "blocked_until_vm_backend_available",
      "no_host_execution",
      "artifact_sync_is_redacted",
      "vm_lifecycle_cleanup_required"
    ],
    commitPolicy: "blocked_until_backend",
    rolloutStatus: "backend_deferred",
    summary: "Records implementation-ready VM requirements and fail-closed evidence without executing unknown installers on the host."
  };
}

function planBlockedUnsafeRecipe(text: string): ComputerUseCatchUpRecipe | null {
  if (/(쿠키|cookie|저장된\s*비밀번호|password|credential|captcha\s*우회|캡차\s*우회)/i.test(text)) {
    return null;
  }
  return null;
}

function browserNavigate(url: string): ComputerStructuredOperation {
  return { kind: "browser_action", input: { action: { type: "navigate", url } } };
}

function browserClick(target: string): ComputerStructuredOperation {
  return { kind: "browser_action", input: { action: { type: "click", target: { kind: "text", text: target } } } };
}

function browserType(target: string, text: string): ComputerStructuredOperation {
  return { kind: "browser_action", input: { action: { type: "type", target: { kind: "text", text: target }, text } } };
}

function browserRead(targetSummary: string): ComputerStructuredOperation {
  return { kind: "browser_action", input: { action: { type: "read" }, targetHint: targetSummary } };
}

function browserActionGate(reason: string): ComputerStructuredOperation {
  return { kind: "browser_action", input: { action: { type: "read" }, approvalGate: reason } };
}

function browserChrome(command: string, payload: Record<string, unknown>): ComputerStructuredOperation {
  return { kind: "browser_chrome", input: { command, ...payload } };
}

function toolsmith(capability: string, input: Record<string, unknown>): ComputerStructuredOperation {
  return { kind: "toolsmith", input: { capability, ...input } };
}

function readPermissionType(text: string): string {
  if (/마이크|microphone/i.test(text)) return "microphone";
  if (/위치|location/i.test(text)) return "location";
  if (/알림|notification/i.test(text)) return "notifications";
  return "camera";
}

function readPermissionSetting(text: string): "allow" | "block" | "ask" {
  if (/allow|허용/i.test(text)) return "allow";
  if (/block|차단/i.test(text)) return "block";
  return "ask";
}

function readFirstUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s"'<>]+/i.exec(text) ?? /\b[a-z0-9.-]+\.[a-z]{2,}\b/i.exec(text);
  if (!match) {
    return undefined;
  }
  const value = match[0].replace(/[.,!?]+$/g, "");
  return value.includes("://") ? value : `https://${value}/`;
}

function readMentionedApps(text: string): string[] {
  const apps: string[] = [];
  if (/gmail|메일|지메일/i.test(text)) apps.push("gmail");
  if (/slack|슬랙/i.test(text)) apps.push("slack");
  if (/notion|노션/i.test(text)) apps.push("notion");
  if (/calendar|캘린더|일정/i.test(text)) apps.push("calendar");
  return [...new Set(apps)];
}

function readScheduleHint(text: string): string {
  if (/매일|daily/i.test(text)) return "daily";
  if (/매주|weekly/i.test(text)) return "weekly";
  if (/매월|monthly/i.test(text)) return "monthly";
  return "manual";
}

function normalizePrompt(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
