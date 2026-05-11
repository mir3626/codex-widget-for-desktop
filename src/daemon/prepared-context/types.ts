export type PreparedContextSurface =
  | "browser_page"
  | "screen"
  | "terminal"
  | "workspace"
  | "desktop";

export type PreparedContextFreshness =
  | "fresh"
  | "settling"
  | "stale"
  | "unknown"
  | "blocked"
  | "unavailable";

export type PreparedContextStability =
  | "stable"
  | "mutating"
  | "navigating"
  | "unknown";

export type PreparedContextIdentity = {
  surface: PreparedContextSurface;
  sourceId: string;
  surfaceId?: string;
  url?: string;
  title?: string;
  origin?: string;
  routeKey?: string;
  revision?: string;
  mutationRevision?: string;
  digest?: string;
};

export type PreparedContextSnapshot = {
  schemaVersion: "prepared-context.v1";
  identity: PreparedContextIdentity;
  freshness: PreparedContextFreshness;
  stability: PreparedContextStability;
  capturedAt: string;
  updatedAt: string;
  expiresAt: string;
  redaction: {
    mode: "metadata_only" | "redacted_summary";
    persistedFields: string[];
  };
  diagnostics: Record<string, unknown>;
};

export type PreparedContextLease = {
  leaseId: string;
  contextId: string;
  identity: PreparedContextIdentity;
  capturedAt: string;
  expiresAt: string;
  requiredRisk: "read" | "safe_side_effect" | "risky_side_effect";
  freshness: PreparedContextFreshness | "settling_ready";
  stability: PreparedContextStability;
  diagnostics: Record<string, unknown>;
};
