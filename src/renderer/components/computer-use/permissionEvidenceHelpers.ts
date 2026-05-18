import type {
  AutonomyPermissionProfile,
  AutonomyPermissionRequirement,
  AutonomyRiskClass,
  CapabilityJobSummary,
  ComputerSessionDebugBundle,
  ComputerSessionRollbackActionSummary,
  ComputerSessionSummary,
  ExecutionSurfaceKind
} from "../../../shared/protocol.js";

export function deriveOneTimeProfileRequirements(input: {
  session: ComputerSessionSummary | null;
  bundle: ComputerSessionDebugBundle | null;
  awaitingJobs: CapabilityJobSummary[];
  selectedSurfaceKind: ExecutionSurfaceKind;
}): AutonomyPermissionRequirement[] {
  if (!input.session) {
    return [];
  }
  const requirements: AutonomyPermissionRequirement[] = [];
  for (const node of input.bundle?.dagNodes ?? []) {
    const output = readRecord(node.output);
    collectMissingRequirements(output, requirements);
    const permission = readRecord(output.permission);
    collectMissingRequirements(permission, requirements);
  }
  for (const decision of input.bundle?.safetyDecisions ?? []) {
    const record = readRecord(decision);
    collectMissingRequirements(record, requirements);
    const requiredGrants = Array.isArray(record.requiredGrants) ? record.requiredGrants : [];
    for (const grant of requiredGrants) {
      if (typeof grant === "string") {
        requirements.push(...requirementsForSessionGrant(grant, input.session, input.selectedSurfaceKind));
      }
    }
  }
  for (const job of input.awaitingJobs) {
    requirements.push(...requirementsForCapabilityJob(job, input.session));
  }
  if (!requirements.length && (input.session.blockedReason || input.session.requiresUserAction)) {
    requirements.push(...requirementsForSurface(input.selectedSurfaceKind, input.session));
  }
  const riskRequirement = riskRequirementForSession(input.session);
  if (riskRequirement) {
    requirements.push(riskRequirement);
  }
  return dedupePermissionRequirements(requirements).filter((requirement) => requirement.type !== "credential_access");
}

export function collectMissingRequirements(record: Record<string, unknown>, requirements: AutonomyPermissionRequirement[]): void {
  const missingRequirements = Array.isArray(record.missingRequirements) ? record.missingRequirements : [];
  for (const requirement of missingRequirements) {
    if (isPermissionRequirement(requirement)) {
      requirements.push(requirement);
    }
  }
}

export function requirementsForSessionGrant(
  grant: string,
  session: ComputerSessionSummary,
  selectedSurfaceKind: ExecutionSurfaceKind
): AutonomyPermissionRequirement[] {
  const reason = `Computer Session selected ${selectedSurfaceKind} and requires ${grant}.`;
  if (grant === "browser.profile") {
    return [
      { type: "browser_automation", value: "regular_browser_extension", reason },
      { type: "risk_class", value: "high_risk", reason: "Existing browser profile state can expose private data." }
    ];
  }
  if (grant === "browser.chrome") {
    return [
      { type: "browser_automation", value: "browser_chrome", reason },
      { type: "risk_class", value: "side_effect", reason: "Browser chrome operations can mutate browser state." }
    ];
  }
  if (grant === "generated_code.runtime_workspace") {
    return [
      { type: "generated_tool_materialization", value: "runtime_workspace", reason },
      { type: "generated_tool_execution", value: "runtime_workspace", reason },
      { type: "generated_code", value: "runtime_workspace", reason },
      { type: "risk_class", value: riskClassToAutonomyRisk(session.riskClass), reason: `Session risk class is ${session.riskClass}.` }
    ];
  }
  if (grant === "terminal.command_allowlist") {
    return [
      { type: "risk_class", value: "side_effect", reason: "Terminal execution requires a command allowlist." }
    ];
  }
  if (grant === "file.write_output_root") {
    return [
      { type: "risk_class", value: "reversible", reason: "Local artifact writes must remain in an approved output root." }
    ];
  }
  if (grant === "desktop.foreground_watch" || grant === "desktop.abort_on_user_input") {
    return [
      { type: "risk_class", value: "high_risk", reason: "Foreground desktop actions require watch-mode guardrails." }
    ];
  }
  return [];
}

