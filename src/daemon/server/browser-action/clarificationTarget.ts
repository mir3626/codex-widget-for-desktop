import {
  summarizeBrowserElement,
  type BrowserAction,
  type BrowserElement
} from "../../browser-action/index.js";
import { formatSemanticTargetClarificationCandidate } from "./clarificationInteraction.js";
import type { PendingSemanticClarification } from "./clarificationTypes.js";

export function selectSemanticClarificationCandidate(
  pending: PendingSemanticClarification,
  choice: string | undefined
): BrowserElement | undefined {
  const normalized = String(choice ?? "").trim();
  if (!normalized) {
    return pending.candidates[0];
  }
  const index = readChoiceIndex(normalized);
  if (Number.isInteger(index) && index >= 1 && index <= pending.candidates.length) {
    return pending.candidates[index - 1];
  }
  const lower = normalized.toLowerCase();
  const direct = pending.candidates.find((candidate) => {
    const summary = summarizeBrowserElement(candidate).toLowerCase();
    const formatted = formatSemanticTargetClarificationCandidate(candidate).toLowerCase();
    return summary.includes(lower) || formatted.includes(lower) || candidate.id.toLowerCase() === lower;
  });
  if (direct) {
    return direct;
  }
  return selectByPositionHint(pending.candidates, lower);
}

function readChoiceIndex(value: string): number {
  const numeric = value.match(/\d+/)?.[0];
  if (numeric) {
    return Number(numeric);
  }
  const compact = value.replace(/\s+/g, "").toLowerCase();
  const ordinalPairs: Array<[RegExp, number]> = [
    [/(?:첫|첫번|첫번째|첫째|1st|first)/i, 1],
    [/(?:두번|두번째|둘째|2nd|second)/i, 2],
    [/(?:세번|세번째|셋째|3rd|third)/i, 3],
    [/(?:네번|네번째|넷째|4th|fourth)/i, 4],
    [/(?:다섯|다섯번째|5th|fifth)/i, 5]
  ];
  return ordinalPairs.find(([pattern]) => pattern.test(compact))?.[1] ?? Number.NaN;
}

export function retargetBrowserAction(action: BrowserAction, selected: BrowserElement): BrowserAction {
  const target = { kind: "element_id" as const, id: selected.id };
  if (action.type === "click") return { ...action, target };
  if (action.type === "type") return { ...action, target };
  if (action.type === "select") return { ...action, target };
  if (action.type === "check") return { ...action, target };
  if (action.type === "scroll") return { ...action, target };
  if (action.type === "evaluate" && action.target) return { ...action, target };
  return action;
}

export function uniqueBrowserElements(elements: Array<BrowserElement | undefined>): BrowserElement[] {
  const seen = new Set<string>();
  const output: BrowserElement[] = [];
  for (const element of elements) {
    if (!element || seen.has(element.id)) {
      continue;
    }
    seen.add(element.id);
    output.push(element);
  }
  return output;
}

function selectByPositionHint(candidates: BrowserElement[], lower: string): BrowserElement | undefined {
  const wantsTop = /상단|위쪽|top/.test(lower);
  const wantsMiddle = /중단|가운데|middle|center/.test(lower);
  const wantsBottom = /하단|아래|bottom/.test(lower);
  const wantsLeft = /좌측|왼쪽|left/.test(lower);
  const wantsRight = /우측|오른쪽|right/.test(lower);
  const wantsMain = /본문|main/.test(lower);
  const wantsNav = /메뉴|nav|상단\s*메뉴/.test(lower);
  return candidates.find((candidate) => {
    const y = candidate.bbox?.y;
    const x = candidate.bbox?.x;
    const region = `${candidate.nearestLandmark ?? ""} ${candidate.listOwner ?? ""} ${candidate.formOwner ?? ""}`.toLowerCase();
    if (wantsTop && !(Number.isFinite(y) && Number(y) < 160)) return false;
    if (wantsMiddle && !(Number.isFinite(y) && Number(y) >= 160 && Number(y) < 560)) return false;
    if (wantsBottom && !(Number.isFinite(y) && Number(y) >= 560)) return false;
    if (wantsLeft && !(Number.isFinite(x) && Number(x) < 260)) return false;
    if (wantsRight && !(Number.isFinite(x) && Number(x) >= 760)) return false;
    if (wantsMain && !region.includes("main")) return false;
    if (wantsNav && !region.includes("nav")) return false;
    return wantsTop || wantsMiddle || wantsBottom || wantsLeft || wantsRight || wantsMain || wantsNav;
  });
}
