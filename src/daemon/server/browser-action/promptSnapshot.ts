import { broadcastLedgerSnapshot } from "../clientEvents.js";
import {
  readBrowserBridgeSnapshotMismatch,
  waitForFreshBrowserBridgeSnapshot
} from "../browser-bridge/snapshotWait.js";
import { readHostLabel } from "./presentation.js";
import type { BrowserActionPromptInput } from "./promptTypes.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import type { PreparedBrowserViewContext } from "../../browser-perception/types.js";
import type { BrowserAction } from "../../browser-action/types.js";

export async function readFreshPromptBrowserSnapshot(input: BrowserActionPromptInput, requestStartedAt: Date): Promise<{
  snapshot?: unknown;
  context?: PreparedBrowserViewContext;
  handled: boolean;
}>;
export async function readFreshPromptBrowserSnapshot(input: BrowserActionPromptInput, requestStartedAt: Date, firstAction?: BrowserAction): Promise<{
  snapshot?: unknown;
  context?: PreparedBrowserViewContext;
  handled: boolean;
}>;
export async function readFreshPromptBrowserSnapshot(input: BrowserActionPromptInput, requestStartedAt: Date, firstAction?: BrowserAction): Promise<{
  snapshot?: unknown;
  context?: PreparedBrowserViewContext;
  handled: boolean;
}> {
  const promptRisk = readPromptActionRisk(input.message.text, firstAction);
  const isFastNavigation = promptRisk === "safe_navigation";
  const minCapturedAt = isFastNavigation || promptRisk === "read" ? undefined : requestStartedAt;
  const timeoutMs = promptRisk === "read" ? 12_000 : isFastNavigation ? 3_500 : 35_000;
  const context = await input.browserPerception.ensureFreshContext({
    providers: input.providers,
    bridgeStatus: input.browserExtensionBridge.snapshot(),
    request: {
      requestId: input.message.id,
      reason: "prompt",
      requiredFreshness: isFastNavigation ? "any_visible" : "stable",
      actionRisk: promptRisk,
      allowSettlingForRead: promptRisk === "read" || isFastNavigation,
      minCapturedAt,
      maxAgeMs: promptRisk === "read" ? 3_000 : isFastNavigation ? 30_000 : 10_000,
      timeoutMs,
      settleQuietMs: isFastNavigation ? 0 : 500
    },
    onProgress: (detail) => {
      input.emit({
        type: "browserAction.progress",
        actionSessionId: `browser-action-prompt-${input.message.id}`,
        status: "browser_perception_waiting",
        detail
      });
    }
  });
  if (context.context) {
    recordRuntimeActivity(input.storage, input.sessionId, "info", "browser-action", "Using Browser Perception context for prompt Browser Action", {
      status: context.status,
      viewRevision: context.context.viewRevision,
      routeKey: context.context.routeKey,
      freshness: context.context.freshness,
      stability: context.context.stability
    });
    return { snapshot: context.context.snapshot, context: context.context, handled: false };
  }

  if (context.status !== "timeout") {
    completePromptWithPerceptionFailure(input, context.status, context.userRecovery, context.diagnostics);
    return { handled: true };
  }

  const snapshot = await waitForFreshBrowserBridgeSnapshot({
    providers: input.providers,
    browserExtensionBridge: input.browserExtensionBridge,
    storage: input.storage,
    sessionId: input.sessionId,
    minCapturedAt,
    timeoutMs
  });
  const staleSnapshot = readBrowserBridgeSnapshotMismatch(input.browserExtensionBridge.snapshot(), snapshot, requestStartedAt);
  if (!staleSnapshot) {
    return { snapshot, handled: false };
  }

  const korean = /[가-힣]/.test(input.message.text);
  recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Browser Perception timed out before fresh active-tab observation", {
    perceptionStatus: context.status,
    diagnostics: context.diagnostics,
    staleSnapshot
  });
  input.emit({
    type: "message.completed",
    id: input.message.id,
    text: korean
      ? `현재 활성 탭 관찰이 제한 시간 안에 완료되지 않았습니다. Browser Bridge 연결과 사이트 권한을 확인해 주세요. 대상: ${readHostLabel(staleSnapshot.expectedUrl) || staleSnapshot.expectedUrl}`
      : `The current active-tab observation did not finish before the timeout. Check Browser Bridge connection and site permission for ${readHostLabel(staleSnapshot.expectedUrl) || staleSnapshot.expectedUrl}.`
  });
  input.emit({ type: "session.state", state: "idle", id: input.message.id });
  broadcastLedgerSnapshot(input.clients, input.storage, input.sessionId);
  return { snapshot, handled: true };
}

