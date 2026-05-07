import type { VisionContextAdapter } from "../types.js";

function unavailableAdapter(id: string, label: string): VisionContextAdapter {
  return {
    id,
    label,
    async isAvailable() {
      return false;
    },
    async collect() {
      return [];
    }
  };
}

export const ideAdapter = unavailableAdapter("ide", "IDE");
export const documentAdapter = unavailableAdapter("document", "Document");
export const accessibilityAdapter = unavailableAdapter("accessibility", "Accessibility");
