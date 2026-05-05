export type WidgetMode = "agent" | "browser" | "screen" | "terminal";

export const MODEL_OPTIONS = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "Codex 5.3" },
  { id: "gpt-5.3-codex-spark", label: "Spark 5.3" },
  { id: "gpt-5.2", label: "GPT-5.2" }
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export const REASONING_EFFORT_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" }
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId = "gpt-5.5";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export function normalizeModelId(value: unknown): ModelId {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODEL_OPTIONS.some((option) => option.id === normalized) ? (normalized as ModelId) : DEFAULT_MODEL_ID;
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return REASONING_EFFORT_OPTIONS.some((option) => option.id === normalized)
    ? (normalized as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

export type AuthStatus = {
  mode: "codex" | "oauth-proxy" | "mock";
  configured: boolean;
  authenticated: boolean;
  signInAvailable: boolean;
  signInMethod: "codex" | "pkce" | "token" | null;
  proxyUrl?: string;
  modelLabel?: string;
  reason?: string;
};

export type RuntimeInteractionKind = "approval" | "input";

export type RuntimeInteraction = {
  id: string;
  requestId?: string;
  kind: RuntimeInteractionKind;
  title: string;
  body: string;
  action?: string;
  fields?: Array<{
    id: string;
    label: string;
    placeholder?: string;
    multiline?: boolean;
  }>;
};

export type ProviderStatus = {
  mode: WidgetMode;
  label: string;
  state: "ready" | "stub" | "unavailable";
  detail: string;
  capabilities: string[];
};

export type ClientMessage =
  | {
      type: "ask";
      id: string;
      text: string;
      mode: WidgetMode;
      model?: ModelId;
      reasoningEffort?: ReasoningEffort;
    }
  | {
      type: "cancel";
      id: string;
    }
  | {
      type: "session.reset";
    }
  | {
      type: "interaction.respond";
      id: string;
      decision: "approve" | "decline" | "submit";
      answers?: Record<string, string>;
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
      type: "session.reset";
    }
  | {
      type: "provider.status";
      providers: ProviderStatus[];
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
