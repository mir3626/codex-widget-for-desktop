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
  if (plan.status === "failed" || latest?.status === "failed") {
    return renderFailureResponse(latest, promptText);
  }
  const lines = [
    /[가-힣]/.test(promptText) ? "Browser Action을 실행했습니다." : "Browser Action completed.",
    `- plan: ${plan.status}`,
    `- steps: ${plan.steps.map((step) => `${step.id}:${step.status}`).join(", ")}`,
    latest ? `- latest result: ${latest.status}; verification=${latest.verification.status}; ${latest.verification.reason}` : undefined,
    terminalStatus === "approval_required"
      ? /[가-힣]/.test(promptText)
        ? "- next: 위험한 단계 실행 전 승인이 필요합니다."
        : "- next: user approval is required before executing the risky step."
      : undefined,
  ].filter(Boolean);
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
  return korean
    ? `브라우저에서 실행할 대상을 확정하지 못했습니다. 더 구체적인 이름이나 위치를 알려주세요.${suffix}`
    : `I could not resolve the browser target confidently. Please name the target or location more specifically.${suffix}`;
}

function renderFailureResponse(result: BrowserActionResult | undefined, promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  const reason = result?.error || result?.verification.reason;
  return korean
    ? `Browser Action을 완료하지 못했습니다.${reason ? ` 이유: ${reason}` : ""}`
    : `Browser Action did not complete.${reason ? ` Reason: ${reason}` : ""}`;
}
