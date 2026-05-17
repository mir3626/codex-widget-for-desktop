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
import {
  isBookmarkNavigationRequest,
  resolveKnownBrowserDestinationUrl
} from "./intentResolver/navigationTargets.js";

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
    ? extractUrl(utterance) ?? resolveKnownBrowserDestinationUrl(navigationTargetPhrase ?? utterance)
    : undefined;
  const historyCommand = readHistoryCommand(utterance);
  const actions: BrowserAction[] = [];
  let actionType: BrowserActionIntent["actionType"] = "unknown";
  let targetRole: string | undefined;
  let value: string | undefined = typedText;
  let reason = "Resolved Browser Action intent from deterministic command rules.";

  if (isBookmarkNavigationRequest(utterance)) {
    return createIntent({
      utterance,
      actionType: "unknown",
      actions: [],
      targetPhrase: navigationTargetPhrase,
      confidence: 0.7,
      reason: "Bookmark navigation is routed through Browser Chrome bookmark handling instead of generic Browser Action search fallback."
    });
  }

  const compoundKnownDestination = resolveKnownDestinationCompoundIntent(utterance);
  if (compoundKnownDestination) {
    return compoundKnownDestination;
  }

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
    if (navigationTargetPhrase && isExplicitSearchNavigationRequest(utterance)) {
      const searchUrl = buildSearchNavigationUrl(navigationTargetPhrase);
      value = searchUrl;
      actions.push({ type: "navigate", url: searchUrl });
      reason = "Resolved URL-less navigation request as a search navigation instead of clicking an unrelated current-page link.";
    } else {
      reason = "URL-less navigation did not resolve to a known destination and was not downgraded to search.";
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

function isExplicitSearchNavigationRequest(text: string): boolean {
  return /검색|search/i.test(text) && /열어|이동|접속|navigate|open|go\s*to/i.test(text);
}

function buildSearchNavigationUrl(value: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(value.trim())}`;
}

function resolveKnownDestinationCompoundIntent(text: string): BrowserActionIntent | undefined {
  const split = splitKnownDestinationCompoundRequest(text);
  if (!split) {
    return undefined;
  }
  const url = extractUrl(split.destinationPhrase) ?? resolveKnownBrowserDestinationUrl(split.destinationPhrase);
  if (!url) {
    return undefined;
  }
  if (!isExecutableBrowserCommand(split.actionText)) {
    return undefined;
  }
  const followup = resolveBrowserActionIntent(split.actionText);
  const followupActions = followup.actions.filter((action) => !isBrowserNavigationControlAction(action));
  if (followupActions.length === 0) {
    return undefined;
  }
  return createIntent({
    utterance: text.trim(),
    actionType: "navigate",
    actions: [{ type: "navigate", url }, ...followupActions],
    targetPhrase: followup.targetPhrase,
    targetRole: followup.targetRole,
    value: url,
    confidence: Math.max(0.82, Math.min(0.92, followup.confidence)),
    reason: "Resolved compound Browser Action intent into known-destination navigation followed by an in-page action."
  });
}

function splitKnownDestinationCompoundRequest(text: string): { destinationPhrase: string; actionText: string } | undefined {
  const patterns = [
    /^\s*(.{1,100}?)(?:\s*(?:에|로|으로))?\s*(?:들어가서|들어간\s*(?:뒤|후|다음)|열고|연\s*(?:뒤|후|다음)|이동해서|이동하고|접속해서|접속하고|가서|간\s*(?:뒤|후|다음))\s+(.{1,180})$/i,
    /^\s*(?:go\s*to|open|navigate\s*to)\s+(.{1,100}?)(?:\s*(?:,|and|then)\s+)(.{1,180})$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const destinationPhrase = (match?.[1] ?? "").trim();
    const actionText = normalizeCompoundFollowupActionText(match?.[2] ?? "");
    if (destinationPhrase && actionText) {
      return { destinationPhrase, actionText };
    }
  }
  return undefined;
}

function normalizeCompoundFollowupActionText(text: string): string {
  return text
    .replace(/^(?:그리고|그다음|다음|then|and)\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBrowserNavigationControlAction(action: BrowserAction): boolean {
  return action.type === "navigate" || action.type === "back" || action.type === "forward" || action.type === "reload";
}

function createIntent(input: Omit<BrowserActionIntent, "id" | "alternatives"> & { alternatives?: string[] }): BrowserActionIntent {
  return {
    id: `browser-intent-${randomUUID()}`,
    ...input,
    alternatives: input.alternatives ?? []
  };
}
