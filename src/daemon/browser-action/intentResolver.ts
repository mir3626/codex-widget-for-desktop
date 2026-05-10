import { randomUUID } from "node:crypto";
import type { BrowserAction, BrowserActionIntent } from "./types.js";
import {
  isClickThenContentRequest,
  isContentOpenRequest,
  readContentRequestTarget
} from "./intentResolver/contentRequests.js";
import { readIntentConfidence } from "./intentResolver/confidence.js";
import {
  extractQuotedText,
  extractTargetPhrase,
  extractTextAfterKeyword,
  extractUrl,
  isInformationalBrowserActionQuestion,
  readScrollAmount,
  stripBrowserActionSuffix
} from "./intentResolver/parsing.js";

export {
  extractTargetPhrase,
  isInformationalBrowserActionQuestion
} from "./intentResolver/parsing.js";

export function resolveBrowserActionIntent(text: string): BrowserActionIntent {
  const utterance = text.trim();
  if (!utterance || isInformationalBrowserActionQuestion(utterance)) {
    return createIntent({ utterance, actionType: "unknown", actions: [], confidence: 0, reason: "No executable Browser Action intent." });
  }

  const targetPhrase = extractTargetPhrase(utterance);
  const typedText = extractQuotedText(utterance) ?? extractTextAfterKeyword(utterance, ["입력", "type", "검색어", "search for"]);
  const actions: BrowserAction[] = [];
  let actionType: BrowserActionIntent["actionType"] = "unknown";
  let targetRole: string | undefined;
  let value: string | undefined = typedText;
  let reason = "Resolved Browser Action intent from deterministic command rules.";

  if (isClickThenContentRequest(utterance, targetPhrase)) {
    actionType = "click";
    targetRole = "link";
    actions.push({ type: "click", target: { kind: "text", text: targetPhrase ?? stripBrowserActionSuffix(utterance) ?? utterance.slice(0, 80) } });
    actions.push({ type: "click", target: { kind: "text", role: "link", text: readContentRequestTarget(utterance) } });
    reason = "Resolved chained Browser Action intent: activate a filter/control, then open a representative content item.";
  } else if (isContentOpenRequest(utterance)) {
    actionType = "click";
    targetRole = "link";
    actions.push({ type: "click", target: { kind: "text", role: "link", text: readContentRequestTarget(utterance) } });
    reason = "Resolved Browser Action intent to open a representative content item.";
  } else if (/뒤로|go\s*back|\bback\b/i.test(utterance)) {
    actionType = "back";
    actions.push({ type: "back" });
  } else if (/앞으로|\bforward\b/i.test(utterance)) {
    actionType = "forward";
    actions.push({ type: "forward" });
  } else if (/새로고침|reload|refresh/i.test(utterance)) {
    actionType = "reload";
    actions.push({ type: "reload" });
  } else if (/스크롤|scroll/i.test(utterance)) {
    actionType = "scroll";
    actions.push({ type: "scroll", direction: /위로|up/i.test(utterance) ? "up" : "down", amount: readScrollAmount(utterance) });
  } else if (/열어|이동|navigate|open/i.test(utterance) && extractUrl(utterance)) {
    actionType = "navigate";
    value = extractUrl(utterance);
    actions.push({ type: "navigate", url: value ?? "" });
  } else if (/검색|search/i.test(utterance) && typedText) {
    actionType = "type";
    targetRole = "searchbox";
    actions.push({
      type: "type",
      target: { kind: "text", role: "searchbox", text: targetPhrase || "search" },
      text: typedText,
      clearFirst: true,
      submit: false
    });
    if (!/제출하지|submit 하지|no submit|pre-submit|직전/i.test(utterance)) {
      actions.push({ type: "click", target: { kind: "text", role: "button", text: targetPhrase || "search" } });
    }
  } else if (/입력|type|fill|바꿔|수정/i.test(utterance) && typedText) {
    actionType = "type";
    actions.push({
      type: "type",
      target: { kind: "text", text: targetPhrase || "input" },
      text: typedText,
      clearFirst: /바꿔|수정|clear|replace/i.test(utterance),
      submit: /제출|submit/i.test(utterance) && !/제출하지|submit 하지|no submit|pre-submit|직전/i.test(utterance)
    });
  } else if (/체크|check/i.test(utterance)) {
    actionType = "check";
    actions.push({ type: "check", target: { kind: "text", text: targetPhrase || "checkbox" }, checked: !/해제|uncheck/i.test(utterance) });
  } else if (/선택|\bselect\b/i.test(utterance)) {
    actionType = "select";
    value = typedText ?? targetPhrase ?? "";
    actions.push({ type: "select", target: { kind: "text", text: targetPhrase || value || "select" }, value });
  } else if (/클릭|눌러|누르|click|press|펼쳐|expand/i.test(utterance)) {
    actionType = "click";
    actions.push({ type: "click", target: { kind: "text", text: targetPhrase || stripBrowserActionSuffix(utterance) || utterance.slice(0, 80) } });
  } else if (/읽어|요약|설명|describe|summarize|read|observe|봐줘/i.test(utterance)) {
    actionType = "read";
    actions.push({ type: "read", reason: utterance.slice(0, 240) });
  }

  if (actions.length === 0 && /페이지|browser|브라우저|DOM/i.test(utterance)) {
    actionType = "read";
    actions.push({ type: "read", reason: utterance.slice(0, 240) });
    reason = "Fell back to Browser Action read because the prompt references browser/page context.";
  }

  return createIntent({
    utterance,
    actionType,
    actions,
    targetPhrase,
    targetRole,
    value,
    confidence: actions.length > 0 ? readIntentConfidence({ targetPhrase, typedText, actionType }) : 0.35,
    reason
  });
}

function createIntent(input: Omit<BrowserActionIntent, "id" | "alternatives"> & { alternatives?: string[] }): BrowserActionIntent {
  return {
    id: `browser-intent-${randomUUID()}`,
    ...input,
    alternatives: input.alternatives ?? []
  };
}
