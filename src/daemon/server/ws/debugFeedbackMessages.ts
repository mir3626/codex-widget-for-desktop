import type { ClientMessage } from "../../../shared/protocol.js";
import { extractTargetPhrase } from "../../browser-action/index.js";
import {
  isContentOpenRequest,
  readContentRequestTarget
} from "../../browser-action/intentResolver/contentRequests.js";
import type { SemanticMemoryScope } from "../../semantic-interface/index.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import type { MessageRouterContext } from "./context.js";

type DebugFeedbackOutcome = "success" | "failure" | "partial" | "ux_issue" | "unknown";

export async function handleDebugFeedbackMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  if (message.type !== "debug.feedback.save") {
    return false;
  }

  const sessionId = message.sessionId || context.storage.ensureSessionSnapshot().activeSessionId;
  const reason = normalizeOptionalText(message.reason, 2000);
  const userText = normalizeOptionalText(message.userText, 4000);
  const assistantText = normalizeOptionalText(message.assistantText, 8000);
  const outcome = classifyDebugFeedbackOutcome(reason, assistantText);
  recordRuntimeActivity(
    context.storage,
    sessionId,
    "warn",
    "debug-feedback",
    reason ? `Debug feedback: ${reason}` : "Debug feedback saved",
    {
      schemaVersion: "debug-feedback.v2",
      messageId: message.messageId,
      reason,
      userText,
      assistantText,
      outcome,
      mode: message.mode,
      tags: Array.isArray(message.tags) ? message.tags.slice(0, 12) : [],
      capturedAt: new Date().toISOString()
    }
  );
  recordDebugFeedbackSemanticCorrection({
    context,
    sessionId,
    message,
    reason,
    userText,
    assistantText,
    outcome
  });
  broadcastLedgerSnapshot(context.clients, context.storage, sessionId);
  return true;
}

function recordDebugFeedbackSemanticCorrection(input: {
  context: MessageRouterContext;
  sessionId: string;
  message: Extract<ClientMessage, { type: "debug.feedback.save" }>;
  reason?: string;
  userText?: string;
  assistantText?: string;
  outcome: DebugFeedbackOutcome;
}): void {
  if (!isManualBrowserDebugCorrection(input.message, input.reason, input.assistantText)) {
    return;
  }
  if (!shouldRecordDebugFeedbackSemanticCorrection(input.outcome)) {
    return;
  }
  const phrases = readDebugFeedbackPhrases(input.userText, input.assistantText);
  const rejectedTarget = readRejectedDebugTarget(input.assistantText);
  if (phrases.length === 0 || !rejectedTarget) {
    return;
  }
  const scope = readDebugFeedbackScope(input.assistantText);
  try {
    const eventIds: string[] = [];
    for (const phrase of phrases) {
      const event = input.context.semanticMemory.recordFeedbackEvent({
        source: "user_correction",
        surface: "browser_page",
        scope,
        utterance: input.userText ?? input.reason,
        redactedUtterance: input.reason ?? input.userText,
        payload: {
          phrase,
          rejectedTarget,
          safetyClass: "safe_action"
        }
      });
      eventIds.push(event.id);
    }
    recordRuntimeActivity(
      input.context.storage,
      input.sessionId,
      "info",
      "semantic-memory",
      "Debug feedback recorded as semantic correction",
      {
        messageId: input.message.messageId,
        source: "debug-feedback",
        eventIds,
        phraseCount: phrases.length,
        scope,
        rejectedTarget
      }
    );
  } catch {
    // Debug feedback must remain available even if advisory semantic memory is unavailable.
  }
}

