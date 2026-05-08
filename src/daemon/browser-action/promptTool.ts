import { randomUUID } from "node:crypto";
import type { WidgetMode } from "../../shared/protocol.js";
import type { BrowserAction, BrowserActionMode, BrowserActionPromptPlan, BrowserActionSource } from "./types.js";
import { resolveBrowserActionIntent } from "./intentResolver.js";

export function planBrowserActionFromPrompt(input: {
  text: string;
  mode: WidgetMode;
  defaultAdapterId?: string;
  source?: Partial<BrowserActionSource>;
}): BrowserActionPromptPlan | null {
  const text = input.text.trim();
  if (!text || !isBrowserActionPrompt(text, input.mode)) {
    return null;
  }
  const mode = readRequestedMode(text);
  const adapterId = readRequestedAdapter(text) ?? input.defaultAdapterId;
  const intent = resolveBrowserActionIntent(text);
  const actions = intent.actions;
  if (actions.length === 0) {
    return null;
  }
  return {
    id: `browser-plan-${randomUUID()}`,
    goal: text.slice(0, 500),
    mode,
    adapterId,
    source: input.source,
    confidence: intent.confidence,
    simulatedTool: true,
    reason: intent.reason,
    steps: actions.map((action, index) => ({
      id: `step-${index + 1}`,
      action,
      reason: describePromptAction(action),
      targetSummary: summarizeTarget(action),
      expected: expectedStateForAction(action)
    }))
  };
}

export function isBrowserActionPrompt(text: string, mode: WidgetMode): boolean {
  const normalized = text.toLowerCase();
  if (/\bbrowser\s*action\b|\bba:|\[browser-action\]|브라우저\s*액션/i.test(text)) {
    return true;
  }
  if (mode === "browser" && /(현재\s*페이지|보고\s*있는|페이지|화면|사이트|문서|설명|요약|읽어|봐줘|링크|버튼|검색창|입력칸|클릭|눌러|스크롤|뒤로|앞으로|새로고침|이동|열어|펼쳐|체크|선택|describe|summarize|search|click|type|scroll|navigate|reload|back|forward)/i.test(normalized)) {
    return true;
  }
  return /(현재\s*페이지|active\s*tab).*(눌러|클릭|입력|검색|스크롤|열어|이동|펼쳐|click|type|search|scroll|navigate)/i.test(text);
}

function inferPromptActions(text: string): BrowserAction[] {
  const actions: BrowserAction[] = [];
  const normalized = text.trim();
  if (isInformationalBrowserActionQuestion(normalized)) {
    return actions;
  }
  const targetPhrase = extractTargetPhrase(normalized);
  const typedText = extractQuotedText(normalized) ?? extractTextAfterKeyword(normalized, ["입력", "type", "검색어", "search for"]);

  if (/뒤로|go\s*back|\bback\b/i.test(normalized)) {
    actions.push({ type: "back" });
  } else if (/앞으로|\bforward\b/i.test(normalized)) {
    actions.push({ type: "forward" });
  } else if (/새로고침|reload|refresh/i.test(normalized)) {
    actions.push({ type: "reload" });
  } else if (/스크롤|scroll/i.test(normalized)) {
    actions.push({ type: "scroll", direction: /위로|up/i.test(normalized) ? "up" : "down", amount: readScrollAmount(normalized) });
  } else if (/열어|이동|navigate|open/i.test(normalized) && extractUrl(normalized)) {
    actions.push({ type: "navigate", url: extractUrl(normalized) ?? "" });
  } else if (/검색|search/i.test(normalized) && typedText) {
    actions.push({
      type: "type",
      target: { kind: "text", role: "searchbox", text: targetPhrase || "search" },
      text: typedText,
      clearFirst: true,
      submit: false
    });
    if (!/제출하지|submit 하지|no submit|pre-submit|직전/i.test(normalized)) {
      actions.push({ type: "click", target: { kind: "text", role: "button", text: targetPhrase || "search" } });
    }
  } else if (/입력|type|fill|바꿔|수정/i.test(normalized) && typedText) {
    actions.push({
      type: "type",
      target: { kind: "text", text: targetPhrase || "input" },
      text: typedText,
      clearFirst: /바꿔|수정|clear|replace/i.test(normalized),
      submit: /제출|submit/i.test(normalized) && !/제출하지|submit 하지|no submit|직전/i.test(normalized)
    });
  } else if (/체크|check/i.test(normalized)) {
    actions.push({ type: "check", target: { kind: "text", text: targetPhrase || "checkbox" }, checked: !/해제|uncheck/i.test(normalized) });
  } else if (/선택|select/i.test(normalized)) {
    const value = typedText ?? targetPhrase ?? "";
    actions.push({ type: "select", target: { kind: "text", text: targetPhrase || value || "select" }, value });
  } else if (/클릭|눌러|click|press|펼쳐|expand/i.test(normalized)) {
    actions.push({ type: "click", target: { kind: "text", text: targetPhrase || normalized.slice(0, 80) } });
  } else if (/읽어|요약|설명|describe|summarize|read|observe|봐줘/i.test(normalized)) {
    actions.push({ type: "read", reason: normalized.slice(0, 240) });
  }

  if (actions.length === 0 && /페이지|browser|브라우저|DOM/i.test(normalized)) {
    actions.push({ type: "read", reason: normalized.slice(0, 240) });
  }
  return actions;
}

