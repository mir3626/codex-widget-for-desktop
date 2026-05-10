import { randomUUID } from "node:crypto";
import type {
  BrowserInteractionEvent,
  BrowserInteractionPhase,
  BrowserInteractionSource,
  BrowserInteractionTransaction,
  BrowserViewContextLease,
  CandidateStep,
  IntentFrame
} from "./types.js";
import type { BrowserActionMode, BrowserActionSource } from "../types.js";
import { detectLocale } from "./intentFrame.js";

export class BrowserInteractionTransactionManager {
  private transactions = new Map<string, BrowserInteractionTransaction>();
  private activeByTab = new Map<string, string>();

  begin(input: {
    requestId: string;
    actionSessionId: string;
    sessionId?: string;
    utterance: string;
    source: BrowserInteractionSource;
    mode: BrowserActionMode;
    browserSource?: Partial<BrowserActionSource>;
  }): BrowserInteractionTransaction {
    const transaction: BrowserInteractionTransaction = {
      transactionId: `browser-transaction-${randomUUID()}`,
      requestId: input.requestId,
      actionSessionId: input.actionSessionId,
      sessionId: input.sessionId,
      utterance: input.utterance,
      locale: detectLocale(input.utterance),
      source: input.source,
      mode: input.mode,
      phase: "perceiving",
      browserSource: input.browserSource,
      candidateSteps: [],
      selectedCandidateIds: [],
      stepCursor: 0,
      events: [],
      auditSummary: {}
    };
    transaction.events.push(createInteractionEvent("perceiving", "Browser Interaction transaction started"));
    this.transactions.set(transaction.transactionId, transaction);
    return cloneTransaction(transaction);
  }

  get(id: string | undefined): BrowserInteractionTransaction | undefined {
    const transaction = id ? this.transactions.get(id) : undefined;
    return transaction ? cloneTransaction(transaction) : undefined;
  }

  attachLease(transactionId: string | undefined, lease: BrowserViewContextLease): BrowserInteractionTransaction | undefined {
    const transaction = this.readMutable(transactionId);
    if (!transaction) {
      return undefined;
    }
    transaction.activeLease = lease;
    transaction.phase = "framing_intent";
    transaction.events.push(createInteractionEvent("framing_intent", "Fresh browser view lease attached", {
      leaseId: lease.leaseId,
      contextId: lease.contextId,
      routeKey: lease.routeKey,
      viewRevision: lease.viewRevision
    }));
    const tabKey = readTransactionTabKey(lease);
    if (tabKey) {
      const existingId = this.activeByTab.get(tabKey);
      const existing = existingId && existingId !== transaction.transactionId ? this.transactions.get(existingId) : undefined;
      if (existing && !["completed", "failed", "cancelled"].includes(existing.phase)) {
        existing.phase = "cancelled";
        existing.finalOutcome = "cancelled";
        existing.events.push(createInteractionEvent("cancelled", "Transaction superseded by a newer active-tab interaction", {
          nextTransactionId: transaction.transactionId,
          tabKey
        }));
      }
      this.activeByTab.set(tabKey, transaction.transactionId);
    }
    return cloneTransaction(transaction);
  }

  recordIntent(transactionId: string | undefined, intentFrame: IntentFrame): BrowserInteractionTransaction | undefined {
    const transaction = this.readMutable(transactionId);
    if (!transaction) {
      return undefined;
    }
    transaction.intentFrame = intentFrame;
    transaction.phase = "generating_candidates";
    transaction.events.push(createInteractionEvent("generating_candidates", "Intent frame recorded", intentFrame));
    return cloneTransaction(transaction);
  }

  recordCandidates(transactionId: string | undefined, candidates: CandidateStep[]): BrowserInteractionTransaction | undefined {
    const transaction = this.readMutable(transactionId);
    if (!transaction) {
      return undefined;
    }
    transaction.candidateSteps = candidates;
    transaction.events.push(createInteractionEvent("generating_candidates", "Browser action candidates generated", {
      candidateCount: candidates.length,
      topCandidateId: candidates[0]?.candidateId
    }));
    return cloneTransaction(transaction);
  }

  selectCandidate(transactionId: string | undefined, candidateId: string | undefined): BrowserInteractionTransaction | undefined {
    const transaction = this.readMutable(transactionId);
    if (!transaction || !candidateId) {
      return transaction ? cloneTransaction(transaction) : undefined;
    }
    transaction.selectedCandidateIds.push(candidateId);
    transaction.events.push(createInteractionEvent("executing", "Browser action candidate selected", { candidateId }));
    return cloneTransaction(transaction);
  }

  updatePhase(transactionId: string | undefined, phase: BrowserInteractionPhase, summary: string, detail?: unknown): BrowserInteractionTransaction | undefined {
    const transaction = this.readMutable(transactionId);
    if (!transaction) {
      return undefined;
    }
    transaction.phase = phase;
    transaction.events.push(createInteractionEvent(phase, summary, detail));
    if (phase === "completed" || phase === "failed" || phase === "cancelled") {
      transaction.finalOutcome = phase === "completed" ? "completed" : phase === "cancelled" ? "cancelled" : "failed";
      const tabKey = transaction.activeLease ? readTransactionTabKey(transaction.activeLease) : undefined;
      if (tabKey && this.activeByTab.get(tabKey) === transaction.transactionId) {
        this.activeByTab.delete(tabKey);
      }
    }
    return cloneTransaction(transaction);
  }

  readActiveTransactionForLease(lease: BrowserViewContextLease | undefined): BrowserInteractionTransaction | undefined {
    const tabKey = lease ? readTransactionTabKey(lease) : undefined;
    const id = tabKey ? this.activeByTab.get(tabKey) : undefined;
    return this.get(id);
  }

  private readMutable(id: string | undefined): BrowserInteractionTransaction | undefined {
    return id ? this.transactions.get(id) : undefined;
  }
}

function createInteractionEvent(phase: BrowserInteractionPhase, summary: string, detail?: unknown): BrowserInteractionEvent {
  return {
    id: `browser-interaction-event-${randomUUID()}`,
    t: new Date().toISOString(),
    phase,
    summary,
    detail
  };
}

function readTransactionTabKey(lease: BrowserViewContextLease): string | undefined {
  return lease.tabKey ?? ([lease.adapterId, lease.windowId, lease.tabId, lease.routeKey].filter(Boolean).join(":") || undefined);
}

function cloneTransaction(transaction: BrowserInteractionTransaction): BrowserInteractionTransaction {
  return JSON.parse(JSON.stringify(transaction)) as BrowserInteractionTransaction;
}
