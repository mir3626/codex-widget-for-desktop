import { randomUUID } from "node:crypto";
import type { BrowserActionDirectCommandInput } from "../../shared/protocol.js";
import type { BrowserAction, BrowserActionPlan, BrowserActionPlanStep, ElementTarget } from "./types.js";

export function isBrowserActionDirectExecutionCommand(command: BrowserActionDirectCommandInput): boolean {
  return command.kind !== "adapter_status" && command.kind !== "observe";
}

export function buildBrowserActionPlanFromCommand(input: {
  actionSessionId: string;
  command: BrowserActionDirectCommandInput;
}): BrowserActionPlan {
  const actions = buildBrowserActionsFromCommand(input.command);
  const now = new Date().toISOString();
  return {
    id: input.command.id?.trim() || `browser-direct-plan-${randomUUID()}`,
    actionSessionId: input.actionSessionId,
    createdAt: now,
    goal: describeCommandGoal(input.command),
    adapterId: input.command.adapterId?.trim() || undefined,
    status: "proposed",
    confidence: 0.88,
    steps: actions.map((action, index): BrowserActionPlanStep => ({
      id: `direct-${index + 1}`,
      action,
      targetSummary: summarizeDirectTarget(action),
      reason: describeDirectAction(action, input.command.kind),
      expected: expectedStateForDirectAction(action),
      status: "pending"
    }))
  };
}

function buildBrowserActionsFromCommand(command: BrowserActionDirectCommandInput): BrowserAction[] {
  if (command.kind === "read") {
    return [{ type: "read", reason: "Direct UI read request." }];
  }
  if (command.kind === "click") {
    return [{ type: "click", target: readTarget(command, "button") }];
  }
  if (command.kind === "type") {
    const text = requireText(command.text, "Type/fill command requires text.");
    return [{ type: "type", target: readTarget(command, "input"), text, clearFirst: true, submit: false }];
  }
  if (command.kind === "search") {
    const text = requireText(command.text, "Search command requires text.");
    return [
      { type: "type", target: readTarget(command, "search", "searchbox"), text, clearFirst: true, submit: false },
      { type: "click", target: { kind: "text", role: "button", text: command.targetText?.trim() || "search" } }
    ];
  }
  if (command.kind === "scroll") {
    return [{
      type: "scroll",
      direction: command.direction ?? "down",
      amount: normalizeScrollAmount(command.amount),
      target: command.target
    }];
  }
  if (command.kind === "navigate") {
    return [{ type: "navigate", url: normalizeUrl(requireText(command.url, "Navigate command requires a URL.")) }];
  }
  if (command.kind === "back") {
    return [{ type: "back" }];
  }
  if (command.kind === "forward") {
    return [{ type: "forward" }];
  }
  if (command.kind === "reload") {
    return [{ type: "reload" }];
  }
  if (command.kind === "screenshot") {
    return [{ type: "screenshot", fullPage: Boolean(command.fullPage) }];
  }
  throw new Error(`Browser Action command cannot be executed as a plan: ${command.kind}`);
}

function readTarget(command: BrowserActionDirectCommandInput, fallbackText: string, role?: string): ElementTarget {
  if (command.target) {
    return command.target as ElementTarget;
  }
  const text = command.targetText?.trim() || fallbackText;
  return role ? { kind: "text", role, text } : { kind: "text", text };
}

function normalizeScrollAmount(amount: BrowserActionDirectCommandInput["amount"]): "small" | "medium" | "large" | number {
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return Math.max(1, Math.min(Math.floor(amount), 6000));
  }
  if (amount === "small" || amount === "large") {
    return amount;
  }
  return "medium";
}

function requireText(value: string | undefined, message: string): string {
  const text = value?.trim();
  if (!text) {
    throw new Error(message);
  }
  return text.slice(0, 1000);
}

function normalizeUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }
  return value;
}

function describeCommandGoal(command: BrowserActionDirectCommandInput): string {
  const adapter = command.adapterId ? ` via ${command.adapterId}` : "";
  if (command.kind === "type") {
    return `Direct UI type/fill${adapter}`;
  }
  if (command.kind === "search") {
    return `Direct UI search${adapter}`;
  }
  if (command.kind === "navigate") {
    return `Direct UI navigate${adapter}`;
  }
  return `Direct UI ${command.kind.replace(/_/g, " ")}${adapter}`;
}

function describeDirectAction(action: BrowserAction, kind: BrowserActionDirectCommandInput["kind"]): string {
  if (kind === "search") {
    return "Direct UI search step.";
  }
  if (action.type === "type") {
    return "Direct UI type/fill request with secret redaction handled by Browser Action policy.";
  }
  if (action.type === "click") {
    return "Direct UI click request after target resolution and safety policy.";
  }
  return `Direct UI ${action.type} request.`;
}

function summarizeDirectTarget(action: BrowserAction): string | undefined {
  if (!("target" in action) || !action.target) {
    return undefined;
  }
  if (action.target.kind === "text") {
    return action.target.role ? `${action.target.role}: ${action.target.text}` : action.target.text;
  }
  if (action.target.kind === "element_id") {
    return action.target.id;
  }
  if (action.target.kind === "selector") {
    return action.target.selector;
  }
  return action.target.kind;
}

function expectedStateForDirectAction(action: BrowserAction) {
  if (action.type === "navigate") {
    return [{ type: "url_contains" as const, value: action.url }];
  }
  if (action.type === "type") {
    return [{ type: "element_state" as const, target: action.target, state: { value: action.text } }];
  }
  if (action.type === "click") {
    return [{ type: "custom" as const, description: "Target activation is visible after click." }];
  }
  if (action.type === "screenshot") {
    return [{ type: "custom" as const, description: "Screenshot evidence is returned by the selected adapter." }];
  }
  return undefined;
}
