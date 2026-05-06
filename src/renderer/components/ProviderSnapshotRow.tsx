import type { ProviderSnapshotSummary } from "../../shared/protocol.js";

export function ProviderSnapshotRow({ snapshot }: { snapshot: ProviderSnapshotSummary }) {
  return (
    <div className={`provider-history-row ${snapshot.provider}`}>
      <span>{formatActivityTime(snapshot.capturedAt)}</span>
      <div>
        <strong>{snapshot.title || providerSnapshotLabel(snapshot.provider)}</strong>
        <small>{snapshot.summary || providerSnapshotDetail(snapshot)}</small>
      </div>
      <em>{providerSnapshotLabel(snapshot.provider)}</em>
    </div>
  );
}

function providerSnapshotLabel(provider: ProviderSnapshotSummary["provider"]): string {
  if (provider === "vision") {
    return "Vision";
  }
  if (provider === "terminal") {
    return "PTY";
  }
  return "DOM";
}

function providerSnapshotDetail(snapshot: ProviderSnapshotSummary): string {
  const data = readRecord(snapshot.data);
  const url = typeof data?.url === "string" ? data.url : "";
  if (url) {
    return url;
  }
  const source = typeof data?.source === "string" ? data.source : "";
  if (source) {
    return source;
  }
  const tool = typeof data?.tool === "string" ? data.tool : "";
  return tool || "captured";
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
