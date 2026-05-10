import type {
  BrowserAction,
  BrowserElement
} from "../../browser-action/index.js";

export type PendingSemanticClarification = {
  id: string;
  requestId?: string;
  sessionId: string;
  actionSessionId: string;
  adapterId?: string;
  action: BrowserAction;
  utterance: string;
  transactionId?: string;
  targetHint?: string;
  observationUrl?: string;
  candidates: BrowserElement[];
};
