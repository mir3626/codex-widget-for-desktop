import type { CaptureSource, Rect, VisionRetentionPolicy } from "./core.js";
import type { ContextEntity } from "./graph.js";

export type IntentKind =
  | "identify_place"
  | "explain_screen"
  | "modify_code"
  | "debug_error"
  | "summarize_content"
  | "compare_items"
  | "rewrite_text"
  | "operate_app"
  | "unknown";

export type ResolvedIntent = {
  kind: IntentKind;
  summary: string;
  confidence: number;
};

export type CapsuleEvidence = {
  kind: "text" | "image" | "crop" | "event" | "semantic";
  title: string;
  path?: string;
  dataUrl?: string;
  text?: string;
  t?: number;
  bbox?: Rect;
  sourceObservationIds: string[];
};

export type CapsuleUncertainty = {
  reason: string;
  severity: "low" | "medium" | "high";
  sourceObservationIds?: string[];
};

export type TaskCapsule = {
  id: string;
  createdAt: string;
  captureSessionId: string;
  userUtterance: string;
  source?: CaptureSource;
  resolvedIntent: ResolvedIntent;
  referents: ContextEntity[];
  alternatives: ContextEntity[];
  actionTarget?: ContextEntity;
  evidence: CapsuleEvidence[];
  uncertainties: CapsuleUncertainty[];
  instructions: string[];
  retention: VisionRetentionPolicy;
};

export type ReferenceResolution = {
  primary?: ContextEntity;
  alternatives: ContextEntity[];
  confidence: number;
  reason: string;
};

export type ClarificationDecision =
  | { action: "none" }
  | { action: "inline_confirmation"; prompt: string; options?: string[] }
  | { action: "agent_can_ask"; reason: string };
