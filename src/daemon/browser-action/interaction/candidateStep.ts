import { randomUUID } from "node:crypto";
import type { MemoryReadSet, RedactedMemoryEdge } from "../../semantic-interface/types.js";
import { readContentIdentifier, readContentOrdinal } from "../intentResolver/contentRequests.js";
import { isNonRepresentativeContentLabel } from "../targetResolver/semanticContentTarget.js";
import { normalizeBrowserTargetText, tokenizeBrowserTargetText } from "../targetLexicon.js";
import type {
  BrowserAction,
  BrowserElement,
  BrowserExpectedState,
  ElementGraph,
  ElementTarget
} from "../types.js";
import type { BrowserViewContextLease, CandidateStep, ReferenceBindingScope } from "./types.js";
import { classifyBrowserActionRisk } from "./contextLease.js";

export function generateCandidateSteps(input: {
  action: BrowserAction;
  graph: ElementGraph;
  target?: ElementTarget;
  hint?: string;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
  memoryReadSet?: MemoryReadSet;
}): CandidateStep[] {
  if (!requiresElementTarget(input.action)) {
    return [createSyntheticCandidate(input, "current_view", "이 작업은 특정 페이지 요소가 필요하지 않습니다.", 1)];
  }
  const rawHint = input.hint || (input.target?.kind === "text" ? input.target.text : undefined) || "";
  const hint = normalizeBrowserTargetText(rawHint);
  const identifier = readContentIdentifier(rawHint);
  if (identifier) {
    return generateContentIdentifierCandidates(input, identifier);
  }
  const ordinal = readContentOrdinal(rawHint);
  if (ordinal) {
    return generateOrdinalContentCandidates(input, ordinal);
  }
  const representativeContent = isRepresentativeContentRequest(hint, input.action);
  const elementPool = representativeContent
    ? preferPrimaryContentElements(input.graph.elements.filter((element) => element.visible).filter(looksLikeContentElement))
    : input.graph.elements.filter((element) => element.visible);
  const candidates = elementPool
    .filter((element) => element.visible)
    .map((element) => scoreElementCandidate({ ...input, element, hint }))
    .filter((candidate) => candidate.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || (a.element?.sourceOrder ?? 999999) - (b.element?.sourceOrder ?? 999999));
  return candidates.slice(0, 8).map((candidate, index) => ({
    ...candidate,
    alternatives: candidates.filter((other) => other.candidateId !== candidate.candidateId).slice(0, 4).map((other) => other.candidateId),
    reasonCodes: [...candidate.reasonCodes, index === 0 ? "top_candidate" : "alternative_candidate"]
  }));
}

export function expectedEffectsForAction(action: BrowserAction): BrowserExpectedState[] {
  if (action.type === "navigate") {
    return [{ type: "url_contains", value: action.url }];
  }
  if (action.type === "type") {
    return [
      { type: "element_state", target: action.target, state: { value: action.text } },
      { type: "custom", description: action.submit ? "Typed value is submitted as requested." : "Field value changes without implicit submit/navigation." }
    ];
  }
  if (action.type === "click") {
    return [{ type: "custom", description: "Target activation produces the expected visible page, route, selection, or content change." }];
  }
  if (action.type === "check") {
    return [{ type: "element_state", target: action.target, state: { checked: action.checked } }];
  }
  if (action.type === "select") {
    return [{ type: "element_state", target: action.target, state: { value: action.value } }];
  }
  if (action.type === "back" || action.type === "forward") {
    return [{ type: "navigation_complete" }];
  }
  if (action.type === "reload") {
    return [{ type: "network_idle" }];
  }
  return [];
}

function createSyntheticCandidate(input: {
  action: BrowserAction;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
  memoryReadSet?: MemoryReadSet;
}, scope: ReferenceBindingScope, label: string, confidence: number): CandidateStep {
  return {
    candidateId: `browser-candidate-${randomUUID()}`,
    leaseId: input.lease?.leaseId,
    contextId: input.lease?.contextId,
    viewRevision: input.lease?.viewRevision,
    graphDigest: input.lease?.graphDigest,
    stepIndex: input.stepIndex ?? 0,
    action: input.action,
    referenceBindingScope: scope,
    label,
    localeLabel: label,
    expectedEffect: input.expected ?? expectedEffectsForAction(input.action),
    riskClass: classifyBrowserActionRisk(input.action),
    confidence,
    scoreBreakdown: { synthetic: confidence },
    alternatives: [],
    reasonCodes: ["no_element_target_required"],
    memoryEvidence: input.memoryEvidence,
    safetyHints: []
  };
}

