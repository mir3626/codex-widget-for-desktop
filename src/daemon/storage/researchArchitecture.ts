import { randomUUID } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type {
  CapabilityDagNodeKind,
  CapabilityDagNodeStatus,
  CapabilityDagNodeSummary,
  CapabilityDagRunSummary,
  CapabilityJobKind,
  CapabilityJobPriority,
  CapabilityJobRequestedBy,
  ComputerUseEvalModality,
  ComputerUseEvalResourceSummary,
  ComputerUseEvalRunSummary,
  ComputerUseEvalScenario,
  ComputerUseEvalStatus,
  ComputerUseEvalStepSummary,
  ComputerUseFailureClass,
  ComputerUseTaskSuccess,
  PerceptionGraphSummary,
  StructuredFailureMemoryRecord
} from "../../shared/protocol.js";

type EvalRunRow = {
  id: string;
  scenario_id: string;
  session_id?: string | null;
  status: string;
  modalities_json: string;
  prompt?: string | null;
  scenario_json: string;
  task_success: string;
  failure_class: string;
  started_at: string;
  completed_at?: string | null;
  elapsed_ms?: number | null;
  metrics_json: string;
  created_at: string;
  updated_at: string;
};

type EvalStepRow = {
  id: string;
  run_id: string;
  step_index: number;
  kind: string;
  phase: string;
  status: string;
  capability_job_id?: string | null;
  capability_dag_node_id?: string | null;
  perception_graph_id?: string | null;
  input_json: string;
  output_json: string;
  started_at?: string | null;
  completed_at?: string | null;
  elapsed_ms?: number | null;
  failure_class?: string | null;
  created_at: string;
};

type EvalResourceRow = {
  id: string;
  run_id: string;
  step_id?: string | null;
  capability_resource_id?: string | null;
  blob_id?: string | null;
  role: string;
  retention: string;
  redaction_json: string;
  created_at: string;
};

type PerceptionGraphRow = {
  id: string;
  session_id?: string | null;
  source: string;
  graph_json: string;
  created_at: string;
};

