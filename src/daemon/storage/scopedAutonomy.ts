import { randomUUID } from "node:crypto";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type {
  AutonomyCapabilityGap,
  AutonomyCapabilityInventoryItem,
  AutonomyCapabilityStatus,
  AutonomyGeneratedToolSpec,
  AutonomyPermissionGrants,
  AutonomyPermissionMode,
  AutonomyPermissionProfile,
  AutonomyPermissionProfileScope,
  AutonomyPermissionProfileStatus,
  AutonomyRiskClass,
  AutonomyRunStatus,
  AutonomyRunSummary,
  AutonomyToolRunStatus,
  AutonomyToolRunSummary,
  ComputerUseFailureClass
} from "../../shared/protocol.js";

type ProfileRow = {
  id: string;
  name: string;
  mode: string;
  scope?: string | null;
  status: string;
  grants_json: string;
  safety_boundaries_json: string;
  max_uses?: number | null;
  used_count?: number | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  session_id?: string | null;
  goal: string;
  status: string;
  permission_profile_id?: string | null;
  eval_run_id?: string | null;
  dag_run_id?: string | null;
  gap_ids_json: string;
  tool_spec_ids_json: string;
  output_json: string;
  failure_class?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

type GapRow = {
  id: string;
  run_id?: string | null;
  category: string;
  requested_capability: string;
  reason: string;
  operations_json?: string;
  risk_class?: string;
  evidence_needs_json?: string;
  fallback_plan_json?: string;
  blocker_classification?: string;
  required_grants_json: string;
  suggested_tool_id?: string | null;
  proposed_tool_json?: string;
  blockers_json: string;
  created_at: string;
};

type ToolSpecRow = {
  id: string;
  name: string;
  capability: string;
  version: string;
  status: string;
  template_id: string;
  entrypoint_kind: string;
  description: string;
  required_grants_json: string;
  smoke_tests_json: string;
  artifacts_json: string;
  manifest_json?: string;
  source_hash?: string | null;
  activated_at?: string | null;
  stability_rating?: string | null;
  created_at: string;
  updated_at: string;
};

type ToolRunRow = {
  id: string;
  tool_spec_id: string;
  autonomy_run_id?: string | null;
  eval_run_id?: string | null;
  status: string;
  mode: string;
  input_json: string;
  output_json: string;
  started_at?: string | null;
  completed_at?: string | null;
  elapsed_ms?: number | null;
  last_error?: string | null;
  rollback_json?: string;
  created_at: string;
  updated_at: string;
};

type CapabilityInventoryRow = {
  id: string;
  capability: string;
  status: string;
  source: string;
  operations_json: string;
  risk_class: string;
  required_grants_json: string;
  tool_spec_id?: string | null;
  blockers_json: string;
  created_at: string;
  updated_at: string;
};

export type AutonomyPermissionProfileCreateInput = {
  id?: string;
  name: string;
  mode?: AutonomyPermissionMode;
  scope?: AutonomyPermissionProfileScope;
  status?: AutonomyPermissionProfileStatus;
  grants?: Partial<AutonomyPermissionGrants>;
  safetyBoundaries?: string[];
  maxUses?: number;
  usedCount?: number;
  expiresAt?: string;
  createdAt?: string;
};

export type AutonomyPermissionProfileUpdateInput = {
  id: string;
  name?: string;
  mode?: AutonomyPermissionMode;
  scope?: AutonomyPermissionProfileScope;
  status?: AutonomyPermissionProfileStatus;
  grants?: Partial<AutonomyPermissionGrants>;
  safetyBoundaries?: string[];
  maxUses?: number | null;
  usedCount?: number;
  expiresAt?: string | null;
  updatedAt?: string;
};

export type AutonomyRunCreateInput = {
  id?: string;
  sessionId?: string;
  goal: string;
  status?: AutonomyRunStatus;
  permissionProfileId?: string;
  evalRunId?: string;
  dagRunId?: string;
  gapIds?: string[];
  toolSpecIds?: string[];
  output?: unknown;
  failureClass?: ComputerUseFailureClass;
  createdAt?: string;
};

export type AutonomyRunUpdateInput = {
  id: string;
  status?: AutonomyRunStatus;
  permissionProfileId?: string | null;
  evalRunId?: string | null;
  dagRunId?: string | null;
  gapIds?: string[];
  toolSpecIds?: string[];
  output?: unknown;
  failureClass?: ComputerUseFailureClass | null;
  completedAt?: string | null;
  updatedAt?: string;
};

export type AutonomyCapabilityGapCreateInput = Omit<AutonomyCapabilityGap, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

export type AutonomyGeneratedToolSpecUpsertInput = Omit<AutonomyGeneratedToolSpec, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AutonomyToolRunCreateInput = {
  id?: string;
  toolSpecId: string;
  autonomyRunId?: string;
  evalRunId?: string;
  status?: AutonomyToolRunStatus;
  mode: AutonomyToolRunSummary["mode"];
  input?: unknown;
  output?: unknown;
  rollback?: unknown;
  startedAt?: string;
  createdAt?: string;
};

export type AutonomyToolRunUpdateInput = {
  id: string;
  status?: AutonomyToolRunStatus;
  output?: unknown;
  startedAt?: string | null;
  completedAt?: string | null;
  elapsedMs?: number | null;
  lastError?: string | null;
  rollback?: unknown;
  updatedAt?: string;
};

export type AutonomyCapabilityInventoryUpsertInput = Omit<AutonomyCapabilityInventoryItem, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export function createAutonomyPermissionProfile(
  database: NodeDatabaseSync,
  input: AutonomyPermissionProfileCreateInput
): AutonomyPermissionProfile {
  const now = input.createdAt ?? new Date().toISOString();
  const profile: AutonomyPermissionProfile = {
    id: input.id?.trim() || `autonomy-profile-${randomUUID()}`,
    name: input.name.trim() || "Scoped autonomy",
    mode: input.mode ?? "ask",
    scope: input.scope ?? "persistent",
    status: input.status ?? "active",
    grants: normalizeGrants(input.grants),
    safetyBoundaries: normalizeStringArray(input.safetyBoundaries, defaultSafetyBoundaries()),
    usedCount: normalizeNonNegativeInteger(input.usedCount, 0),
    maxUses: input.maxUses === undefined ? undefined : normalizePositiveInteger(input.maxUses, 1),
    expiresAt: normalizeOptionalString(input.expiresAt),
    createdAt: now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO autonomy_permission_profiles (
        id, name, mode, scope, status, grants_json, safety_boundaries_json,
        max_uses, used_count, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      profile.id,
      profile.name,
      profile.mode,
      profile.scope,
      profile.status,
      stringifyJson(profile.grants),
      stringifyJson(profile.safetyBoundaries),
      profile.maxUses ?? null,
      profile.usedCount,
      profile.expiresAt ?? null,
      profile.createdAt,
      profile.updatedAt
    );
  return profile;
}

export function readAutonomyPermissionProfile(
  database: NodeDatabaseSync,
  id: string
): AutonomyPermissionProfile | null {
  const row = database.prepare("SELECT * FROM autonomy_permission_profiles WHERE id = ?").get(id) as ProfileRow | undefined;
  return row ? mapProfileRow(row) : null;
}

export function listAutonomyPermissionProfiles(
  database: NodeDatabaseSync,
  input: { status?: AutonomyPermissionProfileStatus; limit?: number } = {}
): AutonomyPermissionProfile[] {
  const values: Array<string | number> = [];
  const where = input.status ? "WHERE status = ?" : "";
  if (input.status) {
    values.push(input.status);
  }
  values.push(normalizePositiveInteger(input.limit, 50));
  const rows = database
    .prepare(`SELECT * FROM autonomy_permission_profiles ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...values) as ProfileRow[];
  return rows.map(mapProfileRow);
}

export function updateAutonomyPermissionProfile(
  database: NodeDatabaseSync,
  input: AutonomyPermissionProfileUpdateInput
): AutonomyPermissionProfile {
  const current = readAutonomyPermissionProfile(database, input.id);
  if (!current) {
    throw new Error(`Autonomy permission profile not found: ${input.id}`);
  }
  const updated: AutonomyPermissionProfile = {
    ...current,
    name: input.name?.trim() || current.name,
    mode: input.mode ?? current.mode,
    scope: input.scope ?? current.scope,
    status: input.status ?? current.status,
    grants: input.grants ? normalizeGrants({ ...current.grants, ...input.grants }) : current.grants,
    safetyBoundaries: input.safetyBoundaries ? normalizeStringArray(input.safetyBoundaries, current.safetyBoundaries) : current.safetyBoundaries,
    usedCount: input.usedCount === undefined ? current.usedCount : normalizeNonNegativeInteger(input.usedCount, current.usedCount),
    maxUses: input.maxUses === undefined ? current.maxUses : input.maxUses === null ? undefined : normalizePositiveInteger(input.maxUses, 1),
    expiresAt: input.expiresAt === undefined ? current.expiresAt : input.expiresAt ?? undefined,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `UPDATE autonomy_permission_profiles
       SET name = ?, mode = ?, scope = ?, status = ?, grants_json = ?, safety_boundaries_json = ?,
           max_uses = ?, used_count = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.name,
      updated.mode,
      updated.scope,
      updated.status,
      stringifyJson(updated.grants),
      stringifyJson(updated.safetyBoundaries),
      updated.maxUses ?? null,
      updated.usedCount,
      updated.expiresAt ?? null,
      updated.updatedAt,
      updated.id
    );
  return updated;
}

export function createAutonomyRun(database: NodeDatabaseSync, input: AutonomyRunCreateInput): AutonomyRunSummary {
  const now = input.createdAt ?? new Date().toISOString();
  const run: AutonomyRunSummary = {
    id: input.id?.trim() || `autonomy-run-${randomUUID()}`,
    sessionId: normalizeOptionalString(input.sessionId),
    goal: input.goal,
    status: input.status ?? "planned",
    permissionProfileId: normalizeOptionalString(input.permissionProfileId),
    evalRunId: normalizeOptionalString(input.evalRunId),
    dagRunId: normalizeOptionalString(input.dagRunId),
    gapIds: normalizeStringArray(input.gapIds, []),
    toolSpecIds: normalizeStringArray(input.toolSpecIds, []),
    output: input.output ?? {},
    failureClass: input.failureClass,
    createdAt: now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO autonomy_runs (
        id, session_id, goal, status, permission_profile_id, eval_run_id, dag_run_id,
        gap_ids_json, tool_spec_ids_json, output_json, failure_class, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.sessionId ?? null,
      run.goal,
      run.status,
      run.permissionProfileId ?? null,
      run.evalRunId ?? null,
      run.dagRunId ?? null,
      stringifyJson(run.gapIds),
      stringifyJson(run.toolSpecIds),
      stringifyJson(run.output ?? {}),
      run.failureClass ?? null,
      run.createdAt,
      run.updatedAt
    );
  return run;
}

export function readAutonomyRun(database: NodeDatabaseSync, id: string): AutonomyRunSummary | null {
  const row = database.prepare("SELECT * FROM autonomy_runs WHERE id = ?").get(id) as RunRow | undefined;
  return row ? mapRunRow(row) : null;
}

export function listAutonomyRuns(
  database: NodeDatabaseSync,
  input: { sessionId?: string; statuses?: AutonomyRunStatus[]; limit?: number } = {}
): AutonomyRunSummary[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.sessionId) {
    clauses.push("session_id = ?");
    values.push(input.sessionId);
  }
  if (input.statuses?.length) {
    clauses.push(`status IN (${input.statuses.map(() => '?').join(", ")})`);
    values.push(...input.statuses);
  }
  values.push(normalizePositiveInteger(input.limit, 100));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM autonomy_runs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as RunRow[];
  return rows.map(mapRunRow);
}

export function updateAutonomyRun(database: NodeDatabaseSync, input: AutonomyRunUpdateInput): AutonomyRunSummary {
  const current = readAutonomyRun(database, input.id);
  if (!current) {
    throw new Error(`Autonomy run not found: ${input.id}`);
  }
  const updated: AutonomyRunSummary = {
    ...current,
    status: input.status ?? current.status,
    permissionProfileId: input.permissionProfileId === undefined ? current.permissionProfileId : input.permissionProfileId ?? undefined,
    evalRunId: input.evalRunId === undefined ? current.evalRunId : input.evalRunId ?? undefined,
    dagRunId: input.dagRunId === undefined ? current.dagRunId : input.dagRunId ?? undefined,
    gapIds: input.gapIds ?? current.gapIds,
    toolSpecIds: input.toolSpecIds ?? current.toolSpecIds,
    output: input.output ?? current.output,
    failureClass: input.failureClass === undefined ? current.failureClass : input.failureClass ?? undefined,
    completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt ?? undefined,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `UPDATE autonomy_runs
       SET status = ?, permission_profile_id = ?, eval_run_id = ?, dag_run_id = ?,
           gap_ids_json = ?, tool_spec_ids_json = ?, output_json = ?,
           failure_class = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.status,
      updated.permissionProfileId ?? null,
      updated.evalRunId ?? null,
      updated.dagRunId ?? null,
      stringifyJson(updated.gapIds),
      stringifyJson(updated.toolSpecIds),
      stringifyJson(updated.output ?? {}),
      updated.failureClass ?? null,
      updated.completedAt ?? null,
      updated.updatedAt,
      updated.id
    );
  return updated;
}

export function recordAutonomyCapabilityGap(
  database: NodeDatabaseSync,
  input: AutonomyCapabilityGapCreateInput
): AutonomyCapabilityGap {
  const gap: AutonomyCapabilityGap = {
    ...input,
    id: input.id?.trim() || `autonomy-gap-${randomUUID()}`,
    operations: normalizeStringArray(input.operations, []),
    riskClass: normalizeRiskClass(input.riskClass, "side_effect"),
    evidenceNeeds: normalizeStringArray(input.evidenceNeeds, []),
    fallbackPlan: normalizeStringArray(input.fallbackPlan, []),
    blockerClassification: input.blockerClassification ?? "none",
    blockers: normalizeStringArray(input.blockers, []),
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `INSERT INTO autonomy_capability_gaps (
        id, run_id, category, requested_capability, reason, operations_json,
        risk_class, evidence_needs_json, fallback_plan_json, blocker_classification,
        required_grants_json, suggested_tool_id, proposed_tool_json, blockers_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      gap.id,
      gap.runId ?? null,
      gap.category,
      gap.requestedCapability,
      gap.reason,
      stringifyJson(gap.operations),
      gap.riskClass,
      stringifyJson(gap.evidenceNeeds),
      stringifyJson(gap.fallbackPlan),
      gap.blockerClassification,
      stringifyJson(gap.requiredGrants),
      gap.suggestedToolId ?? null,
      stringifyJson(gap.proposedTool ?? {}),
      stringifyJson(gap.blockers),
      gap.createdAt
    );
  return gap;
}

export function listAutonomyCapabilityGaps(database: NodeDatabaseSync, runId: string): AutonomyCapabilityGap[] {
  const rows = database
    .prepare("SELECT * FROM autonomy_capability_gaps WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as GapRow[];
  return rows.map(mapGapRow);
}

export function upsertAutonomyToolSpec(
  database: NodeDatabaseSync,
  input: AutonomyGeneratedToolSpecUpsertInput
): AutonomyGeneratedToolSpec {
  const now = input.updatedAt ?? new Date().toISOString();
  const id = input.id?.trim() || `autonomy-tool-${randomUUID()}`;
  const existing = readAutonomyToolSpec(database, id);
  const spec: AutonomyGeneratedToolSpec = {
    ...input,
    id,
    artifacts: input.artifacts ?? existing?.artifacts ?? [],
    manifest: input.manifest ?? existing?.manifest,
    sourceHash: input.sourceHash ?? existing?.sourceHash,
    activatedAt: input.activatedAt ?? existing?.activatedAt,
    stabilityRating: input.stabilityRating ?? existing?.stabilityRating ?? input.manifest?.stability.rating ?? "unknown",
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO autonomy_tool_specs (
        id, name, capability, version, status, template_id, entrypoint_kind,
        description, required_grants_json, smoke_tests_json, artifacts_json,
        manifest_json, source_hash, activated_at, stability_rating, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        capability = excluded.capability,
        version = excluded.version,
        status = excluded.status,
        template_id = excluded.template_id,
        entrypoint_kind = excluded.entrypoint_kind,
        description = excluded.description,
        required_grants_json = excluded.required_grants_json,
        smoke_tests_json = excluded.smoke_tests_json,
        artifacts_json = excluded.artifacts_json,
        manifest_json = excluded.manifest_json,
        source_hash = excluded.source_hash,
        activated_at = excluded.activated_at,
        stability_rating = excluded.stability_rating,
        updated_at = excluded.updated_at`
    )
    .run(
      spec.id,
      spec.name,
      spec.capability,
      spec.version,
      spec.status,
      spec.templateId,
      spec.entrypointKind,
      spec.description,
      stringifyJson(spec.requiredGrants),
      stringifyJson(spec.smokeTests),
      stringifyJson(spec.artifacts),
      stringifyJson(spec.manifest ?? {}),
      spec.sourceHash ?? null,
      spec.activatedAt ?? null,
      spec.stabilityRating ?? "unknown",
      spec.createdAt,
      spec.updatedAt
    );
  return spec;
}

export function readAutonomyToolSpec(database: NodeDatabaseSync, id: string): AutonomyGeneratedToolSpec | null {
  const row = database.prepare("SELECT * FROM autonomy_tool_specs WHERE id = ?").get(id) as ToolSpecRow | undefined;
  return row ? mapToolSpecRow(row) : null;
}

export function listAutonomyToolSpecs(
  database: NodeDatabaseSync,
  input: { capability?: string; limit?: number } = {}
): AutonomyGeneratedToolSpec[] {
  const values: Array<string | number> = [];
  const where = input.capability ? "WHERE capability = ?" : "";
  if (input.capability) {
    values.push(input.capability);
  }
  values.push(normalizePositiveInteger(input.limit, 100));
  const rows = database
    .prepare(`SELECT * FROM autonomy_tool_specs ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...values) as ToolSpecRow[];
  return rows.map(mapToolSpecRow);
}

export function createAutonomyToolRun(database: NodeDatabaseSync, input: AutonomyToolRunCreateInput): AutonomyToolRunSummary {
  const now = input.createdAt ?? new Date().toISOString();
  const run: AutonomyToolRunSummary = {
    id: input.id?.trim() || `autonomy-tool-run-${randomUUID()}`,
    toolSpecId: input.toolSpecId,
    autonomyRunId: normalizeOptionalString(input.autonomyRunId),
    evalRunId: normalizeOptionalString(input.evalRunId),
    status: input.status ?? "queued",
    mode: input.mode,
    input: input.input ?? {},
    output: input.output ?? {},
    startedAt: input.startedAt,
    createdAt: now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO autonomy_tool_runs (
        id, tool_spec_id, autonomy_run_id, eval_run_id, status, mode, input_json,
        output_json, rollback_json, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.toolSpecId,
      run.autonomyRunId ?? null,
      run.evalRunId ?? null,
      run.status,
      run.mode,
      stringifyJson(run.input ?? {}),
      stringifyJson(run.output ?? {}),
      stringifyJson(input.rollback ?? {}),
      run.startedAt ?? null,
      run.createdAt,
      run.updatedAt
    );
  return run;
}

export function updateAutonomyToolRun(database: NodeDatabaseSync, input: AutonomyToolRunUpdateInput): AutonomyToolRunSummary {
  const current = readAutonomyToolRun(database, input.id);
  if (!current) {
    throw new Error(`Autonomy tool run not found: ${input.id}`);
  }
  const updated: AutonomyToolRunSummary = {
    ...current,
    status: input.status ?? current.status,
    output: input.output ?? current.output,
    startedAt: input.startedAt === undefined ? current.startedAt : input.startedAt ?? undefined,
    completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt ?? undefined,
    elapsedMs: input.elapsedMs === undefined ? current.elapsedMs : input.elapsedMs ?? undefined,
    lastError: input.lastError === undefined ? current.lastError : input.lastError ?? undefined,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  database
    .prepare(
      `UPDATE autonomy_tool_runs
       SET status = ?, output_json = ?, rollback_json = ?, started_at = ?, completed_at = ?,
           elapsed_ms = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updated.status,
      stringifyJson(updated.output ?? {}),
      stringifyJson(input.rollback ?? {}),
      updated.startedAt ?? null,
      updated.completedAt ?? null,
      updated.elapsedMs ?? null,
      updated.lastError ?? null,
      updated.updatedAt,
      updated.id
    );
  return updated;
}

export function readAutonomyToolRun(database: NodeDatabaseSync, id: string): AutonomyToolRunSummary | null {
  const row = database.prepare("SELECT * FROM autonomy_tool_runs WHERE id = ?").get(id) as ToolRunRow | undefined;
  return row ? mapToolRunRow(row) : null;
}

export function listAutonomyToolRuns(
  database: NodeDatabaseSync,
  input: { toolSpecId?: string; autonomyRunId?: string; limit?: number } = {}
): AutonomyToolRunSummary[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.toolSpecId) {
    clauses.push("tool_spec_id = ?");
    values.push(input.toolSpecId);
  }
  if (input.autonomyRunId) {
    clauses.push("autonomy_run_id = ?");
    values.push(input.autonomyRunId);
  }
  values.push(normalizePositiveInteger(input.limit, 100));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM autonomy_tool_runs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as ToolRunRow[];
  return rows.map(mapToolRunRow);
}

export function upsertAutonomyCapabilityInventory(
  database: NodeDatabaseSync,
  input: AutonomyCapabilityInventoryUpsertInput
): AutonomyCapabilityInventoryItem {
  const now = input.updatedAt ?? new Date().toISOString();
  const id = input.id?.trim() || `autonomy-capability-${input.capability}`;
  const existing = readAutonomyCapabilityInventoryItem(database, id);
  const item: AutonomyCapabilityInventoryItem = {
    id,
    capability: input.capability,
    status: input.status,
    source: input.source,
    operations: normalizeStringArray(input.operations, existing?.operations ?? []),
    riskClass: normalizeRiskClass(input.riskClass, existing?.riskClass ?? "side_effect"),
    requiredGrants: input.requiredGrants ?? existing?.requiredGrants ?? [],
    toolSpecId: input.toolSpecId ?? existing?.toolSpecId,
    blockers: normalizeStringArray(input.blockers, existing?.blockers ?? []),
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now
  };
  database
    .prepare(
      `INSERT INTO autonomy_capability_inventory (
        id, capability, status, source, operations_json, risk_class,
        required_grants_json, tool_spec_id, blockers_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        capability = excluded.capability,
        status = excluded.status,
        source = excluded.source,
        operations_json = excluded.operations_json,
        risk_class = excluded.risk_class,
        required_grants_json = excluded.required_grants_json,
        tool_spec_id = excluded.tool_spec_id,
        blockers_json = excluded.blockers_json,
        updated_at = excluded.updated_at`
    )
    .run(
      item.id,
      item.capability,
      item.status,
      item.source,
      stringifyJson(item.operations),
      item.riskClass,
      stringifyJson(item.requiredGrants),
      item.toolSpecId ?? null,
      stringifyJson(item.blockers),
      item.createdAt,
      item.updatedAt
    );
  return item;
}

export function readAutonomyCapabilityInventoryItem(
  database: NodeDatabaseSync,
  id: string
): AutonomyCapabilityInventoryItem | null {
  const row = database.prepare("SELECT * FROM autonomy_capability_inventory WHERE id = ?").get(id) as CapabilityInventoryRow | undefined;
  return row ? mapCapabilityInventoryRow(row) : null;
}

export function listAutonomyCapabilityInventory(
  database: NodeDatabaseSync,
  input: { status?: AutonomyCapabilityStatus; capability?: string; limit?: number } = {}
): AutonomyCapabilityInventoryItem[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.status) {
    clauses.push("status = ?");
    values.push(input.status);
  }
  if (input.capability) {
    clauses.push("capability = ?");
    values.push(input.capability);
  }
  values.push(normalizePositiveInteger(input.limit, 100));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM autonomy_capability_inventory ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...values) as CapabilityInventoryRow[];
  return rows.map(mapCapabilityInventoryRow);
}

function mapProfileRow(row: ProfileRow): AutonomyPermissionProfile {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode as AutonomyPermissionMode,
    scope: row.scope === "one_time" ? "one_time" : "persistent",
    status: row.status as AutonomyPermissionProfileStatus,
    grants: normalizeGrants(parseJson(row.grants_json, {})),
    safetyBoundaries: normalizeStringArray(parseJson(row.safety_boundaries_json, []), defaultSafetyBoundaries()),
    usedCount: normalizeNonNegativeInteger(row.used_count, 0),
    maxUses: row.max_uses ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRunRow(row: RunRow): AutonomyRunSummary {
  return {
    id: row.id,
    sessionId: row.session_id ?? undefined,
    goal: row.goal,
    status: row.status as AutonomyRunStatus,
    permissionProfileId: row.permission_profile_id ?? undefined,
    evalRunId: row.eval_run_id ?? undefined,
    dagRunId: row.dag_run_id ?? undefined,
    gapIds: parseStringArray(row.gap_ids_json),
    toolSpecIds: parseStringArray(row.tool_spec_ids_json),
    output: parseJson(row.output_json, {}),
    failureClass: row.failure_class as ComputerUseFailureClass | undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined
  };
}

function mapGapRow(row: GapRow): AutonomyCapabilityGap {
  return {
    id: row.id,
    runId: row.run_id ?? undefined,
    category: row.category as AutonomyCapabilityGap["category"],
    requestedCapability: row.requested_capability,
    reason: row.reason,
    operations: parseStringArray(row.operations_json ?? "[]"),
    riskClass: normalizeRiskClass(row.risk_class, "side_effect"),
    evidenceNeeds: parseStringArray(row.evidence_needs_json ?? "[]"),
    fallbackPlan: parseStringArray(row.fallback_plan_json ?? "[]"),
    blockerClassification: normalizeBlockerClassification(row.blocker_classification),
    requiredGrants: parseJson(row.required_grants_json, []),
    suggestedToolId: row.suggested_tool_id ?? undefined,
    proposedTool: parseJson(row.proposed_tool_json ?? "{}", undefined),
    blockers: parseStringArray(row.blockers_json),
    createdAt: row.created_at
  };
}

function mapToolSpecRow(row: ToolSpecRow): AutonomyGeneratedToolSpec {
  return {
    id: row.id,
    name: row.name,
    capability: row.capability,
    version: row.version,
    status: row.status as AutonomyGeneratedToolSpec["status"],
    templateId: row.template_id,
    entrypointKind: row.entrypoint_kind as AutonomyGeneratedToolSpec["entrypointKind"],
    description: row.description,
    requiredGrants: parseJson(row.required_grants_json, []),
    smokeTests: parseJson(row.smoke_tests_json, []),
    artifacts: parseJson(row.artifacts_json, []),
    manifest: parseJson(row.manifest_json ?? "{}", undefined),
    sourceHash: row.source_hash ?? undefined,
    activatedAt: row.activated_at ?? undefined,
    stabilityRating: row.stability_rating as AutonomyGeneratedToolSpec["stabilityRating"] ?? "unknown",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapToolRunRow(row: ToolRunRow): AutonomyToolRunSummary {
  return {
    id: row.id,
    toolSpecId: row.tool_spec_id,
    autonomyRunId: row.autonomy_run_id ?? undefined,
    evalRunId: row.eval_run_id ?? undefined,
    status: row.status as AutonomyToolRunStatus,
    mode: row.mode as AutonomyToolRunSummary["mode"],
    input: parseJson(row.input_json, {}),
    output: parseJson(row.output_json, {}),
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    elapsedMs: row.elapsed_ms ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCapabilityInventoryRow(row: CapabilityInventoryRow): AutonomyCapabilityInventoryItem {
  return {
    id: row.id,
    capability: row.capability as AutonomyCapabilityInventoryItem["capability"],
    status: row.status as AutonomyCapabilityInventoryItem["status"],
    source: row.source as AutonomyCapabilityInventoryItem["source"],
    operations: parseStringArray(row.operations_json),
    riskClass: normalizeRiskClass(row.risk_class, "side_effect"),
    requiredGrants: parseJson(row.required_grants_json, []),
    toolSpecId: row.tool_spec_id ?? undefined,
    blockers: parseStringArray(row.blockers_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeGrants(input: Partial<AutonomyPermissionGrants> | unknown): AutonomyPermissionGrants {
  const record = input && typeof input === "object" ? input as Partial<AutonomyPermissionGrants> : {};
  const filesystem = record.filesystem && typeof record.filesystem === "object"
    ? record.filesystem as Partial<AutonomyPermissionGrants["filesystem"]>
    : {};
  const commands = record.commands && typeof record.commands === "object"
    ? record.commands as Partial<AutonomyPermissionGrants["commands"]>
    : {};
  return {
    network: record.network !== false,
    networkDomains: normalizeStringArray(record.networkDomains, []),
    browserAutomation: Boolean(record.browserAutomation),
    browserDomains: normalizeStringArray(record.browserDomains, []),
    filesystem: {
      readRoots: normalizeStringArray(filesystem.readRoots, []),
      writeRoots: normalizeStringArray(filesystem.writeRoots, [])
    },
    commands: {
      allowPrefixes: normalizeStringArray(commands.allowPrefixes, []),
      denyPatterns: normalizeStringArray(commands.denyPatterns, defaultDenyPatterns())
    },
    packageInstall: Boolean(record.packageInstall),
    packageAllowlist: normalizeStringArray(record.packageAllowlist, ["file:*"]),
    osMutation: Boolean(record.osMutation),
    generatedToolMaterialization: Boolean(record.generatedToolMaterialization),
    generatedToolExecution: Boolean(record.generatedToolExecution),
    generatedCode: Boolean(record.generatedCode),
    credentialAccess: record.credentialAccess === "ask" ? "ask" : "never",
    riskClasses: normalizeRiskClasses(record.riskClasses),
    maxRuntimeMs: normalizePositiveInteger(record.maxRuntimeMs, 30_000),
    maxOutputBytes: normalizePositiveInteger(record.maxOutputBytes, 2 * 1024 * 1024),
    maxIterations: normalizePositiveInteger(record.maxIterations, 3)
  };
}

function defaultSafetyBoundaries(): string[] {
  return [
    "no_credential_access",
    "no_restricted_page_bypass",
    "no_destructive_os_mutation_without_explicit_scope",
    "generated_tools_must_pass_smoke",
    "eval_ledger_records_all_steps"
  ];
}

function defaultDenyPatterns(): string[] {
  return [
    "password",
    "passwd",
    "token",
    "cookie",
    "credential",
    "secret",
    "api_key",
    "rm -rf",
    "Remove-Item -Recurse",
    "format"
  ];
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
  return normalizeStringArray(parseJson(value, []), []);
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function normalizeRiskClasses(value: unknown): AutonomyRiskClass[] {
  const allowed: AutonomyRiskClass[] = ["read_only", "reversible", "side_effect", "high_risk"];
  const values = normalizeStringArray(value, allowed);
  const normalized = values.filter((item): item is AutonomyRiskClass =>
    item === "read_only" || item === "reversible" || item === "side_effect" || item === "high_risk" || item === "credential"
  );
  return normalized.length ? [...new Set(normalized)] : allowed;
}

function normalizeRiskClass(value: unknown, fallback: AutonomyRiskClass): AutonomyRiskClass {
  return value === "read_only" || value === "reversible" || value === "side_effect" || value === "high_risk" || value === "credential"
    ? value
    : fallback;
}

function normalizeBlockerClassification(value: unknown): AutonomyCapabilityGap["blockerClassification"] {
  return value === "permission" || value === "unsupported_template" || value === "external_contract" || value === "safety_boundary"
    ? value
    : "none";
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