function isInformationalBrowserActionQuestion(text: string): boolean {
  return (
    /(what\s+can|what\s+is|explain|help|capabilit|기능|무엇|뭐|뭔|어떤|설명).*(browser\s*action|브라우저\s*액션)/i.test(text) ||
    /(browser\s*action|브라우저\s*액션).*(what\s+can|what\s+is|explain|help|capabilit|기능|무엇|뭐|뭔|어떤|설명)/i.test(text)
  );
}

function extractTargetPhrase(text: string): string | undefined {
  const quoted = text.match(/[“"']([^“"']{1,120})[”"']/)?.[1];
  if (quoted && !/(http|검색|search|입력|type)/i.test(quoted)) {
    return quoted.trim();
  }
  const patterns = [
    /(?:에서|on)\s+(.{1,80}?)(?:을|를)?\s*(?:눌러|클릭|click|press|펼쳐|expand)/i,
    /(.{1,80}?)(?:\s*링크|\s*버튼|\s*button|\s*link)(?:을|를)?\s*(?:눌러|클릭|click|press)?/i,
    /(?:검색창|search box|input|입력칸)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const value = (match[1] ?? match[0]).replace(/현재 페이지|이 페이지|에서|링크|버튼|검색창|입력칸/gi, " ").replace(/\s+/g, " ").trim();
    if (value) {
      return value.slice(0, 120);
    }
  }
  return undefined;
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

function readRequestedAdapter(text: string): string | undefined {
  if (/playwright|managed|controlled/i.test(text)) {
    return "playwright";
  }
  if (/\bcdp\b|debug/i.test(text)) {
    return "cdp";
  }
  if (/extension|active\s*tab|확장/i.test(text)) {
    return "extension";
  }
  if (/native|uia|windows/i.test(text)) {
    return "native-desktop";
  }
  return undefined;
}

function readRequestedMode(text: string): BrowserActionMode {
  if (/full_control_dev|evaluate|자바스크립트|javascript/i.test(text)) {
    return "full_control_dev";
  }
  if (/항상\s*물어|ask/i.test(text)) {
    return "ask_before_action";
  }
  if (/읽기만|read.?only/i.test(text)) {
    return "read_only";
  }
  return "auto_safe_actions";
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

function describePromptAction(action: BrowserAction): string {
  if (action.type === "type") {
    return "Type user-provided text into the resolved browser field without reading hidden values.";
  }
  if (action.type === "click") {
    return "Click the resolved browser target after safety policy evaluation.";
  }
  if (action.type === "read") {
    return "Read the current browser observation.";
  }
  return `Execute typed Browser Action ${action.type}.`;
}

function summarizeTarget(action: BrowserAction): string | undefined {
  if (!("target" in action)) {
    return undefined;
  }
  const target = action.target;
  if (!target) {
    return undefined;
  }
  if (target.kind === "text") {
    return target.role ? `${target.role}: ${target.text}` : target.text;
  }
  if (target.kind === "element_id") {
    return target.id;
  }
  if (target.kind === "selector") {
    return target.selector;
  }
  return target.kind;
}

function expectedStateForAction(action: BrowserAction) {
  if (action.type === "navigate") {
    return [{ type: "url_contains" as const, value: action.url }];
  }
  if (action.type === "type") {
    return [{ type: "element_state" as const, target: action.target, state: { value: action.text } }];
  }
  if (action.type === "click") {
    return [{ type: "custom" as const, description: "Page state changes or target activation is visible after click." }];
  }
  return undefined;
}