export function requirementsForSurface(
  surfaceKind: ExecutionSurfaceKind,
  session: ComputerSessionSummary
): AutonomyPermissionRequirement[] {
  if (surfaceKind === "regular_browser_extension") {
    return requirementsForSessionGrant("browser.profile", session, surfaceKind)
      .concat(requirementsForSessionGrant("browser.chrome", session, surfaceKind));
  }
  if (surfaceKind === "tool_workspace") {
    return requirementsForSessionGrant("generated_code.runtime_workspace", session, surfaceKind);
  }
  if (surfaceKind === "pty_workspace") {
    return requirementsForSessionGrant("terminal.command_allowlist", session, surfaceKind);
  }
  if (surfaceKind === "foreground_desktop_watch") {
    return requirementsForSessionGrant("desktop.foreground_watch", session, surfaceKind)
      .concat(requirementsForSessionGrant("desktop.abort_on_user_input", session, surfaceKind));
  }
  return [];
}

export function requirementsForCapabilityJob(job: CapabilityJobSummary, session: ComputerSessionSummary): AutonomyPermissionRequirement[] {
  const input = readRecord(job.inputJson);
  if (job.kind === "terminal") {
    const command = readString(input.command);
    return [
      ...(command ? [{ type: "command" as const, value: command, reason: "Awaiting terminal command approval." }] : []),
      { type: "risk_class", value: riskClassToAutonomyRisk(session.riskClass), reason: `Session risk class is ${session.riskClass}.` }
    ];
  }
  if (job.kind === "browser_chrome") {
    const command = readString(input.command) ?? readString(input.kind) ?? "browser_chrome";
    const riskClass: AutonomyRiskClass = browserChromeRisk(command) === "read_only"
      ? "read_only"
      : browserChromeRisk(command) === "profile_private_data" || browserChromeRisk(command) === "local_file_disclosure"
        ? "high_risk"
        : "side_effect";
    return [
      { type: "browser_automation", value: "browser_chrome", reason: browserChromeReason(command) },
      { type: "risk_class", value: riskClass, reason: `Browser chrome command ${command} is ${browserChromeRisk(command)}.` }
    ];
  }
  if (job.kind === "browser_action") {
    const action = readActionType(input);
    return [
      { type: "browser_automation", value: "browser_action", reason: "Awaiting Browser Action approval." },
      { type: "risk_class", value: action === "read" || action === "screenshot" ? "read_only" : "side_effect", reason: `Browser Action ${action} requires approval.` }
    ];
  }
  if (job.kind === "desktop_action") {
    return [
      { type: "risk_class", value: "high_risk", reason: "Desktop action requires foreground watch-mode approval." }
    ];
  }
  if (job.kind === "agent_tool") {
    return [
      { type: "generated_tool_execution", value: "runtime_workspace", reason: "Awaiting generated tool execution approval." },
      { type: "risk_class", value: "reversible", reason: "Generated tool output must remain rollback-capable." }
    ];
  }
  return [
    { type: "risk_class", value: "read_only", reason: `Awaiting ${job.kind} capability approval.` }
  ];
}

export function riskRequirementForSession(session: ComputerSessionSummary): AutonomyPermissionRequirement | null {
  const risk = riskClassToAutonomyRisk(session.riskClass);
  if (risk === "read_only") {
    return null;
  }
  return {
    type: "risk_class",
    value: risk,
    reason: `Session risk class is ${session.riskClass}.`
  };
}

export function riskClassToAutonomyRisk(riskClass: ComputerSessionSummary["riskClass"]): AutonomyRiskClass {
  if (riskClass === "read_only") return "read_only";
  if (riskClass === "local_artifact_create") return "reversible";
  if (riskClass === "credential_or_secret") return "credential";
  if (riskClass === "browser_state_mutation" || riskClass === "external_submission") return "side_effect";
  return "high_risk";
}

