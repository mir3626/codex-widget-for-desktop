import type {
  CapabilityDagNodeSummary,
  CapabilityJobKind,
  CapabilityJobSummary,
  ComputerSessionSummary,
  ComputerStructuredOperation
} from "../../shared/protocol.js";
import type { BrowserActionSource } from "../browser-action/index.js";
import type { ComputerSessionOperationExecutor } from "./sessionRuntime.js";
import { readUnknownRecord } from "./sessionRecordUtils.js";

type BrowserActionExecutorResult = Awaited<ReturnType<ComputerSessionOperationExecutor>>;

type BrowserActionAdapterFallbackPlan = {
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
  actionRoute: Record<string, unknown>;
  reason: string;
  fromAdapter?: string;
  toAdapter: string;
};

export function resolvePromptBrowserSource(
  session: ComputerSessionSummary,
  source: Partial<BrowserActionSource> | undefined
): Partial<BrowserActionSource> | undefined {
  if (session.selectedSurface?.kind !== "isolated_browser") {
    return source;
  }
  return {
    ...source,
    kind: "controlled_browser",
    browser: source?.browser ?? "chromium"
  };
}

export function bridgeOperationToCapability(operation: ComputerStructuredOperation): { kind: CapabilityJobKind; input: Record<string, unknown> } | null {
  if (operation.kind === "browser_action" ||
    operation.kind === "browser_chrome" ||
    operation.kind === "terminal" ||
    operation.kind === "screen_observe" ||
    operation.kind === "ocr") {
    return { kind: operation.kind, input: operation.input };
  }
  if (operation.kind === "native_browser_window_action") {
    return { kind: "desktop_action", input: operation.input };
  }
  if (operation.kind === "toolsmith") {
    return { kind: "agent_tool", input: { runtime: "simulated_daemon", capability: "toolsmith", request: operation.input } };
  }
  return null;
}

export function operationFromCapabilityJob(
  kind: CapabilityJobKind,
  job: CapabilityJobSummary
): ComputerStructuredOperation | undefined {
  const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
  if (kind === "browser_action" || kind === "browser_chrome" || kind === "terminal" || kind === "screen_observe" || kind === "ocr") {
    return { kind, input } as ComputerStructuredOperation;
  }
  if (kind === "desktop_action") {
    return { kind: "native_browser_window_action", input };
  }
  if (kind === "agent_tool") {
    return { kind: "toolsmith", input };
  }
  return undefined;
}

export function routeComputerOperation(
  operation: ComputerStructuredOperation,
  session: ComputerSessionSummary
): Record<string, unknown> {
  const surface = session.selectedSurface?.kind;
  if (operation.kind === "toolsmith") {
    return actionRoute("structured_toolsmith", 1, operation.kind, surface, "Research/artifact work is routed to the bounded Toolsmith workspace.");
  }
  if (operation.kind === "terminal") {
    return actionRoute("structured_terminal", 1, operation.kind, surface, "Local command work is routed through the terminal capability allowlist.");
  }
  if (operation.kind === "browser_chrome") {
    return actionRoute("browser_chrome_api", 3, operation.kind, surface, "Browser chrome state uses the Browser Chrome API before visual fallbacks.");
  }
  if (operation.kind === "screen_observe") {
    return actionRoute("screen_observe_roi_cascade", 8, operation.kind, surface, "Screen observation uses the ROI/cascade perception path.");
  }
  if (operation.kind === "ocr") {
    return actionRoute("roi_ocr", 8, operation.kind, surface, "OCR uses the bounded ROI/text recognition path.");
  }
  if (operation.kind === "native_browser_window_action") {
    return actionRoute("native_browser_window_helper", 6, operation.kind, surface, "Native browser-window helper is lower priority than structured browser APIs.");
  }
  if (operation.kind === "browser_permission_bubble_action") {
    return actionRoute("browser_permission_bubble_helper_v2", 7, operation.kind, surface, "Browser permission bubble native-click recovery requires signed watch-mode helper v2 and prompt verification.", {
      nativeHelperRequired: "signed_watch_mode_helper_v2",
      preferredFallback: "browser_chrome_permission_content_settings_api"
    });
  }
  if (operation.kind === "native_file_picker_action") {
    return actionRoute("native_file_picker_helper_v2", 7, operation.kind, surface, "Native file picker automation requires a signed helper v2 and explicit file-selection approval.", {
      nativeHelperRequired: "signed_file_picker_v2"
    });
  }
  if (operation.kind === "visual_desktop_action") {
    return actionRoute("foreground_visual_watch_mode", 7, operation.kind, surface, "Foreground visual action requires signed watch-mode guards before native input.");
  }
  const input = operation.input && typeof operation.input === "object" ? operation.input as Record<string, unknown> : {};
  const adapterId = typeof input.adapterId === "string" ? input.adapterId : undefined;
  const source = input.source && typeof input.source === "object" ? input.source as Record<string, unknown> : {};
  const sourceKind = typeof source.kind === "string" ? source.kind : undefined;
  const action = input.action && typeof input.action === "object" ? input.action as Record<string, unknown> : {};
  if (adapterId === "cdp") {
    return actionRoute("cdp_browser_action", 4, operation.kind, surface, "CDP command path is used after structured DOM routing when explicitly selected.", { adapterId, sourceKind });
  }
  if (adapterId === "playwright" || sourceKind === "controlled_browser" || surface === "isolated_browser") {
    return actionRoute("dom_playwright_locator", 2, operation.kind, surface, "Controlled browser DOM/Playwright action is preferred for isolated web content.", { adapterId, sourceKind });
  }
  if (sourceKind === "active_tab" || surface === "regular_browser_extension") {
    return actionRoute("extension_injected_dom", 5, operation.kind, surface, "Regular browser tasks use the extension-injected DOM path before native fallbacks.", { adapterId, sourceKind });
  }
  if (action.target && typeof action.target === "object") {
    return actionRoute("dom_selector", 2, operation.kind, surface, "Browser Action target includes structured target evidence.", { adapterId, sourceKind });
  }
  if (typeof action.x === "number" && typeof action.y === "number") {
    return actionRoute("coordinate_action", 7, operation.kind, surface, "Coordinate action is only a late fallback when structured targets are unavailable.", { adapterId, sourceKind });
  }
  return actionRoute("browser_action_auto", 5, operation.kind, surface, "Browser Action will resolve the safest available browser adapter.", { adapterId, sourceKind });
}

