import { resolve } from "node:path";
import type {
  AutonomyPermissionDecision,
  AutonomyPermissionGrants,
  AutonomyPermissionProfile,
  AutonomyPermissionRequirement
} from "../../shared/protocol.js";

export function evaluateAutonomyPermission(input: {
  profile?: AutonomyPermissionProfile | null;
  requirements: AutonomyPermissionRequirement[];
  now?: string;
}): AutonomyPermissionDecision {
  const profile = input.profile ?? null;
  if (!profile) {
    return denied("ask", "No scoped autonomy permission profile was provided.", input.requirements, []);
  }
  if (profile.status !== "active") {
    return denied(profile.mode, `Permission profile is ${profile.status}.`, input.requirements, profile.safetyBoundaries, profile.id);
  }
  if (profile.expiresAt && Date.parse(profile.expiresAt) <= Date.parse(input.now ?? new Date().toISOString())) {
    return denied(profile.mode, "Permission profile has expired.", input.requirements, profile.safetyBoundaries, profile.id);
  }
  if (profile.maxUses !== undefined && profile.usedCount >= profile.maxUses) {
    return denied(profile.mode, "Permission profile use limit has been reached.", input.requirements, profile.safetyBoundaries, profile.id);
  }
  if (profile.mode === "off") {
    return denied(profile.mode, "Scoped autonomy mode is off.", input.requirements, profile.safetyBoundaries, profile.id);
  }
  if (profile.mode === "ask") {
    return denied(profile.mode, "Scoped autonomy profile requires explicit approval for this run.", input.requirements, profile.safetyBoundaries, profile.id);
  }

  const missing: AutonomyPermissionRequirement[] = [];
  const used: AutonomyPermissionRequirement[] = [];
  for (const requirement of input.requirements) {
    if (isRequirementAllowed(profile.grants, requirement)) {
      used.push(requirement);
    } else {
      missing.push(requirement);
    }
  }
  return {
    allowed: missing.length === 0,
    mode: profile.mode,
    profileId: profile.id,
    reason: missing.length === 0 ? "Scoped autonomy grants cover all requirements." : "Scoped autonomy profile is missing required grants.",
    missingRequirements: missing,
    usedRequirements: used,
    safetyBoundaries: profile.safetyBoundaries
  };
}

export function sanitizeAutonomyInput(value: unknown, key = ""): unknown {
  if (isCredentialKey(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return containsCredentialLikeText(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeAutonomyInput(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    output[childKey] = sanitizeAutonomyInput(childValue, childKey);
  }
  return output;
}

export function containsCredentialLikeText(value: string): boolean {
  return /(?:password|passwd|token|cookie|credential|secret|api[_-]?key)\s*[:=]\s*\S+/i.test(value);
}

export function isRequirementAllowed(grants: AutonomyPermissionGrants, requirement: AutonomyPermissionRequirement): boolean {
  switch (requirement.type) {
    case "network":
      return grants.network;
    case "network_domain":
      return grants.network && grants.networkDomains.some((pattern) => matchesDomainGrant(pattern, requirement.value));
    case "browser_automation":
      return grants.browserAutomation;
    case "browser_domain":
      return grants.browserAutomation && grants.browserDomains.some((pattern) => pattern === "*" || matchesDomainGrant(pattern, requirement.value));
    case "filesystem_read":
      return grants.filesystem.readRoots.some((root) => isWithinRoot(requirement.value, root));
    case "filesystem_write":
      return grants.filesystem.writeRoots.some((root) => isWithinRoot(requirement.value, root));
    case "command":
      return isCommandAllowed(grants, requirement.value);
    case "package_install":
      return grants.packageInstall;
    case "os_mutation":
      return grants.osMutation;
    case "generated_tool_materialization":
      return grants.generatedToolMaterialization;
    case "generated_tool_execution":
      return grants.generatedToolExecution;
    case "generated_code":
      return grants.generatedCode;
    case "risk_class":
      return grants.riskClasses.includes(requirement.value);
    case "credential_access":
      return grants.credentialAccess !== "never";
  }
}

export function matchesDomainGrant(pattern: string, value: string): boolean {
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

function denied(
  mode: AutonomyPermissionDecision["mode"],
  reason: string,
  missingRequirements: AutonomyPermissionRequirement[],
  safetyBoundaries: string[],
  profileId?: string
): AutonomyPermissionDecision {
  return {
    allowed: false,
    mode,
    profileId,
    reason,
    missingRequirements,
    usedRequirements: [],
    safetyBoundaries
  };
}

function isCommandAllowed(grants: AutonomyPermissionGrants, command: string): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }
  if (grants.commands.denyPatterns.some((pattern) => new RegExp(escapeRegExp(pattern), "i").test(normalized))) {
    return false;
  }
  return grants.commands.allowPrefixes.some((prefix) => normalized.toLowerCase().startsWith(prefix.trim().toLowerCase()));
}

function isWithinRoot(value: string, root: string): boolean {
  const resolvedValue = resolve(value);
  const resolvedRoot = resolve(root);
  return resolvedValue === resolvedRoot || resolvedValue.startsWith(`${resolvedRoot}\\`) || resolvedValue.startsWith(`${resolvedRoot}/`);
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

function isCredentialKey(key: string): boolean {
  return /password|passwd|token|cookie|credential|payment|card|secret|api[_-]?key/i.test(key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
