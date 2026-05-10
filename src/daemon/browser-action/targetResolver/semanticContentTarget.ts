import { summarizeBrowserElement } from "../browserObservation.js";
import { compactText } from "../targetLexicon.js";
import type {
  BrowserElement,
  BrowserObservation,
  TargetResolution
} from "../types.js";

export function isSemanticContentTargetHint(hint: string): boolean {
  return /(재밌|재미|흥미|아무\s*글|대표\s*글|게시글|게시물|포스트|글\s*아무|interesting|fun|any\s+(?:post|article|item)|representative\s+(?:post|article|item)|content\s+item)/i.test(hint);
}

export function resolveSemanticContentTarget(
  elements: BrowserElement[],
  observation: BrowserObservation | undefined
): TargetResolution {
  const graphResolution = resolveSemanticContentTargetFromViewGraph(elements, observation);
  if (graphResolution.primary) {
    return graphResolution;
  }
  const ranked = elements
    .map((element) => ({ element, score: scoreSemanticContentElement(element, observation) }))
    .filter((item) => item.score >= 0.45)
    .sort((left, right) => right.score - left.score || sortSemanticContentElement(left.element, right.element, observation));
  const primary = ranked[0]?.element;
  return {
    primary,
    alternatives: ranked.slice(1, 5).map((item) => item.element),
    confidence: ranked[0]?.score ?? 0,
    reason: primary
      ? `Selected representative content item ${summarizeBrowserElement(primary)} from the current view.`
      : "No representative content item was visible enough to select."
  };
}

function resolveSemanticContentTargetFromViewGraph(
  elements: BrowserElement[],
  observation: BrowserObservation | undefined
): TargetResolution {
  const graph = observation?.viewGraph;
  const representatives = graph?.contentLists
    ?.flatMap((list) => list.representativeNodeIds.map((nodeId) => ({ nodeId, listConfidence: list.confidence }))) ?? [];
  const ranked = representatives
    .map(({ nodeId, listConfidence }) => {
      const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
      const element = node?.elementId ? elements.find((candidate) => candidate.id === node.elementId) : undefined;
      return {
        element,
        score: element ? Math.min(0.97, Math.max(listConfidence, (node?.confidence ?? 0.5) + 0.04)) : 0
      };
    })
    .filter((item): item is { element: BrowserElement; score: number } => Boolean(item.element) && item.score >= 0.55)
    .sort((left, right) => right.score - left.score || sortSemanticContentElement(left.element, right.element, observation));
  return {
    primary: ranked[0]?.element,
    alternatives: ranked.slice(1, 5).map((item) => item.element),
    confidence: ranked[0]?.score ?? 0,
    reason: ranked[0]?.element
      ? `Selected representative content item ${summarizeBrowserElement(ranked[0].element)} from Browser View Graph v2 content-list evidence.`
      : "No representative content item was visible enough in Browser View Graph v2."
  };
}

function scoreSemanticContentElement(element: BrowserElement, observation: BrowserObservation | undefined): number {
  if (!element.visible || element.enabled === false || element.editable) return 0;
  const label = compactText(element.label || element.text || element.ariaLabel || element.title || "");
  const href = element.href ?? "";
  const contentHref = isLikelyContentHref(href, observation?.url);
  if (!label || label.length < 4) return 0;
  if (isNavigationOrUtilityLabel(label, href, observation?.url, contentHref)) return 0;
  let score = 0;
  if (element.role === "link") score += 0.34;
  if (href) score += 0.18;
  if (contentHref) score += 0.22;
  if (label.length >= 8 && label.length <= 120) score += 0.12;
  if (/(재밌|재미|흥미|웃긴|싱글벙글|interesting|fun|best|popular|추천|개념|hot)/i.test(label)) score += 0.08;
  score += sameViewScore(href, observation?.url);
  score += viewportContentScore(element, observation);
  if (element.riskHints.length > 0) score -= 0.25;
  return Math.max(0, Math.min(0.96, score));
}

