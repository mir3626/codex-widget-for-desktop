import {
  redactBrowserActionSecret,
  summarizeBrowserElement,
  type BrowserAction,
  type BrowserActionPlan,
  type BrowserActionResult
} from "../../browser-action/index.js";
import { renderBrowserReadResponse } from "./presentationRead.js";

export function renderBrowserPromptResponse(
  plan: BrowserActionPlan,
  results: BrowserActionResult[],
  terminalStatus: string,
  promptText = ""
): string {
  const latest = results.at(-1);
  if (terminalStatus !== "approval_required" && terminalStatus !== "extension_pending" && latest?.status === "succeeded" && latest.action.type === "read") {
    return renderBrowserReadResponse(latest.after ?? latest.before, promptText);
  }
  if (terminalStatus !== "approval_required" && terminalStatus !== "extension_pending" && latest?.status === "succeeded" && latest.after && shouldRenderPostActionObservation(promptText, latest.action.type)) {
    return renderBrowserReadResponse(latest.after, promptText);
  }
  if (terminalStatus === "extension_pending") {
    return renderExtensionPendingResponse(promptText);
  }
  if (latest?.status === "needs_clarification") {
    return renderClarificationResponse(latest, promptText);
  }
  if (terminalStatus === "approval_required" && latest) {
    return renderApprovalRequiredResponse(latest, promptText);
  }
  if (plan.status === "failed" || latest?.status === "failed") {
    return renderFailureResponse(latest, promptText);
  }
  const lines = renderActionCompletionResponse(plan, latest, terminalStatus, promptText);
  return lines.map((line) => String(redactBrowserActionSecret(line))).join("\n");
}

function shouldRenderPostActionObservation(promptText: string, actionType: BrowserAction["type"]): boolean {
  if (actionType === "read" || actionType === "screenshot") {
    return true;
  }
  return /(보여|알려|설명|요약|읽어|찾아|재밌|what|show|describe|summarize|read|find)/i.test(promptText);
}

function renderExtensionPendingResponse(promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  return korean
    ? "Browser Bridge가 브라우저에서 작업을 가져가기를 기다리고 있습니다. 확장프로그램이 IDLE 상태이고 현재 사이트 권한이 허용되어 있으면 자동으로 이어집니다."
    : "Browser Bridge is waiting to pick up the browser action. It will continue automatically when the extension is idle and the current site is allowed.";
}

function renderClarificationResponse(result: BrowserActionResult, promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  const alternatives = (result.alternatives ?? [])
    .slice(0, 3)
    .map((element) => summarizeBrowserElement(element));
  const suffix = alternatives.length > 0
    ? korean
      ? `\n후보: ${alternatives.join(", ")}`
      : `\nCandidates: ${alternatives.join(", ")}`
    : "";
  const observed = result.before ?? result.after;
  const page = observed?.url
    ? korean
      ? `\n현재 인식한 탭: ${observed.title || "제목 없음"} (${observed.url})`
      : `\nRecognized tab: ${observed.title || "Untitled"} (${observed.url})`
    : "";
  return korean
    ? `브라우저에서 실행할 대상을 확정하지 못했습니다. 더 구체적인 이름이나 위치를 알려주세요.${page}${suffix}`
    : `I could not resolve the browser target confidently. Please name the target or location more specifically.${page}${suffix}`;
}

function renderApprovalRequiredResponse(result: BrowserActionResult, promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  const target = result.target ? summarizeBrowserElement(result.target) : summarizeActionForApproval(result.action) ?? result.safety.targetSummary;
  const reason = result.safety.reason || result.verification.reason;
  return korean
    ? [
        `다음 브라우저 동작은 승인 후 실행됩니다: ${target}`,
        reason ? `사유: ${reason}` : "",
        "의도한 대상이 아니면 거절하세요."
      ].filter(Boolean).join("\n")
    : [
        `Approval is required before running the next browser action: ${target}`,
        reason ? `Reason: ${reason}` : "",
        "Deny it if this is not the intended target."
      ].filter(Boolean).join("\n");
}

function summarizeActionForApproval(action: BrowserAction): string | undefined {
  if (action.type === "navigate") {
    return `navigate ${action.url}`;
  }
  if (action.type === "back" || action.type === "forward" || action.type === "reload") {
    return action.type;
  }
  if (action.type === "scroll") {
    return `scroll ${action.direction}`;
  }
  if (action.type === "type") {
    return "type into field";
  }
  return undefined;
}

function renderActionCompletionResponse(
  plan: BrowserActionPlan,
  latest: BrowserActionResult | undefined,
  terminalStatus: string,
  promptText: string
): string[] {
  const korean = /[가-힣]/.test(promptText);
  const stepSummary = plan.steps
    .filter((step) => step.status !== "skipped")
    .map((step) => summarizePlanStep(step.action, step.targetSummary))
    .filter(Boolean)
    .join(korean ? " -> " : " -> ");
  const page = latest?.after ?? latest?.before;
  const pageLine = page?.url
    ? korean
      ? `현재 페이지: ${page.title || "제목 없음"} (${page.url})`
      : `Current page: ${page.title || "Untitled"} (${page.url})`
    : undefined;
  const verification = latest?.verification.reason
    ? korean
      ? `검증: ${latest.verification.reason}`
      : `Verification: ${latest.verification.reason}`
    : undefined;
  return [
    korean ? "브라우저 동작을 완료했습니다." : "Browser action completed.",
    stepSummary ? (korean ? `실행: ${stepSummary}` : `Action: ${stepSummary}`) : undefined,
    pageLine,
    verification,
    terminalStatus === "approval_required"
      ? korean
        ? "다음 단계는 승인 후 실행됩니다."
        : "The next step requires approval before it runs."
      : undefined
  ].filter((line): line is string => Boolean(line));
}

function summarizePlanStep(action: BrowserAction, targetSummary: string | undefined): string {
  if (targetSummary) {
    return `${action.type} ${targetSummary}`;
  }
  if (action.type === "navigate") {
    return `navigate ${action.url}`;
  }
  if (action.type === "scroll") {
    return `scroll ${action.direction}`;
  }
  if (action.type === "type") {
    return "type into field";
  }
  return action.type;
}

function renderFailureResponse(result: BrowserActionResult | undefined, promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  const reason = localizeFailureReason(result?.error || result?.verification.reason, korean);
  return korean
    ? `Browser Action을 완료하지 못했습니다.${reason ? ` 이유: ${reason}` : ""}`
    : `Browser Action did not complete.${reason ? ` Reason: ${reason}` : ""}`;
}

function localizeFailureReason(reason: string | undefined, korean: boolean): string | undefined {
  if (!reason || !korean) {
    return reason;
  }
  if (/did not pick up .* within \d+ seconds|timed out before the extension picked it up/i.test(reason)) {
    return "Browser Bridge가 제한 시간 안에 작업을 가져가지 못해 명령을 취소했습니다. 확장프로그램 상태, 현재 탭, 사이트 권한을 확인한 뒤 다시 시도하세요.";
  }
  if (/Active tab URL changed before Browser Action execution/i.test(reason)) {
    return "실행 직전 활성 탭 또는 페이지 주소가 바뀌어서 중단했습니다. 현재 탭을 다시 확인한 뒤 요청을 다시 보내세요.";
  }
  if (/specific browser element|resolve the browser target|not resolved confidently/i.test(reason)) {
    return "현재 화면에서 실행 대상을 충분히 확정하지 못했습니다. 대상의 정확한 텍스트나 위치를 함께 알려주세요.";
  }
  return reason;
}
