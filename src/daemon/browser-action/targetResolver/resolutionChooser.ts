import type { TargetResolution } from "../types.js";

export function chooseResolution(input: { lexical: TargetResolution; semantic?: TargetResolution }): TargetResolution {
  if (!input.semantic?.primary) {
    return input.semantic?.semantic
      ? { ...input.lexical, semantic: input.semantic.semantic }
      : input.lexical;
  }
  if (!input.lexical.primary || input.lexical.confidence < 0.75) {
    return input.semantic.confidence >= 0.75 ? input.semantic : { ...input.lexical, semantic: input.semantic.semantic };
  }
  if (input.lexical.primary.id === input.semantic.primary.id) {
    return {
      ...input.lexical,
      confidence: Math.max(input.lexical.confidence, input.semantic.confidence),
      reason: `${input.lexical.reason} Semantic Interface confirmed the same target.`,
      semantic: input.semantic.semantic
    };
  }
  if (input.semantic.confidence >= input.lexical.confidence + 0.08) {
    return input.semantic;
  }
  return {
    ...input.lexical,
    semantic: input.semantic.semantic
  };
}
