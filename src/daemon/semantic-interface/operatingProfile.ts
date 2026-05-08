import type { OperatingProfile, SemanticTier1Risk } from "./types.js";

export const PERMISSIVE_PROFILE: OperatingProfile = {
  id: "permissive",
  version: "0.1.0",
  requiredEvidence: {
    minTopMargin: 0.02,
    maxSnapshotAgeMs: 30_000
  }
};

export const STANDARD_PROFILE: OperatingProfile = {
  id: "standard",
  version: "0.1.0",
  requiredEvidence: {
    exactOrAliasMatch: true,
    roleOrAffordanceMatch: true,
    visibleInViewport: true,
    enabledStateKnown: true,
    revalidationRequired: true,
    minTopMargin: 0.08,
    maxSnapshotAgeMs: 15_000
  }
};

export const STRICT_PROFILE: OperatingProfile = {
  id: "strict",
  version: "0.1.0",
  requiredEvidence: {
    exactOrAliasMatch: true,
    roleOrAffordanceMatch: true,
    visibleInViewport: true,
    enabledStateKnown: true,
    uniqueWithinScope: true,
    revalidationRequired: true,
    minTopMargin: 0.16,
    maxSnapshotAgeMs: 10_000
  }
};

export const OPERATING_PROFILES: Record<OperatingProfile["id"], OperatingProfile> = {
  permissive: PERMISSIVE_PROFILE,
  standard: STANDARD_PROFILE,
  strict: STRICT_PROFILE
};

export function selectOperatingProfileForRisk(risk: SemanticTier1Risk): OperatingProfile {
  if (risk === "read_only" || risk === "local_navigation") {
    return PERMISSIVE_PROFILE;
  }
  if (risk === "external_navigation" || risk === "input_non_submitting" || risk === "state_change") {
    return STANDARD_PROFILE;
  }
  return STRICT_PROFILE;
}