type StructuredFailureRow = {
  id: string;
  failure_class: string;
  surface: string;
  scenario_id?: string | null;
  provenance_json: string;
  calibration_json: string;
  safety_json: string;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

type DagRunRow = {
  id: string;
  eval_run_id?: string | null;
  session_id?: string | null;
  status: string;
  goal?: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

type DagNodeRow = {
  id: string;
  dag_run_id: string;
  kind: string;
  status: string;
  capability_kind?: string | null;
  capability_job_id?: string | null;
  priority: string;
  requested_by: string;
  depends_on_json: string;
  confidence_gate?: number | null;
  input_json: string;
  output_json: string;
  resource_usage_json: string;
  started_at?: string | null;
  completed_at?: string | null;
  elapsed_ms?: number | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

export type ComputerUseEvalRunCreateInput = {
  id?: string;
  scenarioId?: string;
  sessionId?: string;
  modalities: ComputerUseEvalModality[];
  prompt?: string;
  scenario?: ComputerUseEvalScenario;
  status?: ComputerUseEvalStatus;
  taskSuccess?: ComputerUseTaskSuccess;
  failureClass?: ComputerUseFailureClass;
  metrics?: Record<string, unknown>;
  startedAt?: string;
  createdAt?: string;
};

export type ComputerUseEvalRunUpdateInput = {
  id: string;
  status?: ComputerUseEvalStatus;
  taskSuccess?: ComputerUseTaskSuccess;
  failureClass?: ComputerUseFailureClass;
  metrics?: Record<string, unknown>;
  completedAt?: string;
  elapsedMs?: number;
  updatedAt?: string;
};

export type ComputerUseEvalStepCreateInput = {
  id?: string;
  runId: string;
  stepIndex?: number;
  kind: string;
  phase: string;
  status: string;
  capabilityJobId?: string;
  capabilityDagNodeId?: string;
  perceptionGraphId?: string;
  input?: unknown;
  output?: unknown;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  failureClass?: ComputerUseFailureClass;
  createdAt?: string;
};

export type ComputerUseEvalResourceCreateInput = {
  id?: string;
  runId: string;
  stepId?: string;
  capabilityResourceId?: string;
  blobId?: string;
  role: string;
  retention?: ComputerUseEvalResourceSummary["retention"];
  redaction?: unknown;
  createdAt?: string;
};

export type PerceptionGraphRecordInput = {
  graph: PerceptionGraphSummary;
  sessionId?: string;
  source?: string;
  createdAt?: string;
};

export type StructuredFailureRecordInput = Omit<StructuredFailureMemoryRecord, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CapabilityDagRunCreateInput = {
  id?: string;
  evalRunId?: string;
  sessionId?: string;
  status?: CapabilityDagNodeStatus;
  goal?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type CapabilityDagRunUpdateInput = {
  id: string;
  status?: CapabilityDagNodeStatus;
  metadata?: Record<string, unknown>;
  completedAt?: string | null;
  updatedAt?: string;
};

export type CapabilityDagNodeUpsertInput = {
  id?: string;
  dagRunId: string;
  kind: CapabilityDagNodeKind;
  status?: CapabilityDagNodeStatus;
  capabilityKind?: CapabilityJobKind;
  capabilityJobId?: string;
  priority?: CapabilityJobPriority;
  requestedBy?: CapabilityJobRequestedBy;
  dependsOn?: string[];
  confidenceGate?: number;
  input?: unknown;
  output?: unknown;
  resourceUsage?: Record<string, unknown>;
  startedAt?: string | null;
  completedAt?: string | null;
  elapsedMs?: number | null;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export function createComputerUseEvalRun(database: NodeDatabaseSync, input: ComputerUseEvalRunCreateInput): ComputerUseEvalRunSummary {
  const now = input.createdAt ?? new Date().toISOString();
  const scenarioId = input.scenarioId ?? input.scenario?.id ?? `scenario-${randomUUID()}`;
  const run: ComputerUseEvalRunSummary = {
    id: input.id?.trim() || `computer-use-eval-${randomUUID()}`,
    scenarioId,
    sessionId: normalizeOptionalString(input.sessionId),
    status: input.status ?? "running",
    modalities: normalizeModalities(input.modalities),
    prompt: normalizeOptionalString(input.prompt ?? input.scenario?.prompt),
    taskSuccess: input.taskSuccess ?? "unknown",
    failureClass: input.failureClass ?? "unknown",
    scenario: input.scenario,
    metrics: input.metrics ?? {},
    startedAt: input.startedAt ?? now,
    createdAt: now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO computer_use_eval_runs (
        id, scenario_id, session_id, status, modalities_json, prompt, scenario_json,
        task_success, failure_class, started_at, metrics_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.scenarioId,
      run.sessionId ?? null,
      run.status,
      stringifyJson(run.modalities),
      run.prompt ?? null,
      stringifyJson(run.scenario ?? {}),
      run.taskSuccess,
      run.failureClass,
      run.startedAt,
      stringifyJson(run.metrics ?? {}),
      run.createdAt,
      run.updatedAt
    );
  return run;
}

export function readComputerUseEvalRun(database: NodeDatabaseSync, id: string): ComputerUseEvalRunSummary | null {
  const row = database.prepare("SELECT * FROM computer_use_eval_runs WHERE id = ?").get(id) as EvalRunRow | undefined;
  return row ? mapEvalRunRow(row) : null;
}

export function listComputerUseEvalRuns(database: NodeDatabaseSync, input: {
  sessionId?: string;
  scenarioId?: string;
  statuses?: ComputerUseEvalStatus[];
  limit?: number;
} = {}): ComputerUseEvalRunSummary[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.sessionId) {
    clauses.push("session_id = ?");
    values.push(input.sessionId);
  }
  if (input.scenarioId) {
    clauses.push("scenario_id = ?");
    values.push(input.scenarioId);
  }
  if (input.statuses?.length) {
    clauses.push(`status IN (${input.statuses.map(() => '?').join(", ")})`);
    values.push(...input.statuses);
  }
  values.push(normalizePositiveInteger(input.limit, 100));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM computer_use_eval_runs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as EvalRunRow[];
  return rows.map(mapEvalRunRow);
}

export function updateComputerUseEvalRun(database: NodeDatabaseSync, input: ComputerUseEvalRunUpdateInput): ComputerUseEvalRunSummary {
  const current = readComputerUseEvalRun(database, input.id);
  if (!current) {
    throw new Error(`Computer-use eval run not found: ${input.id}`);
  }
  const completedAt = input.completedAt === undefined ? current.completedAt : input.completedAt;
  const elapsedMs = input.elapsedMs ?? (completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(current.startedAt)) : current.elapsedMs);
  const updated: ComputerUseEvalRunSummary = {
    ...current,
    status: input.status ?? current.status,
    taskSuccess: input.taskSuccess ?? current.taskSuccess,
    failureClass: input.failureClass ?? current.failureClass,
    metrics: input.metrics ?? current.metrics,
    completedAt,
    elapsedMs,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `UPDATE computer_use_eval_runs
       SET status = ?, task_success = ?, failure_class = ?, completed_at = ?,
           elapsed_ms = ?, metrics_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.status,
      updated.taskSuccess,
      updated.failureClass,
      updated.completedAt ?? null,
      updated.elapsedMs ?? null,
      stringifyJson(updated.metrics ?? {}),
      updated.updatedAt,
      updated.id
    );
  return updated;
}

export function appendComputerUseEvalStep(database: NodeDatabaseSync, input: ComputerUseEvalStepCreateInput): ComputerUseEvalStepSummary {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const stepIndex = input.stepIndex ?? readNextStepIndex(database, input.runId);
  const step: ComputerUseEvalStepSummary = {
    id: input.id?.trim() || `computer-use-step-${randomUUID()}`,
    runId: input.runId,
    stepIndex,
    kind: input.kind,
    phase: input.phase,
    status: input.status,
    capabilityJobId: normalizeOptionalString(input.capabilityJobId),
    capabilityDagNodeId: normalizeOptionalString(input.capabilityDagNodeId),
    perceptionGraphId: normalizeOptionalString(input.perceptionGraphId),
    input: input.input ?? {},
    output: input.output ?? {},
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    elapsedMs: input.elapsedMs,
    failureClass: input.failureClass,
    createdAt
  };
  database
    .prepare(
      `INSERT INTO computer_use_eval_steps (
        id, run_id, step_index, kind, phase, status, capability_job_id,
        capability_dag_node_id, perception_graph_id, input_json, output_json,
        started_at, completed_at, elapsed_ms, failure_class, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      step.id,
      step.runId,
      step.stepIndex,
      step.kind,
      step.phase,
      step.status,
      step.capabilityJobId ?? null,
      step.capabilityDagNodeId ?? null,
      step.perceptionGraphId ?? null,
      stringifyJson(step.input ?? {}),
      stringifyJson(step.output ?? {}),
      step.startedAt ?? null,
      step.completedAt ?? null,
      step.elapsedMs ?? null,
      step.failureClass ?? null,
      step.createdAt
    );
  return step;
}

export function listComputerUseEvalSteps(database: NodeDatabaseSync, runId: string): ComputerUseEvalStepSummary[] {
  const rows = database
    .prepare("SELECT * FROM computer_use_eval_steps WHERE run_id = ? ORDER BY step_index ASC, created_at ASC")
    .all(runId) as EvalStepRow[];
  return rows.map(mapEvalStepRow);
}

export function createComputerUseEvalResource(database: NodeDatabaseSync, input: ComputerUseEvalResourceCreateInput): ComputerUseEvalResourceSummary {
  const resource: ComputerUseEvalResourceSummary = {
    id: input.id?.trim() || `computer-use-resource-${randomUUID()}`,
    runId: input.runId,
    stepId: normalizeOptionalString(input.stepId),
    capabilityResourceId: normalizeOptionalString(input.capabilityResourceId),
    blobId: normalizeOptionalString(input.blobId),
    role: input.role,
    retention: input.retention ?? "evidence",
    redaction: input.redaction ?? {},
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `INSERT INTO computer_use_eval_resources (
        id, run_id, step_id, capability_resource_id, blob_id, role, retention, redaction_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      resource.id,
      resource.runId,
      resource.stepId ?? null,
      resource.capabilityResourceId ?? null,
      resource.blobId ?? null,
      resource.role,
      resource.retention,
      stringifyJson(resource.redaction ?? {}),
      resource.createdAt
    );
  return resource;
}

export function listComputerUseEvalResources(database: NodeDatabaseSync, runId: string): ComputerUseEvalResourceSummary[] {
  const rows = database
    .prepare("SELECT * FROM computer_use_eval_resources WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as EvalResourceRow[];
  return rows.map(mapEvalResourceRow);
}

export function recordPerceptionGraph(database: NodeDatabaseSync, input: PerceptionGraphRecordInput): PerceptionGraphSummary {
  const graph = {
    ...input.graph,
    sessionId: input.sessionId ?? input.graph.sessionId,
    source: input.source ?? input.graph.source,
    createdAt: input.createdAt ?? input.graph.createdAt
  };
  database
    .prepare("INSERT INTO perception_graphs (id, session_id, source, graph_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(graph.id, graph.sessionId ?? null, graph.source, stringifyJson(graph), graph.createdAt);
  return graph;
}

export function readPerceptionGraph(database: NodeDatabaseSync, id: string): PerceptionGraphSummary | null {
  const row = database.prepare("SELECT * FROM perception_graphs WHERE id = ?").get(id) as PerceptionGraphRow | undefined;
  return row ? mapPerceptionGraphRow(row) : null;
}

export function listPerceptionGraphs(database: NodeDatabaseSync, input: { sessionId?: string; limit?: number } = {}): PerceptionGraphSummary[] {
  const values: Array<string | number> = [];
  const where = input.sessionId ? "WHERE session_id = ?" : "";
  if (input.sessionId) {
    values.push(input.sessionId);
  }
  values.push(normalizePositiveInteger(input.limit, 50));
  const rows = database
    .prepare(`SELECT * FROM perception_graphs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as PerceptionGraphRow[];
  return rows.map(mapPerceptionGraphRow);
}

export function recordStructuredFailureMemory(database: NodeDatabaseSync, input: StructuredFailureRecordInput): StructuredFailureMemoryRecord {
  const now = input.createdAt ?? new Date().toISOString();
  const record: StructuredFailureMemoryRecord = {
    ...input,
    id: input.id?.trim() || `failure-memory-${randomUUID()}`,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    safety: {
      mayAffectRanking: Boolean(input.safety.mayAffectRanking),
      mayCompleteTask: false,
      mayBypassApproval: false,
      proofSource: false,
      boundaries: input.safety.boundaries ?? []
    }
  };
  database
    .prepare(
      `INSERT INTO structured_failure_memory (
        id, failure_class, surface, scenario_id, provenance_json, calibration_json,
        safety_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.failureClass,
      record.surface,
      record.scenarioId ?? null,
      stringifyJson(record.provenance),
      stringifyJson(record.calibration),
      stringifyJson(record.safety),
      record.expiresAt ?? null,
      record.createdAt,
      record.updatedAt
    );
  return record;
}

export function listStructuredFailureMemory(database: NodeDatabaseSync, input: {
  failureClass?: ComputerUseFailureClass;
  surface?: string;
  includeExpired?: boolean;
  limit?: number;
} = {}): StructuredFailureMemoryRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.failureClass) {
    clauses.push("failure_class = ?");
    values.push(input.failureClass);
  }
  if (input.surface) {
    clauses.push("surface = ?");
    values.push(input.surface);
  }
  if (!input.includeExpired) {
    clauses.push("(expires_at IS NULL OR expires_at > ?)");
    values.push(new Date().toISOString());
  }
  values.push(normalizePositiveInteger(input.limit, 100));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM structured_failure_memory ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as StructuredFailureRow[];
  return rows.map(mapStructuredFailureRow);
}

export function createCapabilityDagRun(database: NodeDatabaseSync, input: CapabilityDagRunCreateInput): CapabilityDagRunSummary {
  const now = input.createdAt ?? new Date().toISOString();
  const run: CapabilityDagRunSummary = {
    id: input.id?.trim() || `capability-dag-${randomUUID()}`,
    evalRunId: normalizeOptionalString(input.evalRunId),
    sessionId: normalizeOptionalString(input.sessionId),
    status: input.status ?? "pending",
    goal: normalizeOptionalString(input.goal),
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO capability_dag_runs (
        id, eval_run_id, session_id, status, goal, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.evalRunId ?? null,
      run.sessionId ?? null,
      run.status,
      run.goal ?? null,
      stringifyJson(run.metadata ?? {}),
      run.createdAt,
      run.updatedAt
    );
  return run;
}

export function updateCapabilityDagRun(database: NodeDatabaseSync, input: CapabilityDagRunUpdateInput): CapabilityDagRunSummary {
  const current = readCapabilityDagRun(database, input.id);
  if (!current) {
    throw new Error(`Capability DAG run not found: ${input.id}`);
  }
  const updated: CapabilityDagRunSummary = {
    ...current,
    status: input.status ?? current.status,
    metadata: input.metadata ?? current.metadata,
    completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt ?? undefined,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  database
    .prepare("UPDATE capability_dag_runs SET status = ?, metadata_json = ?, completed_at = ?, updated_at = ? WHERE id = ?")
    .run(updated.status, stringifyJson(updated.metadata ?? {}), updated.completedAt ?? null, updated.updatedAt, updated.id);
  return updated;
}

export function readCapabilityDagRun(database: NodeDatabaseSync, id: string): CapabilityDagRunSummary | null {
  const row = database.prepare("SELECT * FROM capability_dag_runs WHERE id = ?").get(id) as DagRunRow | undefined;
  return row ? mapDagRunRow(row) : null;
}

export function upsertCapabilityDagNode(database: NodeDatabaseSync, input: CapabilityDagNodeUpsertInput): CapabilityDagNodeSummary {
  const now = input.updatedAt ?? new Date().toISOString();
  const id = input.id?.trim() || `capability-dag-node-${randomUUID()}`;
  const existing = readCapabilityDagNode(database, id);
  const node: CapabilityDagNodeSummary = {
    id,
    dagRunId: input.dagRunId,
    kind: input.kind,
    status: input.status ?? existing?.status ?? "pending",
    capabilityKind: input.capabilityKind ?? existing?.capabilityKind,
    capabilityJobId: input.capabilityJobId ?? existing?.capabilityJobId,
    priority: input.priority ?? existing?.priority ?? "normal",
    requestedBy: input.requestedBy ?? existing?.requestedBy ?? "direct_ui",
    dependsOn: input.dependsOn ?? existing?.dependsOn ?? [],
    confidenceGate: input.confidenceGate ?? existing?.confidenceGate,
    input: input.input ?? existing?.input ?? {},
    output: input.output ?? existing?.output ?? {},
    resourceUsage: input.resourceUsage ?? existing?.resourceUsage ?? {},
    startedAt: input.startedAt === undefined ? existing?.startedAt : input.startedAt ?? undefined,
    completedAt: input.completedAt === undefined ? existing?.completedAt : input.completedAt ?? undefined,
    elapsedMs: input.elapsedMs === undefined ? existing?.elapsedMs : input.elapsedMs ?? undefined,
    lastError: input.lastError === undefined ? existing?.lastError : input.lastError ?? undefined,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO capability_dag_nodes (
        id, dag_run_id, kind, status, capability_kind, capability_job_id, priority,
        requested_by, depends_on_json, confidence_gate, input_json, output_json,
        resource_usage_json, started_at, completed_at, elapsed_ms, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        dag_run_id = excluded.dag_run_id,
        kind = excluded.kind,
        status = excluded.status,
        capability_kind = excluded.capability_kind,
        capability_job_id = excluded.capability_job_id,
        priority = excluded.priority,
        requested_by = excluded.requested_by,
        depends_on_json = excluded.depends_on_json,
        confidence_gate = excluded.confidence_gate,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        resource_usage_json = excluded.resource_usage_json,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        elapsed_ms = excluded.elapsed_ms,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`
    )
    .run(
      node.id,
      node.dagRunId,
      node.kind,
      node.status,
      node.capabilityKind ?? null,
      node.capabilityJobId ?? null,
      node.priority,
      node.requestedBy,
      stringifyJson(node.dependsOn),
      node.confidenceGate ?? null,
      stringifyJson(node.input ?? {}),
      stringifyJson(node.output ?? {}),
      stringifyJson(node.resourceUsage ?? {}),
      node.startedAt ?? null,
      node.completedAt ?? null,
      node.elapsedMs ?? null,
      node.lastError ?? null,
      node.createdAt,
      node.updatedAt
    );
  return node;
}

export function readCapabilityDagNode(database: NodeDatabaseSync, id: string): CapabilityDagNodeSummary | null {
  const row = database.prepare("SELECT * FROM capability_dag_nodes WHERE id = ?").get(id) as DagNodeRow | undefined;
  return row ? mapDagNodeRow(row) : null;
}

export function listCapabilityDagNodes(database: NodeDatabaseSync, dagRunId: string): CapabilityDagNodeSummary[] {
  const rows = database
    .prepare("SELECT * FROM capability_dag_nodes WHERE dag_run_id = ? ORDER BY created_at ASC")
    .all(dagRunId) as DagNodeRow[];
  return rows.map(mapDagNodeRow);
}

function readNextStepIndex(database: NodeDatabaseSync, runId: string): number {
  const row = database.prepare("SELECT COALESCE(MAX(step_index), -1) + 1 AS next_index FROM computer_use_eval_steps WHERE run_id = ?").get(runId) as { next_index?: number } | undefined;
  return Number(row?.next_index ?? 0);
}

function mapEvalRunRow(row: EvalRunRow): ComputerUseEvalRunSummary {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    sessionId: row.session_id ?? undefined,
    status: row.status as ComputerUseEvalStatus,
    modalities: parseStringArray(row.modalities_json) as ComputerUseEvalModality[],
    prompt: row.prompt ?? undefined,
    scenario: parseJson(row.scenario_json, undefined),
    taskSuccess: row.task_success as ComputerUseTaskSuccess,
    failureClass: row.failure_class as ComputerUseFailureClass,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    elapsedMs: row.elapsed_ms ?? undefined,
    metrics: parseJson(row.metrics_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEvalStepRow(row: EvalStepRow): ComputerUseEvalStepSummary {
  return {
    id: row.id,
    runId: row.run_id,
    stepIndex: Number(row.step_index),
    kind: row.kind,
    phase: row.phase,
    status: row.status,
    capabilityJobId: row.capability_job_id ?? undefined,
    capabilityDagNodeId: row.capability_dag_node_id ?? undefined,
    perceptionGraphId: row.perception_graph_id ?? undefined,
    input: parseJson(row.input_json, {}),
    output: parseJson(row.output_json, {}),
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    elapsedMs: row.elapsed_ms ?? undefined,
    failureClass: row.failure_class as ComputerUseFailureClass | undefined,
    createdAt: row.created_at
  };
}

function mapEvalResourceRow(row: EvalResourceRow): ComputerUseEvalResourceSummary {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id ?? undefined,
    capabilityResourceId: row.capability_resource_id ?? undefined,
    blobId: row.blob_id ?? undefined,
    role: row.role,
    retention: row.retention as ComputerUseEvalResourceSummary["retention"],
    redaction: parseJson(row.redaction_json, {}),
    createdAt: row.created_at
  };
}

function mapPerceptionGraphRow(row: PerceptionGraphRow): PerceptionGraphSummary {
  const graph = parseJson<PerceptionGraphSummary>(row.graph_json, {
    id: row.id,
    source: row.source,
    createdAt: row.created_at,
    nodes: [],
    edges: [],
    thresholds: { read_only: 0.35, reversible: 0.5, side_effect: 0.68, high_risk: 0.82, credential: 0.92 }
  });
  return {
    ...graph,
    id: row.id,
    sessionId: row.session_id ?? graph.sessionId,
    source: row.source,
    createdAt: row.created_at
  };
}

function mapStructuredFailureRow(row: StructuredFailureRow): StructuredFailureMemoryRecord {
  return {
    id: row.id,
    failureClass: row.failure_class as ComputerUseFailureClass,
    surface: row.surface as StructuredFailureMemoryRecord["surface"],
    scenarioId: row.scenario_id ?? undefined,
    provenance: parseJson(row.provenance_json, { source: "unknown" }),
    calibration: parseJson(row.calibration_json, {}),
    safety: parseJson(row.safety_json, {
      mayAffectRanking: false,
      mayCompleteTask: false,
      mayBypassApproval: false,
      proofSource: false,
      boundaries: []
    }),
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDagRunRow(row: DagRunRow): CapabilityDagRunSummary {
  return {
    id: row.id,
    evalRunId: row.eval_run_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    status: row.status as CapabilityDagNodeStatus,
    goal: row.goal ?? undefined,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined
  };
}

function mapDagNodeRow(row: DagNodeRow): CapabilityDagNodeSummary {
  return {
    id: row.id,
    dagRunId: row.dag_run_id,
    kind: row.kind as CapabilityDagNodeKind,
    status: row.status as CapabilityDagNodeStatus,
    capabilityKind: row.capability_kind as CapabilityJobKind | undefined,
    capabilityJobId: row.capability_job_id ?? undefined,
    priority: row.priority as CapabilityJobPriority,
    requestedBy: row.requested_by as CapabilityJobRequestedBy,
    dependsOn: parseStringArray(row.depends_on_json),
    confidenceGate: row.confidence_gate ?? undefined,
    input: parseJson(row.input_json, {}),
    output: parseJson(row.output_json, {}),
    resourceUsage: parseJson(row.resource_usage_json, {}),
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    elapsedMs: row.elapsed_ms ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeModalities(modalities: ComputerUseEvalModality[]): ComputerUseEvalModality[] {
  const allowed = new Set(["browser", "windows", "asr", "vision", "terminal", "cross_app"]);
  const normalized = modalities.filter((modality) => allowed.has(modality));
  return normalized.length > 0 ? [...new Set(normalized)] : ["cross_app"];
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}
