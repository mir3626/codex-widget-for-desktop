import type {
  AutonomyGeneratedToolSpec,
  AutonomyPermissionRequirement,
  AutonomyRunSummary,
  CapabilityDagNodeKind
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";
import { asRecord } from "./toolsmithShared.js";

export type DagNodeMap = Record<string, string>;

export const AUTONOMY_EXECUTION_STAGES = [
  "crawl_or_observe",
  "extract",
  "verify_sources",
  "draft_markdown",
  "render_pdf",
  "store_artifact",
  "verify_artifact"
] as const;

export type AutonomyExecutionStage = typeof AUTONOMY_EXECUTION_STAGES[number];

export function executionStagesForSpec(spec: AutonomyGeneratedToolSpec): AutonomyExecutionStage[] {
  if (spec.capability === "local_document_conversion") {
    return ["draft_markdown", "render_pdf", "store_artifact", "verify_artifact"];
  }
  return [...AUTONOMY_EXECUTION_STAGES];
}

export function createAutonomyDagNodes(
  storage: StorageService,
  dagRunId: string,
  requirements: AutonomyPermissionRequirement[],
  permissionAllowed: boolean
): DagNodeMap {
  const definitions: Array<{ key: string; kind: CapabilityDagNodeKind; dependsOn: string[] }> = [
    { key: "permission_check", kind: "permission_check", dependsOn: [] },
    { key: "capability_gap", kind: "capability_gap", dependsOn: ["permission_check"] },
    { key: "implement_capability", kind: "implement_capability", dependsOn: ["capability_gap"] },
    { key: "dependency_prepare", kind: "dependency_prepare", dependsOn: ["implement_capability"] },
    { key: "smoke_test", kind: "smoke_test", dependsOn: ["dependency_prepare"] },
    { key: "task_plan", kind: "task_plan", dependsOn: ["smoke_test"] },
    { key: "crawl_or_observe", kind: "crawl_or_observe", dependsOn: ["task_plan"] },
    { key: "extract", kind: "extract", dependsOn: ["crawl_or_observe"] },
    { key: "verify_sources", kind: "verify_sources", dependsOn: ["extract"] },
    { key: "draft_markdown", kind: "draft_markdown", dependsOn: ["verify_sources"] },
    { key: "render_pdf", kind: "render_pdf", dependsOn: ["draft_markdown"] },
    { key: "store_artifact", kind: "store_artifact", dependsOn: ["render_pdf"] },
    { key: "verify_artifact", kind: "verify_artifact", dependsOn: ["store_artifact"] },
    { key: "cleanup_or_rollback", kind: "cleanup_or_rollback", dependsOn: ["verify_artifact"] },
    { key: "eval_ledger_record", kind: "eval_ledger", dependsOn: ["cleanup_or_rollback"] }
  ];
  const map: DagNodeMap = {};
  for (const definition of definitions) {
    map[definition.key] = `${dagRunId}:${definition.key}`;
  }
  for (const definition of definitions) {
    storage.upsertCapabilityDagNode({
      id: map[definition.key],
      dagRunId,
      kind: definition.kind,
      status: definition.key === "permission_check" ? "ready" : permissionAllowed ? "pending" : "skipped",
      dependsOn: definition.dependsOn.map((key) => map[key]).filter(Boolean),
      requestedBy: "prompt",
      priority: "interactive",
      input: { requirements, permissionAllowed }
    });
  }
  return map;
}

export function readDagNodeMap(run: AutonomyRunSummary): DagNodeMap {
  const output = asRecord(run.output);
  const map = asRecord(output.dagNodeMap);
  const result: DagNodeMap = {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
