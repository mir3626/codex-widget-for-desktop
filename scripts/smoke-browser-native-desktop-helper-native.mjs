#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const helperPath = path.resolve("dist/browser-native-desktop-helper/browser-native-desktop-helper.exe");

if (process.platform !== "win32") {
  console.log("browser native desktop helper native smoke skipped: Windows-only helper");
  process.exit(0);
}

if (!existsSync(helperPath)) {
  throw new Error(`Missing built native desktop helper. Run npm run build:browser-native-desktop-helper first: ${helperPath}`);
}

const status = await assertHelper("status", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-status",
  command: "status",
  timeoutMs: 5_000,
  session: createSession()
});
assertCapabilityManifest(status.metadata?.capabilityManifest);

const observe = await assertHelper("observe", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-observe",
  command: "observe",
  timeoutMs: 5_000,
  session: createSession()
});

if (!observe.observation || !Array.isArray(observe.observation.elements) || !Array.isArray(observe.observation.windows)) {
  throw new Error(`Observe response should include normalized observation arrays: ${JSON.stringify(observe)}`);
}

const watchPreflight = await assertHelper("watch preflight", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-watch-preflight",
  command: "watch_preflight",
  timeoutMs: 5_000,
  session: createSession()
});
assertWatchPreflight(watchPreflight);

const monitoredWatchPreflight = await assertHelper("monitored watch preflight", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-watch-preflight-monitor",
  command: "watch_preflight",
  timeoutMs: 5_000,
  session: createSession(),
  watchPreflight: {
    monitorMs: 50,
    sampleIntervalMs: 10,
    idleThresholdMs: 750,
    requireNoUserInput: true,
    requireActiveWindowStable: true
  }
});
assertWatchPreflight(monitoredWatchPreflight, { expectContinuousMonitoring: true });

const disabledForegroundWatch = await runHelper({
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-foreground-watch-disabled",
  command: "foreground_watch_execute",
  timeoutMs: 5_000,
  session: createSession(),
  action: { type: "click", target: { kind: "focused" } }
});
assertDisabledForegroundWatchExecutor(disabledForegroundWatch);

for (const command of ["capture_screenshot", "file_picker_select", "browser_permission_popup_click", "clipboard_set_scoped", "menu_command"]) {
  const disabled = await runHelper({
    schemaVersion: "browser-native-desktop-helper.v1",
    requestId: `native-rs-helper-smoke-disabled-${command}`,
    command,
    timeoutMs: 5_000,
    session: createSession()
  });
  assertDisabledHelperV2Command(command, disabled);
}

const read = await assertHelper("execute read", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-execute-read",
  command: "execute",
  timeoutMs: 5_000,
  session: createSession(),
  action: { type: "read", reason: "smoke" }
});

if (!read.after || !Array.isArray(read.after.elements)) {
  throw new Error(`Read execute should return after observation evidence: ${JSON.stringify(read)}`);
}

const blockedSecret = await runHelper({
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-secret",
  command: "execute",
  timeoutMs: 5_000,
  session: createSession(),
  action: { type: "type", target: { kind: "focused" }, text: "secret token value", clearFirst: true }
});

if (blockedSecret.ok !== false || !String(blockedSecret.error ?? "").includes("sensitive")) {
  throw new Error(`Sensitive text input must be blocked: ${JSON.stringify(blockedSecret)}`);
}

const blockedEval = await runHelper({
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-evaluate",
  command: "execute",
  timeoutMs: 5_000,
  session: createSession(),
  action: { type: "evaluate", code: "document.cookie" }
});

if (blockedEval.ok !== false || !String(blockedEval.error ?? "").includes("does not support evaluate")) {
  throw new Error(`Evaluate must be blocked: ${JSON.stringify(blockedEval)}`);
}

if (read.metadata?.helperImplementation !== "rust-native") {
  throw new Error(`Native smoke should use rust-native helper metadata: ${JSON.stringify(read.metadata)}`);
}

console.log("browser native desktop helper native smoke ok");

function createSession() {
  return {
    id: "native-rs-helper-smoke",
    mode: "auto_safe_actions",
    source: { kind: "active_tab", browser: "unknown" }
  };
}