function completePromptWithPerceptionFailure(
  input: BrowserActionPromptInput,
  status: string,
  userRecovery: string | undefined,
  diagnostics: Record<string, unknown>
): void {
  const korean = /[가-힣]/.test(input.message.text);
  recordRuntimeActivity(input.storage, input.sessionId, "warn", "browser-action", "Browser Perception could not prepare active-tab context", {
    status,
    diagnostics,
    userRecovery
  });
  const text = korean
    ? readKoreanPerceptionFailure(status, userRecovery)
    : readEnglishPerceptionFailure(status, userRecovery);
  input.emit({ type: "message.completed", id: input.message.id, text });
  input.emit({ type: "session.state", state: "idle", id: input.message.id });
  broadcastLedgerSnapshot(input.clients, input.storage, input.sessionId);
}

function readKoreanPerceptionFailure(status: string, userRecovery: string | undefined): string {
  if (status === "permission_required") {
    return `현재 사이트 권한이 필요합니다. ${userRecovery ?? "Browser Bridge 팝업에서 현재 사이트를 허용해 주세요."}`;
  }
  if (status === "restricted_page") {
    return `이 페이지는 브라우저 보안 정책 때문에 Browser Bridge가 읽을 수 없습니다. ${userRecovery ?? ""}`.trim();
  }
  if (status === "disconnected") {
    return `Browser Bridge가 연결되어 있지 않습니다. ${userRecovery ?? "확장프로그램의 daemon URL과 auto-connect 설정을 확인해 주세요."}`;
  }
  return `현재 브라우저 페이지를 읽을 수 없습니다. ${userRecovery ?? "Browser Bridge 상태를 확인해 주세요."}`;
}

function readEnglishPerceptionFailure(status: string, userRecovery: string | undefined): string {
  if (status === "permission_required") {
    return `The current site needs Browser Bridge permission. ${userRecovery ?? "Allow the site from the Browser Bridge popup."}`;
  }
  if (status === "restricted_page") {
    return `Browser Bridge cannot read this page because the browser restricts extension access. ${userRecovery ?? ""}`.trim();
  }
  if (status === "disconnected") {
    return `Browser Bridge is disconnected. ${userRecovery ?? "Check the extension daemon URL and auto-connect setting."}`;
  }
  return `Browser Bridge could not read the current page. ${userRecovery ?? "Check Browser Bridge status."}`;
}

function readPromptActionRisk(text: string, firstAction?: BrowserAction): "read" | "safe_navigation" | "side_effect" {
  if (firstAction && isTargetlessNavigationAction(firstAction)) {
    return "safe_navigation";
  }
  return isLikelyReadPrompt(text) ? "read" : "side_effect";
}

function isTargetlessNavigationAction(action: BrowserAction): boolean {
  return action.type === "navigate" || action.type === "back" || action.type === "forward" || action.type === "reload";
}

function isLikelyReadPrompt(text: string): boolean {
  return /읽|설명|요약|보여|찾아|what|read|show|summar/i.test(text) &&
    !/(누르|클릭|입력|작성|선택|이동|검색|click|type|select|navigate|search)/i.test(text);
}
