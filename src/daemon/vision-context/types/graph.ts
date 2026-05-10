import type { Rect } from "./core.js";

export type Observation = {
  id: string;
  t: number;
  source: "screen" | "ocr" | "browser" | "terminal" | "ide" | "document" | "accessibility" | "pointer" | "speech";
  app?: string;
  kind:
    | "image"
    | "text"
    | "ui_element"
    | "file"
    | "command"
    | "error"
    | "selection"
    | "media"
    | "page"
    | "window"
    | "gesture";
  label?: string;
  text?: string;
  bbox?: Rect;
  path?: string;
  dataUrl?: string;
  metadata?: Record<string, unknown>;
  confidence: number;
};

export type ContextEntity = {
  id: string;
  name?: string;
  role: "referent" | "target" | "evidence" | "source_context" | "action_target" | "alternative";
  observations: string[];
  salience: number;
  confidence: number;
};

export type ContextEdge = {
  from: string;
  to: string;
  relation:
    | "near"
    | "contains"
    | "points_to"
    | "spoken_about"
    | "before"
    | "after"
    | "same_app"
    | "same_window"
    | "candidate_for";
  confidence: number;
};

export type EvidenceGraph = {
  sessionId: string;
  observations: Observation[];
  entities: ContextEntity[];
  edges: ContextEdge[];
};
