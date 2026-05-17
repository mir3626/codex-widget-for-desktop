#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-windows-settings-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const isWindows = process.platform === "win32";
const readCommand = isWindows
  ? "reg query HKCU\\Environment"
  : "echo windows-settings-read-skipped";
const blockedMutationCommand = isWindows
  ? "reg add HKCU\\Environment /v CODEX_WIDGET_BLOCKED_SMOKE /t REG_SZ /d blocked /f"
  : "powershell Set-ItemProperty blocked";
const reversibleRegistryRoot = "HKCU\\Software\\CodexWidgetComputerUseSmoke";
const reversibleValueName = "CODEX_WIDGET_REVERSIBLE_SMOKE";
const reversibleValueData = "reversible";
const reversibleSetCommand = `reg add ${reversibleRegistryRoot} /v ${reversibleValueName} /t REG_SZ /d ${reversibleValueData} /f`;
const reversibleQueryCommand = `reg query ${reversibleRegistryRoot} /v ${reversibleValueName}`;
const reversibleDeleteCommand = `reg delete ${reversibleRegistryRoot} /v ${reversibleValueName} /f`;

cleanupReversibleRegistryValue();

try {
  const profile = await postJson("/computer-use/autonomy/profiles", {
    name: "Computer Use Windows settings read-only smoke",
    mode: "scoped_yolo",
    scope: "persistent",
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: false,
      browserDomains: [],
      filesystem: { readRoots: [], writeRoots: [] },
      commands: {
        allowPrefixes: [isWindows ? "reg query *" : "echo"],
        denyPatterns: ["password", "token", "secret", "cookie", "reg add", "Set-ItemProperty", "Remove-Item", "format"]
      },
      packageInstall: false,
      osMutation: false,
      generatedToolMaterialization: false,
      generatedToolExecution: false,
      generatedCode: false,
      credentialAccess: "never",
      riskClasses: ["read_only", "reversible"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 1
    },
    safetyBoundaries: [
      "windows_settings_read_only_only",
      "os_mutation_not_granted",
      "terminal_output_redacted_in_debug_bundle"
    ]
  });
  assert.equal(profile.ok, true);

  const readStarted = await postJson("/computer-use/sessions", {
    userRequest: "Windows 설정에서 현재 앱 테마 상태를 읽어줘.",
    requestedSurface: "pty_workspace",
    profileId: profile.profile.id,
    metadata: {
      requiresTerminal: true,
      windowsSettingsReadOnly: true
    }
  });
  assert.equal(readStarted.ok, true);
  assert.equal(readStarted.result.session.selectedSurface.kind, "pty_workspace");
  const readSessionId = readStarted.result.session.sessionId;
  const readOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(readSessionId)}/operations`, {
    operation: {
      kind: "terminal",
      input: {
        command: readCommand,
        cwd: process.cwd(),
        expectedOutcome: isWindows ? "registry theme values are read without mutation" : "non-Windows read-only skip"
      }
    },
    waitMs: 8000
  });
  assert.equal(readOperation.ok, true);
  assert.equal(readOperation.result.job?.kind, "terminal", JSON.stringify(readOperation.result));
  assert.equal(readOperation.result.job?.status, "completed", JSON.stringify(readOperation.result));

  const readBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(readSessionId)}/debug-bundle`);
  assert.equal(readBundle.ok, true);
  assert.equal(readBundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "terminal_permission_profile" &&
    decision.decision === "allow" &&
    decision.profileId === profile.profile.id
  ), true);
  assert.equal(readBundle.bundle.observations.some((observation) =>
    observation.kind === "terminal" &&
    observation.capabilityJobId === readOperation.result.job.id &&
    observation.metadata?.jobStatus === "completed"
  ), true);
  const readJob = readBundle.bundle.capabilityJobs.find((job) => job.id === readOperation.result.job.id);
  assert.equal(readJob?.outputJson?.stdout, undefined);
  assert.equal(readJob?.outputJson?.terminalOutput?.redaction, "terminal_stdout_stderr_preview_only");
  if (isWindows) {
    const preview = String(readJob?.outputJson?.terminalOutput?.stdoutPreview ?? "");
    assert.equal(/HKEY_CURRENT_USER|Environment/i.test(preview), true, preview);
  }

  const blockedStarted = await postJson("/computer-use/sessions", {
    userRequest: "Windows 설정에서 앱 테마 값을 변경해줘.",
    requestedSurface: "pty_workspace",
    profileId: profile.profile.id,
    metadata: {
      requiresTerminal: true,
      windowsSettingsMutation: true
    }
  });
  assert.equal(blockedStarted.ok, true);
  const blockedSessionId = blockedStarted.result.session.sessionId;
  const blockedOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(blockedSessionId)}/operations`, {
    operation: {
      kind: "terminal",
      input: {
        command: blockedMutationCommand,
        cwd: process.cwd(),
        expectedOutcome: "mutation command must be blocked before capability job creation"
      }
    },
    waitMs: 8000
  });
  assert.equal(blockedOperation.ok, true);
  assert.equal(blockedOperation.result.job, undefined);
  assert.equal(blockedOperation.result.dagNode.status, "failed");
  assert.equal(blockedOperation.result.dagNode.output.missingRequirements.some((requirement) =>
    requirement.type === "command" && requirement.value === blockedMutationCommand
  ), true);

  const blockedBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(blockedSessionId)}/debug-bundle`);
  assert.equal(blockedBundle.bundle.capabilityJobs.some((job) => job.kind === "terminal"), false);
  assert.equal(blockedBundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "terminal_permission_profile" &&
    decision.decision === "blocked" &&
    decision.missingRequirements?.some((requirement) => requirement.type === "command")
  ), true);
  assert.equal(blockedBundle.bundle.dagNodes.some((node) =>
    node.id === blockedOperation.result.dagNode.id &&
    node.status === "failed" &&
    node.lastError === "terminal_command_destructive_boundary"
  ), true);

  if (isWindows) {
    const reversibleProfile = await postJson("/computer-use/autonomy/profiles", {
      name: "Computer Use Windows settings reversible smoke",
      mode: "scoped_yolo",
      scope: "persistent",
      grants: {
        network: false,
        networkDomains: [],
        browserAutomation: false,
        browserDomains: [],
        filesystem: { readRoots: [], writeRoots: [] },
        commands: {
          allowPrefixes: [reversibleSetCommand, reversibleQueryCommand, reversibleDeleteCommand],
          denyPatterns: ["password", "token", "secret", "cookie", "Remove-Item", "format", "HKCU\\Environment"]
        },
        packageInstall: false,
        osMutation: true,
        generatedToolMaterialization: false,
        generatedToolExecution: false,
        generatedCode: false,
        credentialAccess: "never",
        riskClasses: ["high_risk"],
        maxRuntimeMs: 30000,
        maxOutputBytes: 2097152,
        maxIterations: 1
      },
      safetyBoundaries: [
        "bounded_hkcu_app_registry_only",
        "exact_command_allowlist_required",
        "rollback_command_required",
        "terminal_output_redacted_in_debug_bundle"
      ]
    });
    assert.equal(reversibleProfile.ok, true);

    const reversibleStarted = await postJson("/computer-use/sessions", {
      userRequest: "Windows 앱 설정의 테스트 값을 임시로 변경하고 원복해줘.",
      requestedSurface: "pty_workspace",
      profileId: reversibleProfile.profile.id,
      riskClass: "os_settings_mutation",
      metadata: {
        requiresTerminal: true,
        windowsSettingsReversible: true,
        boundedRegistryRoot: reversibleRegistryRoot
      }
    });
    assert.equal(reversibleStarted.ok, true);
    const reversibleSessionId = reversibleStarted.result.session.sessionId;

    const setOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(reversibleSessionId)}/operations`, {
      operation: {
        kind: "terminal",
        input: {
          command: reversibleSetCommand,
          cwd: process.cwd(),
          expectedOutcome: "bounded HKCU app-registry value is set with rollback proof",
          reversibleWindowsSetting: {
            scope: "hkcu_app_registry",
            root: reversibleRegistryRoot,
            valueName: reversibleValueName,
            valueData: reversibleValueData,
            action: "set"
          }
        }
      },
      waitMs: 8000
    });
    assert.equal(setOperation.ok, true);
    assert.equal(setOperation.result.job?.status, "completed", JSON.stringify(setOperation.result));

    const queryOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(reversibleSessionId)}/operations`, {
      operation: {
        kind: "terminal",
        input: {
          command: reversibleQueryCommand,
          cwd: process.cwd(),
          expectedOutcome: "bounded HKCU app-registry value is observable before rollback"
        }
      },
      waitMs: 8000
    });
    assert.equal(queryOperation.ok, true);
    assert.equal(queryOperation.result.job?.status, "completed", JSON.stringify(queryOperation.result));

    const deleteOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(reversibleSessionId)}/operations`, {
      operation: {
        kind: "terminal",
        input: {
          command: reversibleDeleteCommand,
          cwd: process.cwd(),
          expectedOutcome: "bounded HKCU app-registry value is rolled back",
          reversibleWindowsSetting: {
            scope: "hkcu_app_registry",
            root: reversibleRegistryRoot,
            valueName: reversibleValueName,
            action: "delete"
          }
        }
      },
      waitMs: 8000
    });
    assert.equal(deleteOperation.ok, true);
    assert.equal(deleteOperation.result.job?.status, "completed", JSON.stringify(deleteOperation.result));
    assert.equal(registryValueExists(reversibleRegistryRoot, reversibleValueName), false);

    const reversibleBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(reversibleSessionId)}/debug-bundle`);
    assert.equal(reversibleBundle.ok, true);
    assert.equal(reversibleBundle.bundle.safetyDecisions.some((decision) =>
      decision?.phase === "terminal_permission_profile" &&
      decision.decision === "allow" &&
      decision.reversibleRegistryMutation?.scope === "hkcu_app_registry" &&
      decision.reversibleRegistryMutation?.root === reversibleRegistryRoot &&
      decision.usedRequirements?.some((requirement) => requirement.type === "os_mutation")
    ), true);
    assert.equal(reversibleBundle.bundle.observations.some((observation) =>
      observation.kind === "terminal" &&
      observation.capabilityJobId === setOperation.result.job.id &&
      observation.metadata?.reversibleRegistryMutation?.action === "set"
    ), true);
    assert.equal(reversibleBundle.bundle.observations.some((observation) =>
      observation.kind === "terminal" &&
      observation.capabilityJobId === deleteOperation.result.job.id &&
      observation.metadata?.reversibleRegistryMutation?.action === "delete"
    ), true);
    const queryJob = reversibleBundle.bundle.capabilityJobs.find((job) => job.id === queryOperation.result.job.id);
    const reversiblePreview = String(queryJob?.outputJson?.terminalOutput?.stdoutPreview ?? "");
    assert.equal(reversiblePreview.includes(reversibleValueName), true, reversiblePreview);
    assert.equal(reversiblePreview.includes(reversibleValueData), true, reversiblePreview);
  }

  console.log(`computer use Windows settings smoke ok on port ${daemon.port}`);
} finally {
  cleanupReversibleRegistryValue();
  await daemon.close();
  smokeAppData.cleanup();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

function registryValueExists(root, valueName) {
  if (!isWindows) {
    return false;
  }
  const result = spawnSync("reg", ["query", root, "/v", valueName], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  return result.status === 0;
}

function cleanupReversibleRegistryValue() {
  if (!isWindows) {
    return;
  }
  spawnSync("reg", ["delete", reversibleRegistryRoot, "/v", reversibleValueName, "/f"], {
    stdio: "ignore",
    windowsHide: true
  });
}
