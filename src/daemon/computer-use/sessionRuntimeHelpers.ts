import type {
  AutonomyRiskClass,
  CapabilityDagNodeSummary,
  CapabilityJobKind,
  CapabilityJobSummary,
  ComputerSessionFreshnessSummary,
  ComputerSessionObservationKind,
  ComputerSessionObservationSummary,
  ComputerSessionPromptStepStatus,
  ComputerSessionState,
  ComputerStructuredOperation,
  ComputerUseEvalModality,
  ExecutionSurfaceDecision,
  RiskClass
} from "../../shared/protocol.js";
import type { CapabilityRuntime } from "../capability-runtime/index.js";
import { summarizeCapabilityObservation, type ScreenTileCache } from "./screenObservationRuntime.js";
import { readUnknownRecord } from "./sessionRecordUtils.js";
import type { ComputerSessionOperationResult } from "./sessionRuntimeTypes.js";

export function createSkeletonDagNodes(input: {
  sessionId: string;
  evalRunId: string;
  surfaceDecision: ExecutionSurfaceDecision;
}) {
  const prefix = input.sessionId;
  return [
    {
      id: `${prefix}:permission_check`,
      kind: "permission_check" as const,
      input: {
        evalRunId: input.evalRunId,
        requiredGrants: input.surfaceDecision.requiredGrants
      }
    },
    {
      id: `${prefix}:surface_select`,
      kind: "setup" as const,
      dependsOn: [`${prefix}:permission_check`],
      input: {
        surface: input.surfaceDecision.surface.kind,
        reason: input.surfaceDecision.reason
      }
    },
    {
      id: `${prefix}:observe`,
      kind: "observe" as const,
      dependsOn: [`${prefix}:surface_select`],
      input: { mode: "skeleton_observe" }
    },
    {
      id: `${prefix}:plan`,
      kind: "plan" as const,
      dependsOn: [`${prefix}:observe`],
      input: { mode: "skeleton_plan" }
    },
    {
      id: `${prefix}:eval_ledger`,
      kind: "eval_ledger" as const,
      dependsOn: [`${prefix}:plan`],
      input: { evalRunId: input.evalRunId }
    }
  ];
}

export function inferRiskClass(userRequest: string): RiskClass {
  if (/password|credential|token|secret|cookie|captcha|비밀번호|암호|쿠키|캡차|보안|security/i.test(userRequest)) {
    return "credential_or_secret";
  }
  if (/purchase|payment|pay|checkout|card|cvv|cvc|결제|구매|카드/i.test(userRequest)) {
    return "external_submission";
  }
  if (/delete|remove|삭제|변경|settings|설정/i.test(userRequest)) {
    return "os_settings_mutation";
  }
  if (/upload|첨부|file/i.test(userRequest)) {
    return "local_file_disclosure";
  }
  if (/pdf|markdown|문서|보고서|저장|save/i.test(userRequest)) {
    return "local_artifact_create";
  }
  return "read_only";
}

export function inferModalitiesForSurface(surface: string): ComputerUseEvalModality[] {
  if (surface === "pty_workspace" || surface === "tool_workspace") {
    return ["terminal", "cross_app"];
  }
  if (surface === "foreground_desktop_watch" || surface === "future_vm_session") {
    return ["windows", "vision"];
  }
  return ["browser"];
}

export function inferFailureMemorySurface(surface: string | undefined, capabilityKind: CapabilityJobKind): ComputerUseEvalModality | "memory" {
  if (capabilityKind === "terminal") return "terminal";
  if (capabilityKind === "desktop_action" || surface === "foreground_desktop_watch" || surface === "future_vm_session") return "windows";
  if (capabilityKind === "screen_observe" || capabilityKind === "ocr") return "vision";
  if (capabilityKind === "browser_action" || capabilityKind === "browser_chrome") return "browser";
  return "memory";
}

export function mapRiskClassToAutonomyRisk(riskClass: RiskClass): AutonomyRiskClass {
  if (riskClass === "read_only") return "read_only";
  if (riskClass === "local_artifact_create") return "reversible";
  if (riskClass === "credential_or_secret") return "credential";
  if (riskClass === "browser_state_mutation") return "side_effect";
  if (riskClass === "external_submission") return "high_risk";
  return "high_risk";
}

export function readSourceDocuments(value: unknown): Array<{ title?: string; url?: string; text: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const documents = value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      title: typeof item.title === "string" ? item.title : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      text: typeof item.text === "string" ? item.text : ""
    }))
    .filter((item) => item.text.trim());
  return documents.length ? documents : undefined;
}

