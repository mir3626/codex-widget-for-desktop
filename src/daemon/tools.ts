import {
  ProviderRegistry,
  renderDomSnapshotToolOutput,
  renderScreenSnapshotToolOutput
} from "./providers/providerRegistry.js";
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
      renderScreenSnapshotToolOutput(providers?.getScreenSnapshot() ?? null),
    terminal:
      "Terminal provider is ready. Use `/run <command>` for one-shot commands, or `/pty start`, `/pty <command>`, `/pty resize 120x30`, and `/pty write <input>` for the resident PTY session."
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
