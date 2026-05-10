import type {
  BrowserActionSource,
  BrowserConsoleSummary,
  BrowserElement,
  BrowserElementRiskHint,
  BrowserImageEvidence,
  BrowserNetworkSummary,
  BrowserViewport,
  Rect
} from "./core.js";
import type { BrowserViewGraph } from "./viewGraph.js";

export type BrowserObservation = {
  id: string;
  capturedAt: string;
  source: BrowserActionSource;
  url: string;
  title: string;
  readyState?: "loading" | "interactive" | "complete";
  viewport?: BrowserViewport;
  selection?: string;
  focusedElementId?: string;
  text?: string;
  elements: BrowserElement[];
  screenshot?: BrowserImageEvidence;
  console?: BrowserConsoleSummary;
  network?: BrowserNetworkSummary;
  viewGraph?: BrowserViewGraph;
};

export type BrowserElementGroup = {
  id: string;
  label: string;
  elementIds: string[];
  riskHints: BrowserElementRiskHint[];
};

export type BrowserElementEdge = {
  from: string;
  to: string;
  relation: "labels" | "contains" | "submits" | "near" | "navigates_to" | "candidate_for";
  confidence: number;
};

export type ElementGraph = {
  observationId: string;
  focusedElementId?: string;
  elements: BrowserElement[];
  groups: BrowserElementGroup[];
  edges: BrowserElementEdge[];
};

export type ElementTarget =
  | { kind: "element_id"; id: string }
  | { kind: "selector"; selector: string }
  | { kind: "text"; text: string; role?: string }
  | { kind: "bbox"; bbox: Rect }
  | { kind: "focused" };
