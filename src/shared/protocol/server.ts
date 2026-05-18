import type { AuthStatus } from "./auth.js";
import type {
  BrowserActionAdapterStatus,
  BrowserActionPolicySummary,
  BrowserExtensionBridgeStatus
} from "./browserAction.js";
import type { CapabilityJobEvent } from "./capability.js";
import type { ComputerSessionEvent } from "./computerUse.js";
import type {
  ArtifactFileChangeEvent,
  LedgerSnapshot
} from "./ledger.js";
import type {
  ExecutionPermissionDecision,
  ExecutionPermissionSummary,
  ProviderStatus,
  RuntimeInteraction,
  RuntimeStatus
} from "./runtime.js";
import type {
  MessageSnapshotStatus,
  SessionSnapshot
} from "./session.js";
import type { VisionStreamSummary } from "./vision.js";

export type ServerEvent =
  | {
      type: "connected";
      daemon: {
        port: number;
        model: string;
        liveModel: boolean;
        auth: AuthStatus;
      };
    }
  | {
      type: "auth.status";
      auth: AuthStatus;
    }
  | {
      type: "auth.url";
      url: string;
    }
  | {
      type: "external.url";
      url: string;
      reason?: string;
    }
  | {
      type: "session.state";
      state: "idle" | "thinking" | "streaming" | "tooling" | "cancelled" | "error";
      id?: string;
    }
  | {
      type: "message.delta";
      id: string;
      text: string;
    }
  | {
      type: "message.completed";
      id: string;
      text: string;
    }
  | {
      type: "message.snapshot";
      id: string;
      text: string;
      status: MessageSnapshotStatus;
    }
  | {
      type: "tool.started";
      id: string;
      tool: string;
      label: string;
    }
  | {
      type: "tool.output";
      id: string;
      tool: string;
      chunk: string;
    }
  | {
      type: "tool.completed";
      id: string;
      tool: string;
    }
  | {
      type: "approval.required";
      id: string;
      action: string;
      reason: string;
    }
  | {
      type: "interaction.required";
      interaction: RuntimeInteraction;
    }
  | {
      type: "execution.permissions";
      permissions: ExecutionPermissionSummary[];
    }
  | {
      type: "execution.permission.applied";
      id: string;
      action: string;
      decision: Exclude<ExecutionPermissionDecision, "ask">;
    }
  | {
      type: "session.reset";
    }
  | {
      type: "session.snapshot";
      snapshot: SessionSnapshot;
    }
  | {
      type: "ledger.snapshot";
      snapshot: LedgerSnapshot;
    }
  | ArtifactFileChangeEvent
  | {
      type: "provider.status";
      providers: ProviderStatus[];
    }
  | {
      type: "provider.capture";
      mode: "screen";
      state: "started" | "completed" | "error";
      message: string;
    }
  | {
      type: "provider.vision";
      state: "started" | "stopped" | "completed" | "error";
      stream: VisionStreamSummary;
      message: string;
    }
  | {
      type: "visionContext.started";
      captureId: string;
    }
  | {
      type: "visionContext.progress";
      captureId: string;
      status: string;
      detail?: unknown;
    }
  | {
      type: "visionContext.capsule";
      captureId: string;
      capsuleSummary: unknown;
    }
  | {
      type: "visionContext.sent";
      captureId: string;
      requestId: string;
    }
  | {
      type: "visionContext.error";
      captureId: string;
      error: string;
    }
  | {
      type: "browserAction.started";
      actionSessionId: string;
      summary: unknown;
    }
  | {
      type: "browserAction.observation";
      actionSessionId: string;
      observationSummary: unknown;
    }
  | {
      type: "browserAction.progress";
      actionSessionId: string;
      status: string;
      detail?: unknown;
    }
  | {
      type: "browserAction.adapters";
      actionSessionId?: string;
      adapters: BrowserActionAdapterStatus[];
    }
  | {
      type: "browserExtensionBridge.status";
      status: BrowserExtensionBridgeStatus;
    }
  | {
      type: "browserBridge.command";
      command: unknown;
    }
  | {
      type: "browserBridge.error";
      code: string;
      error: string;
    }
  | {
      type: "browserAction.plan";
      actionSessionId: string;
      plan: unknown;
    }
  | {
      type: "browserAction.policies";
      policies: BrowserActionPolicySummary[];
    }
  | {
      type: "browserAction.result";
      actionSessionId: string;
      result: unknown;
    }
  | {
      type: "browserAction.diagnostics";
      actionSessionId: string;
      diagnostics: unknown;
    }
  | CapabilityJobEvent
  | ComputerSessionEvent
  | {
      type: "browserAction.error";
      actionSessionId: string;
      error: string;
    }
  | {
      type: "terminal.output";
      id: string;
      chunk: string;
    }
  | {
      type: "runtime.status";
      status: RuntimeStatus;
    }
  | {
      type: "error";
      id?: string;
      message: string;
    }
  | {
      type: "pong";
    };

export type ToolEmitter = (event: ServerEvent) => void;
