import { summarizeBrowserElement } from "../browserObservation.js";
import { compactText } from "../targetLexicon.js";
import type {
  BrowserElement,
  BrowserObservation,
  BrowserViewNode,
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
    ?.flatMap((list) => list.representativeNodeIds.map((nodeId) => ({ nodeId, listConfidence: list.confidence, listId: list.id }))) ?? [];
  const ranked = representatives
    .map(({ nodeId, listConfidence, listId }) => {
      const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
      const element = node?.elementId ? elements.find((candidate) => candidate.id === node.elementId) : undefined;
      const elementScore = element ? scoreSemanticContentElement(element, observation) : 0;
      const regionPenalty = isNonContentViewNode(node) ? -0.4 : 0;
      const listBonus = node?.listId === listId ? 0.06 : 0;
      return {
        element,
        score: element && elementScore > 0 ? Math.min(0.97, Math.max(listConfidence * 0.55, (node?.confidence ?? 0.5) * 0.45) + elementScore * 0.45 + listBonus + regionPenalty) : 0
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
  if (isNonRepresentativeContentLabel(`${label} ${element.contextText ?? ""} ${element.nearestHeading ?? ""}`)) return 0;
  if (isPinnedOrAnnouncementElement(element, label)) return 0;
  if (isLikelyStalePinnedContentElement(element, observation)) return 0;
  if (isNavigationOrUtilityLabel(label, href, observation?.url, contentHref)) return 0;
  if (!contentHref && !hasContentStructure(element)) return 0;
  if (isOutsidePrimaryReadingArea(element, observation)) return 0;
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
  if (isGlobalStatisticLabel(label) || isLikelyUtilityHref(href, currentUrl)) return true;
  if (/^\[[0-9]+\]$|^[0-9]+개?$|^(이전|다음|목록|전체글|개념글|글쓰기|검색|삭제|수정|댓글|추천|공지|더보기|로그인|회원가입|로그아웃|본문영역 바로가기|best|hot|new)$/i.test(label)) {
    return true;
  }
  if (isNonRepresentativeContentLabel(label) || /(바로가기|관리 내역|페이지 하단|설정|포인트|내\s*(?:정보|글|댓글)|쪽지함|menu|login|logout|sign in|write|delete|edit|reply|comment|next|previous|more|point|profile|message|notification|setting|lottery|event|stats?)/i.test(label)) {
    return true;
  }
  if (!contentHref && label.length <= 8 && isLikelySectionNavigationHref(href)) {
    return true;
  }
  return /^javascript:/i.test(href);
}

function hasContentStructure(element: BrowserElement): boolean {
  const haystack = `${element.role ?? ""} ${element.tagName ?? ""} ${element.selector ?? ""} ${element.nearestHeading ?? ""} ${element.contextText ?? ""} ${element.listOwner ?? ""}`.toLowerCase();
  return /(article|post|item|row|card|story|content|table|게시글|게시물|본문|제목)/i.test(haystack);
}

function isPinnedOrAnnouncementElement(element: BrowserElement, label: string): boolean {
  const context = `${element.contextText ?? ""} ${element.nearestHeading ?? ""}`.replace(/\s+/g, " ").trim();
  if (!context || context === label) return false;
  return isNonRepresentativeContentLabel(context);
}

export function isNonRepresentativeContentLabel(text: string): boolean {
  return /(^|[\s\[\]()/|:：-])(?:공지|고정|알림|필독|설문|이벤트|광고|운영|관리자|가이드|규칙|문의|안내|정책|notice|announcement|pinned|sticky|survey|poll|event|promo|ad|admin|moderator|guide|rule|policy)(?:$|[\s\[\]()/|:：-])/i.test(text);
}

function isLikelyStalePinnedContentElement(element: BrowserElement, observation: BrowserObservation | undefined): boolean {
  const elementNumber = readContentNumber(element.href ?? "");
  if (!elementNumber || !observation) return false;
  const peers = observation.elements
    .filter((candidate) => candidate.visible && isLikelyContentHref(candidate.href ?? "", observation.url))
    .map((candidate) => ({
      element: candidate,
      number: readContentNumber(candidate.href ?? ""),
      y: candidate.bbox?.y ?? Number.POSITIVE_INFINITY
    }))
    .filter((candidate): candidate is { element: BrowserElement; number: number; y: number } => Boolean(candidate.number) && Number.isFinite(candidate.y));
  if (peers.length < 4) return false;
  const sameSeries = peers.filter((candidate) => isSameContentSeries(candidate.element.href ?? "", element.href ?? "", observation.url));
  if (sameSeries.length < 4) return false;
  const sortedByNumber = [...sameSeries].sort((left, right) => right.number - left.number);
  const medianNumber = sortedByNumber[Math.floor(sortedByNumber.length / 2)]?.number;
  const sortedByViewport = [...sameSeries].sort((left, right) => left.y - right.y);
  const viewportRank = sortedByViewport.findIndex((candidate) => candidate.element.id === element.id);
  if (!medianNumber || viewportRank < 0 || viewportRank > 1) return false;
  return elementNumber < medianNumber * 0.82;
}

function readContentNumber(href: string): number | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    for (const key of ["no", "post", "article", "item", "document_srl"]) {
      const value = Number(url.searchParams.get(key));
      if (Number.isFinite(value) && value > 0) return value;
    }
    const segment = url.pathname.split("/").reverse().find((part) => /^\d{5,}$/.test(part));
    const value = Number(segment);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    const match = href.match(/[?&](?:no|post|article|item|document_srl)=(\d{5,})|\/(\d{5,})(?:\/|$)/i);
    const value = Number(match?.[1] ?? match?.[2]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
}

function isSameContentSeries(leftHref: string, rightHref: string, currentUrl: string | undefined): boolean {
  try {
    const left = new URL(leftHref, currentUrl);
    const right = new URL(rightHref, currentUrl);
    if (left.origin !== right.origin || left.pathname !== right.pathname) return false;
    const leftSection = left.searchParams.get("id") ?? left.searchParams.get("board") ?? left.searchParams.get("category");
    const rightSection = right.searchParams.get("id") ?? right.searchParams.get("board") ?? right.searchParams.get("category");
    return !leftSection || !rightSection || leftSection === rightSection;
  } catch {
    return false;
  }
}

function isOutsidePrimaryReadingArea(element: BrowserElement, observation: BrowserObservation | undefined): boolean {
  const landmark = compactText(element.nearestLandmark ?? "");
  if (/^(header|nav|navigation|menu|toolbar|footer)$/i.test(landmark)) return true;
  if (!element.bbox || !observation?.viewport) return false;
  const viewport = observation.viewport;
  const centerX = element.bbox.x + element.bbox.w / 2;
  const centerY = element.bbox.y + element.bbox.h / 2;
  if (centerY >= 0 && centerY < Math.min(120, viewport.height * 0.14)) return true;
  if (centerX > viewport.width * 0.82 && !isLikelyContentHref(element.href ?? "", observation.url)) return true;
  return false;
}

function isGlobalStatisticLabel(label: string): boolean {
  return /(?:어제|오늘|전체|총)?\s*[\d,]+\s*개\s*(?:게시글|댓글|글|갤러리|posts?|comments?|items?)\s*(?:등록|created|posted)?/i.test(label) ||
    /(?:total|yesterday|today)\s*[\d,]+\s*(?:posts?|comments?|items?)/i.test(label);
}

function isLikelyUtilityHref(href: string, currentUrl: string | undefined): boolean {
  if (!href) return false;
  try {
    const target = new URL(href, currentUrl);
    const path = `${target.pathname} ${target.search}`.toLowerCase();
    if (/(login|logout|signup|register|settings?|profile|notifications?|messages?|search|event|lottery|stats?)/i.test(path)) return true;
    if (/\/(?:lists?|category|categories|tags?|search)(?:\/|$)/i.test(target.pathname) && !isLikelyContentHref(target.href, currentUrl)) return true;
    return false;
  } catch {
    return /(login|logout|signup|register|settings?|profile|notification|message|search|event|lottery|stats?)/i.test(href);
  }
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

function isNonContentViewNode(node: BrowserViewNode | undefined): boolean {
  if (!node) return true;
  if (node.kind !== "content_item" && node.kind !== "row") return true;
  if (node.regionRole === "header" || node.regionRole === "nav" || node.regionRole === "toolbar" || node.regionRole === "footer") return true;
  const label = compactText(node.label || node.text || "");
  return isGlobalStatisticLabel(label) || isNonRepresentativeContentLabel(label);
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