export function grantsFromPermissionRequirements(requirements: AutonomyPermissionRequirement[]): Record<string, unknown> {
  const grants = {
    network: false,
    networkDomains: [] as string[],
    browserAutomation: false,
    browserDomains: [] as string[],
    filesystem: { readRoots: [] as string[], writeRoots: [] as string[] },
    commands: { allowPrefixes: [] as string[], denyPatterns: [] as string[] },
    packageInstall: false,
    packageAllowlist: ["file:*"] as string[],
    osMutation: false,
    generatedToolMaterialization: false,
    generatedToolExecution: false,
    generatedCode: false,
    credentialAccess: "never",
    riskClasses: [] as AutonomyRiskClass[],
    maxRuntimeMs: 30000,
    maxOutputBytes: 2097152,
    maxIterations: 3
  };
  for (const requirement of requirements) {
    if (requirement.type === "network") grants.network = true;
    if (requirement.type === "network_domain") {
      grants.network = true;
      grants.networkDomains.push(requirement.value);
    }
    if (requirement.type === "browser_automation") grants.browserAutomation = true;
    if (requirement.type === "browser_domain") {
      grants.browserAutomation = true;
      grants.browserDomains.push(requirement.value);
    }
    if (requirement.type === "filesystem_read") grants.filesystem.readRoots.push(requirement.value);
    if (requirement.type === "filesystem_write") grants.filesystem.writeRoots.push(requirement.value);
    if (requirement.type === "command") grants.commands.allowPrefixes.push(requirement.value);
    if (requirement.type === "package_install") {
      grants.packageInstall = true;
      if (requirement.value.startsWith("npm:") || requirement.value.startsWith("file:")) {
        grants.packageAllowlist.push(requirement.value);
      }
    }
    if (requirement.type === "os_mutation") grants.osMutation = true;
    if (requirement.type === "generated_tool_materialization") grants.generatedToolMaterialization = true;
    if (requirement.type === "generated_tool_execution") grants.generatedToolExecution = true;
    if (requirement.type === "generated_code") grants.generatedCode = true;
    if (requirement.type === "risk_class") grants.riskClasses.push(requirement.value);
  }
  grants.networkDomains = [...new Set(grants.networkDomains)];
  grants.browserDomains = [...new Set(grants.browserDomains)];
  grants.filesystem.readRoots = [...new Set(grants.filesystem.readRoots)];
  grants.filesystem.writeRoots = [...new Set(grants.filesystem.writeRoots)];
  grants.commands.allowPrefixes = [...new Set(grants.commands.allowPrefixes)];
  grants.packageAllowlist = [...new Set(grants.packageAllowlist)];
  grants.riskClasses = [...new Set<AutonomyRiskClass>(grants.riskClasses.length ? grants.riskClasses : ["read_only"])];
  return grants;
}

type OneTimeProfileDraftSummary = {
  scope: "one_time";
  maxUses: 1;
  credentialAccess: "never";
  riskClasses: AutonomyRiskClass[];
  browserGrants: string[];
  commandGrants: string[];
  fileWriteRoots: string[];
  summary: string;
};

type ProfileGrantDetail = {
  label: string;
  value: string;
};

type BrowserChromeEvidenceRow = {
  id: string;
  command: string;
  status: CapabilityJobSummary["status"];
  riskClass: string;
  verification: string;
  redactionSummary: string;
  resourceSummary: string;
  summary: string;
};

type TerminalDeltaEvidenceRow = {
  id: string;
  status: string;
  createdCount: number;
  modifiedCount: number;
  deletedCount: number;
  rollbackCandidateCount: number;
  resources: string;
  rollbackSummary: string;
  redactionSummary: string;
  summary: string;
};

type ManagedProfileDraftValidation = {
  ok: boolean;
  payload?: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  summary: string;
};

export function collectProfileGrantDetails(profile: AutonomyPermissionProfile): ProfileGrantDetail[] {
  const details: ProfileGrantDetail[] = [];
  for (const domain of profile.grants.networkDomains) {
    details.push({ label: "network", value: domain });
  }
  for (const domain of profile.grants.browserDomains) {
    details.push({ label: "browser", value: domain });
  }
  for (const command of profile.grants.commands.allowPrefixes) {
    details.push({ label: "command", value: command });
  }
  for (const root of profile.grants.filesystem.readRoots) {
    details.push({ label: "read", value: root });
  }
  for (const root of profile.grants.filesystem.writeRoots) {
    details.push({ label: "write", value: root });
  }
  if (profile.grants.packageInstall) {
    details.push({ label: "package", value: "enabled" });
  }
  for (const packagePattern of profile.grants.packageAllowlist ?? []) {
    details.push({ label: "package allow", value: packagePattern });
  }
  if (profile.grants.osMutation) {
    details.push({ label: "os", value: "mutation_enabled" });
  }
  if (profile.grants.generatedToolMaterialization) {
    details.push({ label: "tool", value: "materialization" });
  }
  if (profile.grants.generatedToolExecution) {
    details.push({ label: "tool", value: "execution" });
  }
  if (profile.grants.generatedCode) {
    details.push({ label: "code", value: "runtime_workspace" });
  }
  const leases = Array.isArray(profile.grants.credentialLeases) ? profile.grants.credentialLeases : [];
  for (const lease of leases) {
    details.push({
      label: "credential lease",
      value: `${lease.status}:${lease.scope}:${lease.domains.length ? lease.domains.join(",") : lease.vaultRefs.length ? "vault-ref" : "manual"}`
    });
  }
  if (profile.grants.redactionPolicy) {
    details.push({ label: "redaction", value: `${profile.grants.redactionPolicy.cookies}/${profile.grants.redactionPolicy.debugBundles}` });
  }
  return details;
}

