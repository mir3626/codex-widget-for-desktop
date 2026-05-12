import { BrowserActionAdapterRegistry } from "./adapterRegistry.js";
import type {
  BrowserActionAdapterStatus,
  BrowserActionApproval,
  BrowserActionResult,
  BrowserActionSession,
  BrowserQueuedCommand,
} from "./types.js";
import type { SemanticMemoryStore } from "../semantic-interface/memory/types.js";
import type {
  BrowserActionExecuteInput,
  BrowserActionExecuteOutput,
  BrowserActionExtensionCompletionOutput,
  BrowserActionExecutionResult,
  BrowserActionInteractionInput,
  BrowserActionInteractionOutput,
  BrowserActionObserveInput,
  BrowserActionObserveOutput,
  BrowserActionObserveViaAdapterInput,
  BrowserActionPlanExecuteInput,
  BrowserActionPlanExecuteOutput,
  BrowserActionSessionStartInput
} from "./actionSession/apiTypes.js";
import { cloneSession } from "./actionSession/cloning.js";
import { executeBrowserActionPlan } from "./actionSession/planExecution.js";
import { createDiagnosticSession } from "./actionSession/diagnostics.js";
import { executeBrowserAction } from "./actionSession/executeAction.js";
import { BrowserInteractionTransactionManager } from "./interaction/transactionManager.js";
import type {
  BrowserInteractionPhase,
  BrowserInteractionSource,
  BrowserInteractionTransaction,
  BrowserViewContextLease,
  CandidateStep,
  IntentFrame
} from "./interaction/types.js";
import { respondToBrowserActionInteraction } from "./actionSession/interactions.js";
import {
  acknowledgeBrowserExtensionCommand,
  cancelBrowserActionSession,
  completeBrowserExtensionCommand,
  failPendingBrowserExtensionCommand,
  pollBrowserExtensionCommand
} from "./actionSession/extensionCommands.js";
import {
  createBrowserActionSession,
  summarizeBrowserActionSessionData
} from "./actionSession/lifecycle.js";
import {
  observeBrowserActionSession,
  observeBrowserActionSessionViaAdapter
} from "./actionSession/observation.js";

export class BrowserActionSessionManager {
  private sessions = new Map<string, BrowserActionSession>();
  private results = new Map<string, BrowserActionResult>();
  private pendingCommands: BrowserQueuedCommand[] = [];
  private pendingApprovals = new Map<string, BrowserActionApproval>();
  private commandResultIds = new Map<string, string>();
  private adapters: BrowserActionAdapterRegistry;
  private semanticMemory?: SemanticMemoryStore;
  private semanticMemoryEnabled = true;
  private interactions = new BrowserInteractionTransactionManager();

  constructor(adapters = new BrowserActionAdapterRegistry(), semanticMemory?: SemanticMemoryStore) {
    this.adapters = adapters;
    this.semanticMemory = semanticMemory;
  }

  setSemanticMemoryEnabled(enabled: boolean): { enabled: boolean } {
    this.semanticMemoryEnabled = enabled;
    return this.getSemanticMemorySettings();
  }

  getSemanticMemorySettings(): { enabled: boolean } {
    return { enabled: this.semanticMemoryEnabled };
  }

  start(input: BrowserActionSessionStartInput = {}): BrowserActionSession {
    const session = createBrowserActionSession(input);
    if (this.sessions.has(session.id)) {
      throw new Error(`Browser Action session already exists: ${session.id}`);
    }
    this.sessions.set(session.id, session);
    return cloneSession(session);
  }

  get(id: string): BrowserActionSession | undefined {
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : undefined;
  }

  async getAdapterStatuses(actionSessionId?: string): Promise<BrowserActionAdapterStatus[]> {
    const session = actionSessionId ? this.requireSession(actionSessionId) : createDiagnosticSession();
    return this.adapters.statuses(session);
  }

  observe(input: BrowserActionObserveInput): BrowserActionObserveOutput {
    const session = this.requireSession(input.actionSessionId);
    return observeBrowserActionSession({ session, snapshot: input.snapshot, now: input.now });
  }

  async observeViaAdapter(input: BrowserActionObserveViaAdapterInput): Promise<BrowserActionObserveOutput> {
    const session = this.requireSession(input.actionSessionId);
    return observeBrowserActionSessionViaAdapter({
      session,
      adapters: this.adapters,
      adapterId: input.adapterId,
      providerState: input.providerState
    });
  }

  async execute(input: BrowserActionExecuteInput): Promise<BrowserActionExecuteOutput> {
    const session = this.requireSession(input.actionSessionId);
    return executeBrowserAction({
      session,
      adapters: this.adapters,
      results: this.results,
      pendingCommands: this.pendingCommands,
      pendingApprovals: this.pendingApprovals,
      commandResultIds: this.commandResultIds,
      semanticMemoryEnabled: this.semanticMemoryEnabled,
      semanticMemory: this.semanticMemory,
      action: input.action,
      snapshot: input.snapshot,
      contextLease: input.contextLease,
      transaction: input.transaction,
      expected: input.expected,
      adapterId: input.adapterId,
      approved: input.approved,
      targetHint: input.targetHint,
      policyMatch: input.policyMatch,
      policies: input.policies
    });
  }

