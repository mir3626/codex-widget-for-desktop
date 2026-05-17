import type {
  ComputerSessionCreateInput,
  ComputerStructuredOperation,
  ForegroundWatchExecutorState,
  ForegroundWatchPreflightState
} from "../../shared/protocol.js";
import { readBooleanField } from "./sessionRecordUtils.js";

export function readForegroundWatchPreflight(value: unknown): ForegroundWatchPreflightState {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const abortOnUserInputArmed = readBooleanField(record, "abortOnUserInputArmed");
  const userInputDetected = readBooleanField(record, "userInputDetected");
  const activeWindowDriftDetected = readBooleanField(record, "activeWindowDriftDetected");
  const abortReason = abortOnUserInputArmed && userInputDetected
    ? "foreground_watch_user_input_abort"
    : activeWindowDriftDetected
      ? "foreground_watch_active_window_drift_abort"
      : undefined;
  return {
    schemaVersion: "foreground-watch-preflight.v1",
    oneTimeApprovalGranted: readBooleanField(record, "oneTimeApprovalGranted"),
    visibleCountdownArmed: readBooleanField(record, "visibleCountdownArmed"),
    activeWindowAsserted: readBooleanField(record, "activeWindowAsserted"),
    targetIdentityAsserted: readBooleanField(record, "targetIdentityAsserted"),
    processAllowed: readBooleanField(record, "processAllowed"),
    surfaceLockArmed: readBooleanField(record, "surfaceLockArmed"),
    userIdle: readBooleanField(record, "userIdle"),
    abortOnUserInputArmed,
    userInputDetected,
    activeWindowDriftDetected,
    timeoutArmed: readBooleanField(record, "timeoutArmed"),
    preActionEvidenceReady: readBooleanField(record, "preActionEvidenceReady"),
    postActionEvidenceReady: readBooleanField(record, "postActionEvidenceReady"),
    effectVerifierReady: readBooleanField(record, "effectVerifierReady"),
    rollbackProofReady: readBooleanField(record, "rollbackProofReady"),
    notReversibleRecordReady: readBooleanField(record, "notReversibleRecordReady"),
    signedHelperV2Available: readBooleanField(record, "signedHelperV2Available"),
    actualInputSent: false,
    ...(abortReason ? { abortReason } : {})
  };
}

export function buildDisabledForegroundWatchExecutorState(): ForegroundWatchExecutorState {
  return {
    schemaVersion: "browser-native-desktop-helper-foreground-watch-executor.v1",
    helperCommand: "foreground_watch_execute",
    helperScope: "browser_windows_only",
    enabled: false,
    supported: false,
    dryRunOnly: true,
    actualInputSent: false,
    signedHelperV2Available: false,
    releaseGate: "browser-native-helper-signing",
    blocker: "signed_helper_v2_unavailable",
    requiredPreconditions: [
      "one_time_approval",
      "visible_countdown",
      "active_window_assertion",
      "target_identity_assertion",
      "process_allowlist",
      "surface_lock",
      "user_idle",
      "abort_on_user_input",
      "timeout_guard",
      "pre_action_evidence",
      "post_action_evidence",
      "effect_verifier",
      "rollback_or_not_reversible_record"
    ],
    disabledReason: "current_helper_is_browser_window_scoped_and_must_not_send_broad_foreground_input"
  };
}

export function readForegroundWatchBlockReason(surfaceKind: string | undefined, preflight: ForegroundWatchPreflightState): string {
  if (surfaceKind !== "foreground_desktop_watch") {
    return "visual_desktop_action_requires_foreground_watch_surface";
  }
  if (preflight.abortReason) {
    return preflight.abortReason;
  }
  return "foreground_watch_mode_v2_not_available";
}

