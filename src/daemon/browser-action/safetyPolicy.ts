import { summarizeBrowserElement } from "./browserObservation.js";
import { inspectEvaluateCode } from "./evaluatePolicy.js";
import type { BrowserAction, BrowserActionMode, BrowserElement, BrowserActionSafetyDecision } from "./types.js";

export function decideBrowserActionSafety(input: {
  action: BrowserAction;
  target?: BrowserElement;
  targetConfidence: number;
  mode: BrowserActionMode;
}): BrowserActionSafetyDecision {
  const actionLabel = labelAction(input.action);
  if (input.action.type === "evaluate") {
    const guard = inspectEvaluateCode(input.action);
    if (input.mode !== "full_control_dev") {
      return {
        decision: "block",
        risk: "high",
        reason: "Evaluate is only available in explicit full_control_dev mode.",
        actionLabel,
        targetSummary: summarizeBrowserElement(input.target),
        destructive: true,
        metadata: { codeHash: guard.codeHash }
      };
    }
    if (!guard.ok) {
      return {
        decision: "block",
        risk: "high",
        reason: guard.reason,
        actionLabel,
        targetSummary: summarizeBrowserElement(input.target),
        destructive: true,
        metadata: {
          codeHash: guard.codeHash,
          timeoutMs: guard.timeoutMs,
          resultLimitBytes: guard.resultLimitBytes
        }
      };
    }
    return {
      decision: "confirm",
      risk: "high",
      reason: "full_control_dev evaluate requires visible approval with code preview before execution.",
      actionLabel,
      targetSummary: summarizeBrowserElement(input.target),
      destructive: true,
      metadata: {
        codeHash: guard.codeHash,
        timeoutMs: guard.timeoutMs,
        resultLimitBytes: guard.resultLimitBytes,
        codePreview: guard.preview
      }
    };
  }
  if (input.mode === "read_only" && input.action.type !== "read" && input.action.type !== "screenshot") {
    return {
      decision: "block",
      risk: "medium",
      reason: "Browser Action is in read-only mode.",
      actionLabel,
      targetSummary: summarizeBrowserElement(input.target),
      destructive: false
    };
  }
  const destructive = isDestructiveBrowserAction(input.action, input.target);
  const sensitive = Boolean(input.target?.riskHints.some((hint) => ["password", "payment", "delete", "submit", "file_upload", "download", "auth"].includes(hint)));
  if (requiresResolvedElement(input.action) && input.targetConfidence < 0.75) {
    return {
      decision: "clarify",
      risk: destructive || sensitive ? "high" : "medium",
      reason: "The action needs a specific browser element but the target is not resolved confidently.",
      actionLabel,
      targetSummary: summarizeBrowserElement(input.target),
      destructive: destructive || sensitive
    };
  }
  if ((destructive || sensitive) && input.targetConfidence < 0.75) {
    return {
      decision: "clarify",
      risk: "high",
      reason: "The action has side effects but the target is not resolved confidently.",
      actionLabel,
      targetSummary: summarizeBrowserElement(input.target),
      destructive: true
    };
  }
  if (destructive || sensitive || requiresConfirmation(input.action)) {
    return {
      decision: input.mode === "full_control_dev" ? "allow" : "confirm",
      risk: destructive || sensitive ? "high" : "medium",
      reason: "This browser action can submit, modify, navigate, upload, download, or expose sensitive state.",
      actionLabel,
      targetSummary: summarizeBrowserElement(input.target),
      destructive: destructive || sensitive
    };
  }
  if (input.mode === "ask_before_action" && input.action.type !== "read" && input.action.type !== "screenshot") {
    return {
      decision: "confirm",
      risk: "low",
      reason: "Browser Action is configured to ask before non-read actions.",
      actionLabel,
      targetSummary: summarizeBrowserElement(input.target),
      destructive: false
    };
  }
  return {
    decision: "allow",
    risk: "low",
    reason: "This browser action is low risk under the current policy.",
    actionLabel,
    targetSummary: summarizeBrowserElement(input.target),
    destructive: false
  };
}

export function isDestructiveBrowserAction(action: BrowserAction, target?: BrowserElement): boolean {
  const text = `${labelAction(action)} ${target?.label ?? ""} ${target?.text ?? ""} ${target?.href ?? ""}`.toLowerCase();
  if (target?.riskHints.some((hint) => ["delete", "payment", "submit", "file_upload", "download", "auth"].includes(hint))) {
    return true;
  }
  if (action.type === "type" && action.submit) {
    return true;
  }
  if (action.type === "navigate") {
    return /checkout|payment|logout|delete|remove|결제|삭제/.test(action.url.toLowerCase());
  }
  return /(delete|remove|archive|submit|send|post|publish|purchase|pay|checkout|logout|삭제|제거|보내|게시|결제|구매|제출)/i.test(text);
}

function requiresConfirmation(action: BrowserAction): boolean {
  return action.type === "hotkey" || action.type === "navigate" || action.type === "check" || action.type === "select" || action.type === "evaluate";
}

function requiresResolvedElement(action: BrowserAction): boolean {
  return action.type === "click" || action.type === "type" || action.type === "select" || action.type === "check" || action.type === "evaluate" && Boolean(action.target);
}

function labelAction(action: BrowserAction): string {
  if (action.type === "type") {
    return `type ${action.text.length} chars`;
  }
  if (action.type === "navigate") {
    return `navigate ${action.url}`;
  }
  if (action.type === "evaluate") {
    return `evaluate ${action.code.length} chars`;
  }
  return action.type;
}
