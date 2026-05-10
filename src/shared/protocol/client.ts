import type {
  BranchContextMessage,
  CodexUserInput,
  ScreenCrop,
  WidgetMode
} from "./base.js";
import type {
  BrowserActionDirectCommandInput,
  BrowserActionInput,
  BrowserActionMode,
  BrowserActionPlanInput,
  BrowserActionPolicySummary,
  BrowserActionSourceRequest
} from "./browserAction.js";
import type {
  ExecutionPermissionDecision,
  RuntimeInteractionDecision
} from "./runtime.js";
import type {
  ModelId,
  ReasoningEffort
} from "./model.js";
import type {
  VisionContextEventInput,
  VisionContextSourceRequest,
  VisionStreamMode
} from "./vision.js";

export type ClientMessage =
  | {
      type: "ask";
      id: string;
      text: string;
      mode: WidgetMode;
      sessionId?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
      branchContext?: BranchContextMessage[];
      appServerInput?: CodexUserInput[];
      regenerate?: {
        dropTurns: number;
        replaceFromMessageId?: string;
      };
    }
  | {
      type: "cancel";
      id: string;
    }
  | {
      type: "session.reset";
    }
  | {
      type: "session.branch";
      messages?: BranchContextMessage[];
      sourceMessageId?: string;
      title?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
      mode?: WidgetMode;
    }
  | {
      type: "session.create";
      title?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
      mode?: WidgetMode;
    }
  | {
      type: "session.open";
      sessionId: string;
    }
  | {
      type: "session.trash";
      sessionId: string;
    }
  | {
      type: "session.discard";
      sessionId: string;
    }
  | {
      type: "session.delete";
      sessionId: string;
    }
  | {
      type: "session.restore";
      sessionId: string;
    }
  | {
      type: "ledger.refresh";
      sessionId?: string;
    }
  | {
      type: "artifact.open";
      artifactFileId: string;
      versionId?: string;
    }
  | {
      type: "interaction.respond";
      id: string;
      decision: RuntimeInteractionDecision;
      action?: string;
      answers?: Record<string, string>;
    }
  | {
      type: "execution.permissions.refresh";
    }
  | {
      type: "execution.permission.set";
      action: string;
      decision: ExecutionPermissionDecision;
    }
  | {
      type: "provider.captureScreen";
      description?: string;
      crop?: ScreenCrop;
    }
  | {
      type: "provider.vision.start";
      id: string;
      mode: VisionStreamMode;
      sessionId?: string;
      fps?: number;
      frameIntervalMs?: number;
      maxDurationMs?: number;
      detail?: Record<string, unknown>;
    }
  | {
      type: "provider.vision.stop";
      id: string;
      reason?: string;
    }
  | {
      type: "provider.vision.recording.complete";
      id: string;
      mime: string;
      dataUrl: string;
      durationMs?: number;
      size?: number;
    }
  | {
      type: "provider.vision.error";
      id: string;
      message: string;
    }
  | {
      type: "visionContext.start";
      captureId?: string;
      sessionId?: string;
      source?: VisionContextSourceRequest;
      retention?: "default" | "privacy";
      rawMedia?: {
        videoPath?: string;
        audioPath?: string;
        segmentPaths?: string[];
      };
    }
  | {
      type: "visionContext.event";
      captureId: string;
      event: VisionContextEventInput;
    }
  | {
      type: "visionContext.stop";
      captureId: string;
      sendToAgent: boolean;
      requestId?: string;
      sessionId?: string;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
    }
  | {
      type: "visionContext.cancel";
      captureId: string;
    }
  | {
      type: "browserAction.start";
      actionSessionId?: string;
      sessionId?: string;
      mode?: BrowserActionMode;
      source?: BrowserActionSourceRequest;
    }
  | {
      type: "browserAction.adapters";
      actionSessionId?: string;
    }
  | {
      type: "browserAction.observe";
      actionSessionId: string;
      adapterId?: string;
    }
  | {
      type: "browserAction.execute";
      actionSessionId: string;
      action: BrowserActionInput;
      requestId?: string;
      adapterId?: string;
      approved?: boolean;
      targetHint?: string;
    }
  | {
      type: "browserAction.plan";
      actionSessionId?: string;
      sessionId?: string;
      plan: BrowserActionPlanInput;
      requestId?: string;
    }
  | {
      type: "browserAction.command";
      command: BrowserActionDirectCommandInput;
      requestId?: string;
    }
  | {
      type: "browserAction.policy.list";
    }
  | {
      type: "browserAction.policy.set";
      policy: Omit<BrowserActionPolicySummary, "id" | "createdAt" | "updatedAt"> & { id?: string };
    }
  | {
      type: "browserAction.policy.revoke";
      policyId: string;
    }
  | {
      type: "browserAction.cancel";
      actionSessionId: string;
    }
  | {
      type: "terminal.input";
      id: string;
      data: string;
      label?: string;
    }
  | {
      type: "ping";
    }
  | {
      type: "auth.start";
    }
  | {
      type: "auth.logout";
    }
  | {
      type: "auth.save-token";
      accessToken: string;
      proxyUrl: string;
      modelLabel?: string;
    };
