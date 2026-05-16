import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildBrowserObservation } from "../browserObservation.js";
import type { BrowserActionAdapter, BrowserActionCapability, BrowserActionExecutionResult, BrowserElementRiskHint, BrowserObservation, BrowserActionSession } from "../types.js";
import {
  getNativeDesktopHelperAvailability,
  getNativeDesktopHelperReleaseReadiness,
  readNativeDesktopHelperCapabilityManifest,
  runNativeDesktopHelper,
  type NativeDesktopHelperCapabilityManifest,
  type NativeDesktopHelperSnapshot,
  type NativeDesktopWindow
} from "./nativeDesktop/helperClient.js";

const execFileAsync = promisify(execFile);
const ENABLE_ENV = "CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP";
const BASE_CAPABILITIES: BrowserActionCapability[] = ["tab_control", "hotkey"];
const HELPER_CAPABILITIES: BrowserActionCapability[] = ["click", "type", "select", "scroll", "navigate", "tab_control", "hotkey"];
const HELPER_UNSUPPORTED_CAPABILITIES: BrowserActionCapability[] = ["screenshot"];
const HELPER_V2_DISABLED_PROBE_COMMANDS = ["capture_screenshot", "file_picker_select", "browser_permission_popup_click"] as const;
const HELPER_BLOCKED = {
  item: "Windows UI Automation executable Browser Action fallback",
  reason: "This repo now has a bounded Rust UI Automation helper and a PowerShell fallback helper, but production signing remains blocked until an Authenticode certificate or CI signing service is provided.",
  attemptedPath: "Bundle a Rust native helper under dist/browser-native-desktop-helper and preserve the PowerShell helper as a development fallback.",
  requiredScopeExpansion: `Provide an Authenticode code-signing certificate or CI signing secret, then enforce CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1 in release verification.`
};

