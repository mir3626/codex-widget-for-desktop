import type { Observation } from "./graph.js";
import type { VisionCaptureSession } from "./session.js";

export type BuildTaskCapsuleInput = {
  captureSession: VisionCaptureSession;
  observations?: Observation[];
  now?: Date;
};