export function readBrowserFallbackDocuments(value: unknown): Array<{
  title?: string;
  url: string;
  text?: string;
  capture?: Record<string, unknown>;
}> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const documents = value
    .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      title: typeof item.title === "string" ? item.title : undefined,
      url: typeof item.url === "string" ? item.url.trim() : "",
      text: typeof item.text === "string" ? item.text : undefined,
      capture: item.capture && typeof item.capture === "object" && !Array.isArray(item.capture)
        ? item.capture as Record<string, unknown>
        : undefined
    }))
    .filter((item) => item.url && (item.text?.trim() || item.capture));
  return documents.length ? documents : undefined;
}

export function createBrowserActionReobserveOperation(
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>
): Extract<ComputerStructuredOperation, { kind: "browser_action" }> {
  const originalInput = operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const reobserveInput: Record<string, unknown> = {
    action: {
      type: "read",
      reason: `Refresh browser observation before ${readBrowserActionTypeFromOperation(operation)}.`
    }
  };
  for (const key of ["actionSessionId", "adapterId", "source", "mode", "targetHint"]) {
    if (originalInput[key] !== undefined) {
      reobserveInput[key] = originalInput[key];
    }
  }
  if (typeof originalInput.requestId === "string" && originalInput.requestId.trim()) {
    reobserveInput.requestId = `${originalInput.requestId.trim()}:reobserve`;
  }
  return {
    kind: "browser_action",
    input: reobserveInput
  };
}

export function readBrowserActionTypeFromOperation(
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>
): string {
  const input = operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const action = input.action && typeof input.action === "object" && !Array.isArray(input.action)
    ? input.action as Record<string, unknown>
    : {};
  return typeof action.type === "string" && action.type.trim() ? action.type.trim() : "unknown";
}

export function summarizeBrowserActionTargetForRecovery(
  operation: Extract<ComputerStructuredOperation, { kind: "browser_action" }>
): Record<string, unknown> | undefined {
  const input = operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const action = input.action && typeof input.action === "object" && !Array.isArray(input.action)
    ? input.action as Record<string, unknown>
    : {};
  const target = action.target && typeof action.target === "object" && !Array.isArray(action.target)
    ? action.target as Record<string, unknown>
    : undefined;
  if (!target) {
    return undefined;
  }
  const summary: Record<string, unknown> = {};
  for (const key of ["kind", "id", "role", "label", "name", "text", "selector"]) {
    const value = target[key];
    if (typeof value === "string" && value.trim()) {
      summary[key] = value.length > 160 ? `${value.slice(0, 157)}...` : value;
    }
  }
  return Object.keys(summary).length ? summary : { kind: "unknown" };
}

export function evaluateOperationFreshnessRequirement(
  observations: ComputerSessionObservationSummary[],
  operation: ComputerStructuredOperation
): {
  status: "not_required" | "ok" | "blocked";
  reason?: string;
  latestObservation?: ComputerSessionObservationSummary;
  maxAgeMs?: number;
} {
  const input = "input" in operation && operation.input && typeof operation.input === "object"
    ? operation.input as Record<string, unknown>
    : {};
  const requiresFreshObservation = input.requiresFreshObservation === true || typeof input.maxEvidenceAgeMs === "number";
  if (!requiresFreshObservation) {
    return { status: "not_required" };
  }
  const maxAgeMs = clampFreshnessMs(typeof input.maxEvidenceAgeMs === "number" ? input.maxEvidenceAgeMs : undefined);
  const latestObservation = [...observations]
    .reverse()
    .find((observation) => observation.kind !== "session_skeleton");
  if (!latestObservation) {
    return {
      status: "blocked",
      reason: "fresh_observation_required_but_missing",
      maxAgeMs
    };
  }
  const [annotated] = annotateObservationFreshness([latestObservation], new Date(), maxAgeMs);
  if (annotated.freshness !== "fresh") {
    return {
      status: "blocked",
      reason: annotated.freshness === "stale"
        ? "fresh_observation_required_but_stale"
        : "fresh_observation_required_but_unknown",
      latestObservation: annotated,
      maxAgeMs
    };
  }
  return {
    status: "ok",
    latestObservation: annotated,
    maxAgeMs
  };
}

export function annotateObservationFreshness(
  observations: ComputerSessionObservationSummary[],
  now = new Date(),
  overrideStaleAfterMs?: number
): ComputerSessionObservationSummary[] {
  return observations.map((observation) => {
    const staleAfterMs = overrideStaleAfterMs ?? staleAfterMsForObservation(observation);
    const capturedAtMs = Date.parse(observation.capturedAt);
    if (!Number.isFinite(capturedAtMs) || staleAfterMs <= 0) {
      return {
        ...observation,
        freshness: "unknown",
        metadata: {
          ...(observation.metadata ?? {}),
          freshnessCheckedAt: now.toISOString(),
          freshnessReason: !Number.isFinite(capturedAtMs) ? "invalid_captured_at" : "no_freshness_window"
        }
      };
    }
    const ageMs = Math.max(0, now.getTime() - capturedAtMs);
    const freshness = ageMs <= staleAfterMs ? "fresh" : "stale";
    return {
      ...observation,
      freshness,
      metadata: {
        ...(observation.metadata ?? {}),
        freshnessCheckedAt: now.toISOString(),
        ageMs,
        staleAfterMs
      }
    };
  });
}

