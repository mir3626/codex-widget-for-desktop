import { buildSemanticHypotheses } from "./hypothesis.js";
import { applySemanticMemoryToHypotheses } from "./memory/memoryFeatures.js";
import { decideSemanticOutcome } from "./ranker.js";
import { applyStepTransitionGrammar } from "./transitionGrammar.js";
import type { IntentFrame, MemoryReadSet, SemanticDecisionOutcome, SemanticSnapshot } from "./types.js";

export function replaySemanticDecision(input: {
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  memoryReadSet?: MemoryReadSet;
  now?: Date;
}): SemanticDecisionOutcome {
  const generated = buildSemanticHypotheses({ snapshot: input.snapshot, intent: input.intent });
  const memoryApplied = applySemanticMemoryToHypotheses({
    hypotheses: generated,
    memoryReadSet: input.memoryReadSet
  });
  const hypotheses = applyStepTransitionGrammar({
    snapshot: input.snapshot,
    intent: input.intent,
    hypotheses: memoryApplied
  });
  return decideSemanticOutcome({
    snapshot: input.snapshot,
    intent: input.intent,
    hypotheses,
    now: input.now
  });
}
