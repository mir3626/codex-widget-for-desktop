import { resolve } from "node:path";
import type {
  AutonomyPermissionDecision,
  AutonomyPermissionGrants,
  AutonomyPermissionProfile,
  AutonomyPermissionRequirement
} from "../../shared/protocol.js";
import {
  evaluateCredentialRequirement,
  summarizeCredentialPolicy
} from "./credentialPolicy.js";
import {
  evaluateBrowserProfileRequirement,
  isBrowserProfileRequirement,
  summarizeBrowserProfilePolicy
} from "./browserProfilePolicy.js";

export type AutonomyPermissionModeCapabilities = {
  isSuperYolo: boolean;
  credentialCookieCaptchaUnlocked: boolean;
  paymentPurchaseUnlocked: boolean;
};

const SUPER_YOLO_CONFIRMATION_BOUNDARY = "super_yolo_requires_user_confirmation";
const CREDENTIAL_COOKIE_CAPTCHA_UNLOCK_BOUNDARY = "credential_cookie_captcha_boundary_released_by_user";
const PAYMENT_PURCHASE_UNLOCK_BOUNDARY = "payment_purchase_boundary_released_by_user";
const CREDENTIAL_COOKIE_CAPTCHA_PATTERN = /password|passwd|token|cookie|credential|secret|api[_-]?key|captcha|비밀번호|암호|쿠키|자격\s*증명|캡차/i;
const PAYMENT_PURCHASE_PATTERN = /purchase|payment|pay|checkout|card|cvv|cvc|결제|구매|카드/i;

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
  const capabilities = readAutonomyPermissionModeCapabilities(profile);
  const unlocksUsed = new Set<string>();
  for (const requirement of input.requirements) {
    const evaluation = evaluateRequirementForProfile(profile, requirement, { now: input.now, capabilities });
    if (evaluation.allowed) {
      used.push(requirement);
      if (evaluation.unlock) {
        unlocksUsed.add(evaluation.unlock);
      }
    } else {
      missing.push(requirement);
    }
  }
  const baseCredentialPolicy = summarizeCredentialPolicy({
    grants: profile.grants,
    requirements: input.requirements,
    now: input.now
  });
  const credentialPolicy = capabilities.credentialCookieCaptchaUnlocked && hasCredentialCookieCaptchaRequirement(input.requirements)
    ? {
        ...baseCredentialPolicy,
        allowed: true,
        status: "allowed" as const,
        reason: "SUPER-YOLO credential/cookie/CAPTCHA unlock covers profile-level permission; raw values remain redacted or reference-only."
      }
    : baseCredentialPolicy;
  const baseBrowserProfilePolicy = summarizeBrowserProfilePolicy({
    grants: profile.grants,
    requirements: input.requirements,
    now: input.now
  });
  const browserProfilePolicy = capabilities.credentialCookieCaptchaUnlocked && input.requirements.some(isBrowserProfileRequirement)
    ? {
        ...baseBrowserProfilePolicy,
        allowed: true,
        status: "allowed" as const,
        reason: "SUPER-YOLO credential/cookie/CAPTCHA unlock covers authenticated browser profile/session/cookie permission; evidence remains redacted.",
        profileAccess: "explicit_lease_only" as const,
        cookieAccess: "metadata_only_or_user_approved_helper" as const
      }
    : baseBrowserProfilePolicy;
  const reason = missing.length === 0
    ? unlocksUsed.size
      ? `Scoped autonomy grants plus ${[...unlocksUsed].join(", ")} unlock cover all requirements.`
      : "Scoped autonomy grants cover all requirements."
    : "Scoped autonomy profile is missing required grants.";
  return {
    allowed: missing.length === 0,
    mode: profile.mode,
    profileId: profile.id,
    reason,
    missingRequirements: missing,
    usedRequirements: used,
    safetyBoundaries: profile.safetyBoundaries,
    credentialPolicy: {
      status: credentialPolicy.status,
      reason: credentialPolicy.reason,
      matchedLeaseIds: credentialPolicy.matchedLeaseIds,
      activeLeaseCount: credentialPolicy.activeLeaseCount,
      redactionPolicy: credentialPolicy.redactionPolicy,
      vaultAccess: credentialPolicy.vaultAccess
    },
    browserProfilePolicy: {
      status: browserProfilePolicy.status,
      reason: browserProfilePolicy.reason,
      matchedLeaseIds: browserProfilePolicy.matchedLeaseIds,
      activeLeaseCount: browserProfilePolicy.activeLeaseCount,
      redactionPolicy: browserProfilePolicy.redactionPolicy,
      defaultDeny: browserProfilePolicy.defaultDeny,
      profileAccess: browserProfilePolicy.profileAccess,
      cookieAccess: browserProfilePolicy.cookieAccess,
      auditTrail: browserProfilePolicy.auditTrail,
      leaseScopes: browserProfilePolicy.leaseScopes
    }
  };
}