export const nativeDesktopAdapter: BrowserActionAdapter = {
  id: "native-desktop",
  label: "Windows native desktop browser boundary",
  capabilities: HELPER_CAPABILITIES,
  async isAvailable() {
    return process.platform === "win32" && process.env[ENABLE_ENV] === "1";
  },
  async getStatus(input) {
    if (process.platform !== "win32") {
      return {
        id: "native-desktop",
        label: "Windows native desktop browser boundary",
        state: "unavailable",
        capabilities: BASE_CAPABILITIES,
        detail: "Native desktop Browser Action is Windows-only.",
        checkedAt: new Date().toISOString(),
        diagnostics: {
          scope: "browser_windows_only",
          blocked: HELPER_BLOCKED
        }
      };
    }
    if (process.env[ENABLE_ENV] !== "1") {
      return {
        id: "native-desktop",
        label: "Windows native desktop browser boundary",
        state: "unavailable",
        capabilities: BASE_CAPABILITIES,
        detail: `Set ${ENABLE_ENV}=1 to enable the bounded Windows browser-window diagnostics path.`,
        checkedAt: new Date().toISOString(),
        diagnostics: {
          scope: "browser_windows_only",
          env: ENABLE_ENV,
          blocked: HELPER_BLOCKED
        }
      };
    }
    const helper = getNativeDesktopHelperAvailability();
    const releaseReadiness = await getNativeDesktopHelperReleaseReadiness();
    const helperStatus =
      helper.configured && helper.exists
        ? await runNativeDesktopHelper({
            schemaVersion: "browser-native-desktop-helper.v1",
            requestId: "native-desktop-status",
            command: "status",
            timeoutMs: 5_000,
            session: pickSession(input.session)
          }).catch((error): import("./nativeDesktop/helperClient.js").NativeDesktopHelperResponse => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            metadata: { helperStatusError: true }
          }))
        : undefined;
    const helperWatchPreflight =
      helper.configured && helper.exists
        ? await runNativeDesktopHelper({
            schemaVersion: "browser-native-desktop-helper.v1",
            requestId: "native-desktop-watch-preflight",
            command: "watch_preflight",
            timeoutMs: 5_000,
            session: pickSession(input.session),
            watchPreflight: {
              monitorMs: 50,
              sampleIntervalMs: 10,
              idleThresholdMs: 750,
              requireNoUserInput: true,
              requireActiveWindowStable: true
            }
          }).catch((error): import("./nativeDesktop/helperClient.js").NativeDesktopHelperResponse => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            metadata: { helperWatchPreflightError: true }
          }))
        : undefined;
    const helperV2DisabledContracts = helper.configured && helper.exists
      ? await probeHelperV2DisabledContracts(input.session)
      : undefined;
    const capabilityManifest = readNativeDesktopHelperCapabilityManifest(helperStatus?.metadata);
    const windows =
      helperStatus?.ok && helperStatus.observation?.windows
        ? helperStatus.observation.windows
        : await listBrowserWindows().catch((error) => [
            { processName: "diagnostic-error", id: 0, title: error instanceof Error ? error.message : "Window enumeration failed." }
          ]);
    return {
      id: "native-desktop",
      label: "Windows native desktop browser boundary",
      state: "ready",
      capabilities: helper.configured && helper.exists ? HELPER_CAPABILITIES : BASE_CAPABILITIES,
      detail:
        helper.configured && helper.exists
          ? `Native desktop boundary can enumerate ${windows.length} browser window(s); executable actions will be routed through the configured helper.`
          : `Native desktop boundary can enumerate ${windows.length} browser window(s); executable actions require a configured UI Automation helper.`,
      checkedAt: new Date().toISOString(),
      diagnostics: {
        scope: "browser_windows_only",
        windows: windows.slice(0, 8),
        helper,
        helperStatus: helperStatus
          ? {
              ok: helperStatus.ok,
              error: helperStatus.error,
              metadata: helperStatus.metadata
            }
          : undefined,
        helperWatchPreflight: helperWatchPreflight
          ? {
              ok: helperWatchPreflight.ok,
              error: helperWatchPreflight.error,
              metadata: helperWatchPreflight.metadata
            }
          : undefined,
        helperV2DisabledContracts,
        helperCapabilities: buildHelperCapabilityDiagnostics(helper.configured && helper.exists, capabilityManifest),
        releaseReadiness,
        helperV2Boundary: buildHelperV2Boundary(capabilityManifest, releaseReadiness.releaseReady, helperWatchPreflight?.metadata, helperV2DisabledContracts),
        blocked: HELPER_BLOCKED
      }
    };
  },
  async observe(input) {
    const helper = getNativeDesktopHelperAvailability();
    if (helper.configured && helper.exists) {
      const response = await runNativeDesktopHelper({
        schemaVersion: "browser-native-desktop-helper.v1",
        requestId: "native-desktop-observe",
        command: "observe",
        timeoutMs: 5_000,
        session: pickSession(input.session)
      });
      if (response.ok && response.observation) {
        return buildObservationFromHelper(input.session, response.observation);
      }
    }
    const windows = await listBrowserWindows();
    return buildObservationFromWindows(input.session, windows);
  },
  async execute(input): Promise<BrowserActionExecutionResult> {
    if (input.action.type === "read") {
      const after = await nativeDesktopAdapter.observe({ session: input.session });
      return { requestId: "native-desktop", adapterId: "native-desktop", ok: true, after };
    }
    if (input.action.type === "screenshot") {
      return {
        requestId: "native-desktop",
        adapterId: "native-desktop",
        ok: false,
        error: "Native desktop helper v1 does not support screenshot execution; route screenshot requests through screen_observe, Playwright, or CDP.",
        metadata: {
          helperConfigured: getNativeDesktopHelperAvailability().configured,
          unsupportedCapability: "screenshot",
          fallbackCapabilities: ["screen_observe", "playwright_screenshot", "cdp_screenshot"]
        }
      };
    }
    const helper = getNativeDesktopHelperAvailability();
    if (helper.configured && helper.exists) {
      const response = await runNativeDesktopHelper({
        schemaVersion: "browser-native-desktop-helper.v1",
        requestId: `native-desktop-${input.action.type}`,
        command: "execute",
        timeoutMs: input.timeoutMs ?? 10_000,
        session: pickSession(input.session),
        action: input.action,
        target: input.target
      });
      if (!response.ok) {
        return {
          requestId: "native-desktop",
          adapterId: "native-desktop",
          ok: false,
          error: response.error ?? "Native desktop helper execution failed.",
          metadata: {
            ...response.metadata,
            helperConfigured: true
          }
        };
      }
      return {
        requestId: "native-desktop",
        adapterId: "native-desktop",
        ok: true,
        after: response.after ? buildObservationFromHelper(input.session, response.after) : undefined,
        metadata: {
          ...response.metadata,
          helperConfigured: true,
          helperAction: input.action.type
        }
      };
    }
    return {
      requestId: "native-desktop",
      adapterId: "native-desktop",
      ok: false,
      error: `BLOCKED: ${HELPER_BLOCKED.item}. ${HELPER_BLOCKED.reason} Required scope expansion: ${HELPER_BLOCKED.requiredScopeExpansion}`
    };
  }
};