function isNavigationOrUtilityLabel(label: string, href: string, currentUrl: string | undefined, contentHref: boolean): boolean {
  if (isSameDocumentOrUtilityHref(href, currentUrl)) return true;
  if (/^\[[0-9]+\]$|^[0-9]+개?$|^(이전|다음|목록|전체글|개념글|글쓰기|검색|삭제|수정|댓글|추천|공지|더보기|로그인|회원가입|로그아웃|본문영역 바로가기|best|hot|new)$/i.test(label)) {
    return true;
  }
  if (/(바로가기|갤로그로 이동|관리 내역|페이지 하단|디시콘|설정|포인트|잉여력|내\s*(?:정보|글|댓글)|쪽지함|menu|login|logout|sign in|write|delete|edit|reply|comment|next|previous|more|point|profile|message|notification|setting)/i.test(label)) {
    return true;
  }
  if (!contentHref && label.length <= 8 && isLikelySectionNavigationHref(href)) {
    return true;
  }
  return /^javascript:/i.test(href);
}

function isSameDocumentOrUtilityHref(href: string, currentUrl: string | undefined): boolean {
  if (!href) return false;
  try {
    const target = new URL(href, currentUrl);
    if (/^(javascript|mailto|tel):/i.test(target.protocol)) return true;
    if (target.searchParams.has("act") && !/dispBoardContent|view|read/i.test(target.searchParams.get("act") ?? "")) {
      return true;
    }
    if (/comment|reply|댓글/i.test(target.hash) && compactText(target.pathname).length > 0) {
      return true;
    }
    if (!currentUrl) return false;
    const current = new URL(currentUrl);
    const targetComparable = new URL(target.href);
    const currentComparable = new URL(current.href);
    targetComparable.hash = "";
    currentComparable.hash = "";
    return targetComparable.href === currentComparable.href;
  } catch {
    return /^javascript:/i.test(href);
  }
}

function isLikelyContentHref(href: string, currentUrl: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, currentUrl);
    if (url.searchParams.has("act") && !/dispBoardContent|view|read/i.test(url.searchParams.get("act") ?? "")) {
      return false;
    }
    const path = url.pathname;
    if (/\/(?:view|post|article|read|story|item)(?:\/|$)/i.test(path)) return true;
    if (/[?&](?:no|post|article|item|document_srl)=\d+/i.test(url.search)) return true;
    const segments = path.split("/").filter(Boolean);
    return segments.some((segment) => /^\d{5,}$/.test(segment));
  } catch {
    return /\/(?:view|post|article|read|story|item)(?:\/|$)|[?&](?:no|post|article|item|document_srl)=\d+/i.test(href);
  }
}

function isLikelySectionNavigationHref(href: string): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length <= 1 && !url.search;
  } catch {
    return /^\/?[\w-]+\/?$/i.test(href);
  }
}

function sameViewScore(href: string, currentUrl: string | undefined): number {
  if (!href || !currentUrl) return 0;
  try {
    const target = new URL(href, currentUrl);
    const current = new URL(currentUrl);
    let score = 0;
    if (target.origin === current.origin) score += 0.08;
    const targetRoot = target.pathname.split("/").filter(Boolean)[0];
    const currentRoot = current.pathname.split("/").filter(Boolean)[0];
    if (targetRoot && targetRoot === currentRoot) score += 0.08;
    const currentSection = current.searchParams.get("id");
    if (currentSection && target.searchParams.get("id") === currentSection) score += 0.14;
    return score;
  } catch {
    return 0;
  }
}

function viewportContentScore(element: BrowserElement, observation: BrowserObservation | undefined): number {
  const viewport = observation?.viewport;
  const bbox = element.bbox;
  if (!viewport || !bbox) return 0.06;
  const centerX = bbox.x + bbox.w / 2;
  const centerY = bbox.y + bbox.h / 2;
  if (centerY < 0 || centerY > viewport.height) return -0.28;
  let score = 0.16;
  if (centerX >= viewport.width * 0.18 && centerX <= viewport.width * 0.82) score += 0.08;
  if (centerX > viewport.width * 0.84) score -= 0.08;
  if (centerY >= viewport.height * 0.1 && centerY <= viewport.height * 0.85) score += 0.06;
  return score;
}

function sortSemanticContentElement(left: BrowserElement, right: BrowserElement, observation: BrowserObservation | undefined): number {
  const viewport = observation?.viewport;
  const leftY = readViewportSortY(left, viewport?.height);
  const rightY = readViewportSortY(right, viewport?.height);
  return leftY - rightY || left.id.localeCompare(right.id);
}

function readViewportSortY(element: BrowserElement, viewportHeight: number | undefined): number {
  const y = element.bbox ? element.bbox.y + element.bbox.h / 2 : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(y)) return Number.POSITIVE_INFINITY;
  if (viewportHeight && (y < 0 || y > viewportHeight)) return viewportHeight + Math.abs(y);
  return y;
}