export function classifyDebugFeedbackOutcome(reason: string | undefined, assistantText: string | undefined): DebugFeedbackOutcome {
  const reasonText = normalizeOptionalText(reason, 2000) ?? "";
  const combinedText = `${reasonText} ${normalizeOptionalText(assistantText, 2000) ?? ""}`;
  const successPattern = /(정상적으로\s*동작|완전한\s*성공|최종적으로는?.{0,40}성공|결과적으로.{0,40}성공|success|succeeded|worked)/i;
  const uxPattern = /(fallback|폴백|과다|정확|background|백그라운드|직접\s*마우스|개선|느림|지연|UX|사용성)/i;
  const partialPattern = /(부분|partial|의도는\s*파악|fallback|폴백)/i;
  const failurePattern = /((?:polling|pooling)\s*실패|동작\s*수행\s*실패|실패|failed|not\s+work|안\s*됨|못\s*함|잘못|엉뚱|가버림|달라고\s*했는데|했는데.*(?:누름|열림|이동)|대신|다른\s*(?:페이지|탭|대상)|wrong)/i;

  if (successPattern.test(reasonText)) {
    return uxPattern.test(reasonText) ? "ux_issue" : "success";
  }
  if (failurePattern.test(reasonText) && partialPattern.test(reasonText)) {
    return "partial";
  }
  if (failurePattern.test(reasonText)) {
    return "failure";
  }
  if (partialPattern.test(reasonText) && failurePattern.test(combinedText)) {
    return "partial";
  }
  if (uxPattern.test(reasonText)) {
    return "ux_issue";
  }
  if (failurePattern.test(combinedText) && !successPattern.test(combinedText)) {
    return "failure";
  }
  return "unknown";
}

function shouldRecordDebugFeedbackSemanticCorrection(outcome: DebugFeedbackOutcome): boolean {
  return outcome === "failure" || outcome === "partial";
}

function isManualBrowserDebugCorrection(
  message: Extract<ClientMessage, { type: "debug.feedback.save" }>,
  reason: string | undefined,
  assistantText: string | undefined
): boolean {
  const tags = new Set((message.tags ?? []).map((tag) => tag.toLowerCase()));
  const browserMode = message.mode === "browser";
  const manualDebug = tags.has("manual-debug");
  const browserActionOutput = /(Browser Action|브라우저\s*동작|브라우저\s*액션|실행:|검증:)/i.test(assistantText ?? "");
  return browserMode && manualDebug && Boolean(reason?.trim()) && browserActionOutput;
}

function readDebugFeedbackPhrases(userText: string | undefined, assistantText: string | undefined): string[] {
  const phrases = new Set<string>();
  const add = (value: string | undefined) => {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (normalized) {
      phrases.add(normalized.slice(0, 160));
    }
  };
  add(userText);
  add(userText ? extractTargetPhrase(userText) : undefined);
  add(userText && isContentOpenRequest(userText) ? readContentRequestTarget(userText) : undefined);
  add(readExecutedTargetPhrase(assistantText));
  return [...phrases].slice(0, 4);
}

function readExecutedTargetPhrase(assistantText: string | undefined): string | undefined {
  const match = assistantText?.match(/실행:\s*(?:click|select|check|type)\s+(.{1,120}?)(?:\s+현재 페이지:|\s+검증:|$)/i);
  return match?.[1]
    ?.replace(/^(?:link|button|textbox|input)\s*:\s*/i, "")
    .replace(/^(?:link|button|textbox|input)\s+/i, "")
    .trim();
}

function readRejectedDebugTarget(assistantText: string | undefined): string | undefined {
  const currentPage = assistantText?.match(/현재 페이지:\s*([^()]{1,180}?)\s*\((https?:\/\/[^)\s]+)\)/i);
  if (currentPage?.[2]) {
    return `${currentPage[1]?.trim() ?? ""} ${currentPage[2]}`.trim();
  }
  const url = assistantText?.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (url) {
    return url;
  }
  return readExecutedTargetPhrase(assistantText);
}

function readDebugFeedbackScope(assistantText: string | undefined): SemanticMemoryScope {
  const scope: SemanticMemoryScope = { surface: "browser_page" };
  const url = assistantText?.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (!url) {
    return scope;
  }
  try {
    const parsed = new URL(url);
    if (parsed.origin && parsed.origin !== "null") {
      scope.origin = parsed.origin;
    }
  } catch {
    // Leave the correction page-surface scoped when the pasted URL is malformed.
  }
  return scope;
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, maxLength);
}
