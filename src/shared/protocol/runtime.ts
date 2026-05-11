import type { WidgetMode } from "./base.js";

export type RuntimeInteractionKind = "approval" | "input";

export type RuntimeInteractionDecision = "approve" | "always_allow" | "decline" | "submit";

export type RuntimeInteraction = {
  id: string;
  requestId?: string;
  kind: RuntimeInteractionKind;
  title: string;
  body: string;
  action?: string;
  fields?: Array<{
    id: string;
    label: string;
    placeholder?: string;
    multiline?: boolean;
  }>;
  choices?: Array<{
    id: string;
    label: string;
    value: string;
    description?: string;
    detail?: string;
    visual?: {
      kind: "bbox";
      bbox: {
        x: number;
        y: number;
        w: number;
        h: number;
      };
      viewport?: {
        width: number;
        height: number;
      };
      region?: string;
      confidence?: number;
    };
  }>;
};

export type ExecutionPermissionDecision = "ask" | "allow" | "deny";

export type ExecutionPermissionSummary = {
  action: string;
  decision: ExecutionPermissionDecision;
  updatedAt: string;
};

export type ProviderStatus = {
  mode: WidgetMode;
  label: string;
  state: "ready" | "stub" | "unavailable";
  detail: string;
  capabilities: string[];
};

export type RuntimeStatus = {
  uptimeSeconds: number;
  clients: number;
  activeRequests: number;
  storage: {
    state: "ready" | "error";
    databasePath: string;
    blobDir: string;
    schemaVersion: number;
    latestSchemaVersion: number;
    migrationsApplied: number;
    tableCount: number;
    journalMode: string;
    foreignKeys: boolean;
    integrity: string;
    lastError?: string;
  };
  codexAppServer: {
    state: "closed" | "starting" | "connected";
    pid?: number;
    hasThread: boolean;
    activeTurn: boolean;
    startCount: number;
    lastStartedAt?: string;
    lastExitedAt?: string;
    lastError?: string;
  };
};
