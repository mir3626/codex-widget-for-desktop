import type { CapabilityKind } from "../capability-transaction/types.js";
import type { AgentToolRuntimeKind } from "./types.js";

export type BlockedAgentToolRuntimeContract = {
  id: string;
  runtime: AgentToolRuntimeKind;
  capability: CapabilityKind;
  status: "blocked";
  reason: string;
  attemptedPath: string;
  requiredScopeExpansion: string;
  safeFallbackRuntime: AgentToolRuntimeKind;
};

export const browserActionAppServerClientToolContract: BlockedAgentToolRuntimeContract = {
  id: "browser_action.app_server_client_tool",
  runtime: "app_server_client_tool",
  capability: "browser_action",
  status: "blocked",
  reason:
    "Codex app-server does not currently expose a stable custom client-tool request/response contract for this product to bind Browser Action actions without prompt-only claims.",
  attemptedPath:
    "Browser Action is exposed through a daemon-owned simulated tool path with protocol events, approval, action results, audit metadata, and smoke coverage.",
  requiredScopeExpansion:
    "Adopt an official app-server client-tool contract that defines tool schema advertisement, request ids, streaming tool-call events, user approval handoff, result/error delivery, and persistence/redaction semantics.",
  safeFallbackRuntime: "simulated_daemon"
};
