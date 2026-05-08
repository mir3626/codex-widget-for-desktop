import type { BrowserElement, BrowserElementRiskHint, BrowserObservation } from "../../browser-action/types.js";
import { compactSemanticText, hashSemanticParts, normalizeSemanticText, uniqueStrings } from "../ontology.js";
import { DEFAULT_SEMANTIC_CAPABILITIES } from "../observation.js";
import type {
  SemanticAffordance,
  SemanticEntity,
  SemanticEntityKind,
  SemanticEvidence,
  SemanticObservationAdapter,
  SemanticRelation,
  SemanticSnapshot,
  SemanticTier1Risk
} from "../types.js";

export const browserActionSemanticAdapter: SemanticObservationAdapter<BrowserObservation> = {
  id: "browser-action",
  surfaceKinds: ["browser_page"],
  capabilities() {
    return {
      ...DEFAULT_SEMANTIC_CAPABILITIES,
      execute: true,
      snapshotImmutable: false,
      supportsDomLocator: true
    };
  },
  toSnapshot(input) {
    return browserObservationToSemanticSnapshot(input);
  }
};

export function browserObservationToSemanticSnapshot(input: {
  observation: BrowserObservation;
  previousSnapshotId?: string;
  previousActionResultId?: string;
  now?: Date;
}): SemanticSnapshot {
  const observation = input.observation;
  const createdAt = input.now?.toISOString() ?? observation.capturedAt;
  const snapshotId = `sem-browser-${hashSemanticParts([observation.id, observation.url, observation.title, observation.elements.length])}`;
  const surfaceId = `surface-${hashSemanticParts([observation.url, observation.title])}`;
  const evidence: SemanticEvidence[] = [];
  const entities: SemanticEntity[] = [
    {
      id: surfaceId,
      kind: "surface",
      surfaceId,
      label: observation.title || observation.url || "Browser page",
      normalizedLabel: normalizeSemanticText(observation.title || observation.url),
      affordances: ["read", "locate"],
      evidenceIds: [],
      tier1: { role: "observe", risk: "read_only" },
      state: { visible: true }
    }
  ];
  const relations: SemanticRelation[] = [];

  for (const element of observation.elements) {
    const evidenceId = `evidence-${element.id}`;
    const sensitive = isSensitiveElement(element);
    const label = sensitive ? "[redacted field]" : readElementLabel(element);
    evidence.push({
      id: evidenceId,
      snapshotId,
      adapterId: browserActionSemanticAdapter.id,
      source: "dom",
      observedAt: observation.capturedAt,
      confidence: element.confidence,
      locator: {
        selector: element.selector,
        xpath: element.xpath,
        role: element.role,
        name: label,
        bbox: element.bbox,
        opaque: { browserElementId: element.id }
      },
      value: {
        text: element.text,
        role: element.role,
        label,
        state: {
          visible: element.visible,
          enabled: element.enabled,
          editable: element.editable,
          selected: element.selected,
          checked: element.checked
        },
        attributes: buildElementAttributes(element)
      },
      redaction: sensitive
        ? { redacted: true, reason: "credential-like browser element" }
        : undefined
    });
    entities.push({
      id: `entity-${element.id}`,
      kind: inferEntityKind(element),
      surfaceId,
      label,
      normalizedLabel: normalizeSemanticText(label),
      description: `${element.role || element.tagName} ${label}`.trim(),
      affordances: inferAffordances(element),
      evidenceIds: [evidenceId],
      state: {
        selected: element.selected,
        focused: observation.focusedElementId === element.id,
        disabled: !element.enabled,
        visible: element.visible
      },
      tier1: {
        role: inferTier1Role(element),
        risk: inferTier1Risk(element)
      },
      tier2: {
        browserElementId: element.id,
        role: element.role ?? "",
        tagName: element.tagName,
        redacted: sensitive ? "true" : "false"
      }
    });
    relations.push({
      from: surfaceId,
      to: `entity-${element.id}`,
      type: "contains",
      confidence: 0.9,
      evidenceIds: [evidenceId]
    });
    if (observation.focusedElementId === element.id) {
      relations.push({
        from: surfaceId,
        to: `entity-${element.id}`,
        type: "focused",
        confidence: 0.95,
        evidenceIds: [evidenceId]
      });
    }
  }

  return {
    id: snapshotId,
    createdAt,
    surface: {
      id: surfaceId,
      kind: "browser_page",
      title: observation.title,
      url: observation.url,
      adapterId: browserActionSemanticAdapter.id
    },
    capabilities: browserActionSemanticAdapter.capabilities(observation),
    evidence,
    entities,
    relations,
    provenance: {
      rawObservationId: observation.id,
      previousSnapshotId: input.previousSnapshotId,
      previousActionResultId: input.previousActionResultId
    }
  };
}

