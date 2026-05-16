import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONTRACT_SCHEMA = "browser-native-desktop-helper-contract-readiness.v1";
const HELPER_SCHEMA = "browser-native-desktop-helper.v1";
const MANIFEST_SCHEMA = "browser-native-desktop-helper-capability-manifest.v2";
const WATCH_PREFLIGHT_SCHEMA = "foreground-watch-preflight.v1";
const WATCH_GUARDS_SCHEMA = "browser-native-desktop-helper-watch-preflight-guards.v1";

const REQUIRED_SUPPORTED_COMMANDS = [
  "status",
  "watch_preflight",
  "observe_uia",
  "execute.click",
  "execute.type_text",
  "execute.navigate"
];

const REQUIRED_BLOCKED_HELPER_V2_COMMANDS = [
  "foreground_watch_execute",
  "capture_screenshot",
  "focus_window",
  "double_click",
  "move",
  "drag",
  "key",
  "clipboard_set_scoped",
  "clipboard_restore",
  "file_picker_select",
  "menu_command",
  "browser_permission_popup_click"
];

const GENERIC_DISABLED_HELPER_V2_COMMANDS = [
  "capture_screenshot",
  "file_picker_select",
  "browser_permission_popup_click",
  "clipboard_set_scoped",
  "menu_command"
];

export function probeBrowserNativeDesktopHelperContract(options) {
  const helperPath = path.resolve(options.helperPath);
  const report = {
    schemaVersion: CONTRACT_SCHEMA,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    helperKind: "browser-native-desktop-helper",
    helper: readHelperEvidence(helperPath),
    checks: [],
    blockers: [],
    evidence: {}
  };

  if (process.platform !== "win32") {
    addCheck(report, "windows-platform", false, "native helper contract probe requires Windows release infrastructure");
    return finish(report);
  }
  if (!report.helper.exists) {
    addCheck(report, "helper-exists", false, "built native helper is missing");
    return finish(report);
  }
  addCheck(report, "helper-exists", true, `${report.helper.basename} (${formatBytes(report.helper.size ?? 0)})`);

  const status = runHelperRequest(helperPath, createRequest("native-helper-contract-status", "status"), options.timeoutMs);
  if (!status.ok) {
    addCheck(report, "status-command", false, status.error);
    return finish(report);
  }
  addCheck(report, "status-command", true, "status command returned JSON");
  validateStatusManifest(report, status.response);

  const watch = runHelperRequest(helperPath, createRequest("native-helper-contract-watch-preflight", "watch_preflight"), options.timeoutMs);
  if (!watch.ok) {
    addCheck(report, "watch-preflight-command", false, watch.error);
    return finish(report);
  }
  addCheck(report, "watch-preflight-command", true, "watch_preflight command returned JSON");
  validateWatchPreflight(report, "watch-preflight", watch.response, { expectContinuousMonitoring: false });

  const monitoredWatch = runHelperRequest(
    helperPath,
    {
      ...createRequest("native-helper-contract-watch-preflight-monitor", "watch_preflight"),
      watchPreflight: {
        monitorMs: 50,
        sampleIntervalMs: 10,
        idleThresholdMs: 750,
        requireNoUserInput: true,
        requireActiveWindowStable: true
      }
    },
    options.timeoutMs
  );
  if (!monitoredWatch.ok) {
    addCheck(report, "watch-preflight-monitor-command", false, monitoredWatch.error);
    return finish(report);
  }
  addCheck(report, "watch-preflight-monitor-command", true, "monitored watch_preflight command returned JSON");
  validateWatchPreflight(report, "watch-preflight-monitor", monitoredWatch.response, { expectContinuousMonitoring: true });

  const disabledForegroundWatch = runHelperRequest(
    helperPath,
    {
      ...createRequest("native-helper-contract-foreground-watch-disabled", "foreground_watch_execute"),
      action: { type: "click", target: { kind: "focused" } }
    },
    options.timeoutMs
  );
  if (!disabledForegroundWatch.ok) {
    addCheck(report, "foreground-watch-executor-disabled-command", false, disabledForegroundWatch.error);
    return finish(report);
  }
  addCheck(report, "foreground-watch-executor-disabled-command", true, "foreground_watch_execute command returned JSON");
  validateDisabledForegroundWatchExecutor(report, disabledForegroundWatch.response);

  for (const command of GENERIC_DISABLED_HELPER_V2_COMMANDS) {
    const disabled = runHelperRequest(
      helperPath,
      {
        ...createRequest(`native-helper-contract-disabled-${command.replace(/_/g, "-")}`, command),
        action: command === "browser_permission_popup_click"
          ? { type: "click", target: { kind: "focused" } }
          : undefined
      },
      options.timeoutMs
    );
    if (!disabled.ok) {
      addCheck(report, `helper-v2-disabled-${command}-command`, false, disabled.error);
      return finish(report);
    }
    addCheck(report, `helper-v2-disabled-${command}-command`, true, `${command} command returned JSON`);
    validateDisabledHelperV2Command(report, command, disabled.response);
  }

  return finish(report);
}

