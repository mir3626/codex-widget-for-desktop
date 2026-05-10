import { isDestructiveBrowserAction } from "../safetyPolicy.js";
import type {
  BrowserAction,
  BrowserActionMode,
  BrowserActionPolicy,
  BrowserActionPolicyMatch,
  BrowserActionSafetyDecision,
  BrowserElement,
  BrowserObservation
} from "../types.js";
import { normalizeOrigin } from "./normalizers.js";

export function matchBrowserActionPolicy(input: {
  policies: BrowserActionPolicy[];
  action: BrowserAction;
  target?: BrowserElement;
  observation?: BrowserObservation;
  mode: BrowserActionMode;
  safety: BrowserActionSafetyDecision;
}): BrowserActionPolicyMatch {
  const active = input.policies
    .filter((policy) => !policy.revokedAt && !isExpired(policy))
    .sort((left, right) => policySpecificity(right) - policySpecificity(left));
  const origin = normalizeOrigin(input.observation?.url);
  const risk = classifyActionRisk(input.action, input.target, input.safety);
  for (const policy of active) {
    if (!matchesActionFamily(policy.actionFamily, input.action)) {
      continue;
    }
    if (policy.mode && policy.mode !== "any" && policy.mode !== input.mode) {
      continue;
    }
    if (policy.origin && policy.origin !== origin) {
      continue;
    }
    if (policy.targetRisk && policy.targetRisk !== risk && policy.targetRisk !== input.safety.risk) {
      continue;
    }
    if (policy.decision === "allow" && isCredentialOrDestructiveRisk(risk) && !isExplicitHighRiskPolicy(policy)) {
      return {
        decision: "ask",
        policy,
        reason: "Saved policy matched, but destructive or credential-sensitive Browser Actions still require explicit confirmation."
      };
    }
    return {
      decision: policy.decision,
      policy,
      reason: `Matched Browser Action policy ${policy.id}.`
    };
  }
  return {
    decision: "ask",
    reason: "No Browser Action policy matched this action."
  };
}

export function applyBrowserActionPolicyToSafety(input: {
  safety: BrowserActionSafetyDecision;
  match?: BrowserActionPolicyMatch;
}): BrowserActionSafetyDecision {
  const match = input.match;
  if (!match || match.decision === "ask" || input.safety.decision === "block" || input.safety.decision === "clarify") {
    return input.safety;
  }
  if (match.decision === "deny") {
    return {
      ...input.safety,
      decision: "block",
      reason: `Saved Browser Action policy denied this action. ${match.reason}`,
      metadata: {
        ...input.safety.metadata,
        policyId: match.policy?.id,
        policyDecision: match.decision
      }
    };
  }
  return {
    ...input.safety,
    decision: input.safety.decision === "confirm" ? "allow" : input.safety.decision,
    reason: `${input.safety.reason} Saved Browser Action policy allowed this action. ${match.reason}`,
    metadata: {
      ...input.safety.metadata,
      policyId: match.policy?.id,
      policyDecision: match.decision
    }
  };
}

function classifyActionRisk(action: BrowserAction, target: BrowserElement | undefined, safety: BrowserActionSafetyDecision): "low" | "medium" | "high" | "destructive" | "credential" {
  if (target?.riskHints.some((hint) => hint === "password" || hint === "payment" || hint === "auth")) {
    return "credential";
  }
  if (isDestructiveBrowserAction(action, target) || safety.destructive) {
    return "destructive";
  }
  return safety.risk;
}

function isCredentialOrDestructiveRisk(risk: string): boolean {
  return risk === "credential" || risk === "destructive" || risk === "high";
}

function isExplicitHighRiskPolicy(policy: BrowserActionPolicy): boolean {
  return policy.targetRisk === "destructive" || policy.targetRisk === "credential";
}

function matchesActionFamily(family: BrowserActionPolicy["actionFamily"], action: BrowserAction): boolean {
  if (family === "all" || family === action.type) {
    return true;
  }
  if (family === "safe_read_scroll") {
    return action.type === "read" || action.type === "scroll" || action.type === "screenshot";
  }
  if (family === "safe_click_type") {
    return action.type === "click" || action.type === "type" || action.type === "select" || action.type === "check";
  }
  return false;
}

function policySpecificity(policy: BrowserActionPolicy): number {
  return [
    policy.origin ? 4 : 0,
    policy.targetRisk ? 3 : 0,
    policy.mode && policy.mode !== "any" ? 2 : 0,
    policy.actionFamily !== "all" ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function isExpired(policy: BrowserActionPolicy): boolean {
  return Boolean(policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now());
}