export function readAutonomyPermissionModeCapabilities(input: {
  mode?: string;
  safetyBoundaries?: string[];
} | null | undefined): AutonomyPermissionModeCapabilities {
  const boundaries = new Set(Array.isArray(input?.safetyBoundaries) ? input.safetyBoundaries : []);
  const isSuperYolo = input?.mode === "scoped_yolo" && boundaries.has(SUPER_YOLO_CONFIRMATION_BOUNDARY);
  return {
    isSuperYolo,
    credentialCookieCaptchaUnlocked: isSuperYolo && boundaries.has(CREDENTIAL_COOKIE_CAPTCHA_UNLOCK_BOUNDARY),
    paymentPurchaseUnlocked: isSuperYolo && boundaries.has(PAYMENT_PURCHASE_UNLOCK_BOUNDARY)
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

function evaluateRequirementForProfile(
  profile: AutonomyPermissionProfile,
  requirement: AutonomyPermissionRequirement,
  options: {
    now?: string;
    capabilities?: AutonomyPermissionModeCapabilities;
  } = {}
): { allowed: boolean; unlock?: string } {
  if (isRequirementAllowed(profile.grants, requirement, { now: options.now })) {
    return { allowed: true };
  }
  const capabilities = options.capabilities ?? readAutonomyPermissionModeCapabilities(profile);
  if (capabilities.credentialCookieCaptchaUnlocked && canCredentialCookieCaptchaUnlockRequirement(profile, requirement)) {
    return { allowed: true, unlock: CREDENTIAL_COOKIE_CAPTCHA_UNLOCK_BOUNDARY };
  }
  if (capabilities.paymentPurchaseUnlocked && canPaymentPurchaseUnlockRequirement(profile, requirement)) {
    return { allowed: true, unlock: PAYMENT_PURCHASE_UNLOCK_BOUNDARY };
  }
  return { allowed: false };
}

export function isRequirementAllowed(
  grants: AutonomyPermissionGrants,
  requirement: AutonomyPermissionRequirement,
  options: { now?: string } = {}
): boolean {
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
      return grants.packageInstall && isPackageInstallAllowed(grants, requirement.value);
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
      return evaluateCredentialRequirement({ grants, requirement, now: options.now }).allowed;
    case "browser_profile_access":
    case "browser_session_access":
    case "browser_account_access":
    case "cookie_jar_access":
      return evaluateBrowserProfileRequirement({ grants, requirement, now: options.now }).allowed;
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
  return grants.commands.allowPrefixes.some((prefix) => matchesCommandGrant(prefix, normalized));
}

function matchesCommandGrant(prefix: string, command: string): boolean {
  const normalizedPrefix = prefix.trim().toLowerCase();
  const normalizedCommand = command.trim().toLowerCase();
  if (!normalizedPrefix) {
    return false;
  }
  if (normalizedPrefix.endsWith("*")) {
    const wildcardPrefix = normalizedPrefix.slice(0, -1).trimEnd();
    return Boolean(wildcardPrefix) && (
      normalizedCommand === wildcardPrefix ||
      normalizedCommand.startsWith(`${wildcardPrefix} `)
    );
  }
  if (normalizedCommand === normalizedPrefix) {
    return true;
  }
  return !/\s/.test(normalizedPrefix) && normalizedCommand.startsWith(`${normalizedPrefix} `);
}

function isPackageInstallAllowed(grants: AutonomyPermissionGrants, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "isolated_runtime_workspace" || normalized.startsWith("file:")) {
    return true;
  }
  const allowlist = Array.isArray(grants.packageAllowlist) && grants.packageAllowlist.length ? grants.packageAllowlist : ["file:*"];
  return allowlist.some((pattern) => matchesPackagePattern(pattern, normalized));
}

function matchesPackagePattern(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern === "*" || normalizedPattern === value) {
    return true;
  }
  if (normalizedPattern.endsWith("*")) {
    return value.startsWith(normalizedPattern.slice(0, -1));
  }
  if (!normalizedPattern.includes("@") && value.startsWith(`${normalizedPattern}@`)) {
    return true;
  }
  return false;
}

function canCredentialCookieCaptchaUnlockRequirement(
  profile: AutonomyPermissionProfile,
  requirement: AutonomyPermissionRequirement
): boolean {
  if (requirement.type === "credential_access" || requirement.type === "risk_class" && requirement.value === "credential") {
    return true;
  }
  if (isBrowserProfileRequirement(requirement)) {
    if (!profile.grants.browserAutomation) {
      return false;
    }
    return requirement.type === "browser_account_access" ||
      profile.grants.browserDomains.some((pattern) => pattern === "*" || matchesDomainGrant(pattern, requirement.value));
  }
  if (requirement.type === "command" && CREDENTIAL_COOKIE_CAPTCHA_PATTERN.test(`${requirement.value} ${requirement.reason}`)) {
    return isCommandAllowedIgnoringCategoryDeny(profile.grants, requirement.value, CREDENTIAL_COOKIE_CAPTCHA_PATTERN);
  }
  return false;
}

function canPaymentPurchaseUnlockRequirement(
  profile: AutonomyPermissionProfile,
  requirement: AutonomyPermissionRequirement
): boolean {
  const text = `${requirement.value} ${requirement.reason}`;
  if (requirement.type === "risk_class" && requirement.value === "high_risk" && PAYMENT_PURCHASE_PATTERN.test(text)) {
    return true;
  }
  if (requirement.type === "command" && PAYMENT_PURCHASE_PATTERN.test(text)) {
    return isCommandAllowedIgnoringCategoryDeny(profile.grants, requirement.value, PAYMENT_PURCHASE_PATTERN);
  }
  return false;
}

function hasCredentialCookieCaptchaRequirement(requirements: AutonomyPermissionRequirement[]): boolean {
  return requirements.some((requirement) =>
    requirement.type === "credential_access" ||
    requirement.type === "risk_class" && requirement.value === "credential" ||
    isBrowserProfileRequirement(requirement) ||
    CREDENTIAL_COOKIE_CAPTCHA_PATTERN.test(`${requirement.value} ${requirement.reason}`)
  );
}

function isCommandAllowedIgnoringCategoryDeny(
  grants: AutonomyPermissionGrants,
  command: string,
  ignoredDenyPattern: RegExp
): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }
  if (grants.commands.denyPatterns.some((pattern) => !ignoredDenyPattern.test(pattern) && new RegExp(escapeRegExp(pattern), "i").test(normalized))) {
    return false;
  }
  return grants.commands.allowPrefixes.some((prefix) => matchesCommandGrant(prefix, normalized));
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
