export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BrowserActionMode = "read_only" | "ask_before_action" | "auto_safe_actions" | "full_control_dev";

export type BrowserActionSource = {
  kind: "active_tab" | "tab" | "controlled_browser" | "debug_target";
  browser?: "chrome" | "edge" | "chromium" | "unknown";
  tabId?: string;
  url?: string;
  title?: string;
  windowId?: string;
};

export type BrowserViewport = {
  width: number;
  height: number;
  devicePixelRatio?: number;
  scrollX?: number;
  scrollY?: number;
};

export type BrowserElementRiskHint =
  | "password"
  | "payment"
  | "delete"
  | "submit"
  | "file_upload"
  | "download"
  | "external_navigation"
  | "auth"
  | "unknown_side_effect";

export type BrowserElement = {
  id: string;
  role?: string;
  tagName: string;
  label?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  selector?: string;
  xpath?: string;
  bbox?: Rect;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  checked?: boolean;
  selected?: boolean;
  href?: string;
  inputType?: string;
  confidence: number;
  riskHints: BrowserElementRiskHint[];
};

export type BrowserImageEvidence = {
  path?: string;
  dataUrl?: string;
  title?: string;
};

export type BrowserConsoleSummary = {
  errors: number;
  warnings: number;
  latest?: string;
};

export type BrowserNetworkSummary = {
  inflight?: number;
  failed?: number;
  latestFailure?: string;
};
