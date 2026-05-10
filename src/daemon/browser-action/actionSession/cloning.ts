import type {
  BrowserActionPlan,
  BrowserActionResult,
  BrowserActionSession
} from "../types.js";

export function cloneSession(session: BrowserActionSession): BrowserActionSession {
  return JSON.parse(JSON.stringify(session)) as BrowserActionSession;
}

export function cloneResult(result: BrowserActionResult): BrowserActionResult {
  return JSON.parse(JSON.stringify(result)) as BrowserActionResult;
}

export function clonePlan(plan: BrowserActionPlan): BrowserActionPlan {
  return JSON.parse(JSON.stringify(plan)) as BrowserActionPlan;
}