export function readForegroundWatchVerifierReason(reason: string): string {
  if (reason === "foreground_watch_user_input_abort") {
    return "Foreground desktop visual action aborted before native input because user input was detected during watch-mode preflight.";
  }
  if (reason === "foreground_watch_active_window_drift_abort") {
    return "Foreground desktop visual action aborted before native input because the active window drifted during watch-mode preflight.";
  }
  return "Foreground desktop visual action did not run because watch-mode safety preconditions are incomplete.";
}

export function buildForegroundWatchPreconditions(input: {
  surfaceKind?: string;
  action: Extract<ComputerStructuredOperation, { kind: "visual_desktop_action" }>["action"];
  preflight?: ForegroundWatchPreflightState;
}): Array<{
  id: string;
  status: "satisfied" | "missing" | "blocked";
  reason: string;
}> {
  const surfaceReady = input.surfaceKind === "foreground_desktop_watch";
  const preflight = input.preflight ?? readForegroundWatchPreflight(undefined);
  const effectProofReady = preflight.effectVerifierReady && (preflight.rollbackProofReady || preflight.notReversibleRecordReady);
  return [
    {
      id: "foreground_watch_surface_selected",
      status: surfaceReady ? "satisfied" : "missing",
      reason: surfaceReady ? "Session selected the foreground watch surface." : "Visual desktop actions require a foreground_desktop_watch surface."
    },
    {
      id: "one_time_user_approval",
      status: preflight.oneTimeApprovalGranted ? "satisfied" : "missing",
      reason: preflight.oneTimeApprovalGranted ? "The foreground action has a one-time approval record for this run." : "Foreground input must be approved per run with a visible action preview."
    },
    {
      id: "visible_countdown",
      status: preflight.visibleCountdownArmed ? "satisfied" : "missing",
      reason: preflight.visibleCountdownArmed ? "The foreground watch preflight armed a visible countdown." : "The user must see a countdown before native input is injected."
    },
    {
      id: "active_window_assertion",
      status: preflight.activeWindowDriftDetected ? "blocked" : preflight.activeWindowAsserted ? "satisfied" : "missing",
      reason: preflight.activeWindowDriftDetected
        ? "The foreground watch preflight detected active-window drift and aborted before native input."
        : preflight.activeWindowAsserted
          ? "The foreground watch preflight asserted the active window before input."
          : "The helper must prove the active window still matches the planned target."
    },
    {
      id: "target_identity_check",
      status: preflight.targetIdentityAsserted ? "satisfied" : "missing",
      reason: preflight.targetIdentityAsserted ? "The foreground watch preflight matched the target title, URL, app, or workflow identity." : "The helper must verify the current title, URL, app, or workflow identity before native input."
    },
    {
      id: "process_allowlist_match",
      status: preflight.processAllowed ? "satisfied" : "missing",
      reason: preflight.processAllowed ? "The foreground watch preflight matched the active process allowlist." : "The active process must match the bounded workflow allowlist."
    },
    {
      id: "surface_lock",
      status: preflight.surfaceLockArmed ? "satisfied" : "missing",
      reason: preflight.surfaceLockArmed ? "The foreground surface is locked for this action window." : "Foreground input requires a surface lock so the target cannot drift during countdown or execution."
    },
    {
      id: "mouse_keyboard_idle_guard",
      status: preflight.userInputDetected ? "blocked" : preflight.userIdle ? "satisfied" : "missing",
      reason: preflight.userInputDetected
        ? "The foreground watch preflight detected user input and aborted before native input."
        : preflight.userIdle
          ? "The foreground watch preflight proved the user input stream was idle."
          : "The helper must prove there was no recent user input before acting."
    },
    {
      id: "abort_on_user_input",
      status: preflight.abortOnUserInputArmed ? "satisfied" : "missing",
      reason: preflight.abortOnUserInputArmed ? "The foreground watch preflight armed abort-on-user-input monitoring." : "Any mouse, keyboard, focus, or active-window drift during countdown/execution must abort."
    },
    {
      id: "timeout_guard",
      status: preflight.timeoutArmed ? "satisfied" : "missing",
      reason: preflight.timeoutArmed ? "The foreground watch preflight armed a bounded execution timeout." : "Foreground watch execution must have a bounded timeout before native input can be sent."
    },
    {
      id: "pre_action_screenshot_or_uia",
      status: preflight.preActionEvidenceReady ? "satisfied" : "missing",
      reason: preflight.preActionEvidenceReady ? "Pre-action screen/UIA evidence is available under retention policy." : "The run needs pre-action screen/UIA evidence with blob retention policy."
    },
    {
      id: "post_action_screenshot_or_uia",
      status: preflight.postActionEvidenceReady ? "satisfied" : "missing",
      reason: preflight.postActionEvidenceReady ? "Post-action evidence is available to prove the abort/no-mutation result." : "The run needs post-action evidence to verify the effect or prove no mutation."
    },
    {
      id: "signed_watch_mode_helper_v2",
      status: preflight.signedHelperV2Available ? "satisfied" : "blocked",
      reason: preflight.signedHelperV2Available ? "Signed watch-mode helper v2 is available for this preflight." : "The current helper is browser-window scoped; broader foreground control requires signed watch-mode helper v2."
    },
    {
      id: "effect_verifier_or_not_reversible_record",
      status: effectProofReady ? "satisfied" : "missing",
      reason: effectProofReady ? "Effect verifier and rollback/not-reversible proof are ready." : "Every foreground action needs an effect verifier and either rollback proof or a not-reversible record."
    }
  ];
}

