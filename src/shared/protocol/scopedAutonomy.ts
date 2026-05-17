import type {
  CapabilityDagNodeKind,
  ComputerUseFailureClass
} from "./researchArchitecture.js";

export type AutonomyPermissionMode = "off" | "ask" | "scoped_yolo";

export type AutonomyPermissionProfileStatus = "active" | "disabled" | "expired";

export type AutonomyPermissionProfileScope = "one_time" | "persistent";

export type AutonomyCredentialPolicy = "never" | "ask";

export type AutonomyRiskClass = "read_only" | "reversible" | "side_effect" | "high_risk" | "credential";

export type AutonomyCredentialLeaseStatus = "active" | "revoked" | "expired";

export type AutonomyCredentialLeaseScope =
  | "browser_profile"
  | "site_session"
  | "credential_vault"
  | "cookie_jar";

export type AutonomyCredentialVaultRef = {
  id: string;
  provider: "windows_credential_manager" | "dpapi_user" | "external" | "manual_user_handoff";
  label: string;
  secretKind: "password" | "token" | "cookie" | "session" | "other";
  redacted: true;
};

export type AutonomyCredentialLeaseGrant = {
  id: string;
  status: AutonomyCredentialLeaseStatus;
  scope: AutonomyCredentialLeaseScope;
  domains: string[];
  purposes: string[];
  vaultRefs: AutonomyCredentialVaultRef[];
  maxUses?: number;
  usedCount?: number;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  revokedAt?: string;
  revokeReason?: string;
};

export type AutonomyCredentialRedactionPolicy = {
  credentials: "redact";
  cookies: "never_store";
  localPaths: "basename_or_hash";
  browserHistory: "domain_only";
  screenshots: "metadata_only" | "not_stored";
  debugBundles: "redacted_summary";
  semanticMemory: "no_secret_values";
};

export type AutonomyPermissionGrants = {
  network: boolean;
  networkDomains: string[];
  browserAutomation: boolean;
  browserDomains: string[];
  filesystem: {
    readRoots: string[];
    writeRoots: string[];
  };
  commands: {
    allowPrefixes: string[];
    denyPatterns: string[];
  };
  packageInstall: boolean;
  packageAllowlist: string[];
  osMutation: boolean;
  generatedToolMaterialization: boolean;
  generatedToolExecution: boolean;
  generatedCode: boolean;
  credentialAccess: AutonomyCredentialPolicy;
  credentialLeases?: AutonomyCredentialLeaseGrant[];
  redactionPolicy?: AutonomyCredentialRedactionPolicy;
  riskClasses: AutonomyRiskClass[];
  maxRuntimeMs: number;
  maxOutputBytes: number;
  maxIterations: number;
};