function validateStatusManifest(report, response) {
  const manifest = response?.metadata?.capabilityManifest;
  if (response?.ok !== true) {
    addCheck(report, "status-ok", false, "status response was not ok");
    return;
  }
  addCheck(report, "status-ok", true, "status response ok");

  if (manifest?.schemaVersion !== MANIFEST_SCHEMA || !Array.isArray(manifest.commands)) {
    addCheck(report, "manifest-schema", false, "capability manifest v2 is missing from status metadata");
    return;
  }
  addCheck(report, "manifest-schema", true, MANIFEST_SCHEMA);

  const commands = new Map(manifest.commands.map((command) => [command?.name, command]));
  const supportedMissing = REQUIRED_SUPPORTED_COMMANDS.filter((name) => commands.get(name)?.supported !== true);
  addCheck(
    report,
    "manifest-current-commands",
    supportedMissing.length === 0,
    supportedMissing.length === 0
      ? `supported=${REQUIRED_SUPPORTED_COMMANDS.join(",")}`
      : `missing supported commands: ${supportedMissing.join(",")}`
  );

  const helperV2Failures = [];
  for (const name of REQUIRED_BLOCKED_HELPER_V2_COMMANDS) {
    const command = commands.get(name);
    const requiresApproval = name === "clipboard_restore" ? command?.requiresApproval === false : command?.requiresApproval === true;
    if (
      command?.supported !== false ||
      command?.requiresForeground !== true ||
      !requiresApproval ||
      !String(command?.status ?? "").includes("helper_v2")
    ) {
      helperV2Failures.push(name);
    }
  }
  addCheck(
    report,
    "manifest-helper-v2-boundary",
    helperV2Failures.length === 0,
    helperV2Failures.length === 0
      ? `blocked=${REQUIRED_BLOCKED_HELPER_V2_COMMANDS.join(",")}`
      : `helper-v2 boundary missing for: ${helperV2Failures.join(",")}`
  );

  const boundary = manifest.boundary && typeof manifest.boundary === "object" ? manifest.boundary : {};
  addCheck(
    report,
    "manifest-foreground-input-boundary",
    boundary.foregroundDesktopWatchExecutor === false && boundary.actualInputSentForBlockedV2Commands === false,
    "foreground helper-v2 input remains disabled"
  );

  report.evidence.statusManifest = {
    schemaVersion: manifest.schemaVersion,
    helperSchemaVersion: stringOrUndefined(manifest.helperSchemaVersion),
    helperVersion: stringOrUndefined(manifest.helperVersion),
    scope: stringOrUndefined(manifest.scope),
    supportedCommands: REQUIRED_SUPPORTED_COMMANDS.filter((name) => commands.get(name)?.supported === true),
    blockedHelperV2Commands: REQUIRED_BLOCKED_HELPER_V2_COMMANDS.filter((name) => commands.get(name)?.supported === false),
    foregroundDesktopWatchExecutor: boundary.foregroundDesktopWatchExecutor === true,
    actualInputSentForBlockedV2Commands: boundary.actualInputSentForBlockedV2Commands === true
  };
}

