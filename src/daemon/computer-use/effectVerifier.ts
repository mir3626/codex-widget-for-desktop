import type {
  CapabilityJobKind,
  CapabilityJobSummary,
  ComputerStructuredOperation,
  ComputerUseFailureClass
} from "../../shared/protocol.js";

export type ComputerSessionEffectVerification = {
  id?: string;
  status: "passed" | "failed" | "inconclusive";
  class:
    | "capability_verification"
    | "terminal_expected_output"
    | "browser_action_effect"
    | "desktop_effect"
    | "not_applicable";
  reason: string;
  capabilityJobId?: string;
  capabilityKind?: CapabilityJobKind;
  failureClass?: ComputerUseFailureClass;
  evidence?: Record<string, unknown>;
  recovery?: {
    attempted: boolean;
    reason: string;
    budgetRemaining: number;
    hints: string[];
  };
};

export function verifyComputerSessionEffect(input: {
  operation: ComputerStructuredOperation;
  capabilityKind: CapabilityJobKind;
  job: CapabilityJobSummary;
  recoveryBudgetRemaining: number;
}): ComputerSessionEffectVerification {
  const output = readRecord(input.job.outputJson);
  const expected = readExpected(input.operation, input.job.inputJson);
  const capabilityVerification = readCapabilityVerification(output);
  const textExpectation = verifyTextExpectedOutput({
    expected,
    output
  });
  if (textExpectation) {
    return withRecovery({
      ...textExpectation,
      capabilityJobId: input.job.id,
      capabilityKind: input.capabilityKind
    }, input.recoveryBudgetRemaining);
  }
  const terminalExpectation = verifyTerminalExpectedOutput({
    capabilityKind: input.capabilityKind,
    expected,
    output
  });
  if (terminalExpectation) {
    return withRecovery({
      ...terminalExpectation,
      capabilityJobId: input.job.id,
      capabilityKind: input.capabilityKind
    }, input.recoveryBudgetRemaining);
  }
  if (expected && capabilityVerification && readVerificationStatus(capabilityVerification) !== "failed" && !capabilityVerificationAddressesExpected({
    output,
    verification: capabilityVerification,
    expected
  })) {
    return withRecovery({
      status: "inconclusive",
      class: input.capabilityKind === "desktop_action" ? "desktop_effect" : "capability_verification",
      reason: "The operation declared an expected outcome, but no explicit verifier proof was attached.",
      capabilityJobId: input.job.id,
      capabilityKind: input.capabilityKind,
      failureClass: "verification_false_negative",
      evidence: {
        expected,
        capabilityVerificationStatus: readVerificationStatus(capabilityVerification),
        capabilityVerificationClass: readString(capabilityVerification.class)
      }
    }, input.recoveryBudgetRemaining);
  }
  if (capabilityVerification) {
    const status = capabilityVerification.status === "passed"
      ? "passed"
      : capabilityVerification.status === "failed"
        ? "failed"
        : "inconclusive";
    return withRecovery({
      status,
      class: readVerificationClass(capabilityVerification, input.capabilityKind),
      reason: readString(capabilityVerification.reason) ?? (status === "passed" ? "Capability verifier passed." : "Capability verifier did not prove success."),
      capabilityJobId: input.job.id,
      capabilityKind: input.capabilityKind,
      failureClass: status === "passed" ? "none" : mapFailureClass(capabilityVerification.failureClass, status),
      evidence: readRecord(capabilityVerification.evidence)
    }, input.recoveryBudgetRemaining);
  }
  if (expected) {
    return withRecovery({
      status: "inconclusive",
      class: input.capabilityKind === "desktop_action" ? "desktop_effect" : "capability_verification",
      reason: "The operation declared an expected outcome, but no explicit verifier proof was attached.",
      capabilityJobId: input.job.id,
      capabilityKind: input.capabilityKind,
      failureClass: "verification_false_negative",
      evidence: {
        expected
      }
    }, input.recoveryBudgetRemaining);
  }
  return {
    status: "passed",
    class: "not_applicable",
    reason: "No explicit expected outcome was declared; accepted capability runtime verification boundary.",
    capabilityJobId: input.job.id,
    capabilityKind: input.capabilityKind,
    failureClass: "none",
    evidence: {
      outputKeys: Object.keys(output).slice(0, 20)
    }
  };
}

function verifyTextExpectedOutput(input: {
  expected?: string;
  output: Record<string, unknown>;
}): ComputerSessionEffectVerification | null {
  if (!input.expected) {
    return null;
  }
  const match = /^text\s+contains\s+(.+)$/i.exec(input.expected.trim());
  if (!match) {
    return null;
  }
  const needle = match[1]?.trim() ?? "";
  const text = readNestedString(input.output, ["text"]) ??
    readNestedString(input.output, ["output", "text"]) ??
    "";
  const passed = needle.length > 0 && text.includes(needle);
  return {
    status: passed ? "passed" : "failed",
    class: "capability_verification",
    reason: passed
      ? `Output text contained expected text: ${needle}`
      : `Output text did not contain expected text: ${needle}`,
    failureClass: passed ? "none" : "verification_false_negative",
    evidence: {
      expectedTextContains: needle,
      textLength: text.length
    }
  };
}

