import type { BrowserExtensionBridgeStatus } from "../../shared/protocol.js";
import type { BrowserObservation } from "../browser-action/types.js";
import type { DomSnapshot } from "../providers/providerSnapshots.js";
import {
  buildPreparedBrowserViewContext,
  contextMatchesBridgeStatus
} from "./sourceIdentity.js";
import type {
  BrowserPerceptionObserveReason,
  PreparedBrowserViewContext
} from "./types.js";

export class PreparedBrowserViewContextStore {
  private activeContext: PreparedBrowserViewContext | undefined;

  ingest(input: {
    snapshot: DomSnapshot;
    observation: BrowserObservation;
    bridgeStatus?: BrowserExtensionBridgeStatus;
    reason: BrowserPerceptionObserveReason;
  }): PreparedBrowserViewContext {
    const context = buildPreparedBrowserViewContext(input);
    this.activeContext = context;
    return context;
  }

  getActive(): PreparedBrowserViewContext | undefined {
    return this.activeContext;
  }

  getActiveForBridge(status: BrowserExtensionBridgeStatus): PreparedBrowserViewContext | undefined {
    return contextMatchesBridgeStatus(this.activeContext, status) ? this.activeContext : undefined;
  }

  markDirty(reason: string): void {
    if (!this.activeContext) {
      return;
    }
    this.activeContext = {
      ...this.activeContext,
      freshness: "stale",
      stability: "unknown",
      diagnostics: {
        ...this.activeContext.diagnostics,
        dirtyReason: reason,
        dirtyAt: new Date().toISOString()
      }
    };
  }
}