function validateWatchPreflight(report, id, response, options) {
  const metadata = response?.metadata ?? {};
  const preflight = metadata.watchPreflight;
  const guards = metadata.helperSideGuards;
  const evidenceKey = id === "watch-preflight-monitor" ? "monitoredWatchPreflight" : "watchPreflight";

  if (response?.ok !== true) {
    addCheck(report, `${id}-ok`, false, `${id} response was not ok`);
    return;
  }
  addCheck(report, `${id}-ok`, true, `${id} response ok`);

  addCheck(
    report,
    `${id}-actual-input`,
    metadata.actualInputSent === false && preflight?.actualInputSent === false,
    "watch preflight sends no native input"
  );
  addCheck(
    report,
    `${id}-schema`,
    preflight?.schemaVersion === WATCH_PREFLIGHT_SCHEMA,
    preflight?.schemaVersion === WATCH_PREFLIGHT_SCHEMA
      ? WATCH_PREFLIGHT_SCHEMA
      : "foreground watch preflight schema missing"
  );
  addCheck(
    report,
    `${id}-guards-schema`,
    guards?.schemaVersion === WATCH_GUARDS_SCHEMA,
    guards?.schemaVersion === WATCH_GUARDS_SCHEMA
      ? WATCH_GUARDS_SCHEMA
      : "helper-side watch guard schema missing"
  );

  const requiredBooleans = [
    "activeWindowAsserted",
    "targetIdentityAsserted",
    "processAllowed",
    "userIdle",
    "abortOnUserInputArmed",
    "activeWindowDriftDetected",
    "timeoutArmed",
    "actualInputSent"
  ];
  const badBooleanFields = requiredBooleans.filter((field) => typeof preflight?.[field] !== "boolean");
  addCheck(
    report,
    `${id}-boolean-fields`,
    badBooleanFields.length === 0,
    badBooleanFields.length === 0 ? `fields=${requiredBooleans.join(",")}` : `invalid fields: ${badBooleanFields.join(",")}`
  );

  if (options.expectContinuousMonitoring) {
    addCheck(
      report,
      `${id}-monitor-enabled`,
      guards?.continuousMonitoring === true && guards?.monitor?.enabled === true,
      "bounded dry-run monitor is enabled"
    );
    addCheck(
      report,
      `${id}-monitor-samples`,
      typeof guards?.monitor?.sampleCount === "number" && guards.monitor.sampleCount >= 1,
      `samples=${guards?.monitor?.sampleCount ?? "missing"}`
    );
    addCheck(
      report,
      `${id}-monitor-parameters`,
      guards?.monitor?.requestedMs === 50 && guards?.monitor?.sampleIntervalMs === 10,
      `requestedMs=${guards?.monitor?.requestedMs ?? "missing"} sampleIntervalMs=${guards?.monitor?.sampleIntervalMs ?? "missing"}`
    );
  } else {
    addCheck(
      report,
      `${id}-single-sample`,
      guards?.continuousMonitoring === false && guards?.monitor?.enabled === false,
      "default watch_preflight is single-sample observe-only"
    );
  }

  report.evidence[evidenceKey] = {
    schemaVersion: preflight?.schemaVersion,
    guardsSchemaVersion: guards?.schemaVersion,
    actualInputSent: metadata.actualInputSent === true || preflight?.actualInputSent === true,
    abortReason: stringOrUndefined(preflight?.abortReason ?? guards?.monitor?.abortReason),
    continuousMonitoring: guards?.continuousMonitoring === true,
    monitorEnabled: guards?.monitor?.enabled === true,
    monitorSampleCount: numberOrUndefined(guards?.monitor?.sampleCount),
    monitorRequestedMs: numberOrUndefined(guards?.monitor?.requestedMs),
    monitorSampleIntervalMs: numberOrUndefined(guards?.monitor?.sampleIntervalMs)
  };
}

