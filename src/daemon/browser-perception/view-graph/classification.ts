import type {
  BrowserElement,
  BrowserViewActionHint,
  BrowserViewNodeKind,
  BrowserViewRegionRole,
  BrowserViewRiskHint
} from "../../browser-action/types.js";
import type { BrowserViewElementClassification } from "./types.js";
import { compactViewText } from "./digest.js";

export function classifyBrowserViewElement(element: BrowserElement): BrowserViewElementClassification {
  const text = compactViewText([element.role, element.tagName, element.label, element.text, element.ariaLabel, element.title, element.contextText, element.href].filter(Boolean).join(" "));
  const regionRole = inferRegionRole(element, text);
  const actionHint = inferActionHint(element, text);
  const riskHints = inferRiskHints(element, actionHint, text);
  const nodeKind = inferNodeKind(element, actionHint, riskHints, text);
  const evidence = [
    element.role ? `role:${element.role}` : "",
    element.tagName ? `tag:${element.tagName}` : "",
    element.nearestLandmark ? `landmark:${element.nearestLandmark}` : "",
    element.nearestHeading ? `heading:${element.nearestHeading}` : "",
    element.href ? "has_href" : "",
    element.editable ? "editable" : "",
    element.riskHints.length ? `risk:${element.riskHints.join(",")}` : ""
  ].filter(Boolean);
  return {
    nodeKind,
    regionRole,
    actionHint,
    riskHints,
    confidence: readClassificationConfidence(element, actionHint, nodeKind),
    evidence
  };
}

export function isLikelyUtilityElement(element: BrowserElement): boolean {
  const label = compactViewText(element.label || element.text || element.ariaLabel || element.title || "").toLowerCase();
  const href = compactViewText(element.href).toLowerCase();
  if (!label) {
    return true;
  }
  if (isLikelyCollectionNavigationHref(href)) {
    return true;
  }
  if (/^(이전|다음|목록|전체글|글쓰기|검색|삭제|수정|댓글|추천|공지|더보기|로그인|회원가입|로그아웃|best|hot|new|menu|next|previous|more|login|logout|write|edit|delete|reply|comment)$/.test(label)) {
    return true;
  }
  if (/(profile|member|login|logout|signup|setting|notification|message|point|comment|reply|delete|edit|write|admin|프로필|로그인|회원가입|설정|알림|댓글|수정|삭제|글쓰기|쪽지|포인트)/.test(label + " " + href)) {
    return true;
  }
  return /^javascript:|^mailto:|^tel:/i.test(href);
}

function isLikelyCollectionNavigationHref(href: string): boolean {
  if (!href) {
    return false;
  }
  try {
    const url = new URL(href);
    const path = url.pathname.toLowerCase();
    if (/\/(?:lists?|categories?|category|tags?|search)(?:\/|$)/i.test(path)) {
      return !/[?&](?:no|post|article|item|document_srl)=\d+/i.test(url.search);
    }
    return false;
  } catch {
    return /\/(?:lists?|categories?|category|tags?|search)(?:\/|$)/i.test(href) &&
      !/[?&](?:no|post|article|item|document_srl)=\d+/i.test(href);
  }
}

export function isLikelyContentElement(element: BrowserElement): boolean {
  if (!element.visible || element.editable || element.riskHints.length > 0) {
    return false;
  }
  const label = compactViewText(element.label || element.text || element.ariaLabel || element.title || "");
  if (label.length < 4 || isLikelyUtilityElement(element)) {
    return false;
  }
  const href = element.href ?? "";
  if (element.role === "link" && href) {
    return true;
  }
  return /(article|post|item|row|card|story|content|게시글|게시물|글|본문)/i.test(`${element.role} ${element.tagName} ${element.selector ?? ""} ${element.nearestHeading ?? ""}`);
}

