#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STATUS_ALIASES = new Map([
  ['accepted', 'accepted'],
  ['accept', 'accepted'],
  ['deferred', 'deferred'],
  ['deferred-until', 'deferred'],
  ['defer', 'deferred'],
  ['closed-by-scope', 'closed-by-scope'],
  ['closed_by_scope', 'closed-by-scope'],
  ['closed-by-scope-change', 'closed-by-scope'],
  ['closed', 'closed-by-scope'],
  ['resolved', 'resolved'],
  ['acknowledged', 'acknowledged'],
  ['open', 'open'],
]);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizePendingRiskStatus(rawStatus) {
  const normalized = String(rawStatus ?? 'open').trim().toLowerCase();
  return STATUS_ALIASES.get(normalized) ?? 'open';
}

function migrateSprintStatus(root) {
  const statusPath = path.join(root, '.vibe', 'agent', 'sprint-status.json');
  if (!existsSync(statusPath)) {
    return 'missing';
  }

  const status = readJson(statusPath, null);
  if (!status || !Array.isArray(status.pendingRisks)) {
    return 'idempotent';
  }

  let changed = false;
  for (const risk of status.pendingRisks) {
    if (!risk || typeof risk !== 'object') {
      continue;
    }

    const nextStatus = normalizePendingRiskStatus(risk.status);
    if (risk.status !== nextStatus) {
      risk.statusReason =
        typeof risk.statusReason === 'string'
          ? risk.statusReason
          : `migrated legacy pendingRisk status ${String(risk.status)}`;
      risk.status = nextStatus;
      changed = true;
    }

    if (nextStatus !== 'open' && typeof risk.statusUpdatedAt !== 'string') {
      risk.statusUpdatedAt =
        typeof risk.resolvedAt === 'string'
          ? risk.resolvedAt
          : typeof risk.createdAt === 'string'
            ? risk.createdAt
            : new Date().toISOString();
      changed = true;
    }

    if (nextStatus === 'deferred' && typeof risk.deferredUntil !== 'string') {
      const legacyUntil =
        typeof risk.deferredUntilSprint === 'string'
          ? risk.deferredUntilSprint
          : typeof risk.until === 'string'
            ? risk.until
            : undefined;
      if (legacyUntil) {
        risk.deferredUntil = legacyUntil;
        changed = true;
      }
    }
  }

  if (changed) {
    writeJson(statusPath, status);
    return 'updated';
  }
  return 'idempotent';
}

function migrateBundlePolicy(root) {
  const configPath = path.join(root, '.vibe', 'config.json');
  if (!existsSync(configPath)) {
    return 'missing';
  }

  const config = readJson(configPath, {});
  const bundle = config.bundle && typeof config.bundle === 'object' ? config.bundle : null;
  if (!bundle || typeof bundle.policy === 'string') {
    return 'idempotent';
  }

  bundle.policy = bundle.enabled === true ? 'custom' : 'automatic';
  if (bundle.enabled !== true && typeof bundle.rationale !== 'string') {
    bundle.rationale = 'automatic bundle policy added by harness migration';
  }
  config.bundle = bundle;
  writeJson(configPath, config);
  return 'updated';
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const sprintStatus = migrateSprintStatus(root);
  const bundlePolicy = migrateBundlePolicy(root);
  process.stdout.write(`[migrate 1.7.3] sprintStatus=${sprintStatus} bundlePolicy=${bundlePolicy}\n`);
}

try {
  main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