function validateDisabledForegroundWatchExecutor(report, response) {
  const metadata = response?.metadata ?? {};
  addCheck(
    report,
    "foreground-watch-executor-disabled-ok",
    response?.ok === false && String(response?.error ?? "").includes("disabled"),
    "foreground watch executor is disabled before helper-v2 signing"
  );
  addCheck(
    report,
    "foreground-watch-executor-disabled-schema",
    metadata.schemaVersion === "browser-native-desktop-helper-foreground-watch-executor.v1",
    metadata.schemaVersion === "browser-native-desktop-helper-foreground-watch-executor.v1"
      ? metadata.schemaVersion
      : "disabled foreground watch executor schema missing"
  );
  addCheck(
    report,
    "foreground-watch-executor-disabled-no-input",
    metadata.enabled === false &&
      metadata.supported === false &&
      metadata.dryRunOnly === true &&
      metadata.actualInputSent === false &&
      metadata.signedHelperV2Available === false,
    "disabled executor remains dry-run only with no native input"
  );
  addCheck(
    report,
    "foreground-watch-executor-disabled-release-gate",
    metadata.releaseGate === "browser-native-helper-signing" &&
      metadata.blocker === "signed_helper_v2_unavailable",
    "disabled executor names signing/helper-v2 release blocker"
  );

  const required = Array.isArray(metadata.requiredPreconditions) ? metadata.requiredPreconditions : [];
  const missing = [
    "one_time_approval",
    "visible_countdown",
    "abort_on_user_input",
    "effect_verifier",
    "rollback_or_not_reversible_record"
  ].filter((precondition) => !required.includes(precondition));
  addCheck(
    report,
    "foreground-watch-executor-disabled-preconditions",
    missing.length === 0,
    missing.length === 0 ? `preconditions=${required.length}` : `missing preconditions: ${missing.join(",")}`
  );

  report.evidence.foregroundWatchExecutor = {
    schemaVersion: stringOrUndefined(metadata.schemaVersion),
    enabled: metadata.enabled === true,
    supported: metadata.supported === true,
    dryRunOnly: metadata.dryRunOnly === true,
    actualInputSent: metadata.actualInputSent === true,
    signedHelperV2Available: metadata.signedHelperV2Available === true,
    releaseGate: stringOrUndefined(metadata.releaseGate),
    blocker: stringOrUndefined(metadata.blocker),
    requiredPreconditionCount: required.length
  };
}