function actionRoute(
  executionMode: string,
  preferenceRank: number,
  operationKind: string,
  surface: string | undefined,
  reason: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: "computer-session-action-route.v1",
    operationKind,
    selectedSurface: surface,
    executionMode,
    preferenceRank,
    visualFallbackUsed: executionMode === "coordinate_action" || executionMode === "foreground_visual_watch_mode",
    reason,
    ...extra
  };
}

export function mapBrowserActionExecutorResultToDagStatus(result: BrowserActionExecutorResult): CapabilityDagNodeSummary["status"] {
  if (result.status === "completed") return "completed";
  if (result.status === "awaiting_approval" || result.status === "running") return "running";
  if (result.status === "cancelled") return "cancelled";
  return "failed";
}

export function createBrowserActionAdapterFallbackPlan(input: {
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
  session: ComputerSessionSummary;
  result: BrowserActionExecutorResult;
  actionRoute: Record<string, unknown>;
}): BrowserActionAdapterFallbackPlan | null {
  if (input.result.status !== "failed") {
    return null;
  }
  const operationInput = readUnknownRecord(input.operation.input);
  if (operationInput.disableAdapterFallback === true || operationInput.adapterFallbackAttempt === true) {
    return null;
  }
  if (!isRetryableBrowserActionAdapterFailure(input.result)) {
    return null;
  }
  if (isCredentialSensitiveBrowserAction(operationInput, input.session)) {
    return null;
  }
  const source = readUnknownRecord(operationInput.source);
  const sourceKind = typeof source.kind === "string" ? source.kind : undefined;
  const fromAdapter = typeof operationInput.adapterId === "string" ? operationInput.adapterId : undefined;
  if (fromAdapter === "playwright" && sourceKind === "controlled_browser") {
    return createBrowserActionAdapterFallbackOperation({
      operation: input.operation,
      session: input.session,
      fromActionRoute: input.actionRoute,
      fromAdapter,
      toAdapter: "cdp",
      reason: "Playwright Browser Action failed with a retryable adapter error; retrying once through the same controlled browser using CDP."
    });
  }
  if (fromAdapter !== "extension" && (sourceKind === "active_tab" || input.session.selectedSurface?.kind === "regular_browser_extension")) {
    return createBrowserActionAdapterFallbackOperation({
      operation: input.operation,
      session: input.session,
      fromActionRoute: input.actionRoute,
      fromAdapter,
      toAdapter: "extension",
      reason: "Browser Action failed with a retryable adapter error; retrying once through the extension-injected DOM path."
    });
  }
  return null;
}

function createBrowserActionAdapterFallbackOperation(input: {
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>;
  session: ComputerSessionSummary;
  fromActionRoute: Record<string, unknown>;
  fromAdapter?: string;
  toAdapter: string;
  reason: string;
}): BrowserActionAdapterFallbackPlan {
  const operationInput = readUnknownRecord(input.operation.input);
  const fallbackInput: Record<string, unknown> = {
    ...operationInput,
    adapterId: input.toAdapter,
    adapterFallbackAttempt: true,
    adapterFallbackFrom: input.fromAdapter ?? input.fromActionRoute.executionMode,
    adapterFallbackReason: input.reason
  };
  if (typeof fallbackInput.requestId === "string" && fallbackInput.requestId.trim()) {
    fallbackInput.requestId = `${fallbackInput.requestId.trim()}:adapter-fallback:${input.toAdapter}`;
  }
  const operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }> = {
    kind: "browser_action",
    input: fallbackInput
  };
  return {
    operation,
    actionRoute: {
      ...routeComputerOperation(operation, input.session),
      fallbackFrom: input.fromActionRoute,
      fallbackReason: input.reason
    },
    reason: input.reason,
    fromAdapter: input.fromAdapter,
    toAdapter: input.toAdapter
  };
}

function isRetryableBrowserActionAdapterFailure(result: BrowserActionExecutorResult): boolean {
  const haystack = JSON.stringify({
    error: result.error,
    summary: result.summary,
    output: result.output
  }).toLowerCase();
  if (/(restricted|credential|password|secret|token|permission[_\s-]*denied|approval|unsafe|policy|destructive|blocked_by_policy)/i.test(haystack)) {
    return false;
  }
  return true;
}

function isCredentialSensitiveBrowserAction(input: Record<string, unknown>, session: ComputerSessionSummary): boolean {
  if (session.riskClass === "credential_or_secret" || session.riskClass === "security_boundary") {
    return true;
  }
  const action = readUnknownRecord(input.action);
  const target = readUnknownRecord(action.target);
  const riskHints = Array.isArray(target.riskHints) ? target.riskHints : Array.isArray(action.riskHints) ? action.riskHints : [];
  if (riskHints.some((hint) => typeof hint === "string" && /credential|password|payment|auth|secret|token/i.test(hint))) {
    return true;
  }
  return /(password|passwd|token|cookie|credential|secret|api[_-]?key|payment|card|비밀번호|암호|결제)/i.test(JSON.stringify({ action, target }));
}
