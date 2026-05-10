import type {
  BrowserAction,
  BrowserActionPlanStep
} from "./action.js";
import type {
  BrowserActionMode,
  BrowserActionSource,
  BrowserElement
} from "./core.js";

export type BrowserQueuedCommand = {
  requestId: string;
  actionSessionId: string;
  resultId: string;
  adapterId?: string;
  action: BrowserAction;
  target?: BrowserElement;
  expectedSource?: BrowserActionSource;
  createdAt: string;
  expiresAt?: string;
  deliveredAt?: string;
  deliveryAttempts?: number;
  acknowledgedAt?: string;
};

export type BrowserActionPromptPlan = {
  id: string;
  goal: string;
  mode: BrowserActionMode;
  adapterId?: string;
  source?: Partial<BrowserActionSource>;
  steps: Array<Omit<BrowserActionPlanStep, "status">>;
  confidence: number;
  simulatedTool: true;
  reason: string;
};
