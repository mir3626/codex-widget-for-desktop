import type { BrowserAction, BrowserActionSession } from "./action.js";
import type { BrowserElement } from "./core.js";
import type { BrowserObservation } from "./observation.js";

export type BrowserActionCapability =
  | "observe_dom"
  | "observe_accessibility"
  | "screenshot"
  | "click"
  | "type"
  | "select"
  | "scroll"
  | "navigate"
  | "hotkey"
  | "console"
  | "network"
  | "evaluate"
  | "download"
  | "tab_control";

export type BrowserAdapterAvailabilityInput = {
  session: BrowserActionSession;
};

export type BrowserObserveInput = {
  session: BrowserActionSession;
  providerState?: unknown;
};

export type BrowserExecuteInput = {
  session: BrowserActionSession;
  observation: BrowserObservation;
  action: BrowserAction;
  target?: BrowserElement;
  timeoutMs?: number;
};

export type BrowserActionExecutionResult = {
  requestId: string;
  ok: boolean;
  adapterId?: string;
  before?: unknown;
  after?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type BrowserActionAdapterStatus = {
  id: string;
  label: string;
  state: "ready" | "unavailable" | "error";
  capabilities: BrowserActionCapability[];
  detail: string;
  checkedAt: string;
  diagnostics?: Record<string, unknown>;
};

export type BrowserActionAdapter = {
  id: string;
  label: string;
  capabilities: BrowserActionCapability[];
  isAvailable(input: BrowserAdapterAvailabilityInput): Promise<boolean>;
  getStatus?(input: BrowserAdapterAvailabilityInput): Promise<BrowserActionAdapterStatus>;
  observe(input: BrowserObserveInput): Promise<BrowserObservation>;
  execute(input: BrowserExecuteInput): Promise<BrowserActionExecutionResult>;
};