export function summarizeObservationFreshness(
  observations: ComputerSessionObservationSummary[]
): ComputerSessionFreshnessSummary {
  const summary: ComputerSessionFreshnessSummary = {
    checkedAt: new Date().toISOString(),
    fresh: 0,
    stale: 0,
    unknown: 0,
    staleObservationIds: []
  };
  for (const observation of observations) {
    if (observation.freshness === "fresh") {
      summary.fresh += 1;
    } else if (observation.freshness === "stale") {
      summary.stale += 1;
      summary.staleObservationIds.push(observation.id);
    } else {
      summary.unknown += 1;
    }
    const ageMs = typeof observation.metadata?.ageMs === "number" ? observation.metadata.ageMs : undefined;
    if (ageMs !== undefined) {
      summary.maxAgeMs = Math.max(summary.maxAgeMs ?? 0, ageMs);
    }
  }
  return summary;
}

export function staleAfterMsForObservation(observation: ComputerSessionObservationSummary): number {
  if (observation.kind === "browser_dom" || observation.kind === "screen" || observation.kind === "ocr") {
    return 15_000;
  }
  if (observation.kind === "terminal" || observation.kind === "file") {
    return 5 * 60_000;
  }
  return 0;
}

export function clampFreshnessMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 15_000;
  }
  return Math.min(Math.max(Math.floor(value), 250), 5 * 60_000);
}

export function summarizeObservationRecord(kind: ComputerSessionObservationKind, output: unknown): string {
  const summary = summarizeCapabilityObservation(kind, output);
  if (kind === "ocr") {
    return `OCR observation captured ${String(summary.textLength ?? 0)} characters.`;
  }
  if (kind === "screen") {
    return `Screen observation captured ${String(summary.dirtyRegionCount ?? "unknown")} dirty regions.`;
  }
  if (kind === "terminal") {
    return `Terminal observation completed with exit code ${String(summary.exitCode ?? "unknown")}.`;
  }
  return "Capability observation completed through Computer Session runtime.";
}

export function readOperationTimeoutMs(input: Record<string, unknown>): number | undefined {
  const timeoutMs = Number(input.timeoutMs);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(120_000, Math.floor(timeoutMs)) : undefined;
}

export async function waitForCapabilityJobIfRunning(
  runtime: CapabilityRuntime,
  jobId: string,
  timeoutMs: number
): Promise<CapabilityJobSummary> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let latest = runtime.read(jobId);
  while (latest && !isCapabilitySettledForSession(latest.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    latest = runtime.read(jobId);
  }
  if (!latest) {
    throw new Error(`Capability job not found: ${jobId}`);
  }
  return latest;
}

export function isCapabilitySettledForSession(status: CapabilityJobSummary["status"]): boolean {
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "awaiting_approval";
}

export function isComputerSessionFinal(state: ComputerSessionState): boolean {
  return state === "completed" || state === "blocked" || state === "cancelled" || state === "failed";
}

export function isCapabilityDagNodeFinal(status: CapabilityDagNodeSummary["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "skipped";
}

export function readPromptStepStatus(operation: ComputerSessionOperationResult): ComputerSessionPromptStepStatus {
  return readPromptStepStatusFromJobNode(operation.job ?? null, operation.dagNode, "running");
}

export function readPromptStepStatusFromJobNode(
  job: CapabilityJobSummary | null,
  node: CapabilityDagNodeSummary | null,
  fallback: ComputerSessionPromptStepStatus
): ComputerSessionPromptStepStatus {
  if (job?.status === "awaiting_approval") {
    return "awaiting_approval";
  }
  if (job?.status === "completed" || node?.status === "completed") {
    return "completed";
  }
  if (job?.status === "cancelled" || node?.status === "cancelled") {
    return "cancelled";
  }
  if (job?.status === "failed" || job?.status === "expired" || node?.status === "failed") {
    return "failed";
  }
  if (job?.status === "queued" || job?.status === "scheduled" || job?.status === "running" || node?.status === "running" || node?.status === "ready" || node?.status === "pending") {
    return "running";
  }
  return fallback;
}

export function isPromptStepFinal(status: ComputerSessionPromptStepStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "skipped";
}

export function isScreenTileCache(value: unknown): value is ScreenTileCache {
  const record = readUnknownRecord(value);
  return Array.isArray(record.tileHashes) && typeof record.capturedAt === "string";
}