export function readElementLabel(element: BrowserElement): string {
  return element.label || element.ariaLabel || element.placeholder || element.text || element.title || element.value || element.href || element.id;
}

function buildElementAttributes(element: BrowserElement): Record<string, string> {
  if (isSensitiveElement(element)) {
    return Object.fromEntries(Object.entries({
      tagName: element.tagName,
      inputType: element.inputType,
      compactLabel: "redacted-field"
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
  }
  return Object.fromEntries(Object.entries({
    tagName: element.tagName,
    href: element.href,
    inputType: element.inputType,
    selector: element.selector,
    compactLabel: compactSemanticText(readElementLabel(element))
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

function isSensitiveElement(element: BrowserElement): boolean {
  return element.inputType === "password" || element.riskHints.includes("password") || element.riskHints.includes("payment");
}

function inferEntityKind(element: BrowserElement): SemanticEntityKind {
  if (element.editable || isControlRole(element.role) || isControlTag(element.tagName)) {
    return "control";
  }
  if (element.href || element.role === "link") {
    return "content_item";
  }
  return element.visible ? "content_item" : "region";
}

function inferAffordances(element: BrowserElement): SemanticAffordance[] {
  const affordances: SemanticAffordance[] = ["read", "locate"];
  if (element.enabled && element.visible) {
    if (element.editable) affordances.push("type");
    if (element.href || element.role === "link") affordances.push("navigate", "activate");
    if (isControlRole(element.role) || isControlTag(element.tagName)) affordances.push("activate");
    if (isFilterLike(element)) affordances.push("filter");
    if (element.riskHints.includes("submit")) affordances.push("submit");
  }
  return uniqueStrings(affordances) as SemanticAffordance[];
}

function inferTier1Role(element: BrowserElement): "observe" | "locate" | "act" {
  return inferAffordances(element).some((affordance) => !["read", "locate"].includes(affordance)) ? "act" : "locate";
}

function inferTier1Risk(element: BrowserElement): SemanticTier1Risk {
  if (element.riskHints.includes("password") || element.riskHints.includes("payment")) return "credential_or_payment";
  if (element.riskHints.includes("delete")) return "destructive";
  if (element.riskHints.includes("submit") || element.riskHints.includes("file_upload")) return "submit_or_publish";
  if (element.riskHints.includes("download")) return "data_exfiltration";
  if (element.editable) return "input_non_submitting";
  if (element.href) return isExternalHref(element.href) ? "external_navigation" : "local_navigation";
  if (isControlRole(element.role) || isControlTag(element.tagName)) return "state_change";
  return "read_only";
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function isControlRole(role: string | undefined): boolean {
  return ["button", "tab", "switch", "checkbox", "radio", "combobox", "option", "menuitem", "textbox", "searchbox"].includes(role ?? "");
}

function isControlTag(tagName: string): boolean {
  return ["button", "input", "select", "textarea", "option", "summary", "label"].includes(tagName);
}

function isFilterLike(element: BrowserElement): boolean {
  const text = normalizeSemanticText(readElementLabel(element));
  return element.role === "tab" || /filter|필터|카테고리|category|추천|인기/.test(text);
}
