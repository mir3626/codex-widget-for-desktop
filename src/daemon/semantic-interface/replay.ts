import { buildSemanticHypotheses } from "./hypothesis.js";
import { decideSemanticOutcome } from "./ranker.js";
import { applyStepTransitionGrammar } from "./transitionGrammar.js";
import type { IntentFrame, SemanticDecisionOutcome, SemanticSnapshot } from "./types.js";

export function replaySemanticDecision(input: {
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  now?: Date;
}): SemanticDecisionOutcome {
  const hypotheses = applyStepTransitionGrammar({
    snapshot: input.snapshot,
    intent: input.intent,
    hypotheses: buildSemanticHypotheses({ snapshot: input.snapshot, intent: input.intent })
  });
  return decideSemanticOutcome({
    snapshot: input.snapshot,
    intent: input.intent,
    hypotheses,
    now: input.now
  });
}
