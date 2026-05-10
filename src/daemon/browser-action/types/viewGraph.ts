import type { Rect } from "./core.js";

export type BrowserViewIdentity = {
  tabId?: string;
  windowId?: string;
  documentId?: string;
  url: string;
  route: string;
  viewRevision: string;
  domRevision: string;
  capturedAt: string;
  mutationQuietMs?: number;
  textDigest: string;
  interactiveDigest: string;
};

export type BrowserViewNodeKind =
  | "surface"
  | "region"
  | "control"
  | "field"
  | "content_item"
  | "list"
  | "row"
  | "modal"
  | "form";

export type BrowserViewNode = {
  id: string;
  kind: BrowserViewNodeKind;
  label?: string;
  role?: string;
  elementId?: string;
  regionRole?: "header" | "nav" | "sidebar" | "main" | "footer" | "modal" | "form" | "list" | "unknown";
  bbox?: Rect;
  visible: boolean;
};

export type BrowserViewEdge = {
  from: string;
  to: string;
  relation: "contains" | "labels" | "same_group" | "filters" | "submits" | "navigates_to" | "item_of";
  confidence: number;
};

export type BrowserViewGraph = {
  identity: BrowserViewIdentity;
  nodes: BrowserViewNode[];
  edges: BrowserViewEdge[];
};
