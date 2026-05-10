import { replaySemanticDecision } from "../replay.js";
import type { IntentFrame, SemanticDecisionOutcome, SemanticEvalMode, SemanticSnapshot } from "../types.js";
import { browserCase, button, input } from "./caseBuilders.js";
import { createBrowserSemanticFixture, createVisionSemanticFixture } from "./fixtures.js";

export type SemanticGoldenTraceCase = {
  id: string;
  mode: SemanticEvalMode;
  adversarialClass?: string;
  snapshot: SemanticSnapshot;
  intent: IntentFrame;
  expect: {
    outcome: SemanticDecisionOutcome["kind"];
    selectedEntityId?: string;
    warningKind?: string;
  };
};

export type SemanticGoldenTraceResult = {
  id: string;
  mode: SemanticEvalMode;
  adversarialClass?: string;
  passed: boolean;
  outcome: SemanticDecisionOutcome["kind"];
  reason: string;
};

export function createSemanticGoldenTraceSuite(now = new Date("2026-05-08T00:00:05.000Z")): SemanticGoldenTraceCase[] {
  const concept = createBrowserSemanticFixture();
  const duplicate = createBrowserSemanticFixture({ duplicateLabels: true });
  const stale = createBrowserSemanticFixture({ capturedAt: "2026-05-07T23:59:00.000Z" });
  const vision = createVisionSemanticFixture();
  const ariaMismatch = browserCase({
    id: "aria-visible-mismatch",
    instruction: "Cancel 눌러줘",
    reference: "Cancel",
    elements: [button("cancel-visible", "Cancel", { ariaLabel: "Submit form" })]
  });
  const offscreen = browserCase({
    id: "offscreen-target",
    instruction: "Hidden 눌러줘",
    reference: "Hidden",
    elements: [button("hidden-button", "Hidden", { visible: false })]
  });
  const alias = browserCase({
    id: "i18n-alias-new-chat",
    instruction: "new chat 눌러줘",
    reference: "new chat",
    elements: [button("new-chat-alias", "새 채팅")]
  });
  const dynamicA = browserCase({
    id: "dynamic-id-churn-a",
    instruction: "Settings 눌러줘",
    reference: "Settings",
    elements: [button("settings-a-123", "Settings")]
  });
  const dynamicB = browserCase({
    id: "dynamic-id-churn-b",
    instruction: "Settings 눌러줘",
    reference: "Settings",
    elements: [button("settings-b-987", "Settings")]
  });
  const shadow = browserCase({
    id: "shadow-dom-boundary",
    instruction: "Shadow action 눌러줘",
    reference: "Shadow action",
    elements: [button("shadow-action", "Shadow action", { selector: undefined, confidence: 0.84 })]
  });
  const nestedForm = browserCase({
    id: "nested-form-scope",
    instruction: "Workspace email 입력칸 찾아줘",
    reference: "Workspace email",
    elements: [
      input("profile-email", "Profile email"),
      input("workspace-email", "Workspace email")
    ],
    affordance: "locate"
  });

  return [
    {
      id: "typed-browser-concept-filter",
      mode: "typed",
      snapshot: concept.snapshot,
      intent: concept.intent,
      expect: { outcome: "act", selectedEntityId: "entity-concept-posts" }
    },
    {
      id: "untyped-vision-read",
      mode: "untyped",
      snapshot: vision.snapshot,
      intent: vision.readIntent,
      expect: { outcome: "act" }
    },
    {
      id: "duplicate-label",
      mode: "adversarial",
      adversarialClass: "duplicate_label",
      snapshot: duplicate.snapshot,
      intent: duplicate.intent,
      expect: { outcome: "abstain" }
    },
    {
      id: "post-hydration-drift",
      mode: "adversarial",
      adversarialClass: "post_hydration_drift",
      snapshot: stale.snapshot,
      intent: stale.intent,
      expect: { outcome: "act", selectedEntityId: "entity-concept-posts", warningKind: "snapshot_stale" }
    },
    {
      id: "aria-visible-mismatch",
      mode: "adversarial",
      adversarialClass: "aria_visible_mismatch",
      snapshot: ariaMismatch.snapshot,
      intent: ariaMismatch.intent,
      expect: { outcome: "act", selectedEntityId: "entity-cancel-visible" }
    },
    {
      id: "offscreen-occluded",
      mode: "adversarial",
      adversarialClass: "offscreen_or_occluded_target",
      snapshot: offscreen.snapshot,
      intent: offscreen.intent,
      expect: { outcome: "abstain" }
    },
    {
      id: "i18n-alias",
      mode: "adversarial",
      adversarialClass: "i18n_alias",
      snapshot: alias.snapshot,
      intent: alias.intent,
      expect: { outcome: "act", selectedEntityId: "entity-new-chat-alias" }
    },
    {
      id: "dynamic-id-churn-a",
      mode: "adversarial",
      adversarialClass: "dynamic_id_churn",
      snapshot: dynamicA.snapshot,
      intent: dynamicA.intent,
      expect: { outcome: "act", selectedEntityId: "entity-settings-a-123" }
    },
    {
      id: "dynamic-id-churn-b",
      mode: "adversarial",
      adversarialClass: "dynamic_id_churn",
      snapshot: dynamicB.snapshot,
      intent: dynamicB.intent,
      expect: { outcome: "act", selectedEntityId: "entity-settings-b-987" }
    },
    {
      id: "shadow-dom-boundary",
      mode: "adversarial",
      adversarialClass: "shadow_dom_boundary",
      snapshot: shadow.snapshot,
      intent: shadow.intent,
      expect: { outcome: "act", selectedEntityId: "entity-shadow-action" }
    },
    {
      id: "nested-form-scope",
      mode: "adversarial",
      adversarialClass: "nested_form_scope",
      snapshot: nestedForm.snapshot,
      intent: nestedForm.intent,
      expect: { outcome: "act", selectedEntityId: "entity-workspace-email" }
    }
  ];
}

export function runSemanticGoldenTraceSuite(input?: {
  now?: Date;
  cases?: SemanticGoldenTraceCase[];
}): SemanticGoldenTraceResult[] {
  const now = input?.now ?? new Date("2026-05-08T00:00:05.000Z");
  const cases = input?.cases ?? createSemanticGoldenTraceSuite(now);
  return cases.map((testCase) => {
    const outcome = replaySemanticDecision({ snapshot: testCase.snapshot, intent: testCase.intent, now });
    const selectedEntityId = outcome.kind === "act" || outcome.kind === "confirm" ? outcome.hypothesis.targetEntityId : undefined;
    const warningMatched = !testCase.expect.warningKind || outcome.trace.warnings.some((warning) => warning.kind === testCase.expect.warningKind);
    const passed = outcome.kind === testCase.expect.outcome &&
      (!testCase.expect.selectedEntityId || selectedEntityId === testCase.expect.selectedEntityId) &&
      warningMatched;
    return {
      id: testCase.id,
      mode: testCase.mode,
      adversarialClass: testCase.adversarialClass,
      passed,
      outcome: outcome.kind,
      reason: passed
        ? "passed"
        : `expected ${testCase.expect.outcome}/${testCase.expect.selectedEntityId ?? "(any)"}, got ${outcome.kind}/${selectedEntityId ?? "(none)"}`
    };
  });
}
