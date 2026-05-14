import type {
  AutonomyCapabilityClass,
  AutonomyCapabilityInventoryItem,
  AutonomyGeneratedToolSpec,
  AutonomyPermissionRequirement
} from "../../shared/protocol.js";
import type { StorageService } from "../storage/storage.js";

export function seedAutonomyCapabilityInventory(storage: StorageService): AutonomyCapabilityInventoryItem[] {
  const now = new Date().toISOString();
  const builtin = defaultCapabilityInventory(now);
  const generated = storage.listAutonomyToolSpecs({ limit: 200 })
    .filter((tool) => tool.status === "active" || tool.status === "smoke_passed")
    .map((tool) => inventoryItemFromTool(tool, now));
  const saved = [...builtin, ...generated].map((item) => storage.upsertAutonomyCapabilityInventory(item));
  return saved;
}

export function listEffectiveAutonomyCapabilities(storage: StorageService): AutonomyCapabilityInventoryItem[] {
  seedAutonomyCapabilityInventory(storage);
  return storage.listAutonomyCapabilityInventory({ limit: 300 });
}

export function registerGeneratedCapability(
  storage: StorageService,
  tool: AutonomyGeneratedToolSpec
): AutonomyCapabilityInventoryItem {
  return storage.upsertAutonomyCapabilityInventory(inventoryItemFromTool(tool, new Date().toISOString()));
}

export function matchCapabilityForOperations(input: {
  inventory: AutonomyCapabilityInventoryItem[];
  capability: AutonomyCapabilityClass | string;
  operations: string[];
}): AutonomyCapabilityInventoryItem | null {
  const direct = input.inventory.find((item) => item.capability === input.capability && item.status !== "blocked" && item.status !== "external_unavailable");
  if (direct) {
    return direct;
  }
  const required = new Set(input.operations);
  return input.inventory.find((item) =>
    item.status !== "blocked"
    && item.status !== "external_unavailable"
    && input.operations.length > 0
    && item.operations.some((operation) => required.has(operation))
  ) ?? null;
}

function inventoryItemFromTool(tool: AutonomyGeneratedToolSpec, now: string): AutonomyCapabilityInventoryItem {
  const manifest = tool.manifest;
  return {
    id: `generated:${tool.id}`,
    capability: tool.capability as AutonomyCapabilityClass,
    status: "generated",
    source: "generated",
    operations: inferOperationsForCapability(tool.capability),
    riskClass: manifest?.stability.externalDependencyWarnings.some((warning) => /mutation|credential/i.test(warning)) ? "high_risk" : "side_effect",
    requiredGrants: tool.requiredGrants,
    toolSpecId: tool.id,
    blockers: [],
    createdAt: tool.createdAt,
    updatedAt: now
  };
}

function defaultCapabilityInventory(now: string): AutonomyCapabilityInventoryItem[] {
  return [
    {
      id: "builtin:screen_observe",
      capability: "source_extraction",
      status: "available",
      source: "builtin",
      operations: ["observe", "ocr", "extract"],
      riskClass: "read_only",
      requiredGrants: [],
      blockers: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "builtin:browser_chrome",
      capability: "browser_chrome_direct_control",
      status: "available",
      source: "builtin",
      operations: ["browser_chrome_control", "bookmark_list", "bookmark_open"],
      riskClass: "side_effect",
      requiredGrants: [
        { type: "browser_automation", value: "browser_chrome", reason: "Browser chrome command execution." },
        { type: "risk_class", value: "side_effect", reason: "Browser chrome actions can change browser state." }
      ],
      blockers: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "builtin:terminal",
      capability: "terminal_generated_tool",
      status: "available",
      source: "builtin",
      operations: ["execute_terminal_tool", "stdout_stderr"],
      riskClass: "side_effect",
      requiredGrants: [
        { type: "command", value: "node", reason: "Generated Node tools run through Node." },
        { type: "risk_class", value: "side_effect", reason: "Terminal actions can affect local state." }
      ],
      blockers: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "blocked:native_windows_workflow",
      capability: "native_windows_workflow",
      status: "blocked",
      source: "blocked",
      operations: ["native_windows_action", "windows_settings_mutation"],
      riskClass: "high_risk",
      requiredGrants: [
        { type: "os_mutation", value: "windows_settings_or_app_surface", reason: "Windows Settings mutation." },
        { type: "risk_class", value: "high_risk", reason: "Windows Settings mutation." }
      ],
      blockers: ["signed_native_helper_scope_required", "high_risk_dogfood_required"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "builtin:local_document_conversion",
      capability: "local_document_conversion",
      status: "available",
      source: "builtin",
      operations: ["draft_markdown", "render_pdf", "verify_artifact"],
      riskClass: "read_only",
      requiredGrants: [
        { type: "risk_class", value: "read_only", reason: "Document conversion reads generated content and writes artifacts." }
      ],
      blockers: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "blocked:file_picker",
      capability: "file_picker",
      status: "blocked",
      source: "blocked",
      operations: ["native_file_picker", "file_selection"],
      riskClass: "side_effect",
      requiredGrants: [
        { type: "risk_class", value: "side_effect", reason: "File picker workflows can select user files." }
      ],
      blockers: ["signed_native_helper_scope_required"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "blocked:package_install_helper",
      capability: "package_install_helper",
      status: "blocked",
      source: "blocked",
      operations: ["package_install", "dependency_prepare"],
      riskClass: "side_effect",
      requiredGrants: [
        { type: "package_install", value: "isolated_runtime_workspace", reason: "Package installation must be explicitly granted and isolated." },
        { type: "risk_class", value: "side_effect", reason: "Package installation mutates runtime dependencies." }
      ],
      blockers: ["isolated_package_install_runtime_not_promoted"],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "external:app_server_client_tool",
      capability: "browser_download_verify",
      status: "external_unavailable",
      source: "external",
      operations: ["download_verify", "browser_downloads"],
      riskClass: "read_only",
      requiredGrants: [],
      blockers: ["official_app_server_client_tool_contract_required"],
      createdAt: now,
      updatedAt: now
    }
  ];
}

function inferOperationsForCapability(capability: string): string[] {
  if (capability === "web_research_to_pdf") {
    return ["crawl_or_observe", "extract", "verify_sources", "draft_markdown", "render_pdf", "store_artifact", "verify_artifact"];
  }
  if (capability === "browser_download_verify") {
    return ["download_verify", "verify_artifact"];
  }
  if (capability === "terminal_generated_tool") {
    return ["generate_terminal_tool", "execute_terminal_tool"];
  }
  return [capability];
}

export function requiredGrantsForCommand(command: string): AutonomyPermissionRequirement[] {
  return [
    { type: "command", value: command, reason: `Generated tool may run ${command}.` }
  ];
}
