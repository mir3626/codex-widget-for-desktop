import { initialProductStateMigration } from "./migrations/v1InitialProductState.js";
import { semanticMemoryMigration } from "./migrations/v2SemanticMemory.js";
import { capabilityJobsMigration } from "./migrations/v3CapabilityJobs.js";

export type StorageMigration = {
  version: number;
  name: string;
  sql: string;
};

export const STORAGE_MIGRATIONS: StorageMigration[] = [
  initialProductStateMigration,
  semanticMemoryMigration,
  capabilityJobsMigration
];

export const LATEST_STORAGE_SCHEMA_VERSION = STORAGE_MIGRATIONS[STORAGE_MIGRATIONS.length - 1]?.version ?? 0;