export function buildNativeFilePickerPreconditions(input: {
  surfaceKind?: string;
  input: Record<string, unknown>;
}): Array<{
  id: string;
  status: "satisfied" | "missing" | "blocked";
  reason: string;
}> {
  const surfaceReady = input.surfaceKind === "foreground_desktop_watch";
  const hasApprovedPath = typeof input.input.approvedFilePath === "string" || Array.isArray(input.input.approvedFilePaths);
  return [
    {
      id: "foreground_watch_surface_selected",
      status: surfaceReady ? "satisfied" : "missing",
      reason: surfaceReady ? "Session selected the foreground watch surface." : "Native file picker automation requires the foreground_desktop_watch surface."
    },
    {
      id: "one_time_file_selection_approval",
      status: "missing",
      reason: "The user must approve the exact file selection workflow for this run."
    },
    {
      id: "approved_file_path_or_root_grant",
      status: hasApprovedPath ? "satisfied" : "missing",
      reason: hasApprovedPath ? "The request provided an explicit approved path hint." : "The run needs an explicit file path or allowed-root grant before any local path can be selected."
    },
    {
      id: "file_picker_window_assertion",
      status: "missing",
      reason: "The helper must prove the native picker dialog is active and belongs to the expected process."
    },
    {
      id: "active_window_assertion",
      status: "missing",
      reason: "The helper must prove the foreground window still matches the planned file picker target."
    },
    {
      id: "abort_on_user_input",
      status: "missing",
      reason: "Any mouse, keyboard, focus, or active-window drift during picker automation must abort."
    },
    {
      id: "path_redaction_and_retention_policy",
      status: "missing",
      reason: "The helper must emit redacted path evidence and must not persist raw paths or file contents by default."
    },
    {
      id: "signed_file_picker_helper_v2",
      status: "blocked",
      reason: "The current native helper is browser-window scoped; native file picker control requires signed helper v2."
    }
  ];
}

