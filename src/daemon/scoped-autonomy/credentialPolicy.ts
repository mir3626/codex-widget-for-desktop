import type {
  AutonomyCredentialLeaseGrant,
  AutonomyCredentialRedactionPolicy,
  AutonomyPermissionGrants,
  AutonomyPermissionRequirement
} from "../../shared/protocol.js";

export type CredentialRequirementEvaluation = {
  allowed: boolean;
  reason: string;
  matchedLeaseIds: string[];
  activeLeaseCount: number;
  redactionPolicy: AutonomyCredentialRedactionPolicy;
  vaultAccess: "reference_only";
};

export function defaultCredentialRedactionPolicy(): AutonomyCredentialRedactionPolicy {
  return {
    credentials: "redact",
    cookies: "never_store",
    localPaths: "basename_or_hash",
    browserHistory: "domain_only",
    screenshots: "metadata_only",
    debugBundles: "redacted_summary",
    semanticMemory: "no_secret_values"
  };
}

export function normalizeCredentialRedactionPolicy(value: unknown): AutonomyCredentialRedactionPolicy {
  const record = value && typeof value === "object" ? value as Partial<AutonomyCredentialRedactionPolicy> : {};
  const fallback = defaultCredentialRedactionPolicy();
  return {
    credentials: "redact",
    cookies: "never_store",
    localPaths: "basename_or_hash",
    browserHistory: "domain_only",
    screenshots: record.screenshots === "not_stored" ? "not_stored" : fallback.screenshots,
    debugBundles: "redacted_summary",
    semanticMemory: "no_secret_values"
  };
}

export function evaluateCredentialRequirement(input: {
  grants: AutonomyPermissionGrants;
  requirement: AutonomyPermissionRequirement;
  now?: string;
}): CredentialRequirementEvaluation {
  const redactionPolicy = normalizeCredentialRedactionPolicy(input.grants.redactionPolicy);
  const leases = normalizeCredentialLeases(input.grants.credentialLeases);
  const activeLeases = leases.filter((lease) => isLeaseActive(lease, input.now));
  if (input.grants.credentialAccess !== "ask") {
    return {
      allowed: false,
      reason: "Credential access is disabled by the permission profile.",
      matchedLeaseIds: [],
      activeLeaseCount: activeLeases.length,
      redactionPolicy,
      vaultAccess: "reference_only"
    };
  }
  if (!input.grants.riskClasses.includes("credential")) {
    return {
      allowed: false,
      reason: "Credential access requires the credential risk class.",
      matchedLeaseIds: [],
      activeLeaseCount: activeLeases.length,
      redactionPolicy,
      vaultAccess: "reference_only"
    };
  }
  const matched = activeLeases.filter((lease) => leaseCoversRequirement(lease, input.requirement));
  return {
    allowed: matched.length > 0,
    reason: matched.length > 0
      ? "A live credential consent lease covers this requirement."
      : "No live credential consent lease covers this requirement.",
    matchedLeaseIds: matched.map((lease) => lease.id),
    activeLeaseCount: activeLeases.length,
    redactionPolicy,
    vaultAccess: "reference_only"
  };
}

export function summarizeCredentialPolicy(input: {
  grants: AutonomyPermissionGrants;
  requirements: AutonomyPermissionRequirement[];
  now?: string;
}): CredentialRequirementEvaluation & { status: "not_requested" | "allowed" | "blocked" } {
  const credentialRequirements = input.requirements.filter((requirement) => requirement.type === "credential_access");
  const redactionPolicy = normalizeCredentialRedactionPolicy(input.grants.redactionPolicy);
  const activeLeaseCount = normalizeCredentialLeases(input.grants.credentialLeases)
    .filter((lease) => isLeaseActive(lease, input.now)).length;
  if (!credentialRequirements.length) {
    return {
      status: "not_requested",
      allowed: true,
      reason: "No credential access requirement was requested.",
      matchedLeaseIds: [],
      activeLeaseCount,
      redactionPolicy,
      vaultAccess: "reference_only"
    };
  }
  const evaluations = credentialRequirements.map((requirement) => evaluateCredentialRequirement({
    grants: input.grants,
    requirement,
    now: input.now
  }));
  const allowed = evaluations.every((evaluation) => evaluation.allowed);
  return {
    status: allowed ? "allowed" : "blocked",
    allowed,
    reason: allowed
      ? "Credential requirements are covered by live consent leases."
      : evaluations.find((evaluation) => !evaluation.allowed)?.reason ?? "Credential access is blocked.",
    matchedLeaseIds: [...new Set(evaluations.flatMap((evaluation) => evaluation.matchedLeaseIds))],
    activeLeaseCount,
    redactionPolicy,
    vaultAccess: "reference_only"
  };
}

