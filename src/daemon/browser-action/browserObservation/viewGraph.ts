import type {
  BrowserElement,
  BrowserObservation,
  BrowserViewGraph
} from "../types.js";
import { readRecord } from "./utils.js";
import { buildFallbackViewGraph } from "./viewGraph/fallback.js";
import { normalizeProvidedViewGraph } from "./viewGraph/provided.js";

export function normalizeViewGraph(
  value: unknown,
  fallback: {
    source: Partial<BrowserObservation["source"]>;
    url: string;
    title: string;
    capturedAt: string;
    readyState?: BrowserObservation["readyState"];
    focusedElementId?: string;
    text: string;
    elements: BrowserElement[];
    now?: Date;
  }
): BrowserViewGraph {
  const record = readRecord(value);
  if (record && Array.isArray(record.nodes) && Array.isArray(record.edges)) {
    return normalizeProvidedViewGraph(record, fallback);
  }
  return buildFallbackViewGraph(fallback);
}