export type AutonomyPermissionProfile = {
  id: string;
  name: string;
  mode: AutonomyPermissionMode;
  scope: AutonomyPermissionProfileScope;
  status: AutonomyPermissionProfileStatus;
  grants: AutonomyPermissionGrants;
  safetyBoundaries: string[];
  usedCount: number;
  maxUses?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutonomyPermissionRequirement =
  | { type: "network_domain"; value: string; reason: string }
  | { type: "browser_domain"; value: string; reason: string }
  | { type: "filesystem_read"; value: string; reason: string }
  | { type: "filesystem_write"; value: string; reason: string }
  | { type: "command"; value: string; reason: string }
  | { type: "network"; value: string; reason: string }
  | { type: "browser_automation"; value: string; reason: string }
  | { type: "package_install"; value: string; reason: string }
  | { type: "os_mutation"; value: string; reason: string }
  | { type: "generated_tool_materialization"; value: string; reason: string }
  | { type: "generated_tool_execution"; value: string; reason: string }
  | { type: "generated_code"; value: string; reason: string }
  | { type: "risk_class"; value: AutonomyRiskClass; reason: string }
  | { type: "credential_access"; value: string; reason: string };

export type AutonomyPermissionDecision = {
  allowed: boolean;
  mode: AutonomyPermissionMode;
  profileId?: string;
  reason: string;
  missingRequirements: AutonomyPermissionRequirement[];
  usedRequirements: AutonomyPermissionRequirement[];
  safetyBoundaries: string[];
  credentialPolicy?: {
    status: "not_requested" | "allowed" | "blocked";
    reason: string;
    matchedLeaseIds: string[];
    activeLeaseCount: number;
    redactionPolicy: AutonomyCredentialRedactionPolicy;
    vaultAccess: "reference_only";
  };
};

export type AutonomyRunStatus =
  | "planned"
  | "blocked"
  | "implementing"
  | "smoke_testing"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AutonomyCapabilityGapCategory =
  | "web_research"
  | "browser_chrome"
  | "native_windows"
  | "asr_runtime"
  | "terminal_tool"
  | "download_verification"
  | "file_picker"
  | "document_conversion"
  | "source_extraction"
  | "package_install"
  | "unknown";

export type AutonomyCapabilityClass =
  | "web_research_to_pdf"
  | "browser_chrome_direct_control"
  | "browser_download_verify"
  | "file_picker"
  | "native_windows_workflow"
  | "terminal_generated_tool"
  | "package_install_helper"
  | "local_document_conversion"
  | "source_extraction"
  | "local_asr_runtime"
  | "unknown";

export type AutonomyCapabilityStatus = "available" | "generated" | "blocked" | "external_unavailable";

export type AutonomyCapabilityInventoryItem = {
  id: string;
  capability: AutonomyCapabilityClass;
  status: AutonomyCapabilityStatus;
  source: "builtin" | "generated" | "external" | "blocked";
  operations: string[];
  riskClass: AutonomyRiskClass;
  requiredGrants: AutonomyPermissionRequirement[];
  toolSpecId?: string;
  blockers: string[];
  createdAt: string;
  updatedAt: string;
};

export type AutonomyRequestDecomposition = {
  goal: string;
  operations: string[];
  expectedArtifacts: string[];
  riskClass: AutonomyRiskClass;
  evidenceNeeds: string[];
};

export type AutonomyCapabilityGap = {
  id: string;
  runId?: string;
  category: AutonomyCapabilityGapCategory;
  requestedCapability: AutonomyCapabilityClass | string;
  reason: string;
  operations: string[];
  riskClass: AutonomyRiskClass;
  evidenceNeeds: string[];
  fallbackPlan: string[];
  blockerClassification: "none" | "permission" | "unsupported_template" | "external_contract" | "safety_boundary";
  requiredGrants: AutonomyPermissionRequirement[];
  suggestedToolId?: string;
  proposedTool?: {
    templateId: string;
    entrypointKind: "node_script" | "internal_template";
    expectedArtifacts: string[];
  };
  blockers: string[];
  createdAt: string;
};

export type AutonomyGeneratedToolStatus =
  | "proposed"
  | "generating"
  | "materialized"
  | "smoke_passed"
  | "active"
  | "smoke_failed"
  | "blocked"
  | "retired";

export type AutonomyGeneratedToolManifest = {
  schemaVersion: "autonomy-tool-manifest.v1";
  toolId: string;
  capability: AutonomyCapabilityClass | string;
  entrypoint: string;
  commandAllowlist: string[];
  dependencies: Array<{
    name: string;
    version?: string;
    source: "builtin" | "npm" | "pip" | "system" | "none";
    installed: boolean;
  }>;
  smokeCommands: string[];
  artifactContract: Array<{
    role: string;
    mime: string;
    required: boolean;
  }>;
  rollback: Array<{
    type: "delete_path" | "deactivate_tool" | "delete_artifact";
    target: string;
    completed?: boolean;
  }>;
  provenance: {
    generatedBy: "reviewed_template" | "ad_hoc_generator";
    templateId: string;
    sourceHashes: Record<string, string>;
    iterations: number;
    generatedAt: string;
  };
  stability: {
    rating: "unknown" | "low" | "medium" | "high";
    rerunCount: number;
    lastRerunStatus?: "matched" | "changed" | "failed";
    externalDependencyWarnings: string[];
  };
};

export type AutonomyGeneratedToolSpec = {
  id: string;
  name: string;
  capability: string;
  version: string;
  status: AutonomyGeneratedToolStatus;
  templateId: string;
  entrypointKind: "node_script" | "internal_template";
  description: string;
  requiredGrants: AutonomyPermissionRequirement[];
  smokeTests: Array<{
    id: string;
    description: string;
    expectedArtifacts: string[];
  }>;
  artifacts: Array<{
    role: "entrypoint" | "source" | "manifest" | "fixture" | "smoke" | "report" | "pdf" | "debug" | "citation" | "rollback";
    path: string;
    mime: string;
    size?: number;
    sha256?: string;
  }>;
  manifest?: AutonomyGeneratedToolManifest;
  sourceHash?: string;
  activatedAt?: string;
  stabilityRating?: "unknown" | "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
};

export type AutonomyToolRunStatus =
  | "queued"
  | "blocked"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AutonomyToolRunSummary = {
  id: string;
  toolSpecId: string;
  autonomyRunId?: string;
  evalRunId?: string;
  status: AutonomyToolRunStatus;
  mode: "dependency_prepare" | "smoke" | "execute" | "rerun" | "rollback";
  input?: unknown;
  output?: unknown;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutonomyRunSummary = {
  id: string;
  sessionId?: string;
  goal: string;
  status: AutonomyRunStatus;
  permissionProfileId?: string;
  evalRunId?: string;
  dagRunId?: string;
  gapIds: string[];
  toolSpecIds: string[];
  output?: unknown;
  failureClass?: ComputerUseFailureClass;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type AutonomyPlanSummary = {
  run: AutonomyRunSummary;
  permission: AutonomyPermissionDecision;
  gaps: AutonomyCapabilityGap[];
  dagNodes: Array<{
    id: string;
    kind: CapabilityDagNodeKind;
    dependsOn: string[];
  }>;
};

export type AutonomyDebugBundle = {
  schemaVersion: "autonomy-debug-bundle.v1";
  generatedAt: string;
  run: AutonomyRunSummary;
  profile?: AutonomyPermissionProfile;
  gaps: AutonomyCapabilityGap[];
  tools: AutonomyGeneratedToolSpec[];
  toolRuns: AutonomyToolRunSummary[];
  eval?: {
    steps: unknown[];
    resources: unknown[];
  };
  redaction: {
    credentialFieldsRedacted: boolean;
    rawArtifactPathsRedacted: boolean;
  };
};
