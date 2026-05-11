import type { CapabilityKind } from "./types.js";

export type SurfaceControlStage =
  | "observe"
  | "understand"
  | "propose"
  | "gate"
  | "bind"
  | "act"
  | "verify"
  | "remember";

export type SurfaceControlCapability = {
  capability: CapabilityKind;
  surface: "browser_page" | "screen" | "terminal" | "workspace" | "desktop";
  canObserve: boolean;
  canAct: boolean;
  requiresPreparedContext: boolean;
  supportsExpectedEffectVerification: boolean;
};

export const SURFACE_CONTROL_STAGES: SurfaceControlStage[] = [
  "observe",
  "understand",
  "propose",
  "gate",
  "bind",
  "act",
  "verify",
  "remember"
];

