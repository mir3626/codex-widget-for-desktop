import type { ClientMessage } from "../../../shared/protocol.js";
import { broadcastLedgerSnapshot } from "../clientEvents.js";
import { recordRuntimeActivity } from "../runtimeActivity.js";
import type { MessageRouterContext } from "./context.js";

export async function handleDebugFeedbackMessage(message: ClientMessage, context: MessageRouterContext): Promise<boolean> {
  if (message.type !== "debug.feedback.save") {
    return false;
  }

  const sessionId = message.sessionId || context.storage.ensureSessionSnapshot().activeSessionId;
  const reason = normalizeOptionalText(message.reason, 2000);
  const userText = normalizeOptionalText(message.userText, 4000);
  const assistantText = normalizeOptionalText(message.assistantText, 8000);
  recordRuntimeActivity(
    context.storage,
    sessionId,
    "warn",
    "debug-feedback",
    reason ? `Debug feedback: ${reason}` : "Debug feedback saved",
    {
      schemaVersion: "debug-feedback.v1",
      messageId: message.messageId,
      reason,
      userText,
      assistantText,
      mode: message.mode,
      tags: Array.isArray(message.tags) ? message.tags.slice(0, 12) : [],
      capturedAt: new Date().toISOString()
    }
  );
  broadcastLedgerSnapshot(context.clients, context.storage, sessionId);
  return true;
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, maxLength);
}
