import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeDesktopAdapter } from "../dist/daemon/browser-action/index.js";
import { BrowserChromeCommandBridge } from "../dist/daemon/browser-chrome/index.js";
import { registerDaemonCapabilities } from "../dist/daemon/capabilities/registerCapabilities.js";
import { CapabilityRuntime } from "../dist/daemon/capability-runtime/index.js";
import { ComputerSessionRuntime } from "../dist/daemon/computer-use/index.js";
import { createStorageService } from "../dist/daemon/storage/storage.js";

const session = {
  id: "native-desktop-smoke",
  startedAt: new Date().toISOString(),
  source: { kind: "active_tab", browser: "unknown" },
  mode: "auto_safe_actions",
  status: "active",
  timeline: [],
  approvals: []
};

const status = await nativeDesktopAdapter.getStatus({ session });
if (status.diagnostics?.scope !== "browser_windows_only" || !status.diagnostics?.blocked?.requiredScopeExpansion) {
  throw new Error(`Native desktop diagnostics must expose bounded scope and helper blocker: ${JSON.stringify(status)}`);
}
if (status.capabilities.includes("screenshot")) {
  throw new Error(`Native desktop adapter must not advertise unsupported screenshot execution: ${JSON.stringify(status)}`);
}
if (process.platform !== "win32") {
  assertEqual(status.state, "unavailable", "native desktop non-windows status");
} else if (process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP === "1") {
  assertEqual(status.state, "ready", "native desktop enabled status");
  const observation = await nativeDesktopAdapter.observe({ session });
  if (!observation.title) {
    throw new Error(`Native desktop observation missing title: ${JSON.stringify(observation)}`);
  }
  const execute = await nativeDesktopAdapter.execute({
    session,
    observation,
    action: { type: "click", target: { kind: "focused" } }
  });
  assertEqual(execute.ok, false, "native desktop unsupported executable action");
  if (!String(execute.error).includes("BLOCKED") || !String(execute.error).includes("UI Automation")) {
    throw new Error(`Native desktop unsupported path should name BLOCKED UI Automation scope: ${execute.error}`);
  }
} else {
  assertEqual(status.state, "unavailable", "native desktop disabled status");
  if (!status.detail.includes("CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP")) {
    throw new Error(`Native desktop status should explain enable flag: ${status.detail}`);
  }
}

await assertNativeHelperContract();
await assertBundledNativeHelperDiscovery();

console.log(`browser action native smoke ok: ${status.state}`);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

