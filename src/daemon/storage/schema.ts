import { initialProductStateMigration } from "./migrations/v1InitialProductState.js";
import { semanticMemoryMigration } from "./migrations/v2SemanticMemory.js";
import { capabilityJobsMigration } from "./migrations/v3CapabilityJobs.js";
import { researchPerformanceArchitectureMigration } from "./migrations/v4ResearchPerformanceArchitecture.js";
import { scopedAutonomyToolsmithMigration } from "./migrations/v5ScopedAutonomyToolsmith.js";
import { scopedAutonomySelfImplementationMigration } from "./migrations/v6ScopedAutonomySelfImplementation.js";

export type StorageMigration = {
  version: number;
  name: string;
  sql: string;
};

export const STORAGE_MIGRATIONS: StorageMigration[] = [
  initialProductStateMigration,
  semanticMemoryMigration,
  capabilityJobsMigration,
  researchPerformanceArchitectureMigration,
  scopedAutonomyToolsmithMigration,
  scopedAutonomySelfImplementationMigration
];

export const LATEST_STORAGE_SCHEMA_VERSION = STORAGE_MIGRATIONS[STORAGE_MIGRATIONS.length - 1]?.version ?? 0;