function pickSession(session: BrowserActionSession): Pick<BrowserActionSession, "id" | "mode" | "source"> {
  return {
    id: session.id,
    mode: session.mode,
    source: session.source
  };
}

function buildHelperCapabilityDiagnostics(helperConfigured: boolean, manifest?: NativeDesktopHelperCapabilityManifest): Record<string, unknown> {
  return {
    advertised: helperConfigured ? HELPER_CAPABILITIES : BASE_CAPABILITIES,
    explicitlyUnsupported: HELPER_UNSUPPORTED_CAPABILITIES,
    manifestSchemaVersion: manifest?.schemaVersion,
    manifestCommandCount: manifest?.commands.length ?? 0,
    supportedCommands: manifest?.commands.filter((command) => command.supported).map((command) => command.name) ?? [],
    blockedV2Commands: manifest?.commands
      .filter((command) => !command.supported && command.status.includes("helper_v2"))
      .map((command) => command.name) ?? [],
    manifest,
    note: "The v1 Windows browser-window helper does not support screenshot execution; use screen observe, Playwright, or CDP screenshot paths instead."
  };
}

async function probeHelperV2DisabledContracts(session: BrowserActionSession): Promise<Record<string, unknown>> {
  const results = await Promise.all(HELPER_V2_DISABLED_PROBE_COMMANDS.map(async (command) => {
    const response = await runNativeDesktopHelper({
      schemaVersion: "browser-native-desktop-helper.v1",
      requestId: `native-desktop-disabled-${command}`,
      command,
      timeoutMs: 5_000,
      session: pickSession(session)
    }).catch((error): import("./nativeDesktop/helperClient.js").NativeDesktopHelperResponse => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: { helperV2DisabledProbeError: true, command }
    }));
    const metadata = response.metadata ?? {};
    return {
      command,
      ok: response.ok === false && String(response.error ?? "").includes("disabled"),
      schemaVersion: typeof metadata.schemaVersion === "string" ? metadata.schemaVersion : undefined,
      actualInputSent: metadata.actualInputSent === true,
      signedHelperV2Available: metadata.signedHelperV2Available === true,
      releaseGate: typeof metadata.releaseGate === "string" ? metadata.releaseGate : undefined,
      localFilePathDisclosed: metadata.localFilePathDisclosed === true,
      nativePopupClick: metadata.nativePopupClick === true,
      permissionChanged: metadata.permissionChanged === true,
      screenshotCaptured: metadata.screenshotCaptured === true,
      rawScreenshotStored: metadata.rawScreenshotStored === true,
      error: response.error
    };
  }));
  return {
    schemaVersion: "browser-native-desktop-helper-v2-disabled-contract-probe.v1",
    probedCommands: results.map((result) => result.command),
    contractCount: results.length,
    allDisabled: results.every((result) => result.ok === true && result.schemaVersion === "browser-native-desktop-helper-v2-disabled-command.v1"),
    anyInputSent: results.some((result) => result.actualInputSent === true),
    anyPathDisclosed: results.some((result) => result.localFilePathDisclosed === true),
    anyPermissionMutated: results.some((result) => result.permissionChanged === true),
    anyScreenshotCaptured: results.some((result) => result.screenshotCaptured === true || result.rawScreenshotStored === true),
    results
  };
}