function validateDisabledHelperV2Command(report, command, response) {
  const metadata = response?.metadata ?? {};
  addCheck(
    report,
    `helper-v2-disabled-${command}-ok`,
    response?.ok === false && String(response?.error ?? "").includes("disabled"),
    `${command} is disabled before helper-v2 signing`
  );
  addCheck(
    report,
    `helper-v2-disabled-${command}-schema`,
    metadata.schemaVersion === "browser-native-desktop-helper-v2-disabled-command.v1",
    metadata.schemaVersion === "browser-native-desktop-helper-v2-disabled-command.v1"
      ? metadata.schemaVersion
      : `${command} disabled schema missing`
  );
  addCheck(
    report,
    `helper-v2-disabled-${command}-no-input`,
    metadata.command === command &&
      metadata.enabled === false &&
      metadata.supported === false &&
      metadata.dryRunOnly === true &&
      metadata.actualInputSent === false &&
      metadata.signedHelperV2Available === false,
    `${command} remains dry-run only with no native input`
  );
  addCheck(
    report,
    `helper-v2-disabled-${command}-release-gate`,
    metadata.releaseGate === "browser-native-helper-signing" &&
      metadata.blocker === "signed_helper_v2_unavailable",
    `${command} names signing/helper-v2 release blocker`
  );

  const required = Array.isArray(metadata.requiredPreconditions) ? metadata.requiredPreconditions : [];
  const requiredCommon = command === "clipboard_restore"
    ? ["signed_helper_v2", "bounded_timeout"]
    : ["one_time_approval", "signed_helper_v2"];
  const missing = requiredCommon.filter((precondition) => !required.includes(precondition));
  addCheck(
    report,
    `helper-v2-disabled-${command}-preconditions`,
    missing.length === 0,
    missing.length === 0 ? `preconditions=${required.length}` : `missing preconditions: ${missing.join(",")}`
  );

  const evidence = report.evidence.disabledHelperV2Commands ?? [];
  evidence.push({
    command,
    schemaVersion: stringOrUndefined(metadata.schemaVersion),
    enabled: metadata.enabled === true,
    supported: metadata.supported === true,
    dryRunOnly: metadata.dryRunOnly === true,
    actualInputSent: metadata.actualInputSent === true,
    signedHelperV2Available: metadata.signedHelperV2Available === true,
    releaseGate: stringOrUndefined(metadata.releaseGate),
    blocker: stringOrUndefined(metadata.blocker),
    requiredPreconditionCount: required.length,
    localFilePathDisclosed: metadata.localFilePathDisclosed === true,
    nativePopupClick: metadata.nativePopupClick === true,
    permissionChanged: metadata.permissionChanged === true,
    screenshotCaptured: metadata.screenshotCaptured === true,
    clipboardChanged: metadata.clipboardChanged === true,
    clipboardContentLogged: metadata.clipboardContentLogged === true
  });
  report.evidence.disabledHelperV2Commands = evidence;
}

function runHelperRequest(helperPath, request, timeoutMs = 15_000) {
  const result = spawnSync(helperPath, [], {
    input: JSON.stringify(request),
    encoding: "utf8",
    timeout: Math.max(1000, Math.min(Number(timeoutMs) || 15_000, 30_000)),
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? "helper_timeout" : "helper_spawn_error"
    };
  }

  const trimmed = String(result.stdout ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      error: result.status === 0 ? "helper_empty_output" : `helper_exit_${result.signal ?? result.status ?? "unknown"}`
    };
  }

  try {
    const response = JSON.parse(trimmed);
    if ((result.status ?? 0) !== 0 || result.signal) {
      return {
        ok: false,
        error: `helper_exit_${result.signal ?? result.status ?? "unknown"}:${safeError(response?.error)}`
      };
    }
    return { ok: true, response };
  } catch {
    return { ok: false, error: "helper_invalid_json" };
  }
}

function createRequest(requestId, command) {
  return {
    schemaVersion: HELPER_SCHEMA,
    requestId,
    command,
    timeoutMs: 5_000,
    session: {
      id: "native-helper-contract-readiness",
      mode: "auto_safe_actions",
      source: { kind: "active_tab", browser: "unknown" }
    }
  };
}

function addCheck(report, id, passed, detail) {
  report.checks.push({
    id,
    status: passed ? "pass" : "fail",
    detail: String(detail ?? "")
  });
  if (!passed) {
    report.blockers.push(id);
  }
}

function finish(report) {
  report.blockers = Array.from(new Set(report.blockers));
  report.status = report.blockers.length === 0 ? "pass" : "fail";
  return report;
}

function readHelperEvidence(helperPath) {
  const exists = existsSync(helperPath);
  const evidence = {
    basename: path.basename(helperPath),
    extension: path.extname(helperPath).toLowerCase(),
    exists
  };
  if (!exists) {
    return evidence;
  }
  try {
    const bytes = readFileSync(helperPath);
    const stats = statSync(helperPath);
    return {
      ...evidence,
      size: stats.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      modifiedAt: stats.mtime.toISOString()
    };
  } catch {
    return evidence;
  }
}

function safeError(value) {
  if (!value) return "unknown";
  return String(value)
    .replace(/[A-Z]:\\[^\s"]+/gi, "[path]")
    .slice(0, 160);
}

function stringOrUndefined(value) {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
