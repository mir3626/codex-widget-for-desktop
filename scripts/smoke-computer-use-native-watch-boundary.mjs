#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-computer-use-native-watch-boundary-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const started = await postJson("/computer-use/sessions", {
    userRequest: "Click the visible foreground button after checking the current Windows app.",
    requestedSurface: "foreground_desktop_watch",
    riskClass: "security_boundary",
    metadata: {
      requiresForeground: true
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.result.session.selectedSurface.kind, "foreground_desktop_watch");
  const sessionId = started.result.session.sessionId;

  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "visual_desktop_action",
      action: {
        type: "click",
        x: 120,
        y: 160,
        button: "left"
      }
    },
    waitMs: 1000
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.job, undefined);
  assert.equal(operation.result.dagNode.kind, "action");
  assert.equal(operation.result.dagNode.status, "failed");
  assert.equal(operation.result.dagNode.output.actualInputSent, false);
  assert.equal(operation.result.dagNode.output.reason, "foreground_watch_mode_v2_not_available");
  assertDisabledForegroundWatchExecutor(operation.result.dagNode.output.foregroundWatchExecutor);
  assert.equal(operation.result.dagNode.output.missingPreconditions.some((item) => item.id === "signed_watch_mode_helper_v2"), true);
  assert.equal(operation.result.dagNode.output.missingPreconditions.some((item) => item.id === "target_identity_check"), true);
  assert.equal(operation.result.dagNode.output.missingPreconditions.some((item) => item.id === "surface_lock"), true);
  assert.equal(operation.result.dagNode.output.missingPreconditions.some((item) => item.id === "timeout_guard"), true);

  const session = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}`);
  assert.equal(session.ok, true);
  assert.equal(session.session.state, "blocked");
  assert.equal(session.session.blockedReason, "foreground_watch_mode_v2_not_available");

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.capabilityJobs.some((job) => job.kind === "desktop_action"), false);
  const approvalNode = bundle.bundle.dagNodes.find((node) => node.id === `${operation.result.dagNode.id.replace(/:action$/, "")}:approval`);
  assert.equal(approvalNode?.kind, "approval");
  assert.equal(approvalNode?.status, "failed");
  assertFollowupDagNodes(bundle.bundle, operation.result.dagNode.id);
  assert.equal(bundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "foreground_watch_preconditions" &&
    decision.actualInputSent === false &&
    decision.foregroundWatchExecutor?.actualInputSent === false
  ), true);
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.source === "foreground_desktop_watch_boundary" &&
    observation.metadata?.actualInputSent === false &&
    observation.metadata?.foregroundWatchExecutor?.enabled === false
  ), true);
  assert.equal(bundle.bundle.rollbackActions.some((action) =>
    action.kind === "none_available" &&
    action.status === "skipped" &&
    action.reason === "no_action_was_executed"
  ), true);
  assert.equal(bundle.bundle.verifierResults.some((verifier) =>
    verifier?.id === `verifier:${operation.result.dagNode.id}` &&
    verifier.status === "failed" &&
    verifier.foregroundWatchExecutor?.actualInputSent === false
  ), true);
  assert.equal(bundle.bundle.failureMemory.some((record) =>
    record.failureClass === "unsafe_action_rejected" &&
    record.provenance.evalRunId === bundle.bundle.session.evalRunId &&
    record.safety.mayCompleteTask === false &&
    record.safety.proofSource === false &&
    record.calibration.abstentionTriggers?.includes("signed_helper_v2_unavailable")
  ), true);

  const userInputAbortStarted = await postJson("/computer-use/sessions", {
    userRequest: "Click only if the user does not touch the mouse or keyboard during the visible countdown.",
    requestedSurface: "foreground_desktop_watch",
    riskClass: "security_boundary",
    metadata: {
      requiresForeground: true,
      requiresAbortOnUserInput: true
    }
  });
  assert.equal(userInputAbortStarted.ok, true);
  assert.equal(userInputAbortStarted.result.session.selectedSurface.kind, "foreground_desktop_watch");
  const userInputAbortSessionId = userInputAbortStarted.result.session.sessionId;
  const userInputAbortOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(userInputAbortSessionId)}/operations`, {
    operation: {
      kind: "visual_desktop_action",
      action: {
        type: "click",
        x: 180,
        y: 220,
        button: "left"
      },
      watchPreflight: {
        oneTimeApprovalGranted: true,
        visibleCountdownArmed: true,
        activeWindowAsserted: true,
        targetIdentityAsserted: true,
        processAllowed: true,
        surfaceLockArmed: true,
        userIdle: false,
        abortOnUserInputArmed: true,
        userInputDetected: true,
        activeWindowDriftDetected: false,
        timeoutArmed: true,
        preActionEvidenceReady: true,
        postActionEvidenceReady: true,
        effectVerifierReady: true,
        rollbackProofReady: true,
        signedHelperV2Available: false,
        actualInputSent: false
      }
    },
    waitMs: 1000
  });
  assert.equal(userInputAbortOperation.ok, true);
  assert.equal(userInputAbortOperation.result.job, undefined);
  assert.equal(userInputAbortOperation.result.dagNode.kind, "action");
  assert.equal(userInputAbortOperation.result.dagNode.status, "failed");
  assert.equal(userInputAbortOperation.result.dagNode.output.actualInputSent, false);
  assert.equal(userInputAbortOperation.result.dagNode.output.reason, "foreground_watch_user_input_abort");
  assert.equal(userInputAbortOperation.result.dagNode.output.watchPreflight.schemaVersion, "foreground-watch-preflight.v1");
  assert.equal(userInputAbortOperation.result.dagNode.output.watchPreflight.userInputDetected, true);
  assert.equal(userInputAbortOperation.result.dagNode.output.watchPreflight.abortOnUserInputArmed, true);
  assert.equal(userInputAbortOperation.result.dagNode.output.watchPreflight.surfaceLockArmed, true);
  assert.equal(userInputAbortOperation.result.dagNode.output.watchPreflight.timeoutArmed, true);
  assert.equal(userInputAbortOperation.result.dagNode.output.watchPreflight.abortReason, "foreground_watch_user_input_abort");
  assert.equal(userInputAbortOperation.result.dagNode.output.missingPreconditions.some((item) => item.id === "mouse_keyboard_idle_guard" && item.status === "blocked"), true);

  const userInputAbortSession = await getJson(`/computer-use/sessions/${encodeURIComponent(userInputAbortSessionId)}`);
  assert.equal(userInputAbortSession.ok, true);
  assert.equal(userInputAbortSession.session.state, "blocked");
  assert.equal(userInputAbortSession.session.blockedReason, "foreground_watch_user_input_abort");

  const userInputAbortBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(userInputAbortSessionId)}/debug-bundle`);
  assert.equal(userInputAbortBundle.ok, true);
  assert.equal(userInputAbortBundle.bundle.capabilityJobs.some((job) => job.kind === "desktop_action"), false);
  assertFollowupDagNodes(userInputAbortBundle.bundle, userInputAbortOperation.result.dagNode.id, "foreground_watch_user_input_abort");
  assert.equal(userInputAbortBundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "foreground_watch_preflight" &&
    decision.actualInputSent === false &&
    decision.watchPreflight?.userInputDetected === true &&
    decision.watchPreflight?.abortOnUserInputArmed === true
  ), true);
  assert.equal(userInputAbortBundle.bundle.observations.some((observation) =>
    observation.source === "foreground_desktop_watch_boundary" &&
    observation.metadata?.actualInputSent === false &&
    observation.metadata?.watchPreflight?.userInputDetected === true
  ), true);
  assert.equal(userInputAbortBundle.bundle.verifierResults.some((verifier) =>
    verifier?.id === `verifier:${userInputAbortOperation.result.dagNode.id}` &&
    verifier.status === "failed" &&
    verifier.watchPreflight?.userInputDetected === true
  ), true);
  assert.equal(userInputAbortBundle.bundle.failureMemory.some((record) =>
    record.failureClass === "unsafe_action_rejected" &&
    record.provenance.evalRunId === userInputAbortBundle.bundle.session.evalRunId &&
    record.calibration.abstentionTriggers?.includes("foreground_watch_user_input_abort")
  ), true);

  const activeWindowDriftStarted = await postJson("/computer-use/sessions", {
    userRequest: "Click only if the foreground browser window remains the same after countdown.",
    requestedSurface: "foreground_desktop_watch",
    riskClass: "security_boundary",
    metadata: {
      requiresForeground: true,
      requiresActiveWindowGuard: true
    }
  });
  assert.equal(activeWindowDriftStarted.ok, true);
  const activeWindowDriftSessionId = activeWindowDriftStarted.result.session.sessionId;
  const activeWindowDriftOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(activeWindowDriftSessionId)}/operations`, {
    operation: {
      kind: "visual_desktop_action",
      action: {
        type: "click",
        x: 240,
        y: 260,
        button: "left"
      },
      watchPreflight: {
        oneTimeApprovalGranted: true,
        visibleCountdownArmed: true,
        activeWindowAsserted: false,
        targetIdentityAsserted: true,
        processAllowed: true,
        surfaceLockArmed: true,
        userIdle: true,
        abortOnUserInputArmed: true,
        userInputDetected: false,
        activeWindowDriftDetected: true,
        timeoutArmed: true,
        preActionEvidenceReady: true,
        postActionEvidenceReady: true,
        effectVerifierReady: true,
        notReversibleRecordReady: true,
        signedHelperV2Available: false,
        actualInputSent: false
      }
    },
    waitMs: 1000
  });
  assert.equal(activeWindowDriftOperation.ok, true);
  assert.equal(activeWindowDriftOperation.result.job, undefined);
  assert.equal(activeWindowDriftOperation.result.dagNode.status, "failed");
  assert.equal(activeWindowDriftOperation.result.dagNode.output.reason, "foreground_watch_active_window_drift_abort");
  assert.equal(activeWindowDriftOperation.result.dagNode.output.actualInputSent, false);
  assert.equal(activeWindowDriftOperation.result.dagNode.output.watchPreflight.abortReason, "foreground_watch_active_window_drift_abort");
  assert.equal(activeWindowDriftOperation.result.dagNode.output.missingPreconditions.some((item) => item.id === "active_window_assertion" && item.status === "blocked"), true);
  const activeWindowDriftBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(activeWindowDriftSessionId)}/debug-bundle`);
  assert.equal(activeWindowDriftBundle.ok, true);
  assert.equal(activeWindowDriftBundle.bundle.capabilityJobs.some((job) => job.kind === "desktop_action"), false);
  assertFollowupDagNodes(activeWindowDriftBundle.bundle, activeWindowDriftOperation.result.dagNode.id, "foreground_watch_active_window_drift_abort");
  assert.equal(activeWindowDriftBundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "foreground_watch_preflight" &&
    decision.actualInputSent === false &&
    decision.watchPreflight?.activeWindowDriftDetected === true
  ), true);

  const filePickerStarted = await postJson("/computer-use/sessions", {
    userRequest: "Open the native file picker and attach a local invoice PDF.",
    requestedSurface: "foreground_desktop_watch",
    riskClass: "local_file_disclosure",
    metadata: {
      requiresForeground: true,
      requiresNativeFilePicker: true
    }
  });
  assert.equal(filePickerStarted.ok, true);
  assert.equal(filePickerStarted.result.session.selectedSurface.kind, "foreground_desktop_watch");
  const filePickerSessionId = filePickerStarted.result.session.sessionId;
  const filePickerOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(filePickerSessionId)}/operations`, {
    operation: {
      kind: "native_file_picker_action",
      input: {
        mode: "select_file",
        targetApp: "browser",
        allowedExtensions: [".pdf"]
      }
    },
    waitMs: 1000
  });
  assert.equal(filePickerOperation.ok, true);
  assert.equal(filePickerOperation.result.job, undefined);
  assert.equal(filePickerOperation.result.dagNode.kind, "action");
  assert.equal(filePickerOperation.result.dagNode.status, "failed");
  assert.equal(filePickerOperation.result.dagNode.output.actualInputSent, false);
  assert.equal(filePickerOperation.result.dagNode.output.localFilePathDisclosed, false);
  assert.equal(filePickerOperation.result.dagNode.output.reason, "native_file_picker_helper_v2_not_available");
  assert.equal(filePickerOperation.result.dagNode.output.missingPreconditions.some((item) => item.id === "signed_file_picker_helper_v2"), true);

  const filePickerSession = await getJson(`/computer-use/sessions/${encodeURIComponent(filePickerSessionId)}`);
  assert.equal(filePickerSession.ok, true);
  assert.equal(filePickerSession.session.state, "blocked");
  assert.equal(filePickerSession.session.blockedReason, "native_file_picker_helper_v2_not_available");

  const filePickerBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(filePickerSessionId)}/debug-bundle`);
  assert.equal(filePickerBundle.ok, true);
  assert.equal(filePickerBundle.bundle.capabilityJobs.some((job) => job.kind === "desktop_action"), false);
  assertFollowupDagNodes(filePickerBundle.bundle, filePickerOperation.result.dagNode.id, "native_file_picker_helper_v2_not_available");
  assert.equal(filePickerBundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "native_file_picker_preconditions" &&
    decision.actualInputSent === false &&
    decision.localFilePathDisclosed === false
  ), true);
  assert.equal(filePickerBundle.bundle.observations.some((observation) =>
    observation.source === "native_file_picker_boundary" &&
    observation.kind === "file" &&
    observation.metadata?.localFilePathDisclosed === false
  ), true);
  assert.equal(filePickerBundle.bundle.rollbackActions.some((action) =>
    action.kind === "none_available" &&
    action.status === "skipped" &&
    action.reason === "no_file_was_selected"
  ), true);
  assert.equal(filePickerBundle.bundle.verifierResults.some((verifier) =>
    verifier?.id === `verifier:${filePickerOperation.result.dagNode.id}` &&
    verifier.status === "failed" &&
    verifier.localFilePathDisclosed === false
  ), true);
  assert.equal(filePickerBundle.bundle.failureMemory.some((record) =>
    record.failureClass === "external_blocker" &&
    record.provenance.evalRunId === filePickerBundle.bundle.session.evalRunId &&
    record.safety.mayCompleteTask === false &&
    record.safety.proofSource === false &&
    record.calibration.abstentionTriggers?.includes("native_file_picker_helper_v2_unavailable")
  ), true);

  const permissionBubbleStarted = await postJson("/computer-use/sessions", {
    userRequest: "Click Allow on the browser camera permission popup if it belongs to example.com.",
    requestedSurface: "foreground_desktop_watch",
    riskClass: "browser_state_mutation",
    metadata: {
      requiresForeground: true,
      requiresBrowserPermissionBubble: true
    }
  });
  assert.equal(permissionBubbleStarted.ok, true);
  assert.equal(permissionBubbleStarted.result.session.selectedSurface.kind, "foreground_desktop_watch");
  const permissionBubbleSessionId = permissionBubbleStarted.result.session.sessionId;
  const permissionBubbleOperation = await postJson(`/computer-use/sessions/${encodeURIComponent(permissionBubbleSessionId)}/operations`, {
    operation: {
      kind: "browser_permission_bubble_action",
      input: {
        permissionType: "camera",
        host: "example.com",
        targetButton: "allow"
      }
    },
    waitMs: 1000
  });
  assert.equal(permissionBubbleOperation.ok, true);
  assert.equal(permissionBubbleOperation.result.job, undefined);
  assert.equal(permissionBubbleOperation.result.dagNode.kind, "action");
  assert.equal(permissionBubbleOperation.result.dagNode.status, "failed");
  assert.equal(permissionBubbleOperation.result.dagNode.output.reason, "browser_permission_bubble_helper_v2_not_available");
  assert.equal(permissionBubbleOperation.result.dagNode.output.actualInputSent, false);
  assert.equal(permissionBubbleOperation.result.dagNode.output.nativePopupClick, false);
  assert.equal(permissionBubbleOperation.result.dagNode.output.permissionChanged, false);
  assert.equal(permissionBubbleOperation.result.dagNode.output.missingPreconditions.some((item) => item.id === "signed_watch_mode_helper_v2"), true);

  const permissionBubbleSession = await getJson(`/computer-use/sessions/${encodeURIComponent(permissionBubbleSessionId)}`);
  assert.equal(permissionBubbleSession.ok, true);
  assert.equal(permissionBubbleSession.session.state, "blocked");
  assert.equal(permissionBubbleSession.session.blockedReason, "browser_permission_bubble_helper_v2_not_available");

  const permissionBubbleBundle = await getJson(`/computer-use/sessions/${encodeURIComponent(permissionBubbleSessionId)}/debug-bundle`);
  assert.equal(permissionBubbleBundle.ok, true);
  assert.equal(permissionBubbleBundle.bundle.capabilityJobs.some((job) => job.kind === "desktop_action"), false);
  assertFollowupDagNodes(permissionBubbleBundle.bundle, permissionBubbleOperation.result.dagNode.id, "browser_permission_bubble_helper_v2_not_available");
  assert.equal(permissionBubbleBundle.bundle.safetyDecisions.some((decision) =>
    decision?.phase === "browser_permission_bubble_preconditions" &&
    decision.actualInputSent === false &&
    decision.nativePopupClick === false &&
    decision.permissionChanged === false
  ), true);
  assert.equal(permissionBubbleBundle.bundle.observations.some((observation) =>
    observation.source === "browser_permission_bubble_boundary" &&
    observation.metadata?.actualInputSent === false &&
    observation.metadata?.nativePopupClick === false
  ), true);
  assert.equal(permissionBubbleBundle.bundle.rollbackActions.some((action) =>
    action.kind === "none_available" &&
    action.status === "skipped" &&
    action.reason === "no_permission_popup_input_was_sent"
  ), true);
  assert.equal(permissionBubbleBundle.bundle.verifierResults.some((verifier) =>
    verifier?.id === `verifier:${permissionBubbleOperation.result.dagNode.id}` &&
    verifier.status === "failed" &&
    verifier.nativePopupClick === false &&
    verifier.permissionChanged === false
  ), true);
  assert.equal(permissionBubbleBundle.bundle.failureMemory.some((record) =>
    record.failureClass === "external_blocker" &&
    record.provenance.evalRunId === permissionBubbleBundle.bundle.session.evalRunId &&
    record.safety.mayCompleteTask === false &&
    record.safety.proofSource === false &&
    record.calibration.abstentionTriggers?.includes("browser_permission_bubble_helper_v2_unavailable")
  ), true);

  console.log(`computer use native watch boundary smoke ok on port ${daemon.port}`);
} finally {
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

function assertFollowupDagNodes(bundle, actionNodeId, expectedError = "foreground_watch_mode_v2_not_available") {
  const verification = bundle.dagNodes.find((node) => node.id === `${actionNodeId}:verification`);
  const ledger = bundle.dagNodes.find((node) => node.id === `${actionNodeId}:eval_ledger`);
  assert.equal(verification?.kind, "verification");
  assert.equal(verification?.status, "failed");
  assert.equal(verification?.output?.lastError, expectedError);
  assert.equal(ledger?.kind, "eval_ledger");
  assert.equal(ledger?.status, "failed");
  assert.equal(ledger?.output?.recorded, true);
}

function assertDisabledForegroundWatchExecutor(executor) {
  assert.equal(executor?.schemaVersion, "browser-native-desktop-helper-foreground-watch-executor.v1");
  assert.equal(executor?.helperCommand, "foreground_watch_execute");
  assert.equal(executor?.enabled, false);
  assert.equal(executor?.supported, false);
  assert.equal(executor?.dryRunOnly, true);
  assert.equal(executor?.signedHelperV2Available, false);
  assert.equal(executor?.actualInputSent, false);
  assert.equal(executor?.releaseGate, "browser-native-helper-signing");
  assert.equal(executor?.blocker, "signed_helper_v2_unavailable");
  assert.equal(executor?.requiredPreconditions?.includes("abort_on_user_input"), true);
  assert.equal(executor?.requiredPreconditions?.includes("rollback_or_not_reversible_record"), true);
}