function assertCapabilityManifest(manifest) {
  if (manifest?.schemaVersion !== "browser-native-desktop-helper-capability-manifest.v2") {
    throw new Error(`Status should include helper v2 capability manifest: ${JSON.stringify(manifest)}`);
  }
  if (manifest.boundary?.foregroundDesktopWatchExecutor !== false || manifest.boundary?.actualInputSentForBlockedV2Commands !== false) {
    throw new Error(`Capability manifest must keep foreground helper-v2 input blocked: ${JSON.stringify(manifest.boundary)}`);
  }
  const commands = new Map((manifest.commands ?? []).map((command) => [command.name, command]));
  for (const name of ["status", "watch_preflight", "observe_uia", "execute.click", "execute.type_text", "execute.navigate"]) {
    if (commands.get(name)?.supported !== true) {
      throw new Error(`Current helper command should be declared supported: ${name} ${JSON.stringify(manifest.commands)}`);
    }
  }
  for (const name of ["foreground_watch_execute", "capture_screenshot", "file_picker_select", "browser_permission_popup_click"]) {
    const command = commands.get(name);
    if (command?.supported !== false || !String(command.status).includes("helper_v2")) {
      throw new Error(`Future helper-v2 command should remain blocked: ${name} ${JSON.stringify(command)}`);
    }
    if (command.requiresForeground !== true || command.requiresApproval !== true) {
      throw new Error(`Helper-v2 command should declare foreground approval preconditions: ${name} ${JSON.stringify(command)}`);
    }
  }
}

function assertDisabledForegroundWatchExecutor(response) {
  if (response.ok !== false || !String(response.error ?? "").includes("disabled")) {
    throw new Error(`Foreground watch executor must be disabled by default: ${JSON.stringify(response)}`);
  }
  const metadata = response.metadata;
  if (metadata?.command !== "foreground_watch_execute") {
    throw new Error(`Disabled foreground watch response should preserve command metadata: ${JSON.stringify(metadata)}`);
  }
  if (metadata?.schemaVersion !== "browser-native-desktop-helper-foreground-watch-executor.v1") {
    throw new Error(`Disabled foreground watch response should expose executor schema: ${JSON.stringify(metadata)}`);
  }
  if (metadata.enabled !== false || metadata.supported !== false || metadata.dryRunOnly !== true) {
    throw new Error(`Foreground watch executor should be disabled/dry-run only: ${JSON.stringify(metadata)}`);
  }
  if (metadata.actualInputSent !== false || metadata.signedHelperV2Available !== false) {
    throw new Error(`Disabled foreground watch executor must not send input or claim helper v2: ${JSON.stringify(metadata)}`);
  }
  if (metadata.releaseGate !== "browser-native-helper-signing" || metadata.blocker !== "signed_helper_v2_unavailable") {
    throw new Error(`Disabled foreground watch executor should name release/signing blocker: ${JSON.stringify(metadata)}`);
  }
  for (const precondition of ["one_time_approval", "visible_countdown", "abort_on_user_input", "effect_verifier"]) {
    if (!metadata.requiredPreconditions?.includes(precondition)) {
      throw new Error(`Disabled foreground watch executor missing precondition ${precondition}: ${JSON.stringify(metadata)}`);
    }
  }
}

