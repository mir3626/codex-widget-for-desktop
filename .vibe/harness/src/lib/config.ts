import { readJson } from './fs.js';
import { paths } from './paths.js';

export interface ProviderRunner {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type SprintRoleDefinition =
  | string
  | {
      provider: string;
      tier: 'flagship' | 'performant' | 'efficient';
    };

export interface SprintRoles {
  planner: SprintRoleDefinition;
  generator: SprintRoleDefinition;
  evaluator: SprintRoleDefinition;
}

export interface SprintConfig {
  unit: string;
  subAgentPerRole: boolean;
  freshContextPerSprint: boolean;
}

export interface BundleConfig {
  enabled: boolean;
  policy?: 'automatic' | 'custom' | 'off';
  dir: string;
  path?: string;
  limitGzipKB: number;
  excludeExt: string[];
  rationale?: string;
  replacementEvidence?: string;
  resolvedBy?: 'user' | 'agent';
  resolvedAt?: string;
}

export interface BrowserSmokeConfig {
  enabled: boolean;
  configPath: string;
  dist?: string;
}

export interface AuditConfig {
  everyN?: number;
  projectRoots?: string[];
  prototypeLocThreshold?: number;
}

export interface VibeConfig {
  orchestrator: string;
  harnessVersion?: string;
  harnessVersionInstalled?: string;
  mode?: 'human' | 'agent';
  upstream?: {
    type: 'git' | 'local';
    url: string;
    ref?: string;
    self?: boolean;
  };
  sprintRoles: SprintRoles;
  sprint: SprintConfig;
  providers: Record<string, ProviderRunner>;
  qa?: {
    preferScripts?: string[];
  };
  bundle?: BundleConfig;
  browserSmoke?: BrowserSmokeConfig;
  audit?: AuditConfig;
}

export type VibeConfigOverride = Partial<
  Omit<VibeConfig, 'sprintRoles' | 'sprint' | 'providers' | 'qa' | 'bundle' | 'browserSmoke' | 'audit'>
> & {
  sprintRoles?: Partial<SprintRoles>;
  sprint?: Partial<SprintConfig>;
  providers?: Record<string, ProviderRunner>;
  qa?: Partial<NonNullable<VibeConfig['qa']>>;
  bundle?: Partial<BundleConfig>;
  browserSmoke?: Partial<BrowserSmokeConfig>;
  audit?: Partial<AuditConfig>;
};

function resolveBundleConfig(
  base: Partial<BundleConfig> | undefined,
  override: Partial<BundleConfig> | undefined,
): BundleConfig {
  const dir = override?.dir ?? base?.dir ?? 'dist';
  const resolved: BundleConfig = {
    enabled: override?.enabled ?? base?.enabled ?? false,
    dir,
    path: override?.path ?? base?.path ?? dir,
    limitGzipKB: override?.limitGzipKB ?? base?.limitGzipKB ?? 80,
    excludeExt: override?.excludeExt ?? base?.excludeExt ?? ['.map'],
  };
  const policy = override?.policy ?? base?.policy;
  const rationale = override?.rationale ?? base?.rationale;
  const replacementEvidence = override?.replacementEvidence ?? base?.replacementEvidence;
  const resolvedBy = override?.resolvedBy ?? base?.resolvedBy;
  const resolvedAt = override?.resolvedAt ?? base?.resolvedAt;
  if (policy !== undefined) {
    resolved.policy = policy;
  }
  if (rationale !== undefined) {
    resolved.rationale = rationale;
  }
  if (replacementEvidence !== undefined) {
    resolved.replacementEvidence = replacementEvidence;
  }
  if (resolvedBy !== undefined) {
    resolved.resolvedBy = resolvedBy;
  }
  if (resolvedAt !== undefined) {
    resolved.resolvedAt = resolvedAt;
  }
  return resolved;
}

function resolveBrowserSmokeConfig(
  base: Partial<BrowserSmokeConfig> | undefined,
  override: Partial<BrowserSmokeConfig> | undefined,
): BrowserSmokeConfig {
  return {
    enabled: override?.enabled ?? base?.enabled ?? false,
    configPath: override?.configPath ?? base?.configPath ?? '.vibe/smoke.config.js',
    dist: override?.dist ?? base?.dist ?? 'dist',
  };
}

function mergeConfig(base: VibeConfig, override: VibeConfigOverride): VibeConfig {
  const {
    sprintRoles,
    sprint,
    providers,
    qa,
    bundle,
    browserSmoke,
    audit,
    ...overrideRest
  } = override;
  const merged: VibeConfig = {
    ...base,
    ...overrideRest,
    sprintRoles: {
      ...base.sprintRoles,
      ...(sprintRoles ?? {}),
    },
    sprint: {
      ...base.sprint,
      ...(sprint ?? {}),
    },
    providers: {
      ...base.providers,
      ...(providers ?? {}),
    },
    qa: {
      ...(base.qa ?? {}),
      ...(qa ?? {}),
    },
  };

  if (base.bundle || bundle) {
    merged.bundle = resolveBundleConfig(base.bundle, bundle);
  }

  if (base.browserSmoke || browserSmoke) {
    merged.browserSmoke = resolveBrowserSmokeConfig(base.browserSmoke, browserSmoke);
  }

  if (base.audit || audit) {
    merged.audit = {
      ...(base.audit ?? {}),
      ...(audit ?? {}),
    };
  }

  return merged;
}

export async function loadConfig(): Promise<VibeConfig> {
  const shared = await readJson<VibeConfig>(paths.sharedConfig);

  try {
    const local = await readJson<VibeConfigOverride>(paths.localConfig);
    return mergeConfig(shared, local);
  } catch {
    return shared;
  }
}

export { mergeConfig };