export function createSafeManagedProfileDraft(): Record<string, unknown> {
  return {
    name: "Computer Use one-time profile",
    mode: "scoped_yolo",
    scope: "one_time",
    status: "active",
    maxUses: 1,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: false,
      browserDomains: [],
      filesystem: {
        readRoots: [],
        writeRoots: []
      },
      commands: {
        allowPrefixes: [],
        denyPatterns: []
      },
      packageInstall: false,
      packageAllowlist: ["file:*"],
      osMutation: false,
      generatedToolMaterialization: false,
      generatedToolExecution: false,
      generatedCode: false,
      credentialAccess: "never",
      credentialLeases: [],
      redactionPolicy: {
        credentials: "redact",
        cookies: "never_store",
        localPaths: "basename_or_hash",
        browserHistory: "domain_only",
        screenshots: "metadata_only",
        debugBundles: "redacted_summary",
        semanticMemory: "no_secret_values"
      },
      riskClasses: ["read_only"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 3
    },
    safetyBoundaries: [
      "approval_required_for_high_risk_actions",
      "restricted_pages_are_not_bypassed",
      "credentials_are_not_automated",
      "foreground_desktop_requires_watch_mode",
      "generated_code_must_remain_in_runtime_workspace"
    ]
  };
}

export function createComputerUseYoloProfileDraft(): Record<string, unknown> {
  return {
    name: "Computer Use YOLO one-time profile",
    mode: "scoped_yolo",
    scope: "one_time",
    status: "active",
    maxUses: 1,
    grants: {
      network: true,
      networkDomains: ["*"],
      browserAutomation: true,
      browserDomains: ["*"],
      filesystem: {
        readRoots: [],
        writeRoots: []
      },
      commands: {
        allowPrefixes: [],
        denyPatterns: [
          "cookie",
          "password",
          "credential",
          "secret",
          "token",
          "captcha",
          "purchase",
          "payment",
          "submit"
        ]
      },
      packageInstall: false,
      packageAllowlist: ["file:*"],
      osMutation: false,
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      credentialAccess: "never",
      credentialLeases: [],
      redactionPolicy: {
        credentials: "redact",
        cookies: "never_store",
        localPaths: "basename_or_hash",
        browserHistory: "domain_only",
        screenshots: "metadata_only",
        debugBundles: "redacted_summary",
        semanticMemory: "no_secret_values"
      },
      riskClasses: ["read_only", "reversible", "side_effect", "high_risk"],
      maxRuntimeMs: 120000,
      maxOutputBytes: 4194304,
      maxIterations: 8
    },
    safetyBoundaries: [
      "credential_and_cookie_values_are_never_extracted",
      "captcha_bypass_is_blocked",
      "purchase_payment_submit_require_explicit_user_commit",
      "foreground_desktop_requires_watch_mode",
      "host_os_mutation_is_disabled",
      "generated_code_must_remain_in_runtime_workspace",
      "debug_bundles_store_redacted_summaries"
    ]
  };
}