async function assertNativeHelperContract() {
  const previousEnabled = process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP;
  const previousHelper = process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER;
  const tempDir = mkdtempSync(join(tmpdir(), "browser-native-helper-smoke-"));
  const helperPath = join(tempDir, "mock-helper.mjs");
  writeFileSync(
    helperPath,
    `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (request.action?.value && /secret/i.test(String(request.action.value))) {
    process.stdout.write(JSON.stringify({ ok: false, error: "mock helper refuses secret values" }));
    return;
  }
  const observation = {
    url: "browser://native-helper-smoke",
    title: "Native Helper Smoke",
    text: "Native helper observed a browser chrome fallback surface.",
    elements: [
      { id: "tab-back", role: "button", tagName: "button", label: "Back", text: "Back", selector: "uia:back", visible: true, enabled: true, editable: false, confidence: 0.9 }
    ]
  };
  const capabilityManifest = {
    schemaVersion: "browser-native-desktop-helper-capability-manifest.v2",
    helperSchemaVersion: "browser-native-desktop-helper.v1",
    helperVersion: "mock",
    scope: "browser_windows_only",
    boundary: {
      foregroundDesktopWatchExecutor: false,
      nativeFilePickerExecutor: false,
      browserPermissionPopupNativeClickExecutor: false,
      requiresSignedHelperV2ForForegroundInput: true,
      actualInputSentForBlockedV2Commands: false
    },
    commands: [
      { name: "status", supported: true, requiresForeground: false, requiresApproval: false, reversible: true, redactionBehavior: "no_sensitive_content", maxTimeoutMs: 5000, status: "current_v1" },
      { name: "watch_preflight", supported: true, requiresForeground: false, requiresApproval: false, reversible: true, redactionBehavior: "metadata_only_no_input", maxTimeoutMs: 5000, status: "current_v1_observe_only" },
      { name: "observe_uia", supported: true, requiresForeground: false, requiresApproval: false, reversible: true, redactionBehavior: "password_values_omitted", maxTimeoutMs: 5000, status: "current_v1" },
      { name: "execute.click", supported: true, requiresForeground: false, requiresApproval: true, reversible: false, redactionBehavior: "target_evidence_only", maxTimeoutMs: 10000, status: "current_v1" },
      { name: "capture_screenshot", supported: false, requiresForeground: true, requiresApproval: true, reversible: true, redactionBehavior: "blob_backed_region_only", maxTimeoutMs: 5000, status: "blocked_until_signed_helper_v2" },
      { name: "file_picker_select", supported: false, requiresForeground: true, requiresApproval: true, reversible: false, redactionBehavior: "basename_only_path_evidence", maxTimeoutMs: 15000, status: "blocked_until_signed_helper_v2" },
      { name: "browser_permission_popup_click", supported: false, requiresForeground: true, requiresApproval: true, reversible: false, redactionBehavior: "origin_redacted_and_no_credentials", maxTimeoutMs: 10000, status: "blocked_until_signed_helper_v2" }
    ]
  };
  if (request.command === "status") {
    process.stdout.write(JSON.stringify({ ok: true, observation: { ...observation, elements: [] }, metadata: { mockCommand: "status", capabilityManifest } }));
    return;
  }
  if (request.command === "watch_preflight") {
    process.stdout.write(JSON.stringify({
      ok: true,
      observation: { ...observation, elements: [] },
      metadata: {
        mockCommand: "watch_preflight",
        actualInputSent: false,
        watchPreflight: {
          schemaVersion: "foreground-watch-preflight.v1",
          oneTimeApprovalGranted: false,
          visibleCountdownArmed: false,
          activeWindowAsserted: true,
          targetIdentityAsserted: true,
          processAllowed: true,
          surfaceLockArmed: false,
          userIdle: true,
          abortOnUserInputArmed: true,
          userInputDetected: false,
          activeWindowDriftDetected: false,
          timeoutArmed: true,
          preActionEvidenceReady: true,
          postActionEvidenceReady: false,
          effectVerifierReady: false,
          rollbackProofReady: false,
          notReversibleRecordReady: true,
          signedHelperV2Available: false,
          actualInputSent: false
        },
        helperSideGuards: {
          schemaVersion: "browser-native-desktop-helper-watch-preflight-guards.v1",
          continuousMonitoring: Boolean(request.watchPreflight?.monitorMs),
          monitor: {
            enabled: Boolean(request.watchPreflight?.monitorMs),
            requestedMs: request.watchPreflight?.monitorMs ?? 0,
            elapsedMs: request.watchPreflight?.monitorMs ?? 0,
            sampleIntervalMs: request.watchPreflight?.sampleIntervalMs ?? 25,
            sampleCount: request.watchPreflight?.monitorMs ? 2 : 0,
            userInputDetected: false,
            activeWindowDriftDetected: false
          },
          reason: "observe_only_preflight_no_foreground_input"
        }
      }
    }));
    return;
  }
  if (["capture_screenshot", "file_picker_select", "browser_permission_popup_click"].includes(request.command)) {
    const extras = request.command === "file_picker_select"
      ? { localFilePathDisclosed: false, fileSelected: false }
      : request.command === "browser_permission_popup_click"
        ? { nativePopupClick: false, permissionChanged: false }
        : { screenshotCaptured: false, rawScreenshotStored: false };
    process.stdout.write(JSON.stringify({
      ok: false,
      error: request.command + " disabled until signed helper v2",
      metadata: {
        schemaVersion: "browser-native-desktop-helper-v2-disabled-command.v1",
        command: request.command,
        enabled: false,
        supported: false,
        dryRunOnly: true,
        actualInputSent: false,
        signedHelperV2Available: false,
        releaseGate: "browser-native-helper-signing",
        blocker: "signed_helper_v2_unavailable",
        requiredPreconditions: ["one_time_approval", "signed_helper_v2"],
        ...extras
      }
    }));
    return;
  }
  if (request.command === "observe") {
    process.stdout.write(JSON.stringify({ ok: true, observation, metadata: { mockCommand: "observe" } }));
    return;
  }
  if (request.command === "execute") {
    process.stdout.write(JSON.stringify({ ok: true, after: observation, metadata: { mockCommand: "execute", actionType: request.action.type } }));
    return;
  }
  process.stdout.write(JSON.stringify({ ok: true, metadata: { mockCommand: request.command } }));
});
`,
    "utf8"
  );
  try {
    process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP = "1";
    process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER = helperPath;
    const helperStatus = await nativeDesktopAdapter.getStatus({ session });
    if (process.platform === "win32") {
      assertEqual(helperStatus.state, "ready", "native helper status");
      if (helperStatus.diagnostics?.helper?.exists !== true) {
        throw new Error(`Native helper status should report configured helper: ${JSON.stringify(helperStatus)}`);
      }
      assertEqual(helperStatus.diagnostics?.releaseReadiness?.releaseReady, false, "mock helper release readiness");
      if (!helperStatus.diagnostics?.releaseReadiness?.blockers?.includes("native_executable_required_for_release")) {
        throw new Error(`Native helper status should keep generated/mock helpers development-only: ${JSON.stringify(helperStatus.diagnostics?.releaseReadiness)}`);
      }
      if (helperStatus.capabilities.includes("screenshot") || !helperStatus.diagnostics?.helperCapabilities?.explicitlyUnsupported?.includes("screenshot")) {
        throw new Error(`Native helper status should truthfully mark screenshot unsupported: ${JSON.stringify(helperStatus)}`);
      }
      if (helperStatus.diagnostics?.helperCapabilities?.manifestSchemaVersion !== "browser-native-desktop-helper-capability-manifest.v2") {
        throw new Error(`Native helper status should expose capability manifest diagnostics: ${JSON.stringify(helperStatus.diagnostics?.helperCapabilities)}`);
      }
      if (!helperStatus.diagnostics?.helperCapabilities?.blockedV2Commands?.includes("file_picker_select")) {
        throw new Error(`Native helper status should list helper-v2 guarded commands: ${JSON.stringify(helperStatus.diagnostics?.helperCapabilities)}`);
      }
      if (helperStatus.diagnostics?.helperV2Boundary?.nativeInputEnabled !== false || helperStatus.diagnostics?.helperV2Boundary?.actualInputSentForGuardedCommands !== false) {
        throw new Error(`Native helper-v2 boundary must keep guarded input disabled: ${JSON.stringify(helperStatus.diagnostics?.helperV2Boundary)}`);
      }
      if (helperStatus.diagnostics?.helperWatchPreflight?.metadata?.watchPreflight?.schemaVersion !== "foreground-watch-preflight.v1") {
        throw new Error(`Native helper status should expose helper-side watch preflight evidence: ${JSON.stringify(helperStatus.diagnostics?.helperWatchPreflight)}`);
      }
      if (helperStatus.diagnostics?.helperV2Boundary?.helperSideWatchPreflightPresent !== true || helperStatus.diagnostics?.helperV2Boundary?.helperSideWatchPreflightActualInputSent !== false) {
        throw new Error(`Native helper-v2 boundary should surface observe-only helper preflight: ${JSON.stringify(helperStatus.diagnostics?.helperV2Boundary)}`);
      }
      if (helperStatus.diagnostics?.helperV2Boundary?.helperSideContinuousMonitorPresent !== true) {
        throw new Error(`Native helper-v2 boundary should surface observe-only continuous monitor evidence: ${JSON.stringify(helperStatus.diagnostics?.helperV2Boundary)}`);
      }
      if (helperStatus.diagnostics?.helperV2Boundary?.disabledCommandContractsPresent !== true ||
        helperStatus.diagnostics?.helperV2Boundary?.disabledCommandContractCount !== 3 ||
        helperStatus.diagnostics?.helperV2Boundary?.disabledCommandContractsActualInputSent !== false ||
        helperStatus.diagnostics?.helperV2Boundary?.disabledCommandContractsPathDisclosed !== false ||
        helperStatus.diagnostics?.helperV2Boundary?.disabledCommandContractsPermissionMutated !== false ||
        helperStatus.diagnostics?.helperV2Boundary?.disabledCommandContractsScreenshotCaptured !== false) {
        throw new Error(`Native helper-v2 boundary should surface disabled command contract proof: ${JSON.stringify(helperStatus.diagnostics?.helperV2Boundary)}`);
      }
      if (helperStatus.diagnostics?.helperV2DisabledContracts?.schemaVersion !== "browser-native-desktop-helper-v2-disabled-contract-probe.v1" ||
        helperStatus.diagnostics?.helperV2DisabledContracts?.allDisabled !== true) {
        throw new Error(`Native helper status should expose disabled helper-v2 contract probe evidence: ${JSON.stringify(helperStatus.diagnostics?.helperV2DisabledContracts)}`);
      }
    }
    const observation = await nativeDesktopAdapter.observe({ session });
    assertEqual(observation.title, "Native Helper Smoke", "native helper observation title");
    const screenshot = await nativeDesktopAdapter.execute({
      session,
      observation,
      action: { type: "screenshot" }
    });
    assertEqual(screenshot.ok, false, "native helper screenshot unsupported");
    if (!String(screenshot.error).includes("does not support screenshot")) {
      throw new Error(`Native helper screenshot path should explain fallback: ${JSON.stringify(screenshot)}`);
    }
    const execute = await nativeDesktopAdapter.execute({
      session,
      observation,
      action: { type: "click", target: { kind: "selector", selector: "uia:back" } },
      target: observation.elements[0]
    });
    assertEqual(execute.ok, true, "native helper executable action");
    assertEqual(execute.metadata?.helperConfigured, true, "native helper metadata");
    assertEqual(execute.metadata?.helperAction, "click", "native helper action metadata");
    if (execute.after?.title !== "Native Helper Smoke") {
      throw new Error(`Native helper should return after observation evidence: ${JSON.stringify(execute)}`);
    }
    await assertComputerSessionNativeObservationGraph();
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP;
    } else {
      process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP = previousEnabled;
    }
    if (previousHelper === undefined) {
      delete process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER;
    } else {
      process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER = previousHelper;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function assertComputerSessionNativeObservationGraph() {
  const tempRoot = mkdtempSync(join(tmpdir(), "computer-use-native-helper-graph-"));
  let storage;
  let capabilityRuntime;
  try {
    storage = createStorageService({ appDataDir: tempRoot });
    capabilityRuntime = new CapabilityRuntime({ storage, maxActiveJobs: 1 });
    registerDaemonCapabilities({
      capabilityRuntime,
      browserChromeCommands: new BrowserChromeCommandBridge(),
      getDaemonPort: () => 4128
    });
    const runtime = new ComputerSessionRuntime({ storage, capabilityRuntime });
    const started = await runtime.start({
      userRequest: "Use native browser window helper to observe browser chrome.",
      requestedSurface: "foreground_desktop_watch",
      metadata: { readOnly: true }
    });
    const operation = await runtime.executeOperation({
      sessionId: started.session.sessionId,
      operation: {
        kind: "native_browser_window_action",
        input: {
          command: "observe",
          source: { kind: "active_tab", browser: "chrome", url: "browser://native-helper-smoke" }
        }
      },
      waitMs: 5000
    });
    assertEqual(operation.job?.kind, "desktop_action", "native helper session job kind");
    assertEqual(operation.job?.status, "completed", "native helper session job status");
    const bundle = runtime.exportDebugBundle(started.session.sessionId);
    const observation = bundle.observations.find((entry) => entry.kind === "screen" && entry.capabilityJobId === operation.job?.id);
    if (!observation?.perceptionGraphId) {
      throw new Error(`Native helper observation should link a perception graph: ${JSON.stringify(bundle.observations)}`);
    }
    const graph = bundle.perceptionGraphs.find((entry) => entry.id === observation.perceptionGraphId);
    if (graph?.source !== "computer_session_native_browser_observation") {
      throw new Error(`Native helper graph should use native browser source: ${JSON.stringify(graph)}`);
    }
    if (!graph.nodes.some((node) => node.metadata?.elementId === "tab-back" && node.evidence.some((edge) => edge.source === "uia" && edge.class === "uia_selector"))) {
      throw new Error(`Native helper graph should preserve UIA selector evidence for tab-back: ${JSON.stringify(graph.nodes)}`);
    }
  } finally {
    await capabilityRuntime?.shutdown();
    storage?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function assertBundledNativeHelperDiscovery() {
  if (process.platform !== "win32") {
    return;
  }
  const previousEnabled = process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP;
  const previousHelper = process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER;
  try {
    process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP = "1";
    delete process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER;
    const helperStatus = await nativeDesktopAdapter.getStatus({ session });
    assertEqual(helperStatus.state, "ready", "bundled native helper status");
    if (!["native", "powershell"].includes(helperStatus.diagnostics?.helper?.source) || helperStatus.diagnostics?.helper?.exists !== true) {
      throw new Error(`Bundled native helper should be auto-discovered: ${JSON.stringify(helperStatus)}`);
    }
    if (helperStatus.diagnostics?.releaseReadiness?.releaseReady === true && helperStatus.diagnostics?.releaseReadiness?.signature?.status !== "valid") {
      throw new Error(`Bundled helper cannot be release-ready without a valid signature: ${JSON.stringify(helperStatus.diagnostics?.releaseReadiness)}`);
    }
    if (helperStatus.diagnostics?.helper?.implementation === "powershell" && !helperStatus.diagnostics?.releaseReadiness?.blockers?.includes("powershell_fallback_development_only")) {
      throw new Error(`PowerShell fallback must remain development-only for release readiness: ${JSON.stringify(helperStatus.diagnostics?.releaseReadiness)}`);
    }
    const observation = await nativeDesktopAdapter.observe({ session });
    if (!observation.title || !Array.isArray(observation.elements)) {
      throw new Error(`Bundled native helper should observe normalized browser boundary: ${JSON.stringify(observation)}`);
    }
    const read = await nativeDesktopAdapter.execute({
      session,
      observation,
      action: { type: "read", reason: "bundled helper smoke" }
    });
    assertEqual(read.ok, true, "bundled native helper read action");
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP;
    } else {
      process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP = previousEnabled;
    }
    if (previousHelper === undefined) {
      delete process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER;
    } else {
      process.env.CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER = previousHelper;
    }
  }
}
