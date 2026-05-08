import { randomUUID } from "node:crypto";
import { normalizeBrowserTargetText, stripBrowserActionSuffix } from "./targetLexicon.js";
import type { BrowserAction, BrowserActionIntent } from "./types.js";

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

  if (/뒤로|go\s*back|\bback\b/i.test(utterance)) {
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
  } else if (/클릭|눌러|click|press|펼쳐|expand/i.test(utterance)) {
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
    confidence: actions.length > 0 ? readIntentConfidence({ utterance, targetPhrase, typedText, actionType }) : 0.35,
    reason
  });
}

export function isInformationalBrowserActionQuestion(text: string): boolean {
  return (
    /(what\s+can|what\s+is|explain|help|capabilit|기능|무엇|뭐|뭔|어떤|설명).*(browser\s*action|브라우저\s*액션)/i.test(text) ||
    /(browser\s*action|브라우저\s*액션).*(what\s+can|what\s+is|explain|help|capabilit|기능|무엇|뭐|뭔|어떤|설명)/i.test(text)
  );
}

export function extractTargetPhrase(text: string): string | undefined {
  const quoted = text.match(/[“"']([^“"']{1,120})[”"']/)?.[1];
  const textWithoutQuote = quoted ? text.replace(quoted, " ") : text;
  if (quoted && !/(http|검색|search|입력|type)/i.test(quoted) && !/(검색|search|입력|type|fill|입력창|검색창)/i.test(textWithoutQuote)) {
    return normalizeTargetPhrase(quoted);
  }
  const patterns = [
    /^(.{1,80}?)(?:을|를)?\s*(?:눌러서|클릭해서|누르고|클릭하고|press(?:ing)?\s+(?:and|then)|click(?:ing)?\s+(?:and|then))/i,
    /(?:에서|on)\s+(.{1,80}?)(?:을|를)?\s*(?:눌러|클릭|click|press|펼쳐|expand)/i,
    /(.{1,80}?)(?:\s*링크|\s*버튼|\s*button|\s*link)(?:을|를)?\s*(?:눌러|클릭|click|press)?/i,
    /^(.{1,80}?)(?:을|를)?\s*(?:눌러(?:줘|주세요|봐|봐줘)?|클릭(?:해|해줘|해주세요)?|click|press|펼쳐(?:줘|주세요)?|expand)(?:\s*(?:줘|주세요|해줘|해주세요|please))?\.?$/i,
    /(?:검색창|search box|input|입력칸)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const value = normalizeTargetPhrase((match[1] ?? match[0])
      .replace(/현재 페이지|이 페이지|현재 화면|이 화면|페이지|화면|에서|링크|버튼|검색창|입력칸/gi, " "));
    if (value) {
      return value.slice(0, 120);
    }
  }
  return undefined;
}

function createIntent(input: Omit<BrowserActionIntent, "id" | "alternatives"> & { alternatives?: string[] }): BrowserActionIntent {
  return {
    id: `browser-intent-${randomUUID()}`,
    ...input,
    alternatives: input.alternatives ?? []
  };
}

function normalizeTargetPhrase(value: string): string {
  return normalizeBrowserTargetText(value).replace(/\s+/g, " ").trim();
}

function extractQuotedText(text: string): string | undefined {
  return text.match(/[“"']([^“"']{1,500})[”"']/)?.[1]?.trim();
}

function extractTextAfterKeyword(text: string, keywords: string[]): string | undefined {
  for (const keyword of keywords) {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index < 0) {
      continue;
    }
    const value = text.slice(index + keyword.length).replace(/(?:하고|그리고|then|and).*/i, "").trim();
    if (value) {
      return value.slice(0, 500);
    }
  }
  return undefined;
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match?.[0];
}

function readScrollAmount(text: string): "small" | "medium" | "large" {
  if (/조금|small/i.test(text)) {
    return "small";
  }
  if (/많이|끝까지|large|bottom/i.test(text)) {
    return "large";
  }
  return "medium";
}

function readIntentConfidence(input: {
  utterance: string;
  targetPhrase?: string;
  typedText?: string;
  actionType: BrowserActionIntent["actionType"];
}): number {
  if (input.actionType === "read" || input.actionType === "back" || input.actionType === "forward" || input.actionType === "reload") {
    return 0.86;
  }
  if (input.actionType === "navigate") {
    return 0.88;
  }
  if ((input.actionType === "type" || input.actionType === "select") && input.typedText && input.targetPhrase) {
    return 0.84;
  }
  if (input.actionType === "click" && input.targetPhrase) {
    return 0.84;
  }
  return 0.72;
}
