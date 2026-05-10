export const BROWSER_ACTION_POLICY_SETTING_KEY = "browser-action.policies.v1";

export {
  applyBrowserActionPolicyToSafety,
  matchBrowserActionPolicy
} from "./permissionPolicy/matching.js";
export {
  normalizeBrowserActionPolicy,
  normalizeOrigin
} from "./permissionPolicy/normalizers.js";
export {
  redactBrowserActionSecret,
  redactSensitiveText
} from "./permissionPolicy/redaction.js";
