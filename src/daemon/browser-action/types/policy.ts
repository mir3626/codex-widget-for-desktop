import type { BrowserAction } from "./action.js";
import type { BrowserActionMode } from "./core.js";

export type BrowserActionPolicyDecision = "ask" | "allow" | "deny";

export type BrowserActionPolicyInput = {
  id?: string;
  decision: BrowserActionPolicyDecision;
  actionFamily: BrowserAction["type"] | "safe_read_scroll" | "safe_click_type" | "all";
  actionLabel?: string;
  origin?: string;
  targetRisk?: "low" | "medium" | "high" | "destructive" | "credential";
  mode?: BrowserActionMode | "any";
  expiresAt?: string;
  note?: string;
};

export type BrowserActionPolicy = Required<Pick<BrowserActionPolicyInput, "id" | "decision" | "actionFamily">> &
  Omit<BrowserActionPolicyInput, "id" | "decision" | "actionFamily"> & {
    createdAt: string;
    updatedAt: string;
    revokedAt?: string;
  };

export type BrowserActionPolicyMatch = {
  decision: BrowserActionPolicyDecision;
  policy?: BrowserActionPolicy;
  reason: string;
};
