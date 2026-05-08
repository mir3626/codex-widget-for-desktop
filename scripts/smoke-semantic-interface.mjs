import {
  assertSelectedEntity,
  assertSemanticOutcomeKind,
  createBrowserSemanticFixture,
  createVisionSemanticFixture,
  redactTraceRecord,
  replaySemanticDecision,
  resolveBrowserActionTargetSemantically,
  runSemanticGoldenTraceSuite,
  traceContainsSecretLikeText
} from "../dist/daemon/semantic-interface/index.js";
import { BrowserActionSessionManager } from "../dist/daemon/browser-action/index.js";

const fixedNow = new Date("2026-05-08T00:00:05.000Z");

verifyKoreanConceptTarget();
verifyDuplicateLabelAbstention();
verifyStaleWarningAndRedaction();
verifyDeterministicReplay();
await verifyBrowserActionLiveGateUsesSemanticResolution();
verifyVisionReadLocateConformance();
verifyGoldenTraceSuite();

console.log("semantic interface smoke ok");

function verifyKoreanConceptTarget() {
  const fixture = createBrowserSemanticFixture();
  const outcome = replaySemanticDecision({ snapshot: fixture.snapshot, intent: fixture.intent, now: fixedNow });
  assertSemanticOutcomeKind(outcome, "act", "Korean concept target");
  assertSelectedEntity(outcome, "entity-concept-posts", "Korean concept target");
  const rejected = outcome.trace.ranked.find((item) => item.hypothesisId.includes("concept-sidebar"));
  if (rejected?.selected) {
    throw new Error("Partial sidebar concept link should not be selected");
  }
}

function verifyDuplicateLabelAbstention() {
  const fixture = createBrowserSemanticFixture({ duplicateLabels: true });
  const outcome = replaySemanticDecision({ snapshot: fixture.snapshot, intent: fixture.intent, now: fixedNow });
  assertSemanticOutcomeKind(outcome, "abstain", "duplicate label should abstain");
  if (!outcome.reasons.some((reason) => reason.includes("top margin") || reason.includes("unique"))) {
    throw new Error(`Duplicate label abstention should explain margin/uniqueness: ${JSON.stringify(outcome.reasons)}`);
  }
}

function verifyStaleWarningAndRedaction() {
  const fixture = createBrowserSemanticFixture({
    capturedAt: "2026-05-07T23:59:00.000Z",
    includePassword: true
  });
  const outcome = replaySemanticDecision({ snapshot: fixture.snapshot, intent: fixture.intent, now: fixedNow });
  const redacted = redactTraceRecord({
    trace: outcome.trace,
    outcome: outcome.kind === "abstain" ? "abstained" : outcome.kind === "confirm" ? "confirm_required" : outcome.kind === "block" ? "blocked" : "selected",
    selectedHypothesisId: outcome.kind === "act" || outcome.kind === "confirm" ? outcome.hypothesis.id : undefined
  });
  if (!redacted.warnings.some((warning) => warning.kind === "snapshot_stale")) {
    throw new Error(`Expected stale snapshot warning: ${JSON.stringify(redacted.warnings)}`);
  }
  if (!redacted.warnings.some((warning) => warning.kind === "redacted_evidence")) {
    throw new Error(`Expected redacted evidence warning: ${JSON.stringify(redacted.warnings)}`);
  }
  if (traceContainsSecretLikeText(redacted)) {
    throw new Error(`Redacted trace contains secret-like text: ${JSON.stringify(redacted)}`);
  }
}

function verifyDeterministicReplay() {
  const fixture = createBrowserSemanticFixture();
  const first = replaySemanticDecision({ snapshot: fixture.snapshot, intent: fixture.intent, now: fixedNow });
  const second = replaySemanticDecision({ snapshot: fixture.snapshot, intent: fixture.intent, now: fixedNow });
  if (JSON.stringify(first.trace.ranked) !== JSON.stringify(second.trace.ranked)) {
    throw new Error("Replay ranked output should be deterministic");
  }
  if (first.kind !== second.kind) {
    throw new Error(`Replay outcome should be deterministic: ${first.kind} vs ${second.kind}`);
  }
}