function assertDisabledHelperV2Command(command, response) {
  if (response.ok !== false || !String(response.error ?? "").includes("disabled")) {
    throw new Error(`${command} must be disabled by default: ${JSON.stringify(response)}`);
  }
  const metadata = response.metadata;
  if (metadata?.command !== command) {
    throw new Error(`${command} disabled response should preserve command metadata: ${JSON.stringify(metadata)}`);
  }
  if (metadata?.schemaVersion !== "browser-native-desktop-helper-v2-disabled-command.v1") {
    throw new Error(`${command} disabled response should expose helper-v2 disabled schema: ${JSON.stringify(metadata)}`);
  }
  if (metadata.enabled !== false || metadata.supported !== false || metadata.dryRunOnly !== true) {
    throw new Error(`${command} should be disabled/dry-run only: ${JSON.stringify(metadata)}`);
  }
  if (metadata.actualInputSent !== false || metadata.signedHelperV2Available !== false) {
    throw new Error(`${command} must not send input or claim helper v2: ${JSON.stringify(metadata)}`);
  }
  if (metadata.releaseGate !== "browser-native-helper-signing" || metadata.blocker !== "signed_helper_v2_unavailable") {
    throw new Error(`${command} should name release/signing blocker: ${JSON.stringify(metadata)}`);
  }
  if (!metadata.requiredPreconditions?.includes("signed_helper_v2")) {
    throw new Error(`${command} missing signed helper-v2 precondition: ${JSON.stringify(metadata)}`);
  }
  if (command === "file_picker_select") {
    if (metadata.localFilePathDisclosed !== false || metadata.fileSelected !== false) {
      throw new Error(`file picker disabled contract must not disclose/select local files: ${JSON.stringify(metadata)}`);
    }
  }
  if (command === "browser_permission_popup_click") {
    if (metadata.nativePopupClick !== false || metadata.permissionChanged !== false) {
      throw new Error(`permission popup disabled contract must not click or mutate permission: ${JSON.stringify(metadata)}`);
    }
  }
  if (command === "capture_screenshot") {
    if (metadata.screenshotCaptured !== false || metadata.rawScreenshotStored !== false) {
      throw new Error(`screenshot disabled contract must not capture or store raw screenshot: ${JSON.stringify(metadata)}`);
    }
  }
  if (command === "clipboard_set_scoped") {
    if (metadata.clipboardChanged !== false || metadata.clipboardContentLogged !== false) {
      throw new Error(`clipboard disabled contract must not mutate or log clipboard: ${JSON.stringify(metadata)}`);
    }
  }
  if (command === "menu_command" && metadata.menuCommandSent !== false) {
    throw new Error(`menu command disabled contract must not send menu commands: ${JSON.stringify(metadata)}`);
  }
}

function assertWatchPreflight(response, options = {}) {
  const preflight = response.metadata?.watchPreflight;
  const guards = response.metadata?.helperSideGuards;
  if (response.metadata?.actualInputSent !== false) {
    throw new Error(`Watch preflight must never send native input: ${JSON.stringify(response.metadata)}`);
  }
  if (preflight?.schemaVersion !== "foreground-watch-preflight.v1") {
    throw new Error(`Watch preflight should return foreground preflight contract: ${JSON.stringify(response.metadata)}`);
  }
  for (const key of ["activeWindowAsserted", "targetIdentityAsserted", "processAllowed", "userIdle", "abortOnUserInputArmed", "activeWindowDriftDetected", "timeoutArmed", "actualInputSent"]) {
    if (typeof preflight[key] !== "boolean") {
      throw new Error(`Watch preflight field ${key} should be boolean: ${JSON.stringify(preflight)}`);
    }
  }
  if (guards?.schemaVersion !== "browser-native-desktop-helper-watch-preflight-guards.v1") {
    throw new Error(`Watch preflight should include helper-side guard evidence: ${JSON.stringify(guards)}`);
  }
  if (options.expectContinuousMonitoring) {
    if (guards.continuousMonitoring !== true || guards.monitor?.enabled !== true) {
      throw new Error(`Monitored watch preflight should enable observe-only continuous monitoring: ${JSON.stringify(guards)}`);
    }
    if (typeof guards.monitor?.sampleCount !== "number" || guards.monitor.sampleCount < 1) {
      throw new Error(`Monitored watch preflight should record samples: ${JSON.stringify(guards)}`);
    }
    if (guards.monitor?.requestedMs !== 50 || guards.monitor?.sampleIntervalMs !== 10) {
      throw new Error(`Monitored watch preflight should preserve bounded monitor parameters: ${JSON.stringify(guards)}`);
    }
  } else if (guards.continuousMonitoring !== false || guards.monitor?.enabled !== false) {
    throw new Error(`Default helper watch preflight should remain single-sample observe-only: ${JSON.stringify(guards)}`);
  }
}

async function assertHelper(label, request) {
  const response = await runHelper(request);
  if (response.ok !== true) {
    throw new Error(`${label} expected ok response: ${JSON.stringify(response)}`);
  }
  if (response.metadata?.helper !== "browser-native-desktop-helper") {
    throw new Error(`${label} missing helper metadata: ${JSON.stringify(response)}`);
  }
  return response;
}

function runHelper(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`native helper timed out. stdout=${stdout} stderr=${stderr}`));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if ((code ?? 0) !== 0 || signal) {
        reject(new Error(`native helper exited with ${signal ?? code}. stdout=${stdout} stderr=${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`native helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)} stdout=${stdout} stderr=${stderr}`));
      }
    });
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}
