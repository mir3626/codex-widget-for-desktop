export type SemanticEvidenceSource =
  | "dom"
  | "accessibility"
  | "visual"
  | "ocr"
  | "transcript"
  | "terminal"
  | "workspace"
  | "action_result"
  | "memory";

export type SemanticSurfaceKind =
  | "browser_page"
  | "terminal"
  | "desktop_screen"
  | "app_window"
  | "workspace"
  | "media_stream";

export type SemanticEntityKind =
  | "surface"
  | "region"
  | "control"
  | "content_item"
  | "media"
  | "selection"
  | "process";

export type SemanticAffordance =
  | "read"
  | "locate"
  | "activate"
  | "filter"
  | "navigate"
  | "type"
  | "submit";

export type SemanticRelationType =
  | "contains"
  | "labels"
  | "inside"
  | "controls"
  | "same_group"
  | "filters"
  | "submits"
  | "navigates_to"
  | "item_of"
  | "selected"
  | "focused";

export type SemanticTier1Role = "observe" | "locate" | "act";

export type SemanticTier1Risk =
  | "read_only"
  | "local_navigation"
  | "external_navigation"
  | "input_non_submitting"
  | "state_change"
  | "submit_or_publish"
  | "destructive"
  | "credential_or_payment"
  | "code_execution"
  | "data_exfiltration";

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BasisPoints = number;