function verifyTerminalExpectedOutput(input: {
  capabilityKind: CapabilityJobKind;
  expected?: string;
  output: Record<string, unknown>;
}): ComputerSessionEffectVerification | null {
  if (input.capabilityKind !== "terminal" || !input.expected) {
    return null;
  }
  const match = /^stdout\s+contains\s+(.+)$/i.exec(input.expected.trim());
  if (!match) {
    return null;
  }
  const needle = match[1]?.trim() ?? "";
  const stdout = readNestedString(input.output, ["stdout"]) ?? readNestedString(input.output, ["output", "stdout"]) ?? "";
  const passed = needle.length > 0 && stdout.includes(needle);
  return {
    status: passed ? "passed" : "failed",
    class: "terminal_expected_output",
    reason: passed
      ? `Terminal stdout contained expected text: ${needle}`
      : `Terminal stdout did not contain expected text: ${needle}`,
    failureClass: passed ? "none" : "verification_false_negative",
    evidence: {
      expectedStdoutContains: needle,
      stdoutLength: stdout.length
    }
  };
}

function withRecovery(
  verification: ComputerSessionEffectVerification,
  recoveryBudgetRemaining: number
): ComputerSessionEffectVerification {
  if (verification.status === "passed") {
    return verification;
  }
  return {
    ...verification,
    recovery: {
      attempted: recoveryBudgetRemaining > 0,
      reason: recoveryBudgetRemaining > 0 ? "verification_failed_recovery_budget_reserved" : "recovery_budget_exhausted",
      budgetRemaining: Math.max(0, recoveryBudgetRemaining),
      hints: recoveryHintsForFailure(verification.failureClass)
    }
  };
}

function recoveryHintsForFailure(failureClass: ComputerUseFailureClass | undefined): string[] {
  if (failureClass === "verification_false_negative" || failureClass === "verification_false_positive") {
    return ["reobserve_current_surface", "compare_expected_effect", "request_clarification_if_effect_remains_inconclusive"];
  }
  if (failureClass === "ambiguous_target" || failureClass === "perception_miss") {
    return ["refresh_perception_graph", "raise_evidence_threshold", "ask_target_clarification"];
  }
  return ["record_failure_memory", "do_not_mark_task_success_without_fresh_proof"];
}

function readExpected(operation: ComputerStructuredOperation, jobInput: unknown): string | undefined {
  const operationInput = "input" in operation ? operation.input : {};
  const action = "action" in operation ? operation.action : undefined;
  return readStringField(operationInput, "expectedOutcome") ??
    readStringField(operationInput, "expectedEffect") ??
    readStringField(operationInput, "expectedState") ??
    readStringField(operationInput, "verificationTarget") ??
    readStringField(action, "expectedOutcome") ??
    readStringField(jobInput, "expectedOutcome") ??
    readStringField(jobInput, "expectedEffect") ??
    readStringField(jobInput, "expectedState") ??
    readStringField(jobInput, "verificationTarget");
}

function readCapabilityVerification(output: Record<string, unknown>): Record<string, unknown> | null {
  const capabilityVerification = output.capabilityVerification;
  if (capabilityVerification && typeof capabilityVerification === "object" && !Array.isArray(capabilityVerification)) {
    return capabilityVerification as Record<string, unknown>;
  }
  const verification = output.verification;
  return verification && typeof verification === "object" && !Array.isArray(verification)
    ? verification as Record<string, unknown>
    : null;
}

function capabilityVerificationAddressesExpected(input: {
  output: Record<string, unknown>;
  verification: Record<string, unknown>;
  expected: string;
}): boolean {
  if (hasExplicitEffectVerification(input.output)) {
    return true;
  }
  const needle = input.expected.toLowerCase();
  if (!needle) {
    return false;
  }
  return JSON.stringify(input.output).toLowerCase().includes(needle);
}

function hasExplicitEffectVerification(output: Record<string, unknown>): boolean {
  const verification = readRecord(output.verification);
  const metadata = readRecord(output.metadata);
  return verification.status === "passed" ||
    metadata.verification === "effect_verified" ||
    metadata.effectVerified === true;
}

function readVerificationStatus(verification: Record<string, unknown>): "passed" | "failed" | "inconclusive" | undefined {
  if (verification.status === "passed" || verification.status === "failed" || verification.status === "inconclusive") {
    return verification.status;
  }
  return undefined;
}

function readVerificationClass(verification: Record<string, unknown>, capabilityKind: CapabilityJobKind): ComputerSessionEffectVerification["class"] {
  const value = readString(verification.class);
  if (value === "browser_action_effect") return "browser_action_effect";
  if (value === "desktop_effect") return "desktop_effect";
  if (capabilityKind === "browser_action") return "browser_action_effect";
  if (capabilityKind === "desktop_action") return "desktop_effect";
  return "capability_verification";
}

function mapFailureClass(value: unknown, status: "failed" | "inconclusive"): ComputerUseFailureClass {
  if (value === "perception") return "perception_miss";
  if (value === "binding") return "ambiguous_target";
  if (value === "effect_mismatch") return "verification_false_negative";
  if (value === "execution") return "action_failed";
  return status === "inconclusive" ? "verification_false_negative" : "action_failed";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringField(value: unknown, key: string): string | undefined {
  return readString(readRecord(value)[key]);
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const part of path) {
    current = readRecord(current)[part];
  }
  return readString(current);
}
