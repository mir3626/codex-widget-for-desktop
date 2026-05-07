import { browserAdapter } from "./browserAdapter.js";
import { accessibilityAdapter, documentAdapter, ideAdapter } from "./placeholderAdapters.js";
import { screenAdapter } from "./screenAdapter.js";
import { terminalAdapter } from "./terminalAdapter.js";
import type { AdapterCollectInput, Observation, VisionContextAdapter } from "../types.js";

export const builtInVisionContextAdapters: VisionContextAdapter[] = [
  screenAdapter,
  browserAdapter,
  terminalAdapter,
  ideAdapter,
  documentAdapter,
  accessibilityAdapter
];

export async function collectAdapterObservations(
  input: AdapterCollectInput,
  adapters: VisionContextAdapter[] = builtInVisionContextAdapters
): Promise<Observation[]> {
  const collected: Observation[] = [];
  for (const adapter of adapters) {
    if (!(await adapter.isAvailable({ captureSession: input.captureSession, activeSource: input.activeSource }))) {
      continue;
    }
    collected.push(...await adapter.collect(input));
  }
  return collected;
}

export {
  accessibilityAdapter,
  browserAdapter,
  documentAdapter,
  ideAdapter,
  screenAdapter,
  terminalAdapter
};
