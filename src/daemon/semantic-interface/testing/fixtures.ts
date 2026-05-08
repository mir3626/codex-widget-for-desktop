import { buildBrowserObservation } from "../../browser-action/browserObservation.js";
import type { BrowserElement, BrowserObservation } from "../../browser-action/types.js";
import type { TaskCapsule } from "../../vision-context/types.js";
import { browserObservationToSemanticSnapshot } from "../adapters/browserActionAdapter.js";
import { taskCapsuleToSemanticSnapshot } from "../adapters/visionContextAdapter.js";
import { buildIntentFrame } from "../intentFrame.js";
import type { IntentFrame, SemanticSnapshot } from "../types.js";

export function createBrowserSemanticFixture(input?: {
  capturedAt?: string;
  duplicateLabels?: boolean;
  includePassword?: boolean;
}): { observation: BrowserObservation; snapshot: SemanticSnapshot; intent: IntentFrame } {
  const capturedAt = input?.capturedAt ?? "2026-05-08T00:00:00.000Z";
  const elements: BrowserElement[] = input?.duplicateLabels
    ? [
        button("save-primary", "Save", { selector: "#save-primary" }),
        button("save-secondary", "Save", { selector: "#save-secondary" })
      ]
    : [
        button("concept-posts", "개념글", { role: "button", selector: "#concept-posts", selected: true }),
        link("concept-sidebar", "개념글[동물,기타]", "/concept-sidebar"),
        link("fun-post", "AI가 만든 재밌는 글", "/post/1"),
        button("new-chat", "새 채팅", { selector: "#new-chat" })
      ];
  if (input?.includePassword) {
    elements.push({
      id: "password-input",
      tagName: "input",
      role: "textbox",
      label: "Password",
      text: "",
      value: "secret_value",
      inputType: "password",
      selector: "#password",
      visible: true,
      enabled: true,
      editable: true,
      confidence: 0.94,
      riskHints: ["password", "auth"]
    });
  }
  const observation = buildBrowserObservation({
    snapshot: {
      url: "https://example.test/list",
      title: "Semantic fixture",
      capturedAt,
      readyState: "complete",
      text: "개념글 AI가 만든 재밌는 글",
      elements
    },
    now: new Date(capturedAt)
  });
  const snapshot = browserObservationToSemanticSnapshot({
    observation,
    now: new Date(capturedAt)
  });
  const intent = input?.duplicateLabels
    ? buildIntentFrame({
        instruction: "Save 눌러줘",
        language: "en",
        steps: [{ affordance: "activate", reference: "Save", riskBudget: "state_change" }]
      })
    : buildIntentFrame({
        instruction: "개념글 눌러서 재밌어보이는 글 보여줘",
        language: "ko",
        steps: [{ affordance: "filter", reference: "개념글", referenceKind: "content_category", riskBudget: "state_change" }]
      });
  return { observation, snapshot, intent };
}

export function createVisionSemanticFixture(): { capsule: TaskCapsule; snapshot: SemanticSnapshot; locateIntent: IntentFrame; readIntent: IntentFrame } {
  const capsule: TaskCapsule = {
    id: "vision-capsule-semantic-fixture",
    createdAt: "2026-05-08T00:00:00.000Z",
    captureSessionId: "vision-session-semantic-fixture",
    userUtterance: "오른쪽 위 파란 버튼이 뭔지 알려줘.",
    source: {
      kind: "app",
      appName: "Fixture App",
      windowTitle: "Dashboard",
      viewport: { width: 1280, height: 720 }
    },
    resolvedIntent: {
      kind: "explain_screen",
      summary: "Identify the blue button in the upper-right corner.",
      confidence: 0.86
    },
    referents: [{
      id: "vision-entity-blue-button",
      name: "파란 버튼",
      role: "referent",
      observations: ["obs-blue-button"],
      salience: 0.91,
      confidence: 0.87
    }],
    alternatives: [{
      id: "vision-entity-side-link",
      name: "파란 링크",
      role: "alternative",
      observations: ["obs-side-link"],
      salience: 0.42,
      confidence: 0.52
    }],
    evidence: [
      {
        kind: "crop",
        title: "파란 버튼",
        path: "C:\\tmp\\blue-button.png",
        t: 500,
        bbox: { x: 1040, y: 42, w: 148, h: 44 },
        sourceObservationIds: ["obs-blue-button"]
      },
      {
        kind: "text",
        title: "OCR text",
        text: "오른쪽 위에 파란 버튼 저장하기가 보입니다.",
        t: 500,
        bbox: { x: 1040, y: 42, w: 148, h: 44 },
        sourceObservationIds: ["obs-blue-button"]
      },
      {
        kind: "text",
        title: "파란 링크",
        text: "왼쪽 패널에 파란 링크가 있습니다.",
        t: 500,
        bbox: { x: 40, y: 120, w: 180, h: 32 },
        sourceObservationIds: ["obs-side-link"]
      }
    ],
    uncertainties: [],
    instructions: ["Use only selected visual evidence."],
    retention: {
      rawVideo: "delete_after_processing",
      rawAudio: "delete_after_processing",
      derivedFrames: "keep_selected",
      fullFrames: "crop_only",
      transcript: "keep"
    }
  };
  const snapshot = taskCapsuleToSemanticSnapshot({ observation: capsule, now: new Date(capsule.createdAt) });
  const locateIntent = buildIntentFrame({
    instruction: capsule.userUtterance,
    language: "ko",
    steps: [{ affordance: "locate", reference: "파란 버튼", referenceKind: "name", riskBudget: "read_only" }]
  });
  const readIntent = buildIntentFrame({
    instruction: "화면 설명해줘",
    language: "ko",
    steps: [{ affordance: "read", riskBudget: "read_only" }]
  });
  return { capsule, snapshot, locateIntent, readIntent };
}

function button(id: string, label: string, overrides: Partial<BrowserElement> = {}): BrowserElement {
  return {
    id,
    tagName: "button",
    role: "button",
    label,
    text: label,
    selector: `#${id}`,
    visible: true,
    enabled: true,
    editable: false,
    confidence: 0.95,
    riskHints: [],
    ...overrides
  };
}

function link(id: string, label: string, href: string): BrowserElement {
  return {
    id,
    tagName: "a",
    role: "link",
    label,
    text: label,
    href,
    selector: `#${id}`,
    visible: true,
    enabled: true,
    editable: false,
    confidence: 0.9,
    riskHints: []
  };
}