export function normalizeCredentialLeases(value: unknown): AutonomyCredentialLeaseGrant[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeCredentialLease)
    .filter((lease): lease is AutonomyCredentialLeaseGrant => Boolean(lease?.id));
}

export function normalizeCredentialLease(value: unknown): AutonomyCredentialLeaseGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<AutonomyCredentialLeaseGrant>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    return null;
  }
  return {
    id,
    status: record.status === "revoked" || record.status === "expired" ? record.status : "active",
    scope: record.scope === "site_session" ||
      record.scope === "credential_vault" ||
      record.scope === "cookie_jar"
      ? record.scope
      : "browser_profile",
    domains: normalizeStringArray(record.domains),
    purposes: normalizeStringArray(record.purposes),
    vaultRefs: normalizeVaultRefs(record.vaultRefs),
    maxUses: normalizePositiveInteger(record.maxUses),
    usedCount: normalizeNonNegativeInteger(record.usedCount),
    expiresAt: normalizeOptionalString(record.expiresAt),
    createdAt: normalizeOptionalString(record.createdAt),
    updatedAt: normalizeOptionalString(record.updatedAt),
    revokedAt: normalizeOptionalString(record.revokedAt),
    revokeReason: normalizeOptionalString(record.revokeReason)
  };
}

function leaseCoversRequirement(lease: AutonomyCredentialLeaseGrant, requirement: AutonomyPermissionRequirement): boolean {
  if (requirement.type !== "credential_access") {
    return false;
  }
  const value = requirement.value.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (lease.domains.some((domain) => matchesDomainGrant(domain, value))) {
    return true;
  }
  if (/browser|profile|password|cookie|session/.test(value)) {
    return lease.scope === "browser_profile" || lease.scope === "site_session" || lease.scope === "cookie_jar";
  }
  if (/vault|credential/.test(value)) {
    return lease.scope === "credential_vault" && lease.vaultRefs.length > 0;
  }
  return lease.purposes.some((purpose) => value.includes(purpose.toLowerCase()));
}

function matchesDomainGrant(pattern: string, value: string): boolean {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedValue = normalizeHost(value);
  if (!normalizedPattern || !normalizedValue) {
    return false;
  }
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedValue === suffix || normalizedValue.endsWith(`.${suffix}`);
  }
  return normalizedPattern === normalizedValue;
}

function normalizeHost(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text) {
    return "";
  }
  if (text.startsWith("*.")) {
    return `*.${normalizeHost(text.slice(2))}`;
  }
  try {
    return new URL(text.includes("://") ? text : `https://${text}`).hostname.toLowerCase();
  } catch {
    return text.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase() ?? "";
  }
}

function isLeaseActive(lease: AutonomyCredentialLeaseGrant, now = new Date().toISOString()): boolean {
  if (lease.status !== "active" || lease.revokedAt) {
    return false;
  }
  if (lease.expiresAt && Date.parse(lease.expiresAt) <= Date.parse(now)) {
    return false;
  }
  if (typeof lease.maxUses === "number" && typeof lease.usedCount === "number" && lease.usedCount >= lease.maxUses) {
    return false;
  }
  return true;
}

function normalizeVaultRefs(value: unknown): AutonomyCredentialLeaseGrant["vaultRefs"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item)
        ? item as Partial<AutonomyCredentialLeaseGrant["vaultRefs"][number]>
        : {};
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      if (!id || !label) {
        return null;
      }
      return {
        id,
        provider: record.provider === "windows_credential_manager" ||
          record.provider === "dpapi_user" ||
          record.provider === "external"
          ? record.provider
          : "manual_user_handoff",
        label,
        secretKind: record.secretKind === "password" ||
          record.secretKind === "token" ||
          record.secretKind === "cookie" ||
          record.secretKind === "session"
          ? record.secretKind
          : "other",
        redacted: true as const
      };
    })
    .filter((item): item is AutonomyCredentialLeaseGrant["vaultRefs"][number] => Boolean(item));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}
