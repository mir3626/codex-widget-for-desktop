import type {
  AutonomyCredentialLeaseGrant,
  AutonomyCredentialLeaseScope,
  AutonomyCredentialRedactionPolicy,
  AutonomyPermissionGrants,
  AutonomyPermissionRequirement
} from "../../shared/protocol.js";
import {
  defaultCredentialRedactionPolicy,
  normalizeCredentialLeases,
  normalizeCredentialRedactionPolicy
} from "./credentialPolicy.js";

export type BrowserProfilePolicyEvaluation = {
  allowed: boolean;
  status: "not_requested" | "allowed" | "blocked";
  reason: string;
  matchedLeaseIds: string[];
  activeLeaseCount: number;
  redactionPolicy: AutonomyCredentialRedactionPolicy;
  defaultDeny: true;
  profileAccess: "explicit_lease_only";
  cookieAccess: "metadata_only_or_user_approved_helper";
  auditTrail: "decision_summary_only";
  leaseScopes: AutonomyCredentialLeaseScope[];
};

const BROWSER_PROFILE_REQUIREMENTS = new Set<AutonomyPermissionRequirement["type"]>([
  "browser_profile_access",
  "browser_session_access",
  "browser_account_access",
  "cookie_jar_access"
]);

export function isBrowserProfileRequirement(requirement: AutonomyPermissionRequirement): boolean {
  return BROWSER_PROFILE_REQUIREMENTS.has(requirement.type);
}

export function evaluateBrowserProfileRequirement(input: {
  grants: AutonomyPermissionGrants;
  requirement: AutonomyPermissionRequirement;
  now?: string;
}): BrowserProfilePolicyEvaluation {
  const summary = summarizeBrowserProfilePolicy({
    grants: input.grants,
    requirements: [input.requirement],
    now: input.now
  });
  return summary;
}

export function summarizeBrowserProfilePolicy(input: {
  grants: AutonomyPermissionGrants;
  requirements: AutonomyPermissionRequirement[];
  now?: string;
}): BrowserProfilePolicyEvaluation {
  const requirements = input.requirements.filter(isBrowserProfileRequirement);
  const redactionPolicy = normalizeCredentialRedactionPolicy(input.grants.redactionPolicy ?? defaultCredentialRedactionPolicy());
  const activeLeases = normalizeCredentialLeases(input.grants.credentialLeases)
    .filter((lease) => isLeaseActive(lease, input.now));
  const base = {
    activeLeaseCount: activeLeases.length,
    redactionPolicy,
    defaultDeny: true as const,
    profileAccess: "explicit_lease_only" as const,
    cookieAccess: "metadata_only_or_user_approved_helper" as const,
    auditTrail: "decision_summary_only" as const
  };

  if (!requirements.length) {
    return {
      ...base,
      allowed: true,
      status: "not_requested",
      reason: "No authenticated browser profile, session, account, or cookie jar access was requested.",
      matchedLeaseIds: [],
      leaseScopes: []
    };
  }

  if (!input.grants.browserAutomation) {
    return {
      ...base,
      allowed: false,
      status: "blocked",
      reason: "Authenticated browser profile access requires browser automation to be explicitly granted.",
      matchedLeaseIds: [],
      leaseScopes: []
    };
  }
  if (input.grants.credentialAccess !== "ask" || !input.grants.riskClasses.includes("credential")) {
    return {
      ...base,
      allowed: false,
      status: "blocked",
      reason: "Authenticated browser profile access requires an explicit credential consent posture and credential risk class.",
      matchedLeaseIds: [],
      leaseScopes: []
    };
  }

  const matchedByRequirement = requirements.map((requirement) =>
    activeLeases.filter((lease) => leaseCoversBrowserRequirement(lease, requirement, input.grants))
  );
  const missing = matchedByRequirement.findIndex((matches) => matches.length === 0);
  if (missing >= 0) {
    return {
      ...base,
      allowed: false,
      status: "blocked",
      reason: `No live browser profile lease covers ${requirements[missing].type}.`,
      matchedLeaseIds: uniqueStrings(matchedByRequirement.flat().map((lease) => lease.id)),
      leaseScopes: uniqueStrings(matchedByRequirement.flat().map((lease) => lease.scope))
    };
  }

  const matched = matchedByRequirement.flat();
  return {
    ...base,
    allowed: true,
    status: "allowed",
    reason: "Live browser profile/session/cookie consent leases cover all requested authenticated browser access.",
    matchedLeaseIds: uniqueStrings(matched.map((lease) => lease.id)),
    leaseScopes: uniqueStrings(matched.map((lease) => lease.scope))
  };
}

function leaseCoversBrowserRequirement(
  lease: AutonomyCredentialLeaseGrant,
  requirement: AutonomyPermissionRequirement,
  grants: AutonomyPermissionGrants
): boolean {
  const value = String(requirement.value ?? "").trim().toLowerCase();
  if (!value) {
    return false;
  }
  const domainAllowed = grants.browserDomains.some((pattern) => pattern === "*" || matchesDomainGrant(pattern, value));
  const leaseDomainMatched = lease.domains.some((domain) => matchesDomainGrant(domain, value));
  const purposeMatched = lease.purposes.some((purpose) => value.includes(purpose.toLowerCase()));
  const accountMatched = (lease.accountHints ?? []).some((hint) => value.includes(hint.toLowerCase()));

  switch (requirement.type) {
    case "browser_profile_access":
      return domainAllowed && (lease.scope === "browser_profile" || lease.scope === "site_session") && (leaseDomainMatched || purposeMatched);
    case "browser_session_access":
      return domainAllowed && lease.scope === "site_session" && (leaseDomainMatched || purposeMatched);
    case "browser_account_access":
      return (lease.scope === "browser_profile" || lease.scope === "site_session") && (accountMatched || purposeMatched || leaseDomainMatched);
    case "cookie_jar_access":
      return domainAllowed && lease.scope === "cookie_jar" && (leaseDomainMatched || purposeMatched);
    default:
      return false;
  }
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

function uniqueStrings<T extends string>(value: T[]): T[] {
  return [...new Set(value)];
}
