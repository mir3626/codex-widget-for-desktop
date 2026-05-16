import type { CapabilityJobSummary } from "../../shared/protocol.js";
import type { CapabilityHandlerOutput } from "./types.js";

export type CapabilityVerificationClass =
  | "read_observation"
  | "ocr_extraction"
  | "browser_bookmark_effect"
  | "browser_chrome_effect"
  | "browser_action_effect"
  | "desktop_effect"
  | "terminal_state"
  | "helper_result"
  | "not_applicable";

export type CapabilityVerificationSummary = {
  status: "passed" | "failed" | "not_applicable";
  class: CapabilityVerificationClass;
  reason: string;
  failureClass?: "perception" | "binding" | "execution" | "effect_mismatch";
  evidence?: Record<string, unknown>;
};

export function verifyCapabilityHandlerOutput(
  job: CapabilityJobSummary,
  result: CapabilityHandlerOutput
): CapabilityVerificationSummary {
  if (result.status === "cancelled") {
    return { status: "not_applicable", class: "not_applicable", reason: "Capability job was cancelled before verification." };
  }
  if (result.error || result.status === "failed") {
    return {
      status: "failed",
      class: classifyCapability(job),
      reason: result.error ?? "Capability handler reported failure.",
      failureClass: readFailureClass(result.output, "execution"),
      evidence: readEvidence(result.output)
    };
  }
  const output = result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {};
  if (job.kind === "screen_observe") {
    return output.ok === false
      ? { status: "failed", class: "read_observation", reason: "Screen observe returned ok=false.", evidence: readEvidence(result.output) }
      : { status: "passed", class: "read_observation", reason: "Fresh screen observation completed.", evidence: readEvidence(result.output) };
  }
  if (job.kind === "ocr") {
    const text = typeof output.text === "string" ? output.text : undefined;
    return output.ok === false
      ? { status: "failed", class: "ocr_extraction", reason: "OCR returned ok=false.", evidence: readEvidence(result.output) }
      : { status: "passed", class: "ocr_extraction", reason: text ? "OCR text extraction completed." : "OCR helper completed.", evidence: readEvidence(result.output) };
  }
  if (job.kind === "browser_chrome") {
    const metadata = output.metadata && typeof output.metadata === "object" ? output.metadata as Record<string, unknown> : {};
    return {
      status: output.ok === false ? "failed" : "passed",
      class: "browser_chrome_effect",
      reason: typeof metadata.verification === "string" ? metadata.verification : "Browser chrome command returned verified output.",
      failureClass: output.ok === false ? readFailureClass(result.output, "effect_mismatch") : undefined,
      evidence: readEvidence(result.output)
    };
  }
  if (job.kind === "browser_action") {
    const verification = output.verification && typeof output.verification === "object" ? output.verification as Record<string, unknown> : undefined;
    return {
      status: verification?.status === "failed" ? "failed" : "passed",
      class: "browser_action_effect",
      reason: typeof verification?.reason === "string" ? verification.reason : "Browser Action result verification completed.",
      failureClass: verification?.status === "failed" ? readBrowserActionFailureClass(verification) : undefined,
      evidence: readEvidence(result.output)
    };
  }
  if (job.kind === "desktop_action") {
    const expectedEffect = readExpectedEffect(job.inputJson);
    if (expectedEffect && !hasExplicitEffectVerification(output)) {
      return {
        status: "failed",
        class: "desktop_effect",
        reason: "Desktop action expected an effect-specific verification result, but the helper did not provide one.",
        failureClass: "effect_mismatch",
        evidence: {
          ...readEvidence(result.output),
          expectedEffect
        }
      };
    }
    return output.ok === false
      ? { status: "failed", class: "desktop_effect", reason: "Desktop helper returned ok=false.", failureClass: readFailureClass(result.output, "execution"), evidence: readEvidence(result.output) }
      : { status: "passed", class: "desktop_effect", reason: "Desktop helper returned bounded action output.", evidence: readEvidence(result.output) };
  }
  if (job.kind === "terminal") {
    return output.ok === false
      ? { status: "failed", class: "terminal_state", reason: "Terminal helper returned ok=false.", failureClass: readFailureClass(result.output, "execution"), evidence: readEvidence(result.output) }
      : { status: "passed", class: "terminal_state", reason: "Terminal helper completed with output.", evidence: readEvidence(result.output) };
  }
  return {
    status: "passed",
    class: "helper_result",
    reason: "Capability helper completed.",
    evidence: readEvidence(result.output)
  };
}

export function attachCapabilityVerification(
  output: unknown,
  verification: CapabilityVerificationSummary
): unknown {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return {
      ...output as Record<string, unknown>,
      capabilityVerification: verification
    };
  }
  return {
    value: output,
    capabilityVerification: verification
  };
}

function classifyCapability(job: CapabilityJobSummary): CapabilityVerificationClass {
  if (job.kind === "screen_observe") return "read_observation";
  if (job.kind === "ocr") return "ocr_extraction";
  if (job.kind === "browser_chrome") return "browser_chrome_effect";
  if (job.kind === "browser_action") return "browser_action_effect";
  if (job.kind === "desktop_action") return "desktop_effect";
  if (job.kind === "terminal") return "terminal_state";
  return "helper_result";
}

function readEvidence(output: unknown): Record<string, unknown> | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : undefined;
  return {
    ok: record.ok,
    metadata,
    outputKeys: Object.keys(record).filter((key) => key !== "metadata").slice(0, 20)
  };
}

function readExpectedEffect(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  return record.expectedEffect ?? record.expectedState ?? record.verificationTarget;
}

function hasExplicitEffectVerification(output: Record<string, unknown>): boolean {
  const verification = output.verification && typeof output.verification === "object" ? output.verification as Record<string, unknown> : undefined;
  const metadata = output.metadata && typeof output.metadata === "object" ? output.metadata as Record<string, unknown> : undefined;
  return verification?.status === "passed" ||
    metadata?.verification === "effect_verified" ||
    metadata?.effectVerified === true;
}

function readFailureClass(output: unknown, fallback: NonNullable<CapabilityVerificationSummary["failureClass"]>): NonNullable<CapabilityVerificationSummary["failureClass"]> {
  if (!output || typeof output !== "object") {
    return fallback;
  }
  const record = output as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : undefined;
  const value = metadata?.failureClass ?? record.failureClass;
  return value === "perception" || value === "binding" || value === "execution" || value === "effect_mismatch"
    ? value
    : fallback;
}

function readBrowserActionFailureClass(verification: Record<string, unknown>): NonNullable<CapabilityVerificationSummary["failureClass"]> {
  const reason = String(verification.reason ?? "").toLowerCase();
  if (/stale|source|target|bind|mismatch/.test(reason)) {
    return "binding";
  }
  if (/observe|perception|snapshot|context/.test(reason)) {
    return "perception";
  }
  if (/effect|verify|expected|state/.test(reason)) {
    return "effect_mismatch";
  }
  return "execution";
}