function inferNodeKind(element: BrowserElement, actionHint: BrowserViewActionHint, riskHints: BrowserViewRiskHint[], text: string): BrowserViewNodeKind {
  if (element.editable || ["textbox", "searchbox", "combobox", "checkbox", "radio", "option"].includes(element.role ?? "")) {
    return "field";
  }
  if (/(img|image|video|canvas|media)/i.test(text)) {
    return "media";
  }
  if (element.tagName === "tr" || element.role === "row") {
    return isLikelyContentElement(element) ? "content_item" : "row";
  }
  if (isLikelyContentElement(element)) {
    return "content_item";
  }
  if (["button", "tab", "menuitem", "switch"].includes(element.role ?? "") || ["button", "summary"].includes(element.tagName) || actionHint !== "read") {
    return "control";
  }
  return riskHints.includes("safe_read") ? "text_block" : "content_item";
}

function inferRegionRole(element: BrowserElement, text: string): BrowserViewRegionRole {
  const landmark = `${element.nearestLandmark ?? ""}`.toLowerCase();
  const selector = `${element.selector ?? ""}`.toLowerCase();
  const haystack = `${landmark} ${selector} ${text}`;
  if (/dialog|modal|popup/.test(haystack) || element.isLikelyOverlay) return "modal";
  if (/header|banner|gnb|\btop\b/.test(haystack) || (element.bbox?.y ?? 9999) < 96) return "header";
  if (/nav|navigation|menu/.test(haystack)) return "nav";
  if (/(^|[\s._#-])(?:sidebar|aside|side)(?:$|[\s._#-])/.test(haystack) || (element.bbox?.x ?? 9999) < 180) return "sidebar";
  if (/toolbar|filter|tablist/.test(haystack)) return "toolbar";
  if (/form|search|input|textarea|select/.test(haystack) || element.formOwner) return "form";
  if (/article|main|content|post|board|list|table|row/.test(haystack) || element.listOwner) return "list";
  return "main";
}

function inferActionHint(element: BrowserElement, text: string): BrowserViewActionHint {
  if (element.editable) return element.role === "combobox" || element.tagName === "select" ? "select" : "type";
  if (element.role === "checkbox" || element.role === "radio" || element.role === "switch") return "check";
  if (/delete|remove|삭제|제거|지우/.test(text)) return "delete";
  if (/submit|send|publish|save|제출|보내|저장|게시(?:하기|하다|버튼|글쓰기)?$/.test(text) || element.inputType === "submit") return "submit";
  if (element.role === "tab" || /filter|category|카테고리|필터|개념|추천|best|popular|인기/.test(text)) return "filter";
  if (/expand|open|펼치|더보기/.test(text)) return "expand";
  if (element.href) return "navigate";
  if (["button", "menuitem"].includes(element.role ?? "") || ["button", "summary"].includes(element.tagName)) return "filter";
  return "read";
}

function inferRiskHints(element: BrowserElement, actionHint: BrowserViewActionHint, text: string): BrowserViewRiskHint[] {
  const hints = new Set<BrowserViewRiskHint>();
  if (actionHint === "read") hints.add("safe_read");
  if (actionHint === "filter" || actionHint === "check" || actionHint === "select" || actionHint === "expand") hints.add("same_page_update");
  if (actionHint === "navigate") hints.add("navigation");
  if (actionHint === "submit") hints.add("submit");
  if (actionHint === "delete") hints.add("destructive");
  if (element.riskHints.includes("password") || /password|token|secret|cookie|credential|비밀번호|토큰/.test(text)) hints.add("credential");
  if (element.riskHints.includes("payment") || /payment|card|checkout|결제|카드/.test(text)) hints.add("payment");
  if (element.riskHints.includes("download")) hints.add("download");
  if (element.riskHints.includes("file_upload")) hints.add("file_upload");
  if (element.riskHints.includes("external_navigation")) hints.add("cross_origin");
  if (hints.size === 0) hints.add("unknown");
  return [...hints];
}

function readClassificationConfidence(element: BrowserElement, actionHint: BrowserViewActionHint, nodeKind: BrowserViewNodeKind): number {
  let confidence = element.confidence || 0.65;
  if (element.domPathHash) confidence += 0.05;
  if (element.nearestLandmark || element.nearestHeading) confidence += 0.04;
  if (actionHint !== "unknown") confidence += 0.03;
  if (nodeKind === "content_item" && isLikelyContentElement(element)) confidence += 0.06;
  return Math.max(0.2, Math.min(0.98, confidence));
}
