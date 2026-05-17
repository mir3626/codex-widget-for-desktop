import type { ComputerSessionCreateInput } from "../../shared/protocol.js";

export type VmSandboxAdapterKind =
  | "mock"
  | "windows_sandbox"
  | "hyper_v"
  | "rdp"
  | "cloud";

export type VmSandboxAdapterContract = {
  schemaVersion: "computer-use-vm-sandbox-adapter.v1";
  kind: VmSandboxAdapterKind;
  status: "mock_only" | "local_unavailable" | "external_unconfigured";
  promotable: false;
  vmCreated: false;
  hostMutationAllowed: false;
  requiredPreconditions: string[];
  blockers: string[];
  notes: string[];
};

export type FutureVmSessionBoundary = {
  schemaVersion: "future-vm-session-boundary.v1";
  reason: "future_vm_session_backend_not_available";
  selectedAdapter?: VmSandboxAdapterKind;
  adapters: VmSandboxAdapterContract[];
  vmCreated: false;
  hostMutationAllowed: false;
  networkOpened: false;
  rawScreenshotRetained: false;
  missingPreconditions: Array<{ id: string; status: "missing"; detail: string }>;
};

export function listVmSandboxAdapters(): VmSandboxAdapterContract[] {
  return [
    createAdapterContract("mock", "mock_only", [
      "deterministic_fixture_only",
      "no_guest_os",
      "no_host_mutation"
    ]),
    createAdapterContract("windows_sandbox", "local_unavailable", [
      "windows_sandbox_feature_enabled",
      "sandbox_image_policy",
      "clipboard_file_sync_redaction",
      "lifecycle_cleanup"
    ]),
    createAdapterContract("hyper_v", "local_unavailable", [
      "hyper_v_enabled",
      "administrator_or_vm_service",
      "base_image",
      "network_isolation",
      "lifecycle_cleanup"
    ]),
    createAdapterContract("rdp", "external_unconfigured", [
      "rdp_endpoint",
      "credential_vault_reference",
      "screen_capture_policy",
      "lifecycle_cleanup"
    ]),
    createAdapterContract("cloud", "external_unconfigured", [
      "cloud_account",
      "ephemeral_vm_image",
      "network_isolation",
      "cost_guardrail",
      "lifecycle_cleanup"
    ])
  ];
}

export function buildFutureVmSessionBoundary(input: ComputerSessionCreateInput): FutureVmSessionBoundary {
  const adapters = listVmSandboxAdapters();
  const requested = typeof input.metadata?.vmAdapter === "string"
    ? adapters.find((adapter) => adapter.kind === input.metadata?.vmAdapter)
    : undefined;
  return {
    schemaVersion: "future-vm-session-boundary.v1",
    reason: "future_vm_session_backend_not_available",
    selectedAdapter: requested?.kind,
    adapters,
    vmCreated: false,
    hostMutationAllowed: false,
    networkOpened: false,
    rawScreenshotRetained: false,
    missingPreconditions: [
      {
        id: "vm_backend_provider",
        status: "missing",
        detail: "No Windows Sandbox, Hyper-V, RDP, or cloud VM adapter is configured for disposable Computer Use execution."
      },
      {
        id: "vm_lifecycle_cleanup",
        status: "missing",
        detail: "No adapter has proven create, observe, rollback, teardown, and cleanup semantics."
      },
      {
        id: "vm_network_isolation",
        status: "missing",
        detail: "No VM network bridge or egress policy has been approved for this local machine."
      },
      {
        id: "vm_evidence_redaction",
        status: "missing",
        detail: "No VM screenshot, clipboard, file sync, or credential redaction contract has been accepted."
      }
    ]
  };
}

function createAdapterContract(
  kind: VmSandboxAdapterKind,
  status: VmSandboxAdapterContract["status"],
  requiredPreconditions: string[]
): VmSandboxAdapterContract {
  return {
    schemaVersion: "computer-use-vm-sandbox-adapter.v1",
    kind,
    status,
    promotable: false,
    vmCreated: false,
    hostMutationAllowed: false,
    requiredPreconditions,
    blockers: requiredPreconditions,
    notes: [
      "Adapter contract is intentionally fail-closed until the backend can prove isolation, lifecycle cleanup, and redacted evidence."
    ]
  };
}
