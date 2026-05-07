import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildBrowserObservation } from "../browserObservation.js";
import type { BrowserActionAdapter, BrowserActionExecutionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const ENABLE_ENV = "CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP";

export const nativeDesktopAdapter: BrowserActionAdapter = {
  id: "native-desktop",
  label: "Windows native desktop browser boundary",
  capabilities: ["tab_control", "hotkey"],
  async isAvailable() {
    return process.platform === "win32" && process.env[ENABLE_ENV] === "1";
  },
  async getStatus() {
    if (process.platform !== "win32") {
      return {
        id: "native-desktop",
        label: "Windows native desktop browser boundary",
        state: "unavailable",
        capabilities: nativeDesktopAdapter.capabilities,
        detail: "Native desktop Browser Action is Windows-only.",
        checkedAt: new Date().toISOString()
      };
    }
    if (process.env[ENABLE_ENV] !== "1") {
      return {
        id: "native-desktop",
        label: "Windows native desktop browser boundary",
        state: "unavailable",
        capabilities: nativeDesktopAdapter.capabilities,
        detail: `Set ${ENABLE_ENV}=1 to enable the bounded Windows browser-window diagnostics path.`,
        checkedAt: new Date().toISOString()
      };
    }
    const windows = await listBrowserWindows().catch((error) => [{ processName: "diagnostic-error", id: 0, title: error instanceof Error ? error.message : "Window enumeration failed." }]);
    return {
      id: "native-desktop",
      label: "Windows native desktop browser boundary",
      state: "ready",
      capabilities: nativeDesktopAdapter.capabilities,
      detail: `Native desktop boundary can enumerate ${windows.length} browser window(s); DOM actions require UI Automation helper scope.`,
      checkedAt: new Date().toISOString(),
      diagnostics: { windows: windows.slice(0, 8) }
    };
  },
  async observe(input) {
    const windows = await listBrowserWindows();
    return buildBrowserObservation({
      source: {
        ...input.session.source,
        kind: "active_tab",
        browser: "unknown",
        title: windows[0]?.title
      },
      snapshot: {
        url: "",
        title: "Windows browser windows",
        readyState: "complete",
        text: windows.map((window) => `${window.processName} ${window.id}: ${window.title}`).join("\n"),
        elements: windows.map((window, index) => ({
          id: `window-${window.id || index + 1}`,
          role: "window",
          tagName: "window",
          label: window.title,
          text: window.title,
          selector: `process:${window.processName}:${window.id}`,
          visible: true,
          enabled: true,
          editable: false,
          confidence: 0.75,
          riskHints: []
        }))
      }
    });
  },
  async execute(input): Promise<BrowserActionExecutionResult> {
    if (input.action.type === "read") {
      const after = await nativeDesktopAdapter.observe({ session: input.session });
      return { requestId: "native-desktop", adapterId: "native-desktop", ok: true, after };
    }
    return {
      requestId: "native-desktop",
      adapterId: "native-desktop",
      ok: false,
      error: "Native desktop Browser Action currently provides Windows browser-window diagnostics only. UI Automation or a bounded native input helper is required for executable browser chrome actions."
    };
  }
};

async function listBrowserWindows(): Promise<Array<{ processName: string; id: number; title: string }>> {
  if (process.platform !== "win32") {
    return [];
  }
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$names = @('chrome','msedge','chromium','brave','firefox')",
    "Get-Process -Name $names | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,Id,MainWindowTitle | ConvertTo-Json -Compress"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 5_000 });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      processName: String(row.ProcessName ?? "unknown"),
      id: Number(row.Id ?? 0),
      title: String(row.MainWindowTitle ?? "")
    }))
    .filter((row) => row.title);
}
