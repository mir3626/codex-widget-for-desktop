import type { CapabilityKind, CapabilityTransactionSource } from "../capability-transaction/types.js";

export type AgentToolRuntimeKind = "simulated_daemon" | "app_server_client_tool" | "direct_ui";

export type AgentToolInvocation = {
  toolId: string;
  runtime: AgentToolRuntimeKind;
  capability: CapabilityKind;
  requestId: string;
  sessionId?: string;
  source: CapabilityTransactionSource;
  input: Record<string, unknown>;
  redaction: {
    mode: "metadata_only" | "redacted_input";
    persistedFields: string[];
  };
};

export type AgentToolResult = {
  invocationId: string;
  status: "succeeded" | "failed" | "needs_approval" | "needs_clarification" | "blocked";
  summary: string;
  output?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
};

export type AgentToolRuntimeAdapter = {
  id: string;
  runtime: AgentToolRuntimeKind;
  capability: CapabilityKind;
  createInvocation(input: Omit<AgentToolInvocation, "toolId" | "runtime" | "capability">): AgentToolInvocation;
};

