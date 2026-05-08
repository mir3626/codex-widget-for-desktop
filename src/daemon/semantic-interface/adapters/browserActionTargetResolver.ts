import type { BrowserAction, BrowserElement, BrowserObservation, ElementTarget, TargetResolution } from "../../browser-action/types.js";
import { browserObservationToSemanticSnapshot } from "./browserActionAdapter.js";
import { buildIntentFrame, riskForAffordance } from "../intentFrame.js";
import { normalizeSemanticText } from "../ontology.js";
import { replaySemanticDecision } from "../replay.js";
import { redactTraceRecord } from "../trace.js";
import type { RedactedTraceRecord, ReferenceExpression, SemanticAffordance, SemanticDecisionOutcome, SemanticEntityKind, SemanticTier1Risk } from "../types.js";

export function resolveBrowserActionTargetSemantically(input: {
  observation: BrowserObservation;
  action?: BrowserAction;
  target?: ElementTarget;
  hint?: string;
  now?: Date;
}): TargetResolution {
  const reference = readReferenceText(input.target, input.hint, input.action);
  if (!reference && input.target?.kind !== "focused") {
    return {
      alternatives: [],
      confidence: 0,
      reason: "Semantic Interface needs a reference or focused target to resolve a browser element."
    };
  }

  const affordance = semanticAffordanceForAction(input.action);
  const snapshot = browserObservationToSemanticSnapshot({ observation: input.observation, now: input.now });
  const intent = buildIntentFrame({
    instruction: input.hint || reference || input.action?.type || "browser action",
    steps: [{
      affordance,
      reference: input.target?.kind === "focused" ? "focused" : reference,
      referenceKind: referenceKindForTarget(input.target),
      referenceHints: referenceHintsForTarget(input.target, affordance),
      riskBudget: riskForBrowserAction(input.action, affordance)
    }]
  });
  const outcome = replaySemanticDecision({ snapshot, intent, now: input.now });
  const trace = redactTraceRecord({
    trace: outcome.trace,
    outcome: redactedOutcomeKind(outcome),
    selectedHypothesisId: outcome.kind === "act" || outcome.kind === "confirm" ? outcome.hypothesis.id : undefined
  });
  const rankedElementIds = outcome.trace.ranked
    .map((item) => readBrowserElementId(snapshot.entities.find((entity) => entity.id === item.targetEntityId)))
    .filter((value): value is string => Boolean(value));

  if (outcome.kind !== "act" && outcome.kind !== "confirm") {
    return {
      alternatives: rankedElements(input.observation.elements, snapshot, outcome).slice(0, 5),
      confidence: 0,
      reason: `Semantic Interface ${outcome.kind}: ${outcome.reasons.join("; ")}`,
      semantic: {
        outcome: outcome.kind,
        trace,
        selectedElementId: undefined
      }
    };
  }

  const selectedEntity = snapshot.entities.find((entity) => entity.id === outcome.hypothesis.targetEntityId);
  const selectedElementId = readBrowserElementId(selectedEntity);
  const primary = selectedElementId ? input.observation.elements.find((element) => element.id === selectedElementId) : undefined;
  const selectedScore = outcome.trace.ranked.find((item) => item.hypothesisId === outcome.hypothesis.id)?.score ?? 0;
  const alternatives = rankedElements(input.observation.elements, snapshot, outcome).filter((element) => element.id !== primary?.id).slice(0, 5);
  return {
    primary,
    alternatives,
    confidence: selectedScore,
    reason: primary
      ? `Semantic Interface selected ${primary.role || primary.tagName} ${readElementDisplayName(primary)} for ${affordance}.`
      : "Semantic Interface selected a hypothesis, but the browser element is unavailable.",
    semantic: {
      outcome: outcome.kind,
      trace,
      selectedElementId,
      rankedElementIds
    }
  };
}

function semanticAffordanceForAction(action: BrowserAction | undefined): SemanticAffordance {
  if (!action) return "locate";
  if (action.type === "read" || action.type === "screenshot") return "read";
  if (action.type === "type") return "type";
  if (action.type === "navigate" || action.type === "back" || action.type === "forward" || action.type === "reload") return "navigate";
  if (action.type === "scroll") return action.target ? "locate" : "read";
  return "activate";
}

function riskForBrowserAction(action: BrowserAction | undefined, affordance: SemanticAffordance): SemanticTier1Risk {
  if (action?.type === "evaluate") return "code_execution";
  if (action?.type === "navigate") return /^https?:\/\//i.test(action.url) ? "external_navigation" : "local_navigation";
  if (action?.type === "type") return action.submit ? "submit_or_publish" : "input_non_submitting";
  if (action?.type === "check" || action?.type === "select") return "state_change";
  return riskForAffordance(affordance);
}

function referenceKindForTarget(target: ElementTarget | undefined): ReferenceExpression["kind"] {
  if (target?.kind === "focused") return "focused";
  if (target?.kind === "bbox") return "position";
  if (target?.kind === "text" && target.role) return "role";
  return "name";
}

function referenceHintsForTarget(target: ElementTarget | undefined, affordance: SemanticAffordance): ReferenceExpression["hints"] {
  const entityKinds: SemanticEntityKind[] = affordance === "read" || affordance === "locate"
    ? ["surface", "region", "content_item", "control"]
    : ["control", "content_item"];
  return {
    entityKinds,
    affordances: [affordance],
    regionRoles: target?.kind === "text" && target.role ? [target.role] : undefined
  };
}

function readReferenceText(target: ElementTarget | undefined, hint: string | undefined, action: BrowserAction | undefined): string | undefined {
  if (target?.kind === "text") {
    return normalizeSemanticText(target.text);
  }
  if (target?.kind === "selector") {
    return target.selector;
  }
  if (hint?.trim()) {
    return normalizeSemanticText(hint);
  }
  if (action?.type === "read") {
    return undefined;
  }
  return undefined;
}

function readBrowserElementId(entity: { tier2?: Record<string, string> } | undefined): string | undefined {
  return entity?.tier2?.browserElementId;
}

function rankedElements(elements: BrowserElement[], snapshot: ReturnType<typeof browserObservationToSemanticSnapshot>, outcome: SemanticDecisionOutcome): BrowserElement[] {
  const ids = outcome.trace.ranked
    .map((ranked) => readBrowserElementId(snapshot.entities.find((entity) => entity.id === ranked.targetEntityId)))
    .filter((id): id is string => Boolean(id));
  const seen = new Set<string>();
  return ids
    .map((id) => elements.find((element) => element.id === id))
    .filter((element): element is BrowserElement => Boolean(element))
    .filter((element) => {
      if (seen.has(element.id)) return false;
      seen.add(element.id);
      return true;
    });
}

function readElementDisplayName(element: BrowserElement): string {
  return element.label || element.ariaLabel || element.placeholder || element.text || element.title || element.href || element.id;
}

function redactedOutcomeKind(outcome: SemanticDecisionOutcome): RedactedTraceRecord["summary"]["outcome"] {
  if (outcome.kind === "act") return "selected";
  if (outcome.kind === "confirm") return "confirm_required";
  if (outcome.kind === "block") return "blocked";
  return "abstained";
}
