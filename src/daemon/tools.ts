import { ProviderRegistry, renderDomSnapshotToolOutput } from "./providers/providerRegistry.js";
import type { ProviderStatus, ToolEmitter, WidgetMode } from "../shared/protocol.js";

export function getProviderStatuses(providers?: ProviderRegistry): ProviderStatus[] {
  return providers?.getStatuses() ?? new ProviderRegistry().getStatuses();
}

export async function emitModePreview(
  id: string,
  mode: WidgetMode,
  emit: ToolEmitter,
  signal: AbortSignal,
  providers?: ProviderRegistry
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
      renderDomSnapshotToolOutput(providers?.getDomSnapshot() ?? null),
    screen:
      "Screen provider stub is ready. Next step: wire Windows Graphics Capture, crop/diff, and vision input.",
    terminal:
      "Terminal provider is ready. Use `/run <command>`, `$ <command>`, or a fenced shell block to execute an explicit command."
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