export function createComputerUseSuperYoloProfileDraft(): Record<string, unknown> {
  return {
    name: "Computer Use SUPER-YOLO one-time profile",
    mode: "scoped_yolo",
    scope: "one_time",
    status: "active",
    maxUses: 1,
    grants: {
      network: true,
      networkDomains: ["*"],
      browserAutomation: true,
      browserDomains: ["*"],
      filesystem: {
        readRoots: ["C:\\Users"],
        writeRoots: ["C:\\Users\\Public\\Documents\\Codex Outputs"]
      },
      commands: {
        allowPrefixes: [
          "node *",
          "npm *",
          "npx *",
          "git *",
          "python *",
          "py *",
          "powershell *",
          "pwsh *"
        ],
        denyPatterns: [
          "cookie",
          "password",
          "credential",
          "secret",
          "token",
          "captcha",
          "purchase",
          "payment"
        ]
      },
      packageInstall: true,
      packageAllowlist: ["*"],
      osMutation: true,
      generatedToolMaterialization: true,
      generatedToolExecution: true,
      generatedCode: true,
      credentialAccess: "never",
      credentialLeases: [],
      redactionPolicy: {
        credentials: "redact",
        cookies: "never_store",
        localPaths: "basename_or_hash",
        browserHistory: "domain_only",
        screenshots: "metadata_only",
        debugBundles: "redacted_summary",
        semanticMemory: "no_secret_values"
      },
      riskClasses: ["read_only", "reversible", "side_effect", "high_risk"],
      maxRuntimeMs: 300000,
      maxOutputBytes: 8388608,
      maxIterations: 16
    },
    safetyBoundaries: [
      "super_yolo_requires_user_confirmation",
      "super_yolo_is_one_time_only",
      "credential_and_cookie_values_are_never_extracted",
      "captcha_bypass_is_blocked",
      "purchase_payment_submit_require_explicit_user_commit",
      "foreground_desktop_requires_watch_mode",
      "terminal_destructive_patterns_remain_blocked",
      "file_access_is_broad_when_enabled",
      "debug_bundles_store_redacted_summaries"
    ]
  };
}

export function profileToEditablePayload(profile: AutonomyPermissionProfile): Record<string, unknown> {
  return {
    name: profile.name,
    mode: profile.mode,
    scope: profile.scope,
    status: profile.status,
    maxUses: profile.maxUses ?? null,
    expiresAt: profile.expiresAt ?? null,
    grants: profile.grants,
    safetyBoundaries: profile.safetyBoundaries
  };
}

export function validateManagedProfileDraft(draft: string): ManagedProfileDraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(draft || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        errors: ["Profile draft must be a JSON object."],
        warnings,
        summary: "Profile draft must be a JSON object."
      };
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Invalid JSON."],
      warnings,
      summary: "Invalid profile JSON."
    };
  }

  const grants = readRecord(payload.grants);
  const credentialAccess = typeof grants.credentialAccess === "string" ? grants.credentialAccess : "never";
  const scope = payload.scope === "persistent" ? "persistent" : "one_time";
  const riskClasses = readStringArray(grants.riskClasses);
  const browserDomains = readStringArray(grants.browserDomains);
  const commands = readRecord(grants.commands);
  const commandPrefixes = readStringArray(commands.allowPrefixes);
  const browserAutomation = grants.browserAutomation === true;
  const packageInstall = grants.packageInstall === true;
  const osMutation = grants.osMutation === true;
  const generatedCode = grants.generatedCode === true ||
    grants.generatedToolExecution === true ||
    grants.generatedToolMaterialization === true;
  const credentialLeases = Array.isArray(grants.credentialLeases) ? grants.credentialLeases : [];
  const hasCredentialLease = credentialLeases.some((lease) => {
    const record = readRecord(lease);
    return readString(record.id) &&
      (readString(record.status) ?? "active") === "active" &&
      (readStringArray(record.domains).length > 0 || Array.isArray(record.vaultRefs) && record.vaultRefs.length > 0) &&
      typeof record.expiresAt === "string" &&
      readStringArray(record.purposes).length > 0;
  });
  const highRisk = riskClasses.includes("high_risk") ||
    riskClasses.includes("credential") ||
    packageInstall ||
    osMutation;

  if (credentialAccess !== "never") {
    if (credentialAccess !== "ask") {
      errors.push("Credential access can only use ask mode.");
    }
    if (scope !== "one_time") {
      errors.push("Credential consent profiles must be one-time.");
    }
    if (!riskClasses.includes("credential")) {
      errors.push("Credential consent profiles must include credential risk.");
    }
    if (!hasCredentialLease) {
      errors.push("Credential consent requires an active expiring lease with domain or vault reference.");
    }
  } else if (riskClasses.includes("credential")) {
    errors.push("Credential risk requires an explicit credential consent lease.");
  }
  if (scope === "persistent" && highRisk) {
    errors.push("Persistent profiles cannot add high-risk, package, OS, or credential grants from this UI; use a one-time profile.");
  }
  if (scope === "persistent" && browserAutomation && browserDomains.length === 0) {
    errors.push("Persistent browser automation must list exact browser domains.");
  }
  if (scope === "persistent" && commandPrefixes.length > 5) {
    errors.push("Persistent command profiles are capped at five explicit prefixes in this UI.");
  }
  if (generatedCode && commandPrefixes.length === 0) {
    warnings.push("Generated-code profiles usually need exact command prefixes.");
  }
  if (scope === "one_time" && payload.maxUses !== 1) {
    errors.push("One-time profiles must keep maxUses at 1.");
  }
  if (!Array.isArray(payload.safetyBoundaries) || payload.safetyBoundaries.length === 0) {
    warnings.push("Safety boundaries are empty; daemon defaults may apply.");
  }

  return {
    ok: errors.length === 0,
    payload,
    errors,
    warnings,
    summary: errors.length
      ? errors.join(" ")
      : [
        `${scope} profile`,
        credentialAccess === "never" ? "credentials never" : `${credentialLeases.length} credential lease${credentialLeases.length === 1 ? "" : "s"}`,
        riskClasses.length ? `risk ${riskClasses.join(", ")}` : "risk read_only",
        browserAutomation ? `browser ${browserDomains.length ? browserDomains.length : "broad"}` : "browser off",
        commandPrefixes.length ? `${commandPrefixes.length} commands` : "no commands",
        warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "ready"
      ].join(" · ")
  };
}

