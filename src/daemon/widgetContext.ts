import {
  DEFAULT_MODEL_ID,
  normalizeModelId,
  normalizeReasoningEffort,
  type AuthStatus,
  type ModelId,
  type ProviderStatus,
  type ReasoningEffort,
  type WidgetMode
} from "../shared/protocol.js";
import type { ProviderRegistry } from "./providers/providerRegistry.js";

export type WidgetContextRequest = {
  mode: WidgetMode;
  text: string;
  model?: ModelId;
  reasoningEffort?: ReasoningEffort;
  widgetContext?: string;
};

export type WidgetContextOptions = {
  authStatus?: AuthStatus;
  providers?: ProviderRegistry;
};

const MAX_WIDGET_CONTEXT_LENGTH = 5200;

export function attachWidgetContext<T extends WidgetContextRequest>(
  request: T,
  options: WidgetContextOptions
): T {
  return {
    ...request,
    widgetContext: buildWidgetCapabilityContext(request, options)
  };
}

export function renderWidgetContextSection(widgetContext: string | undefined): string {
  const context = widgetContext?.trim();
  if (!context) {
    return "";
  }

  return ["Codex Widget desktop context:", context].join("\n");
}

export function buildWidgetCapabilityContext(
  request: Pick<WidgetContextRequest, "mode" | "model" | "reasoningEffort">,
  options: WidgetContextOptions
): string {
  const model = normalizeModelId(request.model ?? process.env.CODEX_WIDGET_MODEL ?? DEFAULT_MODEL_ID);
  const reasoning = normalizeReasoningEffort(request.reasoningEffort ?? process.env.CODEX_WIDGET_REASONING_EFFORT);
  const auth = sanitizeAuthStatus(options.authStatus);
  const providerStatuses = options.providers?.getStatuses() ?? [];

  return [
    "Purpose: a small resident Windows/Tauri desktop assistant widget for Codex. Use this section when the user asks what a button, mode, panel, session, artifact, or setting in the widget does.",
    `Current mode: ${request.mode}`,
    `Current model: ${model}`,
    `Current reasoning effort: ${reasoning}`,
    `Auth/runtime: mode=${auth.mode}; configured=${auth.configured ? "yes" : "no"}; authenticated=${auth.authenticated ? "yes" : "no"}; signIn=${auth.signInMethod || "none"}`,
    "",
    "Main UI controls:",
    "- Title bar: pin/unpin, opacity, minimize, maximize, close-to-tray, settings, sign in/out.",
    "- Session strip: internal chat tabs, New chat, Recovery Vault for archived/deleted sessions, and Branch in new chat from an assistant response.",
    "- Mode tabs: Agent for normal Codex conversation, DOM for browser tab context, Vision for screen capture/record/share, PTY for the resident terminal viewport.",
    "- Composer: Ask Codex textarea, send/stop button, model selector, reasoning selector, and resizable prompt area.",
    "- Activity: footer shows the latest widget action; the detail control opens the session activity log.",
    "- Artifacts: generated output and file-change artifacts appear in chat and can also be reviewed from trashed sessions.",
    "",
    "Mode capabilities:",
    ...renderProviderStatuses(providerStatuses),
    "",
    "PTY button/use cases:",
    "- Opens the widget terminal surface backed by a daemon-owned PTY session.",
    "- Useful for shell commands, checking local files, running scripts, long-lived shell state, direct text/key input, Ctrl+C, resize, and mouse-aware terminal apps.",
    "- Supports /pty start, /pty status, /pty stop, /pty resize, /pty write, direct input controls, and streamed terminal output.",
    "- The PTY popup opens a terminal-focused widget window on the same daemon port; it is intended for longer interactive terminal work while the compact widget remains available.",
    "",
    "Vision button/use cases:",
    "- Capture snapshot sends a screen snapshot into Vision context.",
    "- Record WebM creates a local recording artifact with metadata and blob storage.",
    "- Share with Agent streams low-frequency frames as live screen context without saving a video file.",
    "",
    "DOM button/use cases:",
    "- Uses the browser extension, bookmarklet, or local provider endpoint to attach active-tab DOM text/selection/metadata.",
    "- Browser Action can observe structured interactive elements and run audited typed actions such as read, click, type, select/check, scroll, navigate, back, forward, reload, and screenshot when the daemon/extension or controlled-browser adapter path is available.",
    "- Browser Action exposes adapter status for extension, Playwright, CDP, and Windows native desktop boundaries; full_control_dev evaluate is non-default and requires approval with code preview and credential safeguards.",
    "- Risky actions such as submit, delete, send, post, pay, purchase, auth, file upload, download, or low-confidence side effects require user approval or clarification.",
    "- If no snapshot exists, tell the user they need to capture or send DOM context first.",
    "",
    "Mascot/persona:",
    "- Current preset: Default Dog, a small resident desktop assistant companion.",
    "- Tone: concise, practical, calm, and lightly friendly; match the user's language and avoid over-explaining routine UI.",
    "- Mascot state hints: idle=available, working=active Codex turn, recording=screen recording, streaming=Agent screen share, offline=daemon/auth unavailable.",
    "",
    "Safety and boundaries:",
    "- Do not claim the widget can directly change its own protected source from inside the widget Agent session. Source changes to this widget/repo should be handled through the CLI.",
    "- For user-owned folders/files outside the protected widget source, the widget Agent may help search, read, create, modify, move, or delete only when the user clearly requests the operation and target.",
    "- Do not reveal OAuth tokens, Codex credentials, or hidden environment values."
  ]
    .join("\n")
    .slice(0, MAX_WIDGET_CONTEXT_LENGTH);
}

function sanitizeAuthStatus(auth: AuthStatus | undefined): Pick<AuthStatus, "mode" | "configured" | "authenticated" | "signInMethod"> {
  return {
    mode: auth?.mode ?? "mock",
    configured: Boolean(auth?.configured),
    authenticated: Boolean(auth?.authenticated),
    signInMethod: auth?.signInMethod ?? null
  };
}

function renderProviderStatuses(statuses: ProviderStatus[]): string[] {
  if (statuses.length === 0) {
    return ["- Provider status is not available yet."];
  }

  return statuses.map((status) => {
    const capabilities = status.capabilities.length > 0 ? status.capabilities.join(", ") : "none";
    return `- ${status.label} (${status.mode}): state=${status.state}; detail=${cleanLine(status.detail)}; capabilities=${capabilities}`;
  });
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}