async function verifyBrowserActionLiveGateUsesSemanticResolution() {
  const fixture = createBrowserSemanticFixture();
  const semantic = resolveBrowserActionTargetSemantically({
    observation: fixture.observation,
    action: { type: "click", target: { kind: "text", text: "개념글" } },
    target: { kind: "text", text: "개념글" },
    hint: "개념글"
  });
  if (semantic.primary?.id !== "concept-posts" || semantic.confidence < 0.75) {
    throw new Error(`Semantic Browser Action resolver should select concept-posts: ${JSON.stringify(semantic)}`);
  }

  const manager = new BrowserActionSessionManager();
  const session = manager.start({ id: "semantic-live-gate-smoke", mode: "auto_safe_actions" });
  manager.observe({ actionSessionId: session.id, snapshot: fixture.observation, now: fixedNow });
  const execution = await manager.execute({
    actionSessionId: session.id,
    action: { type: "click", target: { kind: "text", text: "개념글" } },
    snapshot: fixture.observation
  });
  if (execution.result.status === "needs_clarification" || execution.result.status === "failed") {
    throw new Error(`Semantic live gate should avoid false clarification: ${JSON.stringify(execution.result)}`);
  }
  if (!execution.command) {
    throw new Error(`Expected a queued low-risk extension command: ${JSON.stringify(execution.result)}`);
  }
  const semanticMetadata = execution.result.safety.metadata?.semanticInterface;
  if (!semanticMetadata || semanticMetadata.outcome !== "act") {
    throw new Error(`Expected redacted semantic trace in safety metadata: ${JSON.stringify(execution.result.safety.metadata)}`);
  }
}

function verifyVisionReadLocateConformance() {
  const fixture = createVisionSemanticFixture();
  const locate = replaySemanticDecision({ snapshot: fixture.snapshot, intent: fixture.locateIntent, now: fixedNow });
  assertSemanticOutcomeKind(locate, "act", "Vision locate");
  if (!locate.hypothesis.targetEntityId || !fixture.snapshot.entities.find((entity) => entity.id === locate.hypothesis.targetEntityId)?.label?.includes("파란 버튼")) {
    throw new Error(`Vision locate should select the blue-button referent: ${JSON.stringify(locate.trace.ranked)}`);
  }
  const read = replaySemanticDecision({ snapshot: fixture.snapshot, intent: fixture.readIntent, now: fixedNow });
  assertSemanticOutcomeKind(read, "act", "Vision read");
  if (fixture.snapshot.surface.kind !== "app_window" || fixture.snapshot.capabilities.execute !== false) {
    throw new Error(`Vision snapshot should remain read/locate-only app-window evidence: ${JSON.stringify(fixture.snapshot.surface)}`);
  }
}

function verifyGoldenTraceSuite() {
  const results = runSemanticGoldenTraceSuite({ now: fixedNow });
  const failures = results.filter((result) => !result.passed);
  if (failures.length > 0) {
    throw new Error(`Semantic golden trace failures: ${JSON.stringify(failures, null, 2)}`);
  }
  const modes = new Set(results.map((result) => result.mode));
  for (const mode of ["typed", "untyped", "adversarial"]) {
    if (!modes.has(mode)) {
      throw new Error(`Semantic golden trace suite is missing mode ${mode}: ${JSON.stringify(results)}`);
    }
  }
  const adversarial = new Set(results.map((result) => result.adversarialClass).filter(Boolean));
  for (const name of [
    "duplicate_label",
    "post_hydration_drift",
    "aria_visible_mismatch",
    "offscreen_or_occluded_target",
    "i18n_alias",
    "dynamic_id_churn",
    "shadow_dom_boundary",
    "nested_form_scope"
  ]) {
    if (!adversarial.has(name)) {
      throw new Error(`Semantic golden trace suite is missing adversarial class ${name}`);
    }
  }
}