export function buildBrowserPermissionBubblePreconditions(input: {
  surfaceKind?: string;
  input: Record<string, unknown>;
}): Array<{
  id: string;
  status: "satisfied" | "missing" | "blocked";
  reason: string;
}> {
  const surfaceReady = input.surfaceKind === "foreground_desktop_watch";
  const hasPermissionType = typeof input.input.permissionType === "string";
  const hasOriginScope = typeof input.input.origin === "string" || typeof input.input.host === "string";
  const hasTargetButton = typeof input.input.targetButton === "string";
  return [
    {
      id: "foreground_watch_surface_selected",
      status: surfaceReady ? "satisfied" : "missing",
      reason: surfaceReady ? "Session selected the foreground watch surface." : "Browser permission bubble native-click recovery requires the foreground_desktop_watch surface."
    },
    {
      id: "one_time_permission_popup_approval",
      status: "missing",
      reason: "The user must approve the exact browser permission prompt click for this run."
    },
    {
      id: "permission_type_identified",
      status: hasPermissionType ? "satisfied" : "missing",
      reason: hasPermissionType ? "The requested permission type is identified." : "The helper must identify the requested permission type before a popup can be clicked."
    },
    {
      id: "origin_scope_verified",
      status: hasOriginScope ? "satisfied" : "missing",
      reason: hasOriginScope ? "The request carries an origin/host scope for verification." : "The permission prompt must be tied to the expected origin or host."
    },
    {
      id: "permission_prompt_window_assertion",
      status: "missing",
      reason: "The helper must prove the visible prompt belongs to the active browser window and expected tab."
    },
    {
      id: "safe_prompt_classification",
      status: "missing",
      reason: "Credential, OS security, admin, and extension-install prompts must be classified and blocked."
    },
    {
      id: "target_button_evidence",
      status: hasTargetButton ? "missing" : "missing",
      reason: hasTargetButton ? "The target button still needs current UIA/screenshot evidence before clicking." : "The helper must identify a bounded Allow/Block/Ask button target before clicking."
    },
    {
      id: "active_window_assertion",
      status: "missing",
      reason: "The helper must prove the active window still matches the browser permission prompt target."
    },
    {
      id: "abort_on_user_input",
      status: "missing",
      reason: "Any mouse, keyboard, focus, or active-window drift during permission prompt automation must abort."
    },
    {
      id: "pre_post_prompt_evidence",
      status: "missing",
      reason: "The run needs pre/post prompt evidence and a permission-state verifier."
    },
    {
      id: "signed_watch_mode_helper_v2",
      status: "blocked",
      reason: "The current helper is browser-window scoped; browser chrome permission popup clicking requires signed watch-mode helper v2."
    }
  ];
}

export function buildFutureVmSessionPreconditions(input: ComputerSessionCreateInput): Array<{
  id: string;
  status: "missing" | "blocked";
  reason: string;
}> {
  const needsNetwork = input.metadata?.requiresNetwork !== false;
  return [
    {
      id: "vm_backend_provider",
      status: "blocked",
      reason: "No local VM, Windows Sandbox, RDP, or containerized desktop backend is registered."
    },
    {
      id: "vm_image_or_snapshot",
      status: "missing",
      reason: "A pinned disposable image or snapshot is required before task execution."
    },
    {
      id: "vm_network_isolation_policy",
      status: needsNetwork ? "missing" : "missing",
      reason: "Network egress needs an allowlist and capture policy before browser or app workflows run in a VM."
    },
    {
      id: "vm_clipboard_file_sync_policy",
      status: "missing",
      reason: "Clipboard and file sync need redaction, allowed roots, and artifact retention rules."
    },
    {
      id: "vm_lifecycle_cleanup",
      status: "missing",
      reason: "The daemon must prove VM shutdown, snapshot discard, and temp artifact cleanup."
    },
    {
      id: "vm_observation_retention_policy",
      status: "missing",
      reason: "Screenshot/audio/blob retention policy must be enforced for VM observations."
    },
    {
      id: "vm_effect_verifier",
      status: "missing",
      reason: "VM actions still need before/after evidence and effect verification."
    }
  ];
}

export function isReadOnlyComputerAction(action: Extract<ComputerStructuredOperation, { kind: "visual_desktop_action" }>["action"]): boolean {
  return action.type === "screenshot" || action.type === "wait";
}
