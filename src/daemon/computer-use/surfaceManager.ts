import type {
  ExecutionSurface,
  ExecutionSurfaceDecision,
  ExecutionSurfaceKind,
  RiskClass
} from "../../shared/protocol.js";

export type SurfaceSelectionInput = {
  requestedSurface?: ExecutionSurfaceKind;
  userRequest?: string;
  riskClass?: RiskClass;
  requiresBrowserProfile?: boolean;
  requiresForeground?: boolean;
  requiresTerminal?: boolean;
  requiresGeneratedTool?: boolean;
  requiresBrowserChrome?: boolean;
  createsLocalArtifact?: boolean;
};

export class ExecutionSurfaceManager {
  private readonly surfaces: Map<ExecutionSurfaceKind, ExecutionSurface>;

  constructor(surfaces: ExecutionSurface[] = createDefaultExecutionSurfaces()) {
    this.surfaces = new Map(surfaces.map((surface) => [surface.kind, surface]));
  }

  list(): ExecutionSurface[] {
    return [...this.surfaces.values()];
  }

  select(input: SurfaceSelectionInput = {}): ExecutionSurfaceDecision {
    const warnings: string[] = [];
    const requiredGrants: string[] = [];
    if (input.requestedSurface) {
      const requested = this.surfaces.get(input.requestedSurface);
      if (requested) {
        return {
          surface: requested,
          reason: `requested_surface:${requested.kind}`,
          requiredGrants: requiredGrantsForSurface(requested, input),
          warnings
        };
      }
      warnings.push(`Requested surface is unavailable: ${input.requestedSurface}`);
    }

    if (input.requiresForeground) {
      const surface = this.requireSurface("foreground_desktop_watch");
      return {
        surface,
        reason: "foreground interaction requires explicit watch-mode surface",
        requiredGrants: requiredGrantsForSurface(surface, input),
        warnings
      };
    }

    if (input.requiresBrowserProfile) {
      const surface = this.requireSurface("regular_browser_extension");
      return {
        surface,
        reason: "request requires existing browser profile state",
        requiredGrants: requiredGrantsForSurface(surface, input),
        warnings
      };
    }

    if (input.requiresTerminal) {
      const surface = this.requireSurface("pty_workspace");
      return {
        surface,
        reason: "request is terminal-native",
        requiredGrants: requiredGrantsForSurface(surface, input),
        warnings
      };
    }

    if (input.requiresGeneratedTool || input.createsLocalArtifact || looksLikeResearchArtifactTask(input.userRequest)) {
      const surface = this.requireSurface("tool_workspace");
      return {
        surface,
        reason: "request is better served by a bounded tool workspace",
        requiredGrants: requiredGrantsForSurface(surface, input),
        warnings
      };
    }

    if (input.requiresBrowserChrome) {
      const surface = this.requireSurface("regular_browser_extension");
      return {
        surface,
        reason: "request targets browser chrome state",
        requiredGrants: requiredGrantsForSurface(surface, input),
        warnings
      };
    }

    const surface = this.requireSurface("isolated_browser");
    return {
      surface,
      reason: "default public web computer-use surface",
      requiredGrants: requiredGrantsForSurface(surface, input),
      warnings
    };
  }

  private requireSurface(kind: ExecutionSurfaceKind): ExecutionSurface {
    const surface = this.surfaces.get(kind);
    if (!surface) {
      throw new Error(`Execution surface is not registered: ${kind}`);
    }
    return surface;
  }
}

export function createDefaultExecutionSurfaces(): ExecutionSurface[] {
  return [
    {
      id: "surface:isolated_browser",
      kind: "isolated_browser",
      isolationLevel: "profile",
      supportsVisualActions: true,
      supportsStructuredDom: true,
      supportsBrowserChrome: false,
      supportsTerminal: false,
      supportsGeneratedTools: false,
      supportsFileArtifacts: true,
      requiresForeground: false,
      requiresUserProfileAccess: false,
      defaultRiskClass: "read_only"
    },
    {
      id: "surface:regular_browser_extension",
      kind: "regular_browser_extension",
      isolationLevel: "profile",
      supportsVisualActions: true,
      supportsStructuredDom: true,
      supportsBrowserChrome: true,
      supportsTerminal: false,
      supportsGeneratedTools: false,
      supportsFileArtifacts: true,
      requiresForeground: false,
      requiresUserProfileAccess: true,
      defaultRiskClass: "profile_private_data"
    },
    {
      id: "surface:tool_workspace",
      kind: "tool_workspace",
      isolationLevel: "workspace",
      supportsVisualActions: false,
      supportsStructuredDom: false,
      supportsBrowserChrome: false,
      supportsTerminal: false,
      supportsGeneratedTools: true,
      supportsFileArtifacts: true,
      requiresForeground: false,
      requiresUserProfileAccess: false,
      defaultRiskClass: "local_artifact_create"
    },
    {
      id: "surface:pty_workspace",
      kind: "pty_workspace",
      isolationLevel: "workspace",
      supportsVisualActions: false,
      supportsStructuredDom: false,
      supportsBrowserChrome: false,
      supportsTerminal: true,
      supportsGeneratedTools: false,
      supportsFileArtifacts: true,
      requiresForeground: false,
      requiresUserProfileAccess: false,
      defaultRiskClass: "local_artifact_create"
    },
    {
      id: "surface:foreground_desktop_watch",
      kind: "foreground_desktop_watch",
      isolationLevel: "foreground",
      supportsVisualActions: true,
      supportsStructuredDom: false,
      supportsBrowserChrome: false,
      supportsTerminal: false,
      supportsGeneratedTools: false,
      supportsFileArtifacts: false,
      requiresForeground: true,
      requiresUserProfileAccess: false,
      defaultRiskClass: "security_boundary"
    },
    {
      id: "surface:future_vm_session",
      kind: "future_vm_session",
      isolationLevel: "vm",
      supportsVisualActions: true,
      supportsStructuredDom: false,
      supportsBrowserChrome: false,
      supportsTerminal: true,
      supportsGeneratedTools: true,
      supportsFileArtifacts: true,
      requiresForeground: false,
      requiresUserProfileAccess: false,
      defaultRiskClass: "security_boundary"
    }
  ];
}

function requiredGrantsForSurface(surface: ExecutionSurface, input: SurfaceSelectionInput): string[] {
  const grants: string[] = [];
  if (surface.kind === "regular_browser_extension") {
    grants.push("browser.profile");
  }
  if (surface.supportsBrowserChrome || input.requiresBrowserChrome) {
    grants.push("browser.chrome");
  }
  if (surface.kind === "foreground_desktop_watch") {
    grants.push("desktop.foreground_watch");
    grants.push("desktop.abort_on_user_input");
  }
  if (surface.kind === "future_vm_session") {
    grants.push("vm.session_backend");
    grants.push("vm.network_isolation");
    grants.push("vm.lifecycle_cleanup");
    grants.push("vm.artifact_sync_policy");
  }
  if (surface.kind === "tool_workspace" || input.requiresGeneratedTool) {
    grants.push("generated_code.runtime_workspace");
  }
  if (surface.kind === "pty_workspace" || input.requiresTerminal) {
    grants.push("terminal.command_allowlist");
  }
  if (input.createsLocalArtifact) {
    grants.push("file.write_output_root");
  }
  return [...new Set(grants)];
}

function looksLikeResearchArtifactTask(userRequest?: string): boolean {
  if (!userRequest) {
    return false;
  }
  return /pdf|markdown|report|문서|보고서|정리|조사|research|crawl|크롤/i.test(userRequest);
}
