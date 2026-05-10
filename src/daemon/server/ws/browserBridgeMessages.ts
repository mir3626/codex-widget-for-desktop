import type { BrowserExtensionBridgeStatus } from "../../../shared/protocol.js";
import { browserBridgeActiveTabChanged, pollBrowserBridgeCommand } from "../http/routes/browserBridgeRoutes.js";
import { broadcast, send } from "../events.js";
import type { MessageRouterContext } from "./context.js";

type BrowserBridgeCommandPollMessage = {
  type?: string;
  tabId?: string | number;
  windowId?: string | number;
  url?: string;
  title?: string;
  permission?: string;
  mode?: string;
  reason?: string;
};

export async function handleBrowserBridgeMessage(message: unknown, context: MessageRouterContext): Promise<boolean> {
  const record = message && typeof message === "object" ? message as BrowserBridgeCommandPollMessage : {};
  if (record.type !== "browserBridge.command.poll") {
    return false;
  }

  const previous = context.browserExtensionBridge.snapshot();
  const status = context.browserExtensionBridge.update(buildBrowserBridgeWebSocketStatus(record, previous));
  if (browserBridgeActiveTabChanged(previous, status)) {
    context.browserPerception.markDirty(`bridge_active_tab_changed:${status.reason ?? "ws_poll"}`);
  }
  broadcast(context.clients, { type: "browserExtensionBridge.status", status });

  const command = await pollBrowserBridgeCommand({
    browserPerception: context.browserPerception,
    browserActions: context.browserActions,
    waitMs: 0
  });
  send(context.socket, { type: "browserBridge.command", command });
  return true;
}

function buildBrowserBridgeWebSocketStatus(
  message: BrowserBridgeCommandPollMessage,
  previous: BrowserExtensionBridgeStatus
): BrowserExtensionBridgeStatus {
  const permission = readBridgePermission(message.permission);
  const tabId = message.tabId ?? previous.activeTab?.tabId;
  const windowId = message.windowId ?? previous.activeTab?.windowId;
  const url = typeof message.url === "string" ? message.url : previous.activeTab?.url;
  const title = typeof message.title === "string" ? message.title : previous.activeTab?.title;
  return {
    ...previous,
    connected: true,
    mode: permission === "allowed" ? "idle" : permission === "restricted" ? "restricted" : "permission_needed",
    reason: typeof message.reason === "string" ? message.reason : "ws_poll",
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    activeTab: {
      ...previous.activeTab,
      tabId,
      windowId,
      url,
      title,
      origin: readOriginPattern(url),
      permission
    }
  };
}

function readBridgePermission(value: unknown): NonNullable<BrowserExtensionBridgeStatus["activeTab"]>["permission"] {
  return value === "allowed" || value === "needs_site_permission" || value === "restricted" || value === "unavailable"
    ? value
    : "unknown";
}

function readOriginPattern(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return `${url.origin}/*`;
  } catch {
    return undefined;
  }
}
