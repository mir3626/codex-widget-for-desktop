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
  extractNavigationTargetPhrase,
  extractSearchSubmitTargetPhrase,
  extractTargetPhrase,
  extractTextAfterKeyword,
  extractUrl,
  isInformationalBrowserActionQuestion,
  readSearchFieldTargetPhrase,
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
  if (isBrowserActionFeedbackOnly(utterance)) {
    return createIntent({ utterance, actionType: "unknown", actions: [], confidence: 0, reason: "Browser Action feedback was not treated as an executable browser command." });
  }

  const targetPhrase = extractTargetPhrase(utterance);
  const navigationTargetPhrase = extractNavigationTargetPhrase(utterance);
  const typedText = extractQuotedText(utterance) ?? extractTextAfterKeyword(utterance, ["입력", "type", "검색어", "search for"]);
  const requestedNavigationUrl = isNavigationRequest(utterance)
    ? extractUrl(utterance) ?? resolveKnownWebsiteUrl(navigationTargetPhrase ?? utterance)
    : undefined;
  const historyCommand = readHistoryCommand(utterance);
  const actions: BrowserAction[] = [];
  let actionType: BrowserActionIntent["actionType"] = "unknown";
  let targetRole: string | undefined;
  let value: string | undefined = typedText;
  let reason = "Resolved Browser Action intent from deterministic command rules.";

  if (historyCommand) {
    actionType = historyCommand;
    actions.push({ type: historyCommand });
    reason = "Resolved explicit browser history command before generic content-click parsing.";
  } else if (isClickThenContentRequest(utterance, targetPhrase)) {
    actionType = "click";
    targetRole = "link";
    actions.push({ type: "click", target: { kind: "text", text: targetPhrase ?? stripBrowserActionSuffix(utterance) ?? utterance.slice(0, 80) } });
    actions.push({ type: "click", target: { kind: "text", role: "link", text: readContentRequestTarget(utterance) } });
    reason = "Resolved chained Browser Action intent: activate a filter/control, then open a representative content item.";
  } else if (requestedNavigationUrl) {
    actionType = "navigate";
    value = requestedNavigationUrl;
    actions.push({ type: "navigate", url: requestedNavigationUrl });
    reason = "Resolved Browser Action intent to navigate to a requested website.";
  } else if (isContentOpenRequest(utterance)) {
    actionType = "click";
    targetRole = "link";
    actions.push({ type: "click", target: { kind: "text", role: "link", text: readContentRequestTarget(utterance) } });
    reason = "Resolved Browser Action intent to open a representative content item.";
  } else if (/스크롤|scroll/i.test(utterance)) {
    actionType = "scroll";
    actions.push({ type: "scroll", direction: /위로|up/i.test(utterance) ? "up" : "down", amount: readScrollAmount(utterance) });
  } else if (isNavigationRequest(utterance)) {
    actionType = "navigate";
    if (navigationTargetPhrase) {
      const searchUrl = buildSearchNavigationUrl(navigationTargetPhrase);
      value = searchUrl;
      actions.push({ type: "navigate", url: searchUrl });
      reason = "Resolved URL-less navigation request as a search navigation instead of clicking an unrelated current-page link.";
    }
  } else if (/검색|search/i.test(utterance) && typedText) {
    actionType = "type";
    targetRole = "searchbox";
    const searchFieldTarget = readSearchFieldTargetPhrase(utterance, targetPhrase);
    const searchSubmitTarget = extractSearchSubmitTargetPhrase(utterance);
    actions.push({
      type: "type",
      target: { kind: "text", role: "searchbox", text: searchFieldTarget },
      text: typedText,
      clearFirst: true,
      submit: false
    });
    if (!/제출하지|submit 하지|no submit|pre-submit|직전/i.test(utterance)) {
      actions.push({ type: "click", target: { kind: "text", role: "button", text: searchSubmitTarget } });
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
    const requestedRole = readRequestedElementRole(utterance);
    actions.push({
      type: "click",
      target: {
        kind: "text",
        ...(requestedRole ? { role: requestedRole } : {}),
        text: targetPhrase || stripBrowserActionSuffix(utterance) || utterance.slice(0, 80)
      }
    });
  } else if (/읽어|요약|설명|describe|summarize|read|observe|봐줘/i.test(utterance)) {
    actionType = "read";
    actions.push({ type: "read", reason: utterance.slice(0, 240) });
  }

  if (actions.length === 0 && !isExecutableBrowserCommand(utterance) && /페이지|browser|브라우저|DOM/i.test(utterance)) {
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

function isNavigationRequest(text: string): boolean {
  return /열어|이동|접속|켜|navigate|open|go\s*to/i.test(text);
}

function readHistoryCommand(text: string): "back" | "forward" | "reload" | undefined {
  if (/뒤로|go\s*back|\bback\b/i.test(text)) {
    return "back";
  }
  if (/앞으로|\bforward\b/i.test(text)) {
    return "forward";
  }
  if (/새로고침|reload|refresh/i.test(text)) {
    return "reload";
  }
  return undefined;
}

function readRequestedElementRole(text: string): string | undefined {
  if (/(?:버튼|button)/i.test(text)) {
    return "button";
  }
  if (/(?:탭|tab)/i.test(text)) {
    return "tab";
  }
  if (/(?:메뉴|menu)/i.test(text)) {
    return "menuitem";
  }
  if (/(?:링크|link)/i.test(text)) {
    return "link";
  }
  return undefined;
}

function isBrowserActionFeedbackOnly(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  const referencesBrowserAction = /브라우저|browser|액션|action|뒤로가기|앞으로가기|back|forward/i.test(normalized);
  const describesProblem = /동작|작동|기능|응답|속도|버그|문제|이상|느려|느림|실패|안\s*(?:돼|되)|꼬이|불안정/i.test(normalized);
  const requestsExecution = /해줘|실행|눌러|누르|클릭|열어|이동|접속|켜|가줘|돌아가|go\s*back|go\s*forward|reload|refresh/i.test(normalized);
  return referencesBrowserAction && describesProblem && !requestsExecution;
}

function isExecutableBrowserCommand(text: string): boolean {
  return /눌러|누르|클릭|입력|검색|스크롤|뒤로|앞으로|새로고침|이동|접속|열어|켜|펼쳐|체크|선택|click|type|search|scroll|navigate|open|go\s*to|reload|back|forward/i.test(text);
}

function resolveKnownWebsiteUrl(value: string): string | undefined {
  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?。！？]+$/g, "");
  const aliases: Array<[RegExp, string]> = [
    [/^(google|구글)$/, "https://www.google.com/"],
    [/^(naver|네이버)$/, "https://www.naver.com/"],
    [/^(youtube|유튜브|유튭)$/, "https://www.youtube.com/"],
    [/^(github|깃허브|기트허브)$/, "https://github.com/"],
    [/^(dcinside|디시|디시인사이드)$/, "https://www.dcinside.com/"],
    [/^(fmkorea|펨코|에펨코리아)$/, "https://www.fmkorea.com/"],
    [/^(chzzk|치지직)$/, "https://chzzk.naver.com/"]
  ];
  return aliases.find(([pattern]) => pattern.test(normalized))?.[1];
}

function buildSearchNavigationUrl(value: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(value.trim())}`;
}

function createIntent(input: Omit<BrowserActionIntent, "id" | "alternatives"> & { alternatives?: string[] }): BrowserActionIntent {
  return {
    id: `browser-intent-${randomUUID()}`,
    ...input,
    alternatives: input.alternatives ?? []
  };
}
