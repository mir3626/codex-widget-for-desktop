import type { ProviderStatus, ToolEmitter, WidgetMode } from "../shared/protocol.js";

export function getProviderStatuses(): ProviderStatus[] {
  return [
    {
      mode: "agent",
      label: "Agent",
      state: "ready",
      detail: "Codex app-server runtime",
      capabilities: ["streaming", "session", "approval"]
    },
    {
      mode: "browser",
      label: "DOM",
      state: "stub",
      detail: "Browser bridge pending",
      capabilities: ["active-tab", "selection", "metadata"]
    },
    {
      mode: "screen",
      label: "Vision",
      state: "stub",
      detail: "Screen capture pending",
      capabilities: ["capture", "crop", "diff"]
    },
    {
      mode: "terminal",
      label: "PTY",
      state: "stub",
      detail: "PTY provider pending",
      capabilities: ["shell", "output", "cancel"]
    }
  ];
}

export async function emitModePreview(
  id: string,
  mode: WidgetMode,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<void> {
  if (mode === "agent") {
    return;
  }

  const toolNameByMode: Record<Exclude<WidgetMode, "agent">, string> = {
    browser: "browser.domSnapshot",
    screen: "screen.capture",
    terminal: "terminal.pty"
  };

  const labelByMode: Record<Exclude<WidgetMode, "agent">, string> = {
    browser: "Active tab bridge",
    screen: "Screen vision provider",
    terminal: "PTY session provider"
  };

  const messageByMode: Record<Exclude<WidgetMode, "agent">, string> = {
    browser:
      "Browser provider stub is ready. Next step: attach a Chrome extension bridge for DOM selection and active-tab context.",
    screen:
      "Screen provider stub is ready. Next step: wire Windows Graphics Capture, crop/diff, and vision input.",
    terminal:
      "Terminal provider stub is ready. Next step: attach ConPTY/node-pty and stream shell output into the same session."
  };

  const tool = toolNameByMode[mode];

  emit({ type: "tool.started", id, tool, label: labelByMode[mode] });
  await delay(180, signal);
  emit({ type: "tool.output", id, tool, chunk: messageByMode[mode] });
  await delay(120, signal);
  emit({ type: "tool.completed", id, tool });
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}
