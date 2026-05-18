import { randomUUID } from "node:crypto";
import type {
  ComputerSessionObservationSummary
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";
import type { ComputerUseCatchUpRecipe } from "./promptRecipes.js";
import type { RuntimeSessionState } from "./sessionRuntimeTypes.js";

export type ComputerSessionCatchUpRecipeRuntimeHost = {
  storage: StorageService;
  requireSession: (sessionId: string) => RuntimeSessionState;
  recordObservation: (sessionId: string, observation: ComputerSessionObservationSummary) => void;
};

export function recordCatchUpRecipeEvidence(
  host: ComputerSessionCatchUpRecipeRuntimeHost,
  input: {
    sessionId: string;
    evalRunId: string;
    recipe: ComputerUseCatchUpRecipe;
  }
): void {
  const state = host.requireSession(input.sessionId);
  const now = new Date().toISOString();
  const summary = summarizeCatchUpRecipeForEval(input.recipe);
  host.storage.appendComputerUseEvalStep({
    runId: input.evalRunId,
    kind: "computer_use_catchup_recipe",
    phase: "planning",
    status: input.recipe.rolloutStatus === "backend_deferred" ? "blocked" : "completed",
    input: {
      userRequest: state.summary.userRequest,
      recipeId: input.recipe.id
    },
    output: summary,
    failureClass: input.recipe.rolloutStatus === "backend_deferred" ? "external_blocker" : "none",
    startedAt: now,
    completedAt: now,
    elapsedMs: 0
  });
  host.recordObservation(input.sessionId, {
    id: `observation:${randomUUID()}`,
    kind: "unknown",
    source: "computer_use_catchup_recipe",
    surface: input.recipe.preferredSurface,
    capturedAt: now,
    evalRunId: input.evalRunId,
    freshness: "fresh",
    summary: input.recipe.summary,
    metadata: summary,
    redaction: {
      credentials: "redacted",
      cookies: "never_store",
      localPaths: "basename_or_hash"
    }
  });
}

export function summarizeCatchUpRecipeForEval(recipe: ComputerUseCatchUpRecipe): Record<string, unknown> {
  return {
    schemaVersion: recipe.schemaVersion,
    id: recipe.id,
    title: recipe.title,
    confidence: recipe.confidence,
    preferredSurface: recipe.preferredSurface,
    riskClass: recipe.riskClass,
    requiredGrants: recipe.requiredGrants,
    operationKinds: recipe.operations.map((operation) => operation.kind),
    operationCount: recipe.operations.length,
    evidenceNeeds: recipe.evidenceNeeds,
    safetyBoundaries: recipe.safetyBoundaries,
    commitPolicy: recipe.commitPolicy,
    rolloutStatus: recipe.rolloutStatus,
    summary: recipe.summary
  };
}
