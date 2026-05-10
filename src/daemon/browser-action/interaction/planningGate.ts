import type { BrowserAction } from "../types.js";
import type { CandidateStep, PlanningGateDecision } from "./types.js";
import { classifyBrowserActionRisk, isBrowserViewContextLeaseFresh } from "./contextLease.js";

export function decideCandidatePlanningGate(input: {
  action: BrowserAction;
  candidates: CandidateStep[];
  locale?: "ko" | "en" | "unknown";
  requireFreshLease?: boolean;
}): PlanningGateDecision {
  const sorted = [...input.candidates].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  const runnerUp = sorted[1];
  const margin = top && runnerUp ? top.confidence - runnerUp.confidence : top ? top.confidence : 0;
  const risk = classifyBrowserActionRisk(input.action);
  const locale = input.locale ?? "unknown";

  if (!top) {
    return {
      decision: "abstain",
      clarificationOptions: [],
      confidence: 0,
      margin: 0,
      reasonCodes: ["no_candidates"],
      userFacingMessage: locale === "ko" ? "현재 화면에서 실행 후보를 찾지 못했습니다." : "No executable candidates were found in the current view."
    };
  }

  if (top.leaseId && input.requireFreshLease && top.confidence > 0 && top.riskClass !== "read" && top.scoreBreakdown.lease_expired) {
    return {
      decision: "blocked",
      selectedCandidateId: top.candidateId,
      clarificationOptions: sorted.slice(0, 5),
      blockingReason: "The selected candidate lease is stale.",
      confidence: top.confidence,
      margin,
      reasonCodes: ["stale_lease"],
      userFacingMessage: locale === "ko" ? "페이지 이해가 오래되어 실행 전에 다시 읽어야 합니다." : "The page understanding is stale and must be refreshed before execution."
    };
  }

  const sideEffect = risk !== "read";
  const ambiguous = sorted.length > 1 && (top.confidence < 0.82 || margin < 0.14);
  const weak = top.confidence < (sideEffect ? 0.58 : 0.42);
  const representativeContentPick = sideEffect &&
    top.referenceBindingScope === "content_list_representative" &&
    top.reasonCodes.includes("representative_content") &&
    top.confidence >= 0.5;
  if (sideEffect && (ambiguous || weak) && !representativeContentPick) {
    return {
      decision: "clarify",
      clarificationOptions: sorted.slice(0, 5),
      confidence: top.confidence,
      margin,
      reasonCodes: [weak ? "weak_top_candidate" : "ambiguous_margin", `candidate_count_${sorted.length}`],
      userFacingMessage: locale === "ko"
        ? "대상이 애매해서 바로 실행하지 않았습니다. 실행할 대상을 선택해 주세요."
        : "The target is ambiguous, so the action was not executed. Choose the intended target."
    };
  }

  return {
    decision: "proceed",
    selectedCandidateId: top.candidateId,
    clarificationOptions: sorted.slice(1, 5),
    confidence: top.confidence,
    margin,
    reasonCodes: ["candidate_selected"],
    userFacingMessage: locale === "ko" ? "실행 후보가 선택되었습니다." : "A browser action candidate was selected."
  };
}

export function markLeaseStateOnCandidates(candidates: CandidateStep[]): CandidateStep[] {
  return candidates.map((candidate) => {
    const lease = candidate.leaseId ? undefined : undefined;
    void lease;
    return candidate;
  });
}

export function readLeaseGateReason(input: { fresh: boolean; locale?: "ko" | "en" | "unknown" }): string {
  if (input.fresh) {
    return input.locale === "ko" ? "fresh view lease" : "fresh view lease";
  }
  return input.locale === "ko" ? "페이지 이해가 최신 상태가 아닙니다." : "The page understanding is not fresh.";
}

export { isBrowserViewContextLeaseFresh };
