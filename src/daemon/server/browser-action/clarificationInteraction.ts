import {
  summarizeBrowserElement,
  type BrowserElement
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
    pending.candidates.map((candidate, index) => formatSemanticTargetClarificationCandidate(candidate, index + 1, "ko")).join("\n\n")
  ].filter(Boolean).join("\n");
  return {
    id: pending.id,
    requestId: pending.requestId,
    kind: "input",
    title: "Browser target clarification",
    body,
    action: `Browser action: ${pending.action.type}`,
    choices: pending.candidates.map((candidate, index) => buildSemanticTargetChoice(candidate, index + 1)),
    fields: [{
      id: "choice",
      label: "Target",
      placeholder: "1"
    }]
  };
}

export function renderSemanticTargetClarificationResponse(pending: PendingSemanticClarification, promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  const candidates = pending.candidates
    .map((candidate, index) => formatSemanticTargetClarificationCandidate(candidate, index + 1, korean ? "ko" : "en"))
    .join("\n\n");
  return korean
    ? `Browser Action 대상이 애매해서 바로 실행하지 않았습니다.\n\n${candidates}\n\n번호, "첫번째/두번째" 같은 순서, 표시된 이름, 영역/위치 표현 중 하나를 입력하면 이어서 실행합니다.`
    : `Browser Action needs a target clarification before it acts.\n\n${candidates}\n\nChoose a number, ordinal, visible label, region, or position to continue.`;
}

export function formatSemanticTargetClarificationCandidate(
  element: BrowserElement,
  index?: number,
  locale: "ko" | "en" = "ko"
): string {
  const label = readCandidateLabel(element);
  const role = describeRole(element, locale);
  const prefix = index === undefined ? "" : `${index}. `;
  const parts = [
    summarizeRegion(element, locale),
    summarizePosition(element, locale),
    summarizeHref(element, locale),
    summarizeNearbyText(element, label, locale),
    summarizeConfidence(element, locale)
  ].filter(Boolean);
  const fallback = summarizeBrowserElement(element);
  const title = label
    ? `${role}: "${label}"`
    : fallback;
  const alias = index === undefined ? undefined : summarizeSelectionAlias(index, locale);
  const headline = `${prefix}${title}`;
  const details = parts.length ? `\n   ${parts.join(locale === "ko" ? "\n   " : "\n   ")}` : "";
  return `${headline}${alias ? `\n   ${alias}` : ""}${details}`;
}

function buildSemanticTargetChoice(element: BrowserElement, index: number): NonNullable<RuntimeInteraction["choices"]>[number] {
  const label = readCandidateLabel(element);
  const role = describeRole(element, "ko");
  const summary = label ? `${role}: ${label}` : summarizeBrowserElement(element);
  const details = [
    summarizeRegion(element, "ko"),
    summarizePosition(element, "ko"),
    summarizeHref(element, "ko"),
    summarizeNearbyText(element, label, "ko"),
    summarizeConfidence(element, "ko")
  ].filter(Boolean);
  return {
    id: `candidate-${index}`,
    label: `${index}. ${summary}`,
    value: String(index),
    description: details.slice(0, 2).join(" · ") || undefined,
    detail: details.slice(2).join(" · ") || undefined
  };
}

function describeRole(element: BrowserElement, locale: "ko" | "en"): string {
  const role = (element.role || element.tagName || "element").toLowerCase();
  if (locale !== "ko") {
    return role;
  }
  if (role === "link" || element.href) return "링크";
  if (role === "button") return "버튼";
  if (role === "searchbox") return "검색창";
  if (role === "textbox") return "입력칸";
  if (role === "checkbox") return "체크박스";
  if (role === "combobox" || role === "select") return "선택상자";
  if (role === "tab") return "탭";
  return role;
}

function summarizeSelectionAlias(index: number, locale: "ko" | "en"): string {
  if (locale !== "ko") {
    return `choice: ${index}`;
  }
  const ordinal = ["첫번째", "두번째", "세번째", "네번째", "다섯번째"][index - 1];
  return `선택어: ${index} 또는 ${ordinal ?? `${index}번째`}`;
}

function readCandidateLabel(element: BrowserElement): string {
  const label = normalizeWhitespace(element.label || element.ariaLabel || element.text || element.placeholder || element.title || "");
  if (label && label !== "..." && !/^el-[a-f0-9-]+$/i.test(label)) {
    return truncate(label, 90);
  }
  if (element.href) {
    return truncate(summarizeUrl(element.href), 90);
  }
  return "";
}

function summarizeRegion(element: BrowserElement, locale: "ko" | "en"): string | undefined {
  const raw = normalizeWhitespace(element.nearestLandmark || element.listOwner || element.formOwner || "");
  if (!raw) {
    return undefined;
  }
  const value = locale === "ko" ? localizeRegion(raw) : raw;
  return locale === "ko" ? `영역: ${value}` : `region: ${value}`;
}

function summarizePosition(element: BrowserElement, locale: "ko" | "en"): string | undefined {
  const bbox = element.bbox;
  if (!bbox) {
    return undefined;
  }
  const vertical = bbox.y < 160
    ? locale === "ko" ? "상단" : "top"
    : bbox.y < 560
    ? locale === "ko" ? "중단" : "middle"
    : locale === "ko" ? "하단" : "bottom";
  const horizontal = bbox.x < 260
    ? locale === "ko" ? "좌측" : "left"
    : bbox.x < 760
    ? locale === "ko" ? "중앙" : "center"
    : locale === "ko" ? "우측" : "right";
  return locale === "ko" ? `위치: ${vertical} ${horizontal}` : `position: ${vertical} ${horizontal}`;
}

function summarizeHref(element: BrowserElement, locale: "ko" | "en"): string | undefined {
  if (!element.href) {
    return undefined;
  }
  const label = summarizeUrl(element.href);
  return locale === "ko" ? `링크: ${label}` : `link: ${label}`;
}

function summarizeNearbyText(element: BrowserElement, label: string, locale: "ko" | "en"): string | undefined {
  const context = normalizeWhitespace(element.contextText || "");
  if (!context || context === label || context.includes(label) && context.length <= label.length + 12) {
    return undefined;
  }
  return locale === "ko" ? `근처: ${truncate(context, 90)}` : `near: ${truncate(context, 90)}`;
}

function summarizeConfidence(element: BrowserElement, locale: "ko" | "en"): string | undefined {
  if (!Number.isFinite(element.confidence)) {
    return undefined;
  }
  const percent = Math.max(0, Math.min(100, Math.round(element.confidence * 100)));
  return locale === "ko" ? `요소 신뢰도: ${percent}%` : `element confidence: ${percent}%`;
}

function summarizeUrl(value: string): string {
  try {
    const url = new URL(value);
    const query = url.search ? url.search.slice(0, 48) : "";
    return truncate(`${url.hostname}${url.pathname}${query}`, 92);
  } catch {
    return truncate(value, 92);
  }
}

function localizeRegion(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("nav")) return `${value}/메뉴`;
  if (lower.includes("header")) return `${value}/상단`;
  if (lower.includes("main")) return `${value}/본문`;
  if (lower.includes("sidebar")) return `${value}/사이드`;
  if (lower.includes("toolbar")) return `${value}/도구막대`;
  if (lower.includes("form")) return `${value}/입력폼`;
  if (lower.includes("footer")) return `${value}/하단`;
  return value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
