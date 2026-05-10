import type {
  BrowserActionSource,
  BrowserElement,
  BrowserObservation,
  BrowserViewGraph
} from "../../browser-action/types.js";

export type BrowserViewGraphV2Input = {
  source: Partial<BrowserActionSource>;
  url: string;
  title: string;
  capturedAt: string;
  text: string;
  readyState?: BrowserObservation["readyState"];
  focusedElementId?: string;
  mutationRevision?: string;
  lastMutationAt?: string;
  mutationQuietMs?: number;
  elements: BrowserElement[];
  previous?: BrowserViewGraph;
  now?: Date;
};

export type BrowserViewElementClassification = {
  nodeKind: NonNullable<BrowserViewGraph["nodes"][number]["kind"]>;
  regionRole: NonNullable<BrowserViewGraph["nodes"][number]["regionRole"]>;
  actionHint: NonNullable<BrowserViewGraph["nodes"][number]["actionHint"]>;
  riskHints: NonNullable<BrowserViewGraph["nodes"][number]["riskHints"]>;
  confidence: number;
  evidence: string[];
};
