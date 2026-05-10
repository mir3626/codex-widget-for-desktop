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
  if (mode === "browser" && /(현재\s*페이지|보고\s*있는|페이지|화면|사이트|문서|설명|요약|읽어|봐줘|보여|글|게시글|포스트|게시물|링크|버튼|검색창|입력칸|클릭|눌러|누르|스크롤|뒤로|앞으로|새로고침|이동|열어|펼쳐|체크|선택|describe|summarize|search|click|type|scroll|navigate|reload|back|forward|show|open|post|article)/i.test(normalized)) {
    return true;
  }
  return /(현재\s*페이지|active\s*tab).*(눌러|누르|클릭|입력|검색|스크롤|열어|이동|펼쳐|click|type|search|scroll|navigate)/i.test(text);
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
