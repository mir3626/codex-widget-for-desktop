import type { ComputerSessionDebugBundle } from "../../../shared/protocol.js";
import { formatActivityTime } from "../../utils/format";

export function summarizeFailureMemory(record: ComputerSessionDebugBundle["failureMemory"][number]): string {
  return record.calibration.recoveryHints?.[0] ??
    record.calibration.abstentionTriggers?.[0] ??
    record.provenance.source ??
    shortId(record.id);
}

export function summarizeVerifierAudit(audit: NonNullable<ComputerSessionDebugBundle["verifierAudit"]>["audits"][number]): string {
  return audit.capabilityJobId
    ? `${shortId(audit.capabilityJobId)} · ${audit.reason}`
    : audit.reason;
}

export function verifierAuditTone(auditClass: string): string {
  if (auditClass === "consistent_pass") return "ok";
  if (auditClass === "false_positive_candidate" || auditClass === "missing_verifier_evidence") return "error";
  if (auditClass === "false_negative_record" || auditClass === "inconclusive_verifier") return "warn";
  return "active";
}

type ToolsmithSourceRow = {
  title?: string;
  url?: string;
  status?: string;
  browserFallback?: boolean;
  fallbackReason?: string;
  chars?: number;
  excerpt?: string;
};

type ObservationPreviewPair = {
  key: string;
  source: string;
  actionType: string;
  targetSummary?: string;
  capabilityJobId?: string;
  before?: ComputerSessionDebugBundle["observations"][number];
  after?: ComputerSessionDebugBundle["observations"][number];
};

export function collectObservationPreviewPairs(observations: ComputerSessionDebugBundle["observations"]): ObservationPreviewPair[] {
  const groups = new Map<string, ObservationPreviewPair>();
  for (const observation of observations) {
    const metadata = readRecord(observation.metadata);
    const phase = readString(metadata.observationPhase);
    if (phase !== "pre_action" && phase !== "post_action") {
      continue;
    }
    const key = observation.dagNodeId ?? observation.capabilityJobId ?? observation.id;
    const existing = groups.get(key) ?? {
      key,
      source: observation.source,
      actionType: readString(metadata.action) ?? "action",
      targetSummary: readObservationTargetSummary(metadata),
      capabilityJobId: observation.capabilityJobId
    };
    if (phase === "pre_action") {
      existing.before = observation;
    } else {
      existing.after = observation;
    }
    existing.source = observation.source;
    existing.actionType = readString(metadata.action) ?? existing.actionType;
    existing.targetSummary = existing.targetSummary ?? readObservationTargetSummary(metadata);
    existing.capabilityJobId = existing.capabilityJobId ?? observation.capabilityJobId;
    groups.set(key, existing);
  }
  return [...groups.values()]
    .sort((left, right) => Date.parse((right.after ?? right.before)?.capturedAt ?? "") - Date.parse((left.after ?? left.before)?.capturedAt ?? ""));
}

export function readObservationTargetSummary(metadata: Record<string, unknown>): string | undefined {
  const targetEvidence = readRecord(metadata.targetEvidence);
  const target = readRecord(targetEvidence.target);
  const candidates = [
    readString(metadata.targetSummary),
    readString(target.label),
    readString(target.role),
    readString(targetEvidence.elementId),
    readString(metadata.label),
    readString(metadata.url),
    readString(metadata.title)
  ];
  return candidates.find((candidate) => candidate && candidate.length > 0);
}

export function summarizeObservationPreview(observation: ComputerSessionDebugBundle["observations"][number]): string {
  const metadata = readRecord(observation.metadata);
  const title = readString(metadata.title);
  const url = readString(metadata.url);
  const elementCount = typeof metadata.elementCount === "number" ? `${metadata.elementCount} elements` : undefined;
  const graphCount = typeof metadata.perceptionGraphNodeCount === "number" ? `${metadata.perceptionGraphNodeCount} graph nodes` : undefined;
  return [title, url, elementCount, graphCount].filter((part): part is string => Boolean(part)).join(" · ") ||
    observation.summary ||
    formatActivityTime(observation.capturedAt);
}

