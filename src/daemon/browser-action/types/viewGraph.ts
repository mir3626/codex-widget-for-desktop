import type { Rect } from "./core.js";

export type BrowserViewGraphSchemaVersion = "browser-view-graph.v1" | "browser-view-graph.v2";
export type BrowserViewFreshness = "fresh" | "settling" | "stale" | "unknown";
export type BrowserViewGraphSource =
  | "extension_snapshot"
  | "extension_delta"
  | "extension_action_result"
  | "playwright_observe"
  | "cdp_observe"
  | "native_diagnostics"
  | "test_fixture"
  | "unknown";

export type BrowserViewIdentity = {
  schemaVersion?: BrowserViewGraphSchemaVersion;
  tabId?: string;
  windowId?: string;
  tabKey?: string;
  documentId?: string;
  url: string;
  origin?: string;
  pathname?: string;
  querySignature?: string;
  route: string;
  routeKey?: string;
  viewRevision: string;
  domRevision: string;
  capturedAt: string;
  updatedAt?: string;
  mutationQuietMs?: number;
  textDigest: string;
  interactiveDigest: string;
  structureDigest?: string;
  source?: BrowserViewGraphSource;
  freshness?: BrowserViewFreshness;
};

export type BrowserViewNodeKind =
  | "surface"
  | "region"
  | "control"
  | "field"
  | "content_item"
  | "text_block"
  | "list"
  | "row"
  | "media"
  | "table"
  | "state"
  | "modal"
  | "form";

export type BrowserViewActionHint = "read" | "navigate" | "filter" | "expand" | "submit" | "delete" | "type" | "select" | "check" | "scroll" | "unknown";
export type BrowserViewRiskHint = "safe_read" | "same_page_update" | "navigation" | "submit" | "destructive" | "credential" | "payment" | "download" | "file_upload" | "cross_origin" | "unknown";
export type BrowserViewRegionRole = "header" | "nav" | "sidebar" | "main" | "footer" | "modal" | "form" | "list" | "toolbar" | "dialog" | "article" | "unknown";

export type BrowserViewNode = {
  id: string;
  stableKey?: string;
  kind: BrowserViewNodeKind;
  label?: string;
  text?: string;
  tokens?: string[];
  role?: string;
  elementId?: string;
  regionRole?: BrowserViewRegionRole;
  bbox?: Rect;
  visible: boolean;
  enabled?: boolean;
  editable?: boolean;
  selected?: boolean;
  href?: string;
  actionHint?: BrowserViewActionHint;
  riskHints?: BrowserViewRiskHint[];
  regionId?: string;
  listId?: string;
  formId?: string;
  sourceElementIds?: string[];
  confidence?: number;
  evidence?: string[];
};

export type BrowserViewEdge = {
  id?: string;
  from: string;
  to: string;
  relation:
    | "contains"
    | "labels"
    | "describes"
    | "adjacent_to"
    | "same_group"
    | "filters"
    | "controls"
    | "submits"
    | "navigates_to"
    | "opens"
    | "updates_region"
    | "selected_in"
    | "focused_in"
    | "error_for"
    | "depends_on"
    | "item_of"
    | "list_item_of";
  confidence: number;
  evidence?: string[];
};

export type BrowserRegionSummary = {
  id: string;
  role: BrowserViewRegionRole;
  label: string;
  nodeIds: string[];
  bbox?: Rect;
  confidence: number;
};

export type BrowserContentList = {
  id: string;
  label: string;
  regionId?: string;
  itemNodeIds: string[];
  representativeNodeIds: string[];
  confidence: number;
};

export type BrowserFormSummary = {
  id: string;
  label: string;
  fieldNodeIds: string[];
  submitNodeIds: string[];
  riskHints: BrowserViewRiskHint[];
  confidence: number;
};

export type BrowserAffordanceIndex = {
  byToken: Record<string, string[]>;
  byRole: Record<string, string[]>;
  byActionHint: Record<string, string[]>;
  byRiskHint: Record<string, string[]>;
  byRegion: Record<string, string[]>;
  byList: Record<string, string[]>;
  byForm: Record<string, string[]>;
  focused?: string;
  selected: string[];
  primaryControls: string[];
  contentCandidates: string[];
  safeReadTargets: string[];
  riskyActionTargets: string[];
};

export type BrowserViewGraphDiagnostics = {
  buildTimeMs: number;
  truncatedElements: number;
  totalElements: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  freshnessReason: string;
  warnings: string[];
};

export type BrowserViewGraphRedactionSummary = {
  redactedFieldCount: number;
  redactedNodeIds: string[];
  policy: "metadata_only";
};

export type BrowserViewGraph = {
  schemaVersion?: BrowserViewGraphSchemaVersion;
  identity: BrowserViewIdentity;
  nodes: BrowserViewNode[];
  edges: BrowserViewEdge[];
  regions?: BrowserRegionSummary[];
  contentLists?: BrowserContentList[];
  forms?: BrowserFormSummary[];
  affordanceIndex?: BrowserAffordanceIndex;
  diagnostics?: BrowserViewGraphDiagnostics;
  redaction?: BrowserViewGraphRedactionSummary;
};
