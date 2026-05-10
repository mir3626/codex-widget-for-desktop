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
import { respondToBrowserActionInteraction } from "./actionSession/interactions.js";
import {
  cancelBrowserActionSession,
  completeBrowserExtensionCommand,
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
      commandResultIds: this.commandResultIds,
      results: this.results,
      requireSession: (id) => this.requireSession(id)
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
