import type { SemanticMemoryScope } from "../../semantic-interface/types.js";
import type { SemanticMemoryStore } from "../../semantic-interface/memory/types.js";
import type {
  BrowserAction,
  BrowserElement,
  BrowserObservation,
  ElementTarget,
  TargetResolution
} from "../types.js";

export function readSemanticMemoryForAction(input: {
  enabled: boolean;
  semanticMemory?: SemanticMemoryStore;
  observation: BrowserObservation;
  action: BrowserAction;
  target?: ElementTarget;
  hint?: string;
}) {
  const phrase = readSemanticMemoryPhrase(input.action, input.target, input.hint);
  if (!input.enabled || !input.semanticMemory || !phrase) {
    return undefined;
  }
  try {
    return input.semanticMemory.readMemory({
      phrase,
      scope: semanticMemoryScopeForObservation(input.observation),
      limit: 20
    });
  } catch {
    return undefined;
  }
}

export function recordUnresolvedTargetCase(input: {
  enabled: boolean;
  semanticMemory?: SemanticMemoryStore;
  observation: BrowserObservation;
  action: BrowserAction;
  target?: ElementTarget;
  hint?: string;
  resolution: TargetResolution;
}): void {
  const phrase = readSemanticMemoryPhrase(input.action, input.target, input.hint);
  if (!input.enabled || !input.semanticMemory || !phrase) {
    return;
  }
  try {
    input.semanticMemory.recordUnresolvedCase({
      surface: "browser_page",
      failureKind: input.resolution.primary ? "ambiguous_target" : "unknown_reference",
      utterance: phrase,
      scope: semanticMemoryScopeForObservation(input.observation),
      candidates: [input.resolution.primary, ...input.resolution.alternatives]
        .filter((element): element is BrowserElement => Boolean(element))
        .slice(0, 5)
        .map((element) => ({
          id: element.id,
          label: element.label || element.ariaLabel || element.text || element.title || element.id,
          reason: `${element.role || element.tagName || "element"} confidence ${input.resolution.confidence.toFixed(2)}`
        })),
      traceId: readSemanticTraceId(input.resolution.semantic?.trace)
    });
  } catch {
    // Semantic Memory is advisory. Recording failures must not affect Browser Action safety or execution.
  }
}

function readSemanticTraceId(trace: unknown): string | undefined {
  return trace && typeof trace === "object" && "id" in trace && typeof trace.id === "string" ? trace.id : undefined;
}

function readSemanticMemoryPhrase(action: BrowserAction, target: ElementTarget | undefined, hint: string | undefined): string | undefined {
  if (hint?.trim()) {
    return hint.trim();
  }
  if (target?.kind === "text" && target.text.trim()) {
    return target.text.trim();
  }
  if (action.type === "read" && action.reason?.trim()) {
    return action.reason.trim();
  }
  return undefined;
}

function semanticMemoryScopeForObservation(observation: BrowserObservation): SemanticMemoryScope {
  const scope: SemanticMemoryScope = { surface: "browser_page" };
  try {
    const parsed = observation.url ? new URL(observation.url) : undefined;
    if (parsed?.origin && parsed.origin !== "null") {
      scope.origin = parsed.origin;
      scope.viewPattern = normalizeSemanticMemoryViewPattern(observation.viewGraph?.identity.route, parsed.pathname || "/");
    }
  } catch {
    scope.viewPattern = normalizeSemanticMemoryViewPattern(observation.viewGraph?.identity.route, undefined);
  }
  if (!scope.viewPattern) {
    scope.viewPattern = normalizeSemanticMemoryViewPattern(observation.viewGraph?.identity.route, undefined);
  }
  return scope;
}

function normalizeSemanticMemoryViewPattern(route: string | undefined, fallback: string | undefined): string | undefined {
  if (!route?.trim()) {
    return fallback;
  }
  try {
    return new URL(route).pathname || fallback;
  } catch {
    return route;
  }
}
