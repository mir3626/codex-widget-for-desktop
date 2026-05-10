import { useState } from "react";

export type SemanticMemoryReportView = {
  nodeCount: number;
  edgeCount: number;
  unresolvedCount: number;
  feedbackCount: number;
  topEdges: unknown[];
  generatedAt: string;
};

export function useSemanticMemoryControls(input: {
  daemonPort: number | string;
  appendLog(text: string, tone: "tool" | "error" | "muted"): void;
}) {
  const [semanticMemoryEnabled, setSemanticMemoryEnabled] = useState(true);
  const [semanticMemoryReport, setSemanticMemoryReport] = useState<SemanticMemoryReportView | null>(null);
  const [semanticMemoryStatus, setSemanticMemoryStatus] = useState("Not loaded");

  async function refreshSemanticMemory() {
    try {
      const [settingsResponse, reportResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${input.daemonPort}/semantic-memory/settings`),
        fetch(`http://127.0.0.1:${input.daemonPort}/semantic-memory/report`)
      ]);
      const settingsPayload = await settingsResponse.json();
      const reportPayload = await reportResponse.json();
      if (!settingsResponse.ok || !reportResponse.ok || !settingsPayload.ok || !reportPayload.ok) {
        throw new Error("Semantic memory unavailable");
      }
      setSemanticMemoryEnabled(Boolean(settingsPayload.settings?.enabled));
      setSemanticMemoryReport(normalizeSemanticMemoryReport(reportPayload.report));
      setSemanticMemoryStatus("Ready");
    } catch {
      setSemanticMemoryStatus("Unavailable");
    }
  }

  async function updateSemanticMemoryEnabled(enabled: boolean) {
    setSemanticMemoryEnabled(enabled);
    try {
      const response = await fetch(`http://127.0.0.1:${input.daemonPort}/semantic-memory/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error("Semantic memory settings update failed");
      }
      setSemanticMemoryEnabled(Boolean(payload.settings?.enabled));
      setSemanticMemoryStatus(Boolean(payload.settings?.enabled) ? "Enabled" : "Disabled");
      input.appendLog(Boolean(payload.settings?.enabled) ? "semantic memory enabled" : "semantic memory disabled", "tool");
    } catch {
      setSemanticMemoryEnabled(!enabled);
      setSemanticMemoryStatus("Update failed");
      input.appendLog("semantic memory settings failed", "error");
    }
  }

  async function clearSemanticMemory() {
    try {
      const response = await fetch(`http://127.0.0.1:${input.daemonPort}/semantic-memory/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { global: true } })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error("Semantic memory reset failed");
      }
      setSemanticMemoryReport(normalizeSemanticMemoryReport(payload.report));
      setSemanticMemoryStatus("Cleared");
      input.appendLog("semantic memory cleared", "tool");
    } catch {
      setSemanticMemoryStatus("Clear failed");
      input.appendLog("semantic memory reset failed", "error");
    }
  }

  return {
    semanticMemoryEnabled,
    semanticMemoryReport,
    semanticMemoryStatus,
    refreshSemanticMemory,
    updateSemanticMemoryEnabled,
    clearSemanticMemory
  };
}

function normalizeSemanticMemoryReport(value: unknown): SemanticMemoryReportView {
  const record = value && typeof value === "object" ? value as Partial<SemanticMemoryReportView> : {};
  return {
    nodeCount: Number(record.nodeCount ?? 0),
    edgeCount: Number(record.edgeCount ?? 0),
    unresolvedCount: Number(record.unresolvedCount ?? 0),
    feedbackCount: Number(record.feedbackCount ?? 0),
    topEdges: Array.isArray(record.topEdges) ? record.topEdges : [],
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : new Date().toISOString()
  };
}