export function summarizeOneTimeProfileDraft(requirements: AutonomyPermissionRequirement[]): OneTimeProfileDraftSummary | null {
  if (!requirements.length) {
    return null;
  }
  const riskClasses = valuesForRequirement(requirements, "risk_class") as AutonomyRiskClass[];
  const browserGrants = valuesForRequirement(requirements, "browser_automation");
  const commandGrants = valuesForRequirement(requirements, "command");
  const fileWriteRoots = valuesForRequirement(requirements, "filesystem_write");
  const generatedGrants = requirements.filter((requirement) =>
    requirement.type === "generated_tool_materialization" ||
    requirement.type === "generated_tool_execution" ||
    requirement.type === "generated_code"
  ).length;
  const networkGrants = valuesForRequirement(requirements, "network_domain").length + valuesForRequirement(requirements, "network").length;
  const summaryParts = [
    riskClasses.length ? `${riskClasses.join(", ")} risk` : "read-only risk",
    browserGrants.length ? `${browserGrants.length} browser grant${browserGrants.length === 1 ? "" : "s"}` : null,
    commandGrants.length ? `${commandGrants.length} exact command${commandGrants.length === 1 ? "" : "s"}` : null,
    fileWriteRoots.length ? `${fileWriteRoots.length} write root${fileWriteRoots.length === 1 ? "" : "s"}` : null,
    generatedGrants ? `${generatedGrants} generated-tool grant${generatedGrants === 1 ? "" : "s"}` : null,
    networkGrants ? `${networkGrants} network grant${networkGrants === 1 ? "" : "s"}` : null,
    "credential access stays never"
  ].filter((part): part is string => Boolean(part));
  return {
    scope: "one_time",
    maxUses: 1,
    credentialAccess: "never",
    riskClasses: riskClasses.length ? [...new Set(riskClasses)] : ["read_only"],
    browserGrants,
    commandGrants,
    fileWriteRoots,
    summary: summaryParts.join(" · ")
  };
}

export function valuesForRequirement(requirements: AutonomyPermissionRequirement[], type: AutonomyPermissionRequirement["type"]): string[] {
  return [...new Set(requirements.filter((requirement) => requirement.type === type).map((requirement) => requirement.value))];
}

export function formatCountOrList(values: string[]): string {
  if (!values.length) {
    return "none";
  }
  if (values.length <= 2) {
    return values.join(", ");
  }
  return `${values.length}`;
}

export function formatProfileUse(profile: AutonomyPermissionProfile): string {
  const maxUses = typeof profile.maxUses === "number" ? profile.maxUses : null;
  return maxUses === null ? `${profile.usedCount}/∞` : `${profile.usedCount}/${maxUses}`;
}

