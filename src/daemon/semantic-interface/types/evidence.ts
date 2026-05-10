import type { BasisPoints } from "./core.js";
import type { MemoryContributionEvidence } from "./memory.js";

export type AxisEvidenceStatus =
  | "present"
  | "missing"
  | "conflict"
  | "stale"
  | "unsupported"
  | "redacted";

export interface AxisEvidence {
  scoreBp: BasisPoints;
  status: AxisEvidenceStatus;
  evidenceIds: string[];
  reasonCodes: string[];
}

export interface ActionabilityEvidence {
  visible: AxisEvidence;
  enabled: AxisEvidence;
  stable: AxisEvidence;
  inViewport: AxisEvidence;
  occlusion: AxisEvidence;
  adapterCapability: AxisEvidence;
  revalidation: AxisEvidence;
}

export interface CandidateEvidencePacket {
  lexical: AxisEvidence;
  alias: AxisEvidence;
  affordance: AxisEvidence;
  role: AxisEvidence;
  entityKind: AxisEvidence;
  region: AxisEvidence;
  graphRelation: AxisEvidence;
  viewFreshness: AxisEvidence;
  focus: AxisEvidence;
  actionability: ActionabilityEvidence;
  memory?: MemoryContributionEvidence;
  risk: AxisEvidence;
  ambiguity: AxisEvidence;
}

export type DeterministicFeatures = CandidateEvidencePacket;

export interface AdapterCapabilities {
  observe: boolean;
  locate: boolean;
  execute: boolean;
  shadowProbe: boolean;
  dryRun: boolean;
  snapshotImmutable: boolean;
  revalidateBeforeExecute: boolean;
  supportsVisionOnly?: boolean;
  supportsDomLocator?: boolean;
  supportsOcrLocator?: boolean;
}