function generateOrdinalContentCandidates(input: {
  action: BrowserAction;
  graph: ElementGraph;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
  memoryReadSet?: MemoryReadSet;
}, ordinal: number): CandidateStep[] {
  const ordered = dedupeContentElements(preferPrimaryContentElements(input.graph.elements
    .filter((element) => element.visible)
    .filter(looksLikeContentElement))
    .sort(compareContentElementOrder));
  const selected = ordered[ordinal - 1];
  const candidateElements = selected
    ? [selected, ...ordered.filter((element) => element.id !== selected.id).slice(0, 4)]
    : ordered.slice(0, 5);
  const candidates: CandidateStep[] = candidateElements.map((element, index) => {
    const label = readElementLabel(element) || element.id;
    const selectedOrdinal = selected ? ordinal : index + 1;
    const isSelected = Boolean(selected) && element.id === selected.id;
    const memoryScore = scoreMemoryForCandidate({
      memoryReadSet: input.memoryReadSet,
      action: input.action,
      element,
      label,
      scoreBreakdown: {},
      reasonCodes: []
    });
    return {
      candidateId: `browser-candidate-${randomUUID()}`,
      leaseId: input.lease?.leaseId,
      contextId: input.lease?.contextId,
      viewRevision: input.lease?.viewRevision,
      graphDigest: input.lease?.graphDigest,
      stepIndex: input.stepIndex ?? 0,
      action: input.action,
      targetRef: element.id,
      element,
      referenceBindingScope: "content_list_ordinal" as const,
      label: `${selectedOrdinal}번째 글: ${label}`,
      localeLabel: `${selectedOrdinal}번째 글: ${buildLocaleLabel(element, label)}`,
      role: element.role,
      region: element.nearestLandmark,
      expectedEffect: input.expected ?? expectedEffectsForAction(input.action),
      riskClass: classifyBrowserActionRisk(input.action),
      confidence: Math.max(0, Math.min(0.98, (isSelected ? 0.94 : 0.52) + memoryScore.scoreDelta)),
      scoreBreakdown: {
        ordinal_content: isSelected ? 0.74 : 0.24,
        content_order: Math.max(0, 0.2 - index * 0.03),
        ...memoryScore.scoreBreakdown
      },
      alternatives: [],
      reasonCodes: [
        "ordinal_content",
        isSelected ? "ordinal_match" : "ordinal_alternative",
        index === 0 ? "top_candidate" : "alternative_candidate",
        ...memoryScore.reasonCodes
      ],
      memoryEvidence: input.memoryEvidence,
      safetyHints: element.riskHints
    };
  });
  return candidates.map((candidate, _index, candidates) => ({
    ...candidate,
    alternatives: candidates.filter((other) => other.candidateId !== candidate.candidateId).slice(0, 4).map((other) => other.candidateId)
  }));
}