export function collectTerminalDeltaEvidenceRows(
  observations: ComputerSessionDebugBundle["observations"],
  rollbackActions: ComputerSessionDebugBundle["rollbackActions"]
): TerminalDeltaEvidenceRow[] {
  return observations
    .filter((observation) => observation.source === "terminal_output_root_diff")
    .map((observation) => {
      const metadata = readRecord(observation.metadata);
      const createdCount = readNumber(metadata.createdCount);
      const modifiedCount = readNumber(metadata.modifiedCount);
      const deletedCount = readNumber(metadata.deletedCount);
      const rollbackCandidateCount = readNumber(metadata.rollbackCandidateCount);
      const roles = [...new Set((observation.resourceIds ?? []).map((resource) => resource.role))];
      const hasDeltaManifest = roles.includes("terminal_output_root_delta_manifest");
      const linkedRollback = rollbackActions.find((action) =>
        action.metadata?.source === "terminal_output_root_diff" &&
        (action.capabilityJobId === observation.capabilityJobId || readString(readRecord(action.metadata).capabilityJobId) === observation.capabilityJobId)
      ) ?? rollbackActions.find((action) => action.metadata?.source === "terminal_output_root_diff");
      return {
        id: observation.id,
        status: observation.freshness ?? "evidence",
        createdCount,
        modifiedCount,
        deletedCount,
        rollbackCandidateCount,
        resources: roles.length ? roles.join(", ") : hasDeltaManifest ? "terminal_output_root_delta_manifest" : "manifest only",
        rollbackSummary: linkedRollback
          ? `${linkedRollback.status} rollback · ${readNumber(linkedRollback.metadata?.terminalArtifactTargetCount)} target${readNumber(linkedRollback.metadata?.terminalArtifactTargetCount) === 1 ? "" : "s"}`
          : "rollback not available",
        redactionSummary: summarizeTerminalDeltaRedaction(observation, linkedRollback),
        summary: `created ${createdCount}, modified ${modifiedCount}, deleted ${deletedCount}`
      };
    });
}

export function summarizeTerminalDeltaProof(rows: TerminalDeltaEvidenceRow[]): {
  createdCount: number;
  modifiedCount: number;
  deletedCount: number;
  rollbackCandidateCount: number;
} {
  return rows.reduce((total, row) => ({
    createdCount: total.createdCount + row.createdCount,
    modifiedCount: total.modifiedCount + row.modifiedCount,
    deletedCount: total.deletedCount + row.deletedCount,
    rollbackCandidateCount: total.rollbackCandidateCount + row.rollbackCandidateCount
  }), {
    createdCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    rollbackCandidateCount: 0
  });
}

export function summarizeTerminalDeltaRedaction(
  observation: ComputerSessionDebugBundle["observations"][number],
  rollbackAction?: ComputerSessionRollbackActionSummary
): string {
  const localPaths = readString(readRecord(observation.redaction).localPaths) ?? "minimized";
  const rollbackMetadata = readRecord(rollbackAction?.metadata);
  const rollbackTargets = Array.isArray(rollbackMetadata.terminalArtifactTargets)
    ? rollbackMetadata.terminalArtifactTargets
    : [];
  const hasRawPath = rollbackTargets.some((target) => typeof target === "object" && target !== null && "path" in target);
  return hasRawPath ? `${localPaths} · rollback path leak` : `${localPaths} · rollback paths redacted`;
}

export function collectBrowserChromeEvidenceRows(
  jobs: CapabilityJobSummary[],
  observations: ComputerSessionDebugBundle["observations"]
): BrowserChromeEvidenceRow[] {
  return jobs
    .filter((job) => job.kind === "browser_chrome")
    .map((job) => {
      const input = readRecord(job.inputJson);
      const outputEnvelope = readRecord(job.outputJson);
      const output = readRecord(outputEnvelope.output);
      const metadata = readRecord(outputEnvelope.metadata);
      const command = readString(input.command) ?? "browser_chrome";
      const linkedObservations = observations.filter((observation) => observation.capabilityJobId === job.id);
      const resourceRoles = linkedObservations.flatMap((observation) =>
        (observation.resourceIds ?? []).map((resource) => resource.role)
      );
      return {
        id: job.id,
        command,
        status: job.status,
        riskClass: readString(metadata.risk) ?? browserChromeRisk(command),
        verification: readString(metadata.verification) ?? readString(readRecord(output.verification).status) ?? "unverified",
        redactionSummary: summarizeBrowserChromeRedaction(command, input, output, linkedObservations),
        resourceSummary: resourceRoles.length ? [...new Set(resourceRoles)].join(", ") : "no resources",
        summary: summarizeBrowserChromeEvidence(command, output, linkedObservations)
      };
    });
}

