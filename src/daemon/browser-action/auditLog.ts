import { randomUUID } from "node:crypto";
import type { BrowserActionAuditEntry, BrowserActionResult, BrowserActionSession, BrowserObservation } from "./types.js";

export function auditObservation(session: BrowserActionSession, observation: BrowserObservation): BrowserActionAuditEntry {
  return {
    id: `browser-audit-${randomUUID()}`,
    actionSessionId: session.id,
    sessionId: session.sessionId,
    createdAt: new Date().toISOString(),
    level: "info",
    category: "observe",
    summary: "Browser observation captured",
    detail: {
      url: observation.url,
      title: observation.title,
      elements: observation.elements.length,
      textLength: observation.text?.length ?? 0,
      selectionLength: observation.selection?.length ?? 0
    }
  };
}

export function auditActionResult(session: BrowserActionSession, result: BrowserActionResult): BrowserActionAuditEntry {
  return {
    id: `browser-audit-${randomUUID()}`,
    actionSessionId: session.id,
    sessionId: session.sessionId,
    createdAt: new Date().toISOString(),
    level: result.status === "failed" ? "error" : result.status === "needs_approval" || result.status === "needs_clarification" ? "warn" : "info",
    category: result.status === "needs_approval" ? "approval" : result.status === "pending" ? "execute" : "verify",
    summary: `Browser action ${result.status}: ${result.action.type}`,
    detail: {
      action: result.action.type,
      target: result.safety.targetSummary,
      safety: sanitizeSafetyForAudit(result.safety),
      verification: result.verification,
      error: result.error
    }
  };
}

function sanitizeSafetyForAudit(safety: BrowserActionResult["safety"]): BrowserActionResult["safety"] {
  const metadata = { ...(safety.metadata ?? {}) };
  delete metadata.codePreview;
  return {
    ...safety,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  };
}
