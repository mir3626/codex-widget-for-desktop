import type { RuntimeInteractionDecision } from "../../shared/protocol.js";
import { APP_SERVER_INTERACTION_TIMEOUT_MS } from "./constants.js";
import type {
  InteractionResponseResult,
  PendingInteraction
} from "./types.js";

export function respondToPendingInteraction(input: {
  pendingInteractions: Map<string, PendingInteraction>;
  id: string;
  decision: RuntimeInteractionDecision;
  answers?: Record<string, string>;
  respond: (id: string | number, result: unknown) => void;
}): InteractionResponseResult {
  const pending = input.pendingInteractions.get(input.id);
  if (!pending) {
    return { handled: false };
  }

  clearTimeout(pending.timer);
  input.pendingInteractions.delete(input.id);

  if (pending.kind === "input") {
    input.respond(pending.rpcId, { answers: input.decision === "decline" ? {} : input.answers ?? {} });
    return {
      handled: true,
      kind: pending.kind,
      action: pending.action,
      decision: input.decision === "decline" ? "decline" : "submit",
      remember: false
    };
  }

  const decision = input.decision === "always_allow" ? "approve" : input.decision;
  input.respond(pending.rpcId, {
    decision: decision === "approve" ? "accept" : "decline"
  });
  return {
    handled: true,
    kind: pending.kind,
    action: pending.action,
    decision: decision === "approve" ? "approve" : "decline",
    remember: input.decision === "always_allow"
  };
}

export function storePendingInteraction(input: {
  pendingInteractions: Map<string, PendingInteraction>;
  rpcId: string | number;
  kind: PendingInteraction["kind"];
  action?: string;
  respond: (id: string | number, result: unknown) => void;
}): string {
  const interactionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const timer = setTimeout(() => {
    const pending = input.pendingInteractions.get(interactionId);
    if (!pending) {
      return;
    }
    input.pendingInteractions.delete(interactionId);
    if (pending.kind === "input") {
      input.respond(pending.rpcId, { answers: {} });
      return;
    }
    input.respond(pending.rpcId, { decision: "decline" });
  }, APP_SERVER_INTERACTION_TIMEOUT_MS);

  input.pendingInteractions.set(interactionId, {
    rpcId: input.rpcId,
    kind: input.kind,
    action: input.action,
    timer
  });
  return interactionId;
}