function buildHelperV2Boundary(
  manifest: NativeDesktopHelperCapabilityManifest | undefined,
  releaseReady: boolean,
  watchPreflightMetadata?: Record<string, unknown>,
  disabledContracts?: Record<string, unknown>
): Record<string, unknown> {
  const blockedCommands = manifest?.commands
    .filter((command) => !command.supported && command.status.includes("helper_v2"))
    .map((command) => ({
      name: command.name,
      requiresForeground: command.requiresForeground,
      requiresApproval: command.requiresApproval,
      redactionBehavior: command.redactionBehavior,
      maxTimeoutMs: command.maxTimeoutMs,
      status: command.status
    })) ?? [];
  return {
    status: !manifest || blockedCommands.length > 0 || !releaseReady ? "blocked_until_signed_helper_v2" : "available",
    releaseReady,
    manifestPresent: Boolean(manifest),
    helperSideWatchPreflightPresent: Boolean(watchPreflightMetadata?.watchPreflight),
    helperSideContinuousMonitorPresent: readNestedBoolean(watchPreflightMetadata, ["helperSideGuards", "monitor", "enabled"]) === true,
    helperSideWatchPreflightActualInputSent: watchPreflightMetadata?.actualInputSent === true,
    disabledCommandContractsPresent: disabledContracts?.allDisabled === true,
    disabledCommandContractCount: typeof disabledContracts?.contractCount === "number" ? disabledContracts.contractCount : 0,
    disabledCommandContractsActualInputSent: disabledContracts?.anyInputSent === true,
    disabledCommandContractsPathDisclosed: disabledContracts?.anyPathDisclosed === true,
    disabledCommandContractsPermissionMutated: disabledContracts?.anyPermissionMutated === true,
    disabledCommandContractsScreenshotCaptured: disabledContracts?.anyScreenshotCaptured === true,
    guardedCommands: blockedCommands,
    nativeInputEnabled: false,
    actualInputSentForGuardedCommands: false
  };
}

function readNestedBoolean(record: Record<string, unknown> | undefined, path: string[]): boolean | undefined {
  let cursor: unknown = record;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "boolean" ? cursor : undefined;
}

function buildObservationFromWindows(session: BrowserActionSession, windows: NativeDesktopWindow[]): BrowserObservation {
  return buildBrowserObservation({
    source: {
      ...session.source,
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
}

function buildObservationFromHelper(session: BrowserActionSession, snapshot: NativeDesktopHelperSnapshot): BrowserObservation {
  const windows = snapshot.windows ?? [];
  return buildBrowserObservation({
    source: {
      ...session.source,
      kind: "active_tab",
      browser: "unknown",
      url: snapshot.url ?? session.source.url,
      title: snapshot.title ?? windows[0]?.title ?? session.source.title
    },
    snapshot: {
      url: snapshot.url ?? "",
      title: snapshot.title ?? "Windows browser helper observation",
      readyState: "complete",
      text: snapshot.text ?? windows.map((window) => `${window.processName} ${window.id}: ${window.title}`).join("\n"),
      elements: (snapshot.elements ?? []).map((element, index) => ({
        id: element.id ?? `native-helper-${index + 1}`,
        role: element.role,
        tagName: element.tagName ?? "native",
        label: element.label,
        text: element.text,
        value: element.value,
        placeholder: element.placeholder,
        selector: element.selector,
        bbox: element.bbox,
        visible: element.visible ?? true,
        enabled: element.enabled ?? true,
        editable: element.editable ?? false,
        checked: element.checked,
        selected: element.selected,
        inputType: element.inputType,
        confidence: element.confidence ?? 0.7,
        riskHints: normalizeRiskHints(element.riskHints)
      }))
    }
  });
}

function normalizeRiskHints(riskHints: string[] | undefined): BrowserElementRiskHint[] {
  const allowed = new Set<BrowserElementRiskHint>(["password", "payment", "delete", "submit", "file_upload", "download", "external_navigation", "auth", "unknown_side_effect"]);
  return (riskHints ?? []).filter((hint): hint is BrowserElementRiskHint => allowed.has(hint as BrowserElementRiskHint));
}

async function listBrowserWindows(): Promise<NativeDesktopWindow[]> {
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
