import {
  summarizeBrowserElement
} from "../../browser-action/index.js";
import type { RuntimeInteraction } from "../../../shared/protocol.js";
import type { PendingSemanticClarification } from "./clarificationTypes.js";

export function buildSemanticTargetClarificationInteraction(
  pending: PendingSemanticClarification,
  error?: string
): RuntimeInteraction {
  const body = [
    error,
    "Browser Action 대상이 애매합니다. 실행할 대상을 선택하면 같은 요청을 이어서 수행합니다.",
    "",
    ...pending.candidates.map((candidate, index) => `${index + 1}. ${summarizeBrowserElement(candidate)}`)
  ].filter(Boolean).join("\n");
  return {
    id: pending.id,
    requestId: pending.requestId,
    kind: "input",
    title: "Browser target clarification",
    body,
    action: `Browser action: ${pending.action.type}`,
    fields: [{
      id: "choice",
      label: "Target",
      placeholder: "1"
    }]
  };
}

export function renderSemanticTargetClarificationResponse(pending: PendingSemanticClarification, promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  const candidates = pending.candidates.map((candidate, index) => `${index + 1}. ${summarizeBrowserElement(candidate)}`).join("\n");
  return korean
    ? `Browser Action 대상이 애매해서 바로 실행하지 않았습니다.\n\n${candidates}\n\n위 후보 중 번호를 선택하면 이어서 실행합니다.`
    : `Browser Action needs a target clarification before it acts.\n\n${candidates}\n\nChoose a number to continue.`;
}
