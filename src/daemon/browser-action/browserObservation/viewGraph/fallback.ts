import type {
  BrowserActionSource,
  BrowserElement,
  BrowserObservation,
  BrowserViewGraph
} from "../../types.js";
import { buildBrowserViewGraphV2 } from "../../../browser-perception/view-graph/index.js";

export function buildFallbackViewGraph(input: {
  source: Partial<BrowserActionSource>;
  url: string;
  title: string;
  capturedAt: string;
  readyState?: BrowserObservation["readyState"];
  focusedElementId?: string;
  mutationRevision?: string;
  lastMutationAt?: string;
  mutationQuietMs?: number;
  text: string;
  elements: BrowserElement[];
  now?: Date;
}): BrowserViewGraph {
  return buildBrowserViewGraphV2(input);
}
