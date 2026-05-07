import type { BrowserElement, BrowserElementGroup, ElementGraph } from "./types.js";

export function buildElementGraph(input: { observationId: string; focusedElementId?: string; elements: BrowserElement[] }): ElementGraph {
  const groups = buildGroups(input.elements);
  return {
    observationId: input.observationId,
    focusedElementId: input.focusedElementId,
    elements: input.elements,
    groups,
    edges: [
      ...groups.flatMap((group) => group.elementIds.map((elementId) => ({
        from: group.id,
        to: elementId,
        relation: "contains" as const,
        confidence: 0.74
      }))),
      ...buildLabelEdges(input.elements)
    ]
  };
}

function buildGroups(elements: BrowserElement[]): BrowserElementGroup[] {
  const formLike = elements.filter((element) => element.editable || element.riskHints.includes("submit"));
  const navigation = elements.filter((element) => element.role === "link" || element.href);
  const risky = elements.filter((element) => element.riskHints.length > 0);
  return [
    formLike.length > 0 ? { id: "group-form-controls", label: "Form controls", elementIds: formLike.map((element) => element.id), riskHints: uniqueRiskHints(formLike) } : undefined,
    navigation.length > 0 ? { id: "group-navigation", label: "Navigation", elementIds: navigation.map((element) => element.id), riskHints: uniqueRiskHints(navigation) } : undefined,
    risky.length > 0 ? { id: "group-risky", label: "Risky controls", elementIds: risky.map((element) => element.id), riskHints: uniqueRiskHints(risky) } : undefined
  ].filter((group): group is BrowserElementGroup => Boolean(group));
}

function buildLabelEdges(elements: BrowserElement[]): ElementGraph["edges"] {
  const labels = elements.filter((element) => element.tagName === "label" || element.role === "label");
  const controls = elements.filter((element) => element.editable);
  const edges: ElementGraph["edges"] = [];
  for (const label of labels) {
    const labelText = clean(label.text || label.label);
    if (!labelText) {
      continue;
    }
    const target = controls.find((control) => clean(control.label || control.placeholder).includes(labelText) || labelText.includes(clean(control.label || control.placeholder)));
    if (target) {
      edges.push({ from: label.id, to: target.id, relation: "labels", confidence: 0.7 });
    }
  }
  return edges;
}

function uniqueRiskHints(elements: BrowserElement[]): BrowserElementGroup["riskHints"] {
  return [...new Set(elements.flatMap((element) => element.riskHints))];
}

function clean(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