export function formatObservationPreviewMeta(metadata: Record<string, unknown>): string {
  const verification = readString(metadata.verification);
  const freshnessReason = readString(metadata.freshnessReason);
  const ageMs = typeof metadata.ageMs === "number" ? `${Math.round(metadata.ageMs)}ms old` : undefined;
  return [verification ? `verification ${verification}` : undefined, ageMs, freshnessReason].filter((part): part is string => Boolean(part)).join(" · ") ||
    "redacted structured observation";
}

export function summarizeActionFeedback(feedback: ComputerSessionDebugBundle["actionFeedbacks"][number]): string {
  const parts = [
    feedback.verifierStatus ? `verifier ${feedback.verifierStatus}` : undefined,
    feedback.beforeObservationId ? `before ${shortId(feedback.beforeObservationId)}` : undefined,
    feedback.afterObservationId ? `after ${shortId(feedback.afterObservationId)}` : undefined,
    feedback.perceptionGraphId ? `graph ${shortId(feedback.perceptionGraphId)}` : undefined,
    feedback.capabilityJobId ? `job ${shortId(feedback.capabilityJobId)}` : undefined
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ") ||
    formatActivityTime(feedback.capturedAt);
}

export function formatTargetEvidencePreview(targetEvidence: Record<string, unknown>): string {
  if (targetEvidence.schemaVersion !== "computer-session-target-evidence.v1") {
    return "";
  }
  const target = readRecord(targetEvidence.target);
  const risk = readString(targetEvidence.risk) ?? "risk";
  const allowed = targetEvidence.allowed === true ? "allowed" : "blocked";
  const confidence = typeof targetEvidence.confidence === "number" ? targetEvidence.confidence.toFixed(2) : undefined;
  const threshold = typeof targetEvidence.threshold === "number" ? targetEvidence.threshold.toFixed(2) : undefined;
  const node = readString(targetEvidence.nodeId) ?? readString(targetEvidence.elementId);
  const label = readString(target.label) ?? readString(target.role);
  const sources = readStringList(targetEvidence.evidenceSources).slice(0, 3).join("+");
  const classes = readStringList(targetEvidence.evidenceClasses).slice(0, 2).join("+");
  const arbitration = readRecord(targetEvidence.arbitration);
  const graphSet = readRecord(arbitration.graphSet);
  const graphCount = typeof graphSet.graphCount === "number" ? graphSet.graphCount : undefined;
  const sourceCount = typeof graphSet.sourceCount === "number" ? graphSet.sourceCount : undefined;
  const confidenceText = confidence && threshold ? `${confidence}/${threshold}` : confidence;
  return [
    `target ${allowed}`,
    risk,
    confidenceText ? `conf ${confidenceText}` : undefined,
    graphCount ? `graphs ${graphCount}/${sourceCount ?? String.fromCharCode(63)}` : undefined,
    label,
    node ? shortId(node) : undefined,
    sources ? `src ${sources}` : undefined,
    classes ? `proof ${classes}` : undefined
  ].filter((part): part is string => Boolean(part)).join(" · ");
}

export function targetEvidenceTone(targetEvidence: Record<string, unknown>): string {
  if (targetEvidence.allowed !== true) {
    return "is-blocked";
  }
  const risk = readString(targetEvidence.risk);
  return risk === "read_only" || risk === "reversible" ? "is-safe" : "is-warning";
}

export function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function collectToolsmithSourceRows(observations: ComputerSessionDebugBundle["observations"]): ToolsmithSourceRow[] {
  const rows: ToolsmithSourceRow[] = [];
  for (const observation of observations) {
    const sourceSummary = observation.metadata?.sourceSummary;
    const record = readRecord(sourceSummary);
    const summaryRows = Array.isArray(record.rows) ? record.rows : [];
    for (const row of summaryRows) {
      const source = readRecord(row);
      const url = readString(source.url);
      const title = readString(source.title);
      const key = `${url ?? ""}\n${title ?? ""}`;
      if (!url && !title) {
        continue;
      }
      if (rows.some((candidate) => `${candidate.url ?? ""}\n${candidate.title ?? ""}` === key)) {
        continue;
      }
      rows.push({
        title,
        url,
        status: readString(source.status),
        browserFallback: source.browserFallback === true,
        fallbackReason: readString(source.fallbackReason),
        chars: typeof source.chars === "number" ? source.chars : undefined,
        excerpt: readString(source.excerpt)
      });
    }
  }
  return rows;
}

export function summarizeToolsmithSource(source: ToolsmithSourceRow): string {
  const parts = [
    source.browserFallback ? `browser fallback${source.fallbackReason ? `:${source.fallbackReason}` : ""}` : "direct/source",
    source.url,
    typeof source.chars === "number" ? `${source.chars} chars` : undefined,
    source.excerpt
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ") || "source evidence";
}

export function summarizeToolsmithSourceQuality(rows: ToolsmithSourceRow[]): {
  quality: string;
  directCount: number;
  fallbackCount: number;
  blockedCount: number;
  charCount: number;
} {
  const fallbackCount = rows.filter((row) => row.browserFallback).length;
  const blockedCount = rows.filter((row) => /blocked|failed|missing/i.test(row.status ?? "")).length;
  const directCount = rows.filter((row) => !row.browserFallback && !/blocked|failed|missing/i.test(row.status ?? "")).length;
  const charCount = rows.reduce((sum, row) => sum + Math.max(0, row.chars ?? 0), 0);
  const quality = rows.length === 0
    ? "none"
    : blockedCount > 0
      ? "mixed"
      : fallbackCount > 0 && directCount > 0
        ? "hybrid"
        : fallbackCount > 0
          ? "fallback"
          : "direct";
  return { quality, directCount, fallbackCount, blockedCount, charCount };
}

export function summarizeArtifactProof(resources: ComputerSessionDebugBundle["evalResources"]): {
  total: number;
  blobCount: number;
  textCount: number;
  pdfCount: number;
  missingBlobCount: number;
} {
  const blobCount = resources.filter((resource) => Boolean(resource.blobId)).length;
  const textCount = resources.filter(isTextArtifactResource).length;
  const pdfCount = resources.filter((resource) => /pdf/i.test(resource.role)).length;
  return {
    total: resources.length,
    blobCount,
    textCount,
    pdfCount,
    missingBlobCount: resources.length - blobCount
  };
}

export function summarizeArtifactResource(resource: ComputerSessionDebugBundle["evalResources"][number]): string {
  const redaction = readRecord(resource.redaction);
  const basename = readString(redaction.basename);
  const mode = readString(redaction.mode);
  const id = resource.blobId
    ? `blob ${shortId(resource.blobId)}`
    : resource.capabilityResourceId
      ? `cap ${shortId(resource.capabilityResourceId)}`
      : shortId(resource.id);
  return [basename, id, mode].filter((part): part is string => Boolean(part)).join(" · ");
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return `${value}`;
}

export function isArtifactResource(resource: ComputerSessionDebugBundle["evalResources"][number]): boolean {
  return /artifact|file|toolsmith|report|pdf|citation|markdown|download/i.test(resource.role) &&
    resource.role !== "perception_graph";
}

export function isTextArtifactResource(resource: ComputerSessionDebugBundle["evalResources"][number]): boolean {
  return /report|citation|markdown|json|text|stdout|source/i.test(resource.role) &&
    !/pdf|image|download/i.test(resource.role);
}

export function readActionType(input: Record<string, unknown>): string {
  const action = readRecord(input.action);
  return readString(action.type) ?? readString(input.type) ?? "action";
}

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}
