import type { RuntimeInteractionDecision } from "../../../shared/protocol.js";
import type {
  BrowserAction,
  BrowserActionApproval,
  BrowserActionAuditEntry,
  BrowserActionExecutionResult,
  BrowserActionMode,
  BrowserActionPlan,
  BrowserActionPolicy,
  BrowserActionPolicyMatch,
  BrowserActionResult,
  BrowserActionSession,
  BrowserActionSource,
  BrowserExpectedState,
  BrowserObservation,
  BrowserQueuedCommand
} from "../types.js";
import type {
  BrowserInteractionTransaction,
  BrowserViewContextLease
} from "../interaction/types.js";

export type BrowserActionSessionStartInput = {
  id?: string;
  sessionId?: string;
  mode?: BrowserActionMode;
  source?: Partial<BrowserActionSource>;
};

export type BrowserActionObserveInput = { actionSessionId: string; snapshot: unknown; now?: Date };
export type BrowserActionObserveViaAdapterInput = { actionSessionId: string; adapterId: string; providerState?: unknown; now?: Date };
export type BrowserActionObserveOutput = {
  session: BrowserActionSession;
  observation: BrowserObservation;
  audit: BrowserActionAuditEntry;
};

export type BrowserActionExecuteInput = {
  actionSessionId: string;
  action: BrowserAction;
  snapshot: unknown;
  contextLease?: BrowserViewContextLease;
  transaction?: BrowserInteractionTransaction;
  expected?: BrowserExpectedState[];
  adapterId?: string;
  approved?: boolean;
  targetHint?: string;
  policyMatch?: BrowserActionPolicyMatch;
  policies?: BrowserActionPolicy[];
};
export type BrowserActionExecuteOutput = {
  session: BrowserActionSession;
  result: BrowserActionResult;
  command?: BrowserQueuedCommand;
  approval?: BrowserActionApproval;
  audit: BrowserActionAuditEntry;
};

export type BrowserActionInteractionInput = { id: string; decision: RuntimeInteractionDecision };
export type BrowserActionInteractionOutput = {
  handled: boolean;
  approved?: boolean;
  approval?: BrowserActionApproval;
  result?: BrowserActionResult;
  command?: BrowserQueuedCommand;
};

export type BrowserActionPlanExecuteInput = {
  plan: BrowserActionPlan;
  snapshot: unknown;
  contextLease?: BrowserViewContextLease;
  transaction?: BrowserInteractionTransaction;
  adapterId?: string;
  approvedStepIds?: string[];
  policyMatches?: Record<string, BrowserActionPolicyMatch | undefined>;
  policies?: BrowserActionPolicy[];
};
export type BrowserActionPlanExecuteOutput = {
  session: BrowserActionSession;
  plan: BrowserActionPlan;
  results: BrowserActionResult[];
  command?: BrowserQueuedCommand;
  approval?: BrowserActionApproval;
  audits: BrowserActionAuditEntry[];
};

export type BrowserActionExtensionCompletionOutput = {
  session: BrowserActionSession;
  result: BrowserActionResult;
  audit: BrowserActionAuditEntry;
};

export type { BrowserActionExecutionResult };
