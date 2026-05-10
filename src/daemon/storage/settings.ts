import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type {
  BrowserActionPolicy,
  ExecutionPermissionDecision,
  ExecutionPermissionSummary
} from "./types.js";

const SECRET_SETTING_PATTERN = /(?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|credential)/i;
const EXECUTION_PERMISSIONS_SETTING_KEY = "execution.permissions.v1";
const BROWSER_ACTION_POLICIES_SETTING_KEY = "browser-action.policies.v1";

type StoredExecutionPermission = {
  decision: ExecutionPermissionDecision;
  updatedAt: string;
};

export function assertPersistableSettingKey(key: string): void {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("Setting key is required.");
  }
  if (SECRET_SETTING_PATTERN.test(normalized)) {
    throw new Error(`Refusing to persist secret-like setting key: ${normalized}`);
  }
}

export function readAppSetting<T>(database: NodeDatabaseSync, key: string): T | null {
  const row = database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key.trim());
  if (typeof row?.value_json !== "string") {
    return null;
  }
  return JSON.parse(row.value_json) as T;
}

export function writeAppSetting(database: NodeDatabaseSync, key: string, value: unknown): void {
  assertPersistableSettingKey(key);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key.trim(), JSON.stringify(value), now);
}

export function readExecutionPermissions(database: NodeDatabaseSync): ExecutionPermissionSummary[] {
  const stored = readStoredExecutionPermissions(database);
  return Object.entries(stored)
    .map(([action, record]) => ({
      action,
      decision: record.decision,
      updatedAt: record.updatedAt
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.action.localeCompare(right.action));
}

export function readExecutionPermissionDecision(database: NodeDatabaseSync, action: string): ExecutionPermissionDecision {
  const actionKey = normalizeExecutionPermissionAction(action);
  if (!actionKey) {
    return "ask";
  }
  const decision = readStoredExecutionPermissions(database)[actionKey]?.decision;
  return decision === "allow" || decision === "deny" ? decision : "ask";
}

export function setExecutionPermission(
  database: NodeDatabaseSync,
  input: { action: string; decision: ExecutionPermissionDecision }
): ExecutionPermissionSummary[] {
  const action = normalizeExecutionPermissionAction(input.action);
  if (!action) {
    throw new Error("Execution permission action is required.");
  }
  const stored = readStoredExecutionPermissions(database);
  if (input.decision === "ask") {
    delete stored[action];
  } else {
    stored[action] = {
      decision: input.decision,
      updatedAt: new Date().toISOString()
    };
  }
  writeAppSetting(database, EXECUTION_PERMISSIONS_SETTING_KEY, stored);
  return readExecutionPermissions(database);
}

export function readBrowserActionPolicies(database: NodeDatabaseSync): BrowserActionPolicy[] {
  const stored = readAppSetting<BrowserActionPolicy[]>(database, BROWSER_ACTION_POLICIES_SETTING_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored
    .filter(isStoredBrowserActionPolicy)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export function setBrowserActionPolicy(database: NodeDatabaseSync, policy: BrowserActionPolicy): BrowserActionPolicy[] {
  const policies = readBrowserActionPolicies(database).filter((candidate) => candidate.id !== policy.id);
  policies.unshift(policy);
  writeAppSetting(database, BROWSER_ACTION_POLICIES_SETTING_KEY, policies.slice(0, 100));
  return readBrowserActionPolicies(database);
}

export function revokeBrowserActionPolicy(database: NodeDatabaseSync, policyId: string): BrowserActionPolicy[] {
  const id = policyId.trim();
  if (!id) {
    throw new Error("Browser Action policy id is required.");
  }
  const now = new Date().toISOString();
  const policies = readBrowserActionPolicies(database).map((policy) =>
    policy.id === id
      ? {
          ...policy,
          decision: "ask" as const,
          revokedAt: now,
          updatedAt: now
        }
      : policy
  );
  writeAppSetting(database, BROWSER_ACTION_POLICIES_SETTING_KEY, policies);
  return readBrowserActionPolicies(database);
}

function readStoredExecutionPermissions(database: NodeDatabaseSync): Record<string, StoredExecutionPermission> {
  const stored = readAppSetting<Record<string, StoredExecutionPermission>>(database, EXECUTION_PERMISSIONS_SETTING_KEY);
  const normalized: Record<string, StoredExecutionPermission> = {};
  if (!stored || typeof stored !== "object") {
    return normalized;
  }
  for (const [action, record] of Object.entries(stored)) {
    const actionKey = normalizeExecutionPermissionAction(action);
    if (!actionKey || typeof record !== "object" || record === null) {
      continue;
    }
    const decision = record.decision === "allow" || record.decision === "deny" ? record.decision : undefined;
    if (!decision) {
      continue;
    }
    normalized[actionKey] = {
      decision,
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : new Date().toISOString()
    };
  }
  return normalized;
}

function normalizeExecutionPermissionAction(action: string): string {
  return action.replace(/\s+/g, " ").trim().slice(0, 240);
}

function isStoredBrowserActionPolicy(value: unknown): value is BrowserActionPolicy {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<BrowserActionPolicy>;
  return typeof record.id === "string" &&
    (record.decision === "ask" || record.decision === "allow" || record.decision === "deny") &&
    typeof record.actionFamily === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string";
}