function generateContentIdentifierCandidates(input: {
  action: BrowserAction;
  graph: ElementGraph;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
  memoryReadSet?: MemoryReadSet;
}, identifier: string): CandidateStep[] {
  const scored = dedupeContentElements(input.graph.elements
    .filter((element) => element.visible)
    .filter(looksLikeContentElement))
    .map((element) => ({ element, score: scoreContentIdentifierMatch(element, identifier) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareContentElementOrder(a.element, b.element));
  const candidates: CandidateStep[] = scored.slice(0, 5).map(({ element, score }, index) => {
    const label = readElementLabel(element) || element.id;
    const memoryScore = scoreMemoryForCandidate({
      memoryReadSet: input.memoryReadSet,
      action: input.action,
      element,
      label,
      scoreBreakdown: {},
      reasonCodes: []
    });
    return {
      candidateId: `browser-candidate-${randomUUID()}`,
      leaseId: input.lease?.leaseId,
      contextId: input.lease?.contextId,
      viewRevision: input.lease?.viewRevision,
      graphDigest: input.lease?.graphDigest,
      stepIndex: input.stepIndex ?? 0,
      action: input.action,
      targetRef: element.id,
      element,
      referenceBindingScope: "content_list_identifier" as const,
      label: `${identifier}번 글: ${label}`,
      localeLabel: `${identifier}번 글: ${buildLocaleLabel(element, label)}`,
      role: element.role,
      region: element.nearestLandmark,
      expectedEffect: input.expected ?? expectedEffectsForAction(input.action),
      riskClass: classifyBrowserActionRisk(input.action),
      confidence: Math.max(0, Math.min(0.98, Math.min(0.96, 0.62 + score) + memoryScore.scoreDelta)),
      scoreBreakdown: {
        content_identifier: score,
        content_order: Math.max(0, 0.08 - index * 0.02),
        ...memoryScore.scoreBreakdown
      },
      alternatives: [],
      reasonCodes: [
        "content_identifier",
        index === 0 ? "top_candidate" : "alternative_candidate",
        ...memoryScore.reasonCodes
      ],
      memoryEvidence: input.memoryEvidence,
      safetyHints: element.riskHints
    };
  });
  return candidates.map((candidate, _index, candidates) => ({
    ...candidate,
    alternatives: candidates.filter((other) => other.candidateId !== candidate.candidateId).slice(0, 4).map((other) => other.candidateId)
  }));
}

function preferPrimaryContentElements(elements: BrowserElement[]): BrowserElement[] {
  const preferred = elements.filter((element) => contentLandmarkRank(element) < 2);
  return preferred.length > 0 ? preferred : elements;
}

function scoreElementCandidate(input: {
  action: BrowserAction;
  element: BrowserElement;
  hint: string;
  lease?: BrowserViewContextLease;
  stepIndex?: number;
  expected?: BrowserExpectedState[];
  memoryEvidence?: CandidateStep["memoryEvidence"];
  memoryReadSet?: MemoryReadSet;
}): CandidateStep {
  const label = readElementLabel(input.element);
  const normalizedLabel = normalizeBrowserTargetText(label);
  const normalizedContext = normalizeBrowserTargetText(input.element.contextText || "");
  const tokens = new Set(tokenizeBrowserTargetText(`${label} ${input.element.contextText ?? ""}`));
  const hintTokens = tokenizeBrowserTargetText(input.hint);
  const scoreBreakdown: Record<string, number> = {};
  const reasonCodes: string[] = [];
  let score = 0;

  if (!input.element.visible) {
    score -= 0.5;
  }
  if (!input.element.enabled) {
    score -= 0.2;
  }
  if (input.hint) {
    if (normalizedLabel === input.hint) {
      score += 0.48;
      scoreBreakdown.exact_label = 0.48;
      reasonCodes.push("exact_label");
    } else if (normalizedLabel.includes(input.hint) || input.hint.includes(normalizedLabel)) {
      score += 0.3;
      scoreBreakdown.partial_label = 0.3;
      reasonCodes.push("partial_label");
    }
    const tokenHits = hintTokens.filter((token) => tokens.has(token)).length;
    if (tokenHits > 0) {
      const value = Math.min(0.24, tokenHits * 0.08);
      score += value;
      scoreBreakdown.token_overlap = value;
      reasonCodes.push("token_overlap");
    }
    if (normalizedContext && (normalizedContext.includes(input.hint) || hintTokens.some((token) => normalizedContext.includes(token)))) {
      score += 0.12;
      scoreBreakdown.context_text = 0.12;
      reasonCodes.push("context_text");
    }
  } else {
    score += 0.08;
    scoreBreakdown.visible_default = 0.08;
  }

  const roleScore = scoreRoleFit(input.action, input.element);
  score += roleScore;
  if (roleScore > 0) {
    scoreBreakdown.role_fit = roleScore;
    reasonCodes.push("role_fit");
  }
  const requestedRoleScore = scoreRequestedRoleFit(input.action, input.element);
  score += requestedRoleScore;
  if (requestedRoleScore > 0) {
    scoreBreakdown.requested_role_fit = requestedRoleScore;
    reasonCodes.push("requested_role_fit");
  } else if (requestedRoleScore < 0) {
    scoreBreakdown.requested_role_mismatch = requestedRoleScore;
    reasonCodes.push("requested_role_mismatch");
  }

  if (isRepresentativeContentRequest(input.hint, input.action) && looksLikeContentElement(input.element)) {
    score += 0.22;
    scoreBreakdown.representative_content = 0.22;
    reasonCodes.push("representative_content");
  }

  if (input.element.selected || input.element.checked) {
    score += input.action.type === "click" ? 0.03 : 0.01;
  }
  if (input.element.riskHints.length > 0) {
    score -= 0.08;
    reasonCodes.push("risk_hint_present");
  }
  const memoryScore = scoreMemoryForCandidate({
    memoryReadSet: input.memoryReadSet,
    action: input.action,
    element: input.element,
    label,
    scoreBreakdown,
    reasonCodes
  });
  score += memoryScore.scoreDelta;

  const confidence = Math.max(0, Math.min(0.98, score + Math.min(0.12, input.element.confidence * 0.12)));
  return {
    candidateId: `browser-candidate-${randomUUID()}`,
    leaseId: input.lease?.leaseId,
    contextId: input.lease?.contextId,
    viewRevision: input.lease?.viewRevision,
    graphDigest: input.lease?.graphDigest,
    stepIndex: input.stepIndex ?? 0,
    action: input.action,
    targetRef: input.element.id,
    element: input.element,
    referenceBindingScope: isRepresentativeContentRequest(input.hint, input.action) ? "content_list_representative" : "current_view",
    label: label || input.element.id,
    localeLabel: buildLocaleLabel(input.element, label),
    role: input.element.role,
    region: input.element.nearestLandmark,
    expectedEffect: input.expected ?? expectedEffectsForAction(input.action),
    riskClass: classifyBrowserActionRisk(input.action),
    confidence,
    scoreBreakdown,
    alternatives: [],
    reasonCodes,
    memoryEvidence: input.memoryEvidence,
    safetyHints: input.element.riskHints
  };
}

function scoreMemoryForCandidate(input: {
  memoryReadSet?: MemoryReadSet;
  action: BrowserAction;
  element: BrowserElement;
  label: string;
  scoreBreakdown: Record<string, number>;
  reasonCodes: string[];
}): { scoreDelta: number; scoreBreakdown: Record<string, number>; reasonCodes: string[] } {
  if (!input.memoryReadSet?.edges.length) {
    return { scoreDelta: 0, scoreBreakdown: {}, reasonCodes: [] };
  }
  const scoreBreakdown = input.scoreBreakdown;
  const reasonCodes = input.reasonCodes;
  let positive = 0;
  let penalty = 0;
  for (const edge of input.memoryReadSet.edges) {
    const strength = Math.min(1, Math.abs(edge.weightBp) / 10_000);
    if (edge.weightBp === 0 || strength <= 0) {
      continue;
    }
    const matches = memoryEdgeMatchesCandidate(edge, input.action, input.element, input.label);
    if (!matches) {
      continue;
    }
    if (edge.relation === "avoid_target" || edge.weightBp < 0) {
      penalty = Math.max(penalty, strength * 0.12);
      reasonCodes.push("semantic_memory_avoid_target");
      continue;
    }
    const weighted = strength * readMemoryRelationWeight(edge.relation);
    positive = Math.max(positive, weighted);
    reasonCodes.push(`semantic_memory_${edge.relation}`);
  }
  const scoreDelta = Math.max(-0.16, Math.min(0.09, positive - penalty));
  if (scoreDelta > 0) {
    scoreBreakdown.semantic_memory = Number(scoreDelta.toFixed(4));
  } else if (scoreDelta < 0) {
    scoreBreakdown.semantic_memory_penalty = Number(scoreDelta.toFixed(4));
  }
  return {
    scoreDelta,
    scoreBreakdown,
    reasonCodes: [...new Set(reasonCodes)]
  };
}

function memoryEdgeMatchesCandidate(edge: RedactedMemoryEdge, action: BrowserAction, element: BrowserElement, label: string): boolean {
  const toKey = normalizeBrowserTargetText(edge.toKey);
  if (!toKey) {
    return false;
  }
  if (edge.relation === "preferred_role") {
    return normalizeBrowserTargetText(`${element.role ?? ""} ${element.tagName ?? ""} ${element.inputType ?? ""}`).includes(toKey);
  }
  if (edge.relation === "preferred_region") {
    return normalizeBrowserTargetText(element.nearestLandmark).includes(toKey);
  }
  if (edge.relation === "preferred_affordance" || edge.relation === "usual_action") {
    return normalizeBrowserTargetText(action.type).includes(toKey) || toKey.includes(normalizeBrowserTargetText(action.type));
  }
  const haystack = normalizeBrowserTargetText([
    label,
    element.label,
    element.ariaLabel,
    element.text,
    element.contextText,
    element.title,
    element.href
  ].filter(Boolean).join(" "));
  return Boolean(haystack && (haystack.includes(toKey) || toKey.includes(normalizeBrowserTargetText(label))));
}

function readMemoryRelationWeight(relation: RedactedMemoryEdge["relation"]): number {
  if (relation === "phrase_alias") {
    return 0.09;
  }
  if (relation === "preferred_role" || relation === "preferred_region") {
    return 0.045;
  }
  if (relation === "preferred_affordance" || relation === "usual_action") {
    return 0.025;
  }
  if (relation === "workflow_step") {
    return 0.015;
  }
  return 0;
}

function requiresElementTarget(action: BrowserAction): boolean {
  return action.type === "click" || action.type === "type" || action.type === "select" || action.type === "check";
}

function readElementLabel(element: BrowserElement): string {
  return (element.label || element.ariaLabel || element.text || element.placeholder || element.title || element.value || "").trim();
}

function scoreRoleFit(action: BrowserAction, element: BrowserElement): number {
  const role = `${element.role ?? ""} ${element.tagName ?? ""} ${element.inputType ?? ""}`.toLowerCase();
  if (action.type === "type") {
    return element.editable || /input|textarea|searchbox|textbox/.test(role) ? 0.32 : -0.08;
  }
  if (action.type === "select") {
    return /select|combobox|listbox|option/.test(role) ? 0.28 : 0;
  }
  if (action.type === "check") {
    return /checkbox|radio/.test(role) ? 0.28 : 0;
  }
  if (action.type === "click") {
    if (/button|link|tab|menuitem|summary/.test(role)) {
      return 0.2;
    }
    if (element.href) {
      return 0.16;
    }
  }
  return 0;
}

function scoreRequestedRoleFit(action: BrowserAction, element: BrowserElement): number {
  if (!("target" in action) || action.target?.kind !== "text" || !action.target.role) {
    return 0;
  }
  const requested = action.target.role.toLowerCase();
  const role = `${element.role ?? ""} ${element.tagName ?? ""} ${element.inputType ?? ""}`.toLowerCase();
  if (requested === "searchbox") {
    return element.editable || /searchbox|textbox|input|textarea|search/.test(role) ? 0.24 : -0.12;
  }
  if (requested === "button") {
    return /button|submit|reset/.test(role) ? 0.24 : -0.12;
  }
  if (requested === "link") {
    return /link|a/.test(role) || Boolean(element.href) ? 0.24 : -0.12;
  }
  if (role.includes(requested)) {
    return 0.2;
  }
  return -0.08;
}

function looksLikeContentElement(element: BrowserElement): boolean {
  const role = `${element.role ?? ""} ${element.tagName ?? ""}`.toLowerCase();
  const label = readElementLabel(element);
  const text = `${element.text ?? ""} ${element.contextText ?? ""}`.trim();
  const href = element.href ?? "";
  if (!Boolean(href || /link|article|row/.test(role)) || text.length < 8) {
    return false;
  }
  if (isUtilityContentLabel(label)) {
    return false;
  }
  if (isNonRepresentativeContentLabel(text) || /(로그인|설정|검색|댓글|목록|전체글|개념글|글쓰기|삭제|수정|신고|추천인\s*기록|profile|login|setting|comment|list|write|delete|edit|report)/i.test(text)) {
    return false;
  }
  if (href && /(?:login|logout|signup|register|settings?|profile|notifications?|messages?|search|event|lottery|stats?|comment|reply)/i.test(href)) {
    return false;
  }
  return true;
}

function isUtilityContentLabel(label: string): boolean {
  const normalized = normalizeBrowserTargetText(label);
  if (!normalized) {
    return false;
  }
  if (/^(?:추천|비추천|댓글|조회|스크랩|신고|공지|전체글|개념글|글쓰기|목록|검색|이전|다음|더보기|hot|best|new|prev|next|more)(?:\s*\d+)?$/i.test(normalized)) {
    return true;
  }
  if (/^(?:유머|자유|질문|정보|핫딜|뉴스|이슈|스포츠|게임|정치|경제|연예|축구|해외축구|국내축구)$/i.test(normalized)) {
    return true;
  }
  if (/^\[?\d+\]?$/.test(normalized)) {
    return true;
  }
  return normalized.length <= 2;
}

function dedupeContentElements(elements: BrowserElement[]): BrowserElement[] {
  const seen = new Set<string>();
  const unique: BrowserElement[] = [];
  for (const element of elements) {
    const label = normalizeBrowserTargetText(readElementLabel(element));
    const href = normalizeContentHref(element.href);
    const key = href || `${label}:${Math.round(element.bbox?.y ?? element.sourceOrder ?? 0)}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(element);
  }
  return unique;
}

function normalizeContentHref(href: string | undefined): string {
  if (!href) {
    return "";
  }
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return href.replace(/#.*$/, "");
  }
}

function compareContentElementOrder(left: BrowserElement, right: BrowserElement): number {
  const landmarkDelta = contentLandmarkRank(left) - contentLandmarkRank(right);
  if (landmarkDelta !== 0) {
    return landmarkDelta;
  }
  const leftY = left.bbox?.y ?? Number.POSITIVE_INFINITY;
  const rightY = right.bbox?.y ?? Number.POSITIVE_INFINITY;
  if (leftY !== rightY) {
    return leftY - rightY;
  }
  const leftX = left.bbox?.x ?? Number.POSITIVE_INFINITY;
  const rightX = right.bbox?.x ?? Number.POSITIVE_INFINITY;
  if (leftX !== rightX) {
    return leftX - rightX;
  }
  return (left.sourceOrder ?? 999999) - (right.sourceOrder ?? 999999);
}

function contentLandmarkRank(element: BrowserElement): number {
  const landmark = normalizeBrowserTargetText(element.nearestLandmark ?? "");
  if (/^(main|content|article|본문|게시글|게시물|목록)$/.test(landmark)) {
    return 0;
  }
  if (/^(nav|navigation|menu|toolbar|header|footer|sidebar)$/.test(landmark)) {
    return 2;
  }
  return 1;
}

function isRepresentativeContentRequest(hint: string, action: BrowserAction): boolean {
  if (action.type !== "click") {
    return false;
  }
  return /(아무\s*글|랜덤|대표|재밌|흥미|게시글|게시물|포스트|article|post|interesting|random|any\s+(?:post|article|item))/i.test(hint);
}

function scoreContentIdentifierMatch(element: BrowserElement, identifier: string): number {
  const haystacks = [
    element.href,
    element.label,
    element.text,
    element.contextText,
    element.value,
    element.title
  ].filter(Boolean).map((value) => String(value));
  let score = 0;
  for (const value of haystacks) {
    if (value.includes(identifier)) {
      score = Math.max(score, value === identifier ? 0.34 : 0.28);
    }
    try {
      const url = new URL(value);
      const searchValues = Array.from(url.searchParams.values());
      if (searchValues.includes(identifier)) {
        score = Math.max(score, 0.34);
      }
      if (url.pathname.split(/[/?#&=._-]+/).includes(identifier)) {
        score = Math.max(score, 0.3);
      }
    } catch {
      // Non-URL label/text values are handled by the plain substring check.
    }
  }
  return score;
}

function buildLocaleLabel(element: BrowserElement, label: string): string {
  const role = element.role ? `${element.role} ` : "";
  const region = element.nearestLandmark ? ` (${element.nearestLandmark})` : "";
  return `${role}"${label || element.id}"${region}`.trim();
}
