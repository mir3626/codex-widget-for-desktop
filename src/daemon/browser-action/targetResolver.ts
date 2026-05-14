import { normalizeBrowserTargetText } from "./targetLexicon.js";
import { resolveBrowserActionTargetSemantically } from "../semantic-interface/adapters/browserActionTargetResolver.js";
import type {
  BrowserAction,
  BrowserObservation,
  ElementGraph,
  ElementTarget,
  TargetResolution
} from "./types.js";
import type { MemoryReadSet } from "../semantic-interface/types.js";
import { resolveExplicitTarget } from "./targetResolver/explicitTarget.js";
import { resolveLexicalTarget } from "./targetResolver/lexicalTarget.js";
import {
  isSemanticContentTargetHint,
  resolveSemanticContentTarget
} from "./targetResolver/semanticContentTarget.js";
import { chooseResolution } from "./targetResolver/resolutionChooser.js";
import {
  buildPerceptionGraphFromBrowserObservation,
  explainPerceptionTarget
} from "../perception-graph/index.js";

export function resolveTarget(input: {
  graph: ElementGraph;
  observation?: BrowserObservation;
  action?: BrowserAction;
  target?: ElementTarget;
  hint?: string;
  memoryReadSet?: MemoryReadSet;
}): TargetResolution {
  const elements = input.graph.elements.filter((element) => element.visible);
  if (elements.length === 0) {
    return { alternatives: [], confidence: 0, reason: "No visible browser elements are available." };
  }

  const explicit = resolveExplicitTarget(elements, input.target, input.graph.focusedElementId);
  if (explicit.primary) {
    return explicit;
  }

  const hint = normalizeBrowserTargetText(input.hint || (input.target?.kind === "text" ? input.target.text : undefined));
  if (!hint) {
    const alternatives = elements.slice(0, 5);
    return {
      primary: alternatives[0],
      alternatives: alternatives.slice(1),
      confidence: alternatives[0]?.confidence ? Math.min(0.55, alternatives[0].confidence) : 0.35,
      reason: "No target hint was provided; using the first visible candidate as low-confidence fallback."
    };
  }

  if (isSemanticContentTargetHint(hint)) {
    const content = resolveSemanticContentTarget(elements, input.observation);
    if (content.primary) {
      return content;
    }
  }

  const lexical = resolveLexicalTarget({ elements, hint, target: input.target });
  const semantic = input.observation
    ? resolveBrowserActionTargetSemantically({
        observation: input.observation,
        action: input.action,
        target: input.target,
        hint: input.hint,
        memoryReadSet: input.memoryReadSet
      })
    : undefined;
  const selected = chooseResolution({ lexical, semantic });
  if (!input.observation) {
    return selected;
  }
  const perceptionGraph = buildPerceptionGraphFromBrowserObservation({ observation: input.observation });
  const explanation = explainPerceptionTarget({
    graph: perceptionGraph,
    nodeId: selected.primary?.id,
    risk: classifyTargetResolutionRisk(input.action)
  });
  return {
    ...selected,
    confidence: explanation.allowed ? Math.max(selected.confidence, explanation.confidence) : Math.min(selected.confidence, explanation.confidence),
    reason: `${selected.reason} PerceptionGraph: ${explanation.reason}`,
    semantic: {
      outcome: explanation.allowed ? selected.semantic?.outcome ?? "act" : "abstain",
      selectedElementId: selected.primary?.id,
      rankedElementIds: [selected.primary?.id, ...selected.alternatives.map((element) => element.id)].filter((id): id is string => Boolean(id)),
      trace: {
        ...(selected.semantic?.trace && typeof selected.semantic.trace === "object" ? selected.semantic.trace as Record<string, unknown> : {}),
        perceptionGraphId: perceptionGraph.id,
        perceptionExplanation: explanation,
        evidenceNodeCount: perceptionGraph.nodes.length
      }
    }
  };
}

function classifyTargetResolutionRisk(action: BrowserAction | undefined) {
  if (!action || action.type === "read" || action.type === "screenshot") {
    return "read_only" as const;
  }
  if (action.type === "scroll" || action.type === "back" || action.type === "forward" || action.type === "reload") {
    return "reversible" as const;
  }
  if (action.type === "evaluate") {
    return "high_risk" as const;
  }
  return "side_effect" as const;
}