export function summarizeBrowserChromeEvidence(
  command: string,
  output: Record<string, unknown>,
  observations: ComputerSessionDebugBundle["observations"]
): string {
  if (command === "download.verify" && output.verified === true) {
    return "Download verified with approved artifact evidence.";
  }
  if (command.startsWith("download.")) {
    const download = readRecord(output.download);
    const downloads = Array.isArray(output.downloads) ? output.downloads : [];
    const state = readString(download.state) ?? readString(readRecord(downloads[0]).state);
    return state ? `Download state ${state}.` : "Download evidence recorded.";
  }
  if (command.startsWith("history.")) {
    const items = Array.isArray(output.items) ? output.items.length : 0;
    return items ? `${items} history item(s), path-redacted.` : "History action recorded with redaction.";
  }
  if (command.startsWith("debugger.")) {
    return "Fixed debugger command evidence recorded.";
  }
  if (command.startsWith("permission.")) {
    const permission = readRecord(output.permission);
    const setting = readString(permission.verifiedSetting) ?? readString(permission.setting) ?? readString(permission.requestedSetting);
    const type = readString(permission.type) ?? "permission";
    return setting ? `${type} permission ${setting}.` : "Browser permission evidence recorded.";
  }
  if (command.startsWith("file_upload.")) {
    const files = Array.isArray(output.files) ? output.files.length : 0;
    return files ? `${files} file input item(s), local path redacted.` : "File upload state evidence recorded.";
  }
  if (observations.length) {
    return observations[0]?.summary ?? "Browser Chrome observation recorded.";
  }
  return "Browser Chrome command evidence recorded.";
}

export function summarizeBrowserChromeRedaction(
  command: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  observations: ComputerSessionDebugBundle["observations"]
): string {
  const observationRedactions = observations
    .map((observation) => readRecord(observation.redaction))
    .filter((redaction) => Object.keys(redaction).length > 0);
  if (observationRedactions.some((redaction) => redaction.localPaths === "basename_only")) {
    return "basename-only redacted";
  }
  if (command.startsWith("history.") || output.redaction === "url_path_redacted" || containsBooleanField(output, "pathRedacted")) {
    return "history/path redacted";
  }
  if (command.startsWith("file_upload.") || containsBooleanField(output, "pathRedacted") || containsBooleanField(input, "pathRedacted")) {
    return "local path redacted";
  }
  if (command.startsWith("debugger.")) {
    return "debugger output minimized";
  }
  return observationRedactions.length ? "metadata redacted" : "metadata only";
}

export function containsBooleanField(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsBooleanField(item, key));
  }
  const record = value as Record<string, unknown>;
  if (record[key] === true) {
    return true;
  }
  return Object.values(record).some((child) => containsBooleanField(child, key));
}

export function dedupePermissionRequirements(requirements: AutonomyPermissionRequirement[]): AutonomyPermissionRequirement[] {
  const seen = new Set<string>();
  const output: AutonomyPermissionRequirement[] = [];
  for (const requirement of requirements) {
    const key = `${requirement.type}:${requirement.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(requirement);
  }
  return output;
}

export function isPermissionRequirement(value: unknown): value is AutonomyPermissionRequirement {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { type?: unknown; value?: unknown; reason?: unknown };
  return typeof record.type === "string" && typeof record.value === "string" && typeof record.reason === "string";
}
function browserChromeRisk(command: string): string {
  if (command.startsWith("history.")) return "profile_private_data";
  if (command.startsWith("download.") || command.startsWith("debugger.")) return "local_artifact_create";
  if (command.startsWith("permission.") || command.startsWith("tabs.") || command.startsWith("tabGroups.")) return "browser_state_mutation";
  if (command.startsWith("file_upload.")) return "local_file_disclosure";
  return "read_only";
}

function browserChromeReason(command: string): string {
  const risk = browserChromeRisk(command);
  if (risk === "profile_private_data") return "Browser history access exposes profile-private data.";
  if (risk === "local_artifact_create") return "Browser chrome command can create or inspect local artifacts.";
  if (risk === "browser_state_mutation") return "Browser chrome command mutates browser state.";
  if (risk === "local_file_disclosure") return "File upload inspection can expose local file names.";
  return "Browser chrome read-only command requires browser automation approval.";
}

function readActionType(input: Record<string, unknown>): string {
  const action = input.action && typeof input.action === "object" ? input.action as Record<string, unknown> : {};
  return typeof action.type === "string" ? action.type : typeof input.action === "string" ? input.action : "action";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
