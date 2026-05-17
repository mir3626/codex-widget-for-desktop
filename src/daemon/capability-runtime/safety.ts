import { randomUUID } from "node:crypto";
import type { CapabilityRuntimeEnqueueInput } from "./types.js";

export type CapabilitySafetyDecision = {
  requiresApproval: boolean;
  approvalId?: string;
  reason: string;
};

export function decideCapabilitySafety(input: CapabilityRuntimeEnqueueInput): CapabilitySafetyDecision {
  if (input.requireApproval === false) {
    return {
      requiresApproval: false,
      reason: "caller_preapproved"
    };
  }

  if (input.requireApproval) {
    return {
      requiresApproval: true,
      approvalId: input.approvalId ?? `approval:${input.id ?? input.transactionId ?? randomUUID()}`,
      reason: "caller_requested_approval"
    };
  }

  if (input.kind === "screen_observe" || input.kind === "ocr") {
    return { requiresApproval: false, reason: "read_only_capability" };
  }

  if (input.kind === "desktop_action") {
    return isDesktopObserve(input.input)
      ? { requiresApproval: false, reason: "desktop_observe" }
      : {
          requiresApproval: true,
          approvalId: input.approvalId ?? `approval:${input.id ?? input.transactionId ?? randomUUID()}`,
          reason: "desktop_side_effect"
        };
  }

  if (input.kind === "browser_action") {
    return isBrowserReadOnly(input.input)
      ? { requiresApproval: false, reason: "browser_read_only" }
      : {
          requiresApproval: true,
          approvalId: input.approvalId ?? `approval:${input.id ?? input.transactionId ?? randomUUID()}`,
          reason: "browser_side_effect"
        };
  }

  if (input.kind === "browser_chrome") {
    return isBrowserChromeReadOnly(input.input)
      ? { requiresApproval: false, reason: "browser_chrome_read_only" }
      : {
          requiresApproval: true,
          approvalId: input.approvalId ?? `approval:${input.id ?? input.transactionId ?? randomUUID()}`,
          reason: readBrowserChromeApprovalReason(input.input)
        };
  }

  return {
    requiresApproval: true,
    approvalId: input.approvalId ?? `approval:${input.id ?? input.transactionId ?? randomUUID()}`,
    reason: `${input.kind}_requires_approval`
  };
}

function isBrowserChromeReadOnly(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return true;
  }
  const command = (input as Record<string, unknown>).command;
  return command === undefined ||
    command === "tab.list" ||
    command === "bookmark.list" ||
    command === "tab_group.list" ||
    command === "download.search" ||
    command === "download.observe" ||
    command === "download.verify" ||
    command === "permission.get";
}

function readBrowserChromeApprovalReason(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "browser_chrome_side_effect";
  }
  const command = (input as Record<string, unknown>).command;
  if (typeof command === "string" && (command.startsWith("history.") || command.startsWith("debugger.") || command.startsWith("file_upload.") || command.startsWith("permission."))) {
    return "browser_chrome_high_risk_one_time";
  }
  return "browser_chrome_side_effect";
}

function isDesktopObserve(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return true;
  }
  const record = input as Record<string, unknown>;
  const command = record.command;
  return (command === undefined && record.action === undefined) || command === "status" || command === "observe";
}

function isBrowserReadOnly(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return true;
  }
  const record = input as Record<string, unknown>;
  const action = record.action && typeof record.action === "object"
    ? record.action as Record<string, unknown>
    : record;
  return action.type === undefined || action.type === "read" || action.type === "screenshot";
}
