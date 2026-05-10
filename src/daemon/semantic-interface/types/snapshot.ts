import type {
  Rect,
  SemanticAffordance,
  SemanticEntityKind,
  SemanticEvidenceSource,
  SemanticRelationType,
  SemanticSurfaceKind,
  SemanticTier1Risk,
  SemanticTier1Role
} from "./core.js";
import type { AdapterCapabilities } from "./evidence.js";

export interface SemanticEvidence {
  id: string;
  snapshotId: string;
  adapterId: string;
  source: SemanticEvidenceSource;
  observedAt: string;
  confidence: number;
  locator?: {
    selector?: string;
    xpath?: string;
    role?: string;
    name?: string;
    bbox?: Rect;
    textRange?: { start: number; end: number };
    path?: string;
    processId?: number;
    opaque?: Record<string, unknown>;
  };
  value?: {
    text?: string;
    role?: string;
    label?: string;
    state?: Record<string, unknown>;
    attributes?: Record<string, string>;
  };
  redaction?: {
    redacted: boolean;
    reason?: string;
  };
}

export interface SemanticSnapshot {
  id: string;
  createdAt: string;
  surface: {
    id: string;
    kind: SemanticSurfaceKind;
    title?: string;
    url?: string;
    adapterId: string;
    viewIdentityHash?: string;
  };
  capabilities: AdapterCapabilities;
  evidence: SemanticEvidence[];
  entities: SemanticEntity[];
  relations: SemanticRelation[];
  provenance: {
    rawObservationId?: string;
    previousSnapshotId?: string;
    previousActionResultId?: string;
  };
}

export interface SemanticEntity {
  id: string;
  kind: SemanticEntityKind;
  surfaceId: string;
  label?: string;
  normalizedLabel?: string;
  description?: string;
  affordances: SemanticAffordance[];
  evidenceIds: string[];
  state?: {
    selected?: boolean;
    focused?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    visible?: boolean;
  };
  tier1?: {
    role?: SemanticTier1Role;
    risk?: SemanticTier1Risk;
  };
  tier2?: Record<string, string>;
}

export interface SemanticRelation {
  from: string;
  to: string;
  type: SemanticRelationType;
  confidence: number;
  evidenceIds: string[];
}