  async respondToInteraction(input: BrowserActionInteractionInput): Promise<BrowserActionInteractionOutput> {
    return respondToBrowserActionInteraction({
      ...input,
      pendingApprovals: this.pendingApprovals,
      results: this.results,
      pendingCommands: this.pendingCommands,
      commandResultIds: this.commandResultIds,
      adapters: this.adapters,
      requireSession: (id) => this.requireSession(id)
    });
  }

  async executePlan(input: BrowserActionPlanExecuteInput): Promise<BrowserActionPlanExecuteOutput> {
    const session = this.requireSession(input.plan.actionSessionId);
    return executeBrowserActionPlan({
      session,
      plan: input.plan,
      snapshot: input.snapshot,
      contextLease: input.contextLease,
      transaction: input.transaction,
      adapterId: input.adapterId,
      approvedStepIds: input.approvedStepIds,
      policyMatches: input.policyMatches,
      policies: input.policies,
      executeStep: (stepInput) => this.execute(stepInput)
    });
  }

  pollExtensionCommand(): BrowserQueuedCommand | undefined {
    return pollBrowserExtensionCommand({
      pendingCommands: this.pendingCommands,
      results: this.results,
      sessions: this.sessions,
      commandResultIds: this.commandResultIds
    });
  }

  completeExtensionCommand(input: BrowserActionExecutionResult): BrowserActionExtensionCompletionOutput {
    return completeBrowserExtensionCommand({
      execution: input,
      pendingCommands: this.pendingCommands,
      commandResultIds: this.commandResultIds,
      results: this.results,
      requireSession: (id) => this.requireSession(id)
    });
  }

  acknowledgeExtensionCommand(requestId: string): BrowserActionResult | undefined {
    return acknowledgeBrowserExtensionCommand({
      requestId,
      pendingCommands: this.pendingCommands,
      results: this.results,
      sessions: this.sessions,
      commandResultIds: this.commandResultIds
    });
  }

  failExtensionCommand(requestId: string, error: string): BrowserActionResult | undefined {
    return failPendingBrowserExtensionCommand({
      requestId,
      error,
      pendingCommands: this.pendingCommands,
      results: this.results,
      sessions: this.sessions,
      commandResultIds: this.commandResultIds
    });
  }

  cancel(id: string): BrowserActionSession {
    const session = this.requireSession(id);
    return cancelBrowserActionSession({
      session,
      pendingCommands: this.pendingCommands,
      commandResultIds: this.commandResultIds,
      pendingApprovals: this.pendingApprovals,
      results: this.results
    });
  }

  beginInteraction(input: {
    requestId: string;
    actionSessionId: string;
    sessionId?: string;
    utterance: string;
    source: BrowserInteractionSource;
    mode: BrowserActionSession["mode"];
    browserSource?: Partial<BrowserActionSession["source"]>;
  }): BrowserInteractionTransaction {
    return this.interactions.begin(input);
  }

  attachInteractionLease(transactionId: string | undefined, lease: BrowserViewContextLease): BrowserInteractionTransaction | undefined {
    return this.interactions.attachLease(transactionId, lease);
  }

  recordInteractionIntent(transactionId: string | undefined, intentFrame: IntentFrame): BrowserInteractionTransaction | undefined {
    return this.interactions.recordIntent(transactionId, intentFrame);
  }

  recordInteractionCandidates(transactionId: string | undefined, candidates: CandidateStep[]): BrowserInteractionTransaction | undefined {
    return this.interactions.recordCandidates(transactionId, candidates);
  }

  selectInteractionCandidate(transactionId: string | undefined, candidateId: string | undefined): BrowserInteractionTransaction | undefined {
    return this.interactions.selectCandidate(transactionId, candidateId);
  }

  markInteractionTiming(
    transactionId: string | undefined,
    name: string,
    phase: BrowserInteractionPhase,
    detail?: Record<string, unknown>
  ): BrowserInteractionTransaction | undefined {
    return this.interactions.markTiming(transactionId, name, phase, detail);
  }

  getInteraction(transactionId: string | undefined): BrowserInteractionTransaction | undefined {
    return this.interactions.get(transactionId);
  }

  updateInteractionPhase(
    transactionId: string | undefined,
    phase: BrowserInteractionPhase,
    summary: string,
    detail?: unknown
  ): BrowserInteractionTransaction | undefined {
    return this.interactions.updatePhase(transactionId, phase, summary, detail);
  }

  private requireSession(id: string): BrowserActionSession {
    const session = this.sessions.get(id.trim());
    if (!session) {
      throw new Error(`Browser Action session not found: ${id}`);
    }
    return session;
  }

}

export function summarizeBrowserActionSession(session: BrowserActionSession): Record<string, unknown> {
  return summarizeBrowserActionSessionData(session);
}
