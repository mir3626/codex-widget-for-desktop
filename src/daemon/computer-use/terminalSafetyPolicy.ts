import { readStringField } from "./sessionRecordUtils.js";

export type BoundedReversibleRegistryMutation = {
  scope: "hkcu_app_registry";
  action: "set" | "delete";
  root: string;
  valueName: string;
  rollbackCommand?: string;
  proofCommand?: string;
};

const BOUNDED_REVERSIBLE_REGISTRY_ROOT = "HKCU\\Software\\CodexWidgetComputerUseSmoke";
const SAFE_REGISTRY_VALUE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_REGISTRY_DATA_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

export function readTerminalHardBlockReason(
  command: string,
  options: {
    allowBoundedReversibleRegistryMutation?: boolean;
    allowCredentialLikeText?: boolean;
  } = {}
): string | undefined {
  if (!options.allowCredentialLikeText && /(?:password|passwd|token|cookie|credential|secret|api[_-]?key)\s*[:=]?\s*\S*/i.test(command)) {
    return "terminal_command_credential_like";
  }
  if (/\b(?:format|shutdown|reboot|bcdedit|cipher\s+\/w|diskpart)\b/i.test(command)) {
    return "terminal_command_destructive_boundary";
  }
  if (/\breg\s+(?:add|delete)\b/i.test(command) && options.allowBoundedReversibleRegistryMutation) {
    return undefined;
  }
  if (/\b(?:rm\s+-rf|del\s+\/[fqs]|remove-item\b.*(?:-recurse|-force)|rmdir\s+\/s|reg\s+(?:add|delete)|set-itemproperty\b)\b/i.test(command)) {
    return "terminal_command_destructive_boundary";
  }
  if (hasTerminalShellControlOperator(command)) {
    return "terminal_command_shell_chaining_boundary";
  }
  return undefined;
}

function hasTerminalShellControlOperator(command: string): boolean {
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const previous = index > 0 ? command[index - 1] : "";
    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (quote) {
      continue;
    }
    if (char === "\n" || char === "\r" || char === ";" || char === "&" || char === "|") {
      return true;
    }
  }
  return false;
}

export function readTerminalObservationEvidence(input: Record<string, unknown>): Record<string, unknown> {
  const command = readStringField(input, "command") ?? "";
  const reversibleRegistryMutation = readBoundedReversibleRegistryMutation(input, command);
  return reversibleRegistryMutation ? { reversibleRegistryMutation } : {};
}

export function readBoundedReversibleRegistryMutation(
  input: Record<string, unknown>,
  command: string
): BoundedReversibleRegistryMutation | undefined {
  const descriptor = input.reversibleWindowsSetting && typeof input.reversibleWindowsSetting === "object"
    ? input.reversibleWindowsSetting as Record<string, unknown>
    : null;
  if (!descriptor) {
    return undefined;
  }
  const scope = descriptor.scope;
  const root = typeof descriptor.root === "string" ? descriptor.root.trim() : "";
  const valueName = typeof descriptor.valueName === "string" ? descriptor.valueName.trim() : "";
  const action = descriptor.action;
  if (scope !== "hkcu_app_registry" || root !== BOUNDED_REVERSIBLE_REGISTRY_ROOT || !SAFE_REGISTRY_VALUE_RE.test(valueName)) {
    return undefined;
  }
  const normalizedCommand = normalizeRegistryCommand(command);
  const normalizedRoot = normalizeRegistryCommand(BOUNDED_REVERSIBLE_REGISTRY_ROOT);
  if (action === "set") {
    const valueData = typeof descriptor.valueData === "string" ? descriptor.valueData.trim() : "";
    if (!SAFE_REGISTRY_DATA_RE.test(valueData)) {
      return undefined;
    }
    const expected = normalizeRegistryCommand(`reg add ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName} /t REG_SZ /d ${valueData} /f`);
    if (normalizedCommand !== expected) {
      return undefined;
    }
    const rollbackCommand = `reg delete ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName} /f`;
    return {
      scope,
      action,
      root: BOUNDED_REVERSIBLE_REGISTRY_ROOT,
      valueName,
      rollbackCommand,
      proofCommand: `reg query ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName}`
    };
  }
  if (action === "delete") {
    const expected = normalizeRegistryCommand(`reg delete ${BOUNDED_REVERSIBLE_REGISTRY_ROOT} /v ${valueName} /f`);
    if (normalizedCommand !== expected || !normalizedCommand.startsWith(`reg delete ${normalizedRoot} `)) {
      return undefined;
    }
    return {
      scope,
      action,
      root: BOUNDED_REVERSIBLE_REGISTRY_ROOT,
      valueName,
      proofCommand: `reg query ${BOUNDED_REVERSIBLE_REGISTRY_ROOT}`
    };
  }
  return undefined;
}

function normalizeRegistryCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
