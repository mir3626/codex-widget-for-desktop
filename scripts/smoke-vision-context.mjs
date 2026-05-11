import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VisionContextSessionManager,
  buildAppServerUserInput,
  collectAdapterObservations,
  renderTaskCapsuleMarkdown
} from "../dist/daemon/vision-context/index.js";
import {
  MockAsrEngine,
  SidecarAsrEngine,
  applyLexiconCorrections,
  buildSessionLexicon,
  createMockVadSegments,
  decideClarification,
  scoreActionSlots
} from "../dist/daemon/transcription/index.js";

const tempDir = join(tmpdir(), `codex-widget-vision-context-${process.pid}`);
mkdirSync(tempDir, { recursive: true });

try {
  const fullFrame = join(tempDir, "frame-full.png");
  const cropFrame = join(tempDir, "frame-crop.png");
  const rawVideo = join(tempDir, "capture.webm");
  const rawAudio = join(tempDir, "audio.wav");
  writeFileSync(fullFrame, "png-full");
  writeFileSync(cropFrame, "png-crop");
  writeFileSync(rawVideo, "raw-video");
  writeFileSync(rawAudio, "raw-audio");

  const manager = new VisionContextSessionManager();
  const session = manager.start({
    id: "vision-smoke",
    sessionId: "session-smoke",
    source: {
      kind: "browser_tab",
      appName: "Chrome",
      windowTitle: "Community post",
      url: "https://example.test/post",
      viewport: { width: 1440, height: 900, devicePixelRatio: 1 }
    },
    rawMedia: { videoPath: rawVideo, audioPath: rawAudio }
  });
  manager.addEvent(session.id, {
    id: "speech-1",
    t: 1200,
    type: "speech",
    text: "와 저기 진짜 멋있다. 저기가 어딘지 알려줘.",
    confidence: 0.92
  });
  manager.addEvent(session.id, {
    id: "frame-full",
    t: 1100,
    type: "screenshot",
    path: fullFrame,
    purpose: "full",
    text: "Travel community post"
  });
  manager.addEvent(session.id, {
    id: "frame-crop",
    t: 1150,
    type: "screenshot",
    path: cropFrame,
    purpose: "primary_media",
    bbox: { x: 220, y: 160, w: 860, h: 520 }
  });

  const pending = manager.get(session.id);
  const observations = await collectAdapterObservations({
    captureSession: pending,
    timeRange: { startMs: 0, endMs: 1300 },
    activeSource: pending.source,
    hints: { utterance: "저기가 어딘지 알려줘", pointerEvents: [], currentMode: "screen" },
    providerState: {
      domSnapshot: {
        url: "https://example.test/post",
        title: "Amazing place",
        selection: "",
        text: "A large central travel image is visible in the post.",
        capturedAt: new Date().toISOString()
      }
    }
  });
  const completed = await manager.complete({ captureId: session.id, observations, now: new Date("2026-05-07T00:00:00.000Z") });
  const markdown = renderTaskCapsuleMarkdown(completed.capsule);
  const appServerInput = buildAppServerUserInput(completed.capsule);

  if (!markdown.includes("Vision Context Task") || completed.capsule.resolvedIntent.kind !== "identify_place") {
    throw new Error(`Capsule markdown/intent mismatch: ${markdown}`);
  }
  if (!appServerInput.some((item) => item.type === "localImage" && item.path === cropFrame)) {
    throw new Error(`Expected localImage input for crop evidence: ${JSON.stringify(appServerInput)}`);
  }
  if (existsSync(rawVideo) || existsSync(rawAudio)) {
    throw new Error("Raw media was not deleted after capsule completion.");
  }

  const pointerManager = new VisionContextSessionManager();
  pointerManager.start({ id: "pointer-smoke" });
  pointerManager.addEvent("pointer-smoke", {
    id: "speech-pointer",
    t: 1,
    type: "speech",
    text: "여기 이 부분이 레이아웃이 깨지는데 수정해줘.",
    confidence: 0.9
  });
  pointerManager.addEvent("pointer-smoke", {
    id: "pointer-circle",
    t: 2,
    type: "pointer",
    action: "circle",
    x: 100,
    y: 100,
    bbox: { x: 80, y: 80, w: 120, h: 90 }
  });
  pointerManager.addEvent("pointer-smoke", {
    id: "pointer-target",
    t: 3,
    type: "screenshot",
    path: cropFrame,
    purpose: "referent_crop",
    bbox: { x: 82, y: 84, w: 100, h: 70 }
  });
  const pointerCapsule = (await pointerManager.complete({ captureId: "pointer-smoke" })).capsule;
  if (pointerCapsule.resolvedIntent.kind !== "modify_code" || pointerCapsule.referents.length === 0) {
    throw new Error(`Pointer resolver did not choose the circled target: ${JSON.stringify(pointerCapsule)}`);
  }

  const temporalManager = new VisionContextSessionManager();
  temporalManager.start({ id: "temporal-smoke" });
  temporalManager.addEvent("temporal-smoke", {
    id: "temporal-error",
    t: 100,
    type: "screenshot",
    path: cropFrame,
    purpose: "error_evidence",
    text: "Failed to connect to server"
  });
  temporalManager.addEvent("temporal-smoke", {
    id: "temporal-speech",
    t: 300,
    type: "speech",
    text: "방금 뜬 오류 왜 그래?",
    confidence: 0.88
  });
  const temporalCapsule = (await temporalManager.complete({ captureId: "temporal-smoke" })).capsule;
  if (temporalCapsule.resolvedIntent.kind !== "debug_error" || !temporalCapsule.evidence.some((item) => item.text?.includes("Failed"))) {
    throw new Error("Temporal resolver did not preserve disappeared error evidence.");
  }

  const asr = new MockAsrEngine([{ text: "리액터 로또 덤 수정해줘", confidence: 0.7 }]);
  const transcript = await asr.transcribe({
    segments: createMockVadSegments([{ startMs: 0, endMs: 1200 }]),
    language: "ko"
  });
  const lexicon = buildSessionLexicon({
    terms: ["react-router-dom"],
    existing: [{
      id: "lex-1",
      profileId: "test",
      canonical: "react-router-dom",
      aliases: ["리액트 라우터 돔"],
      observedMisrecognitions: ["리액터 로또 덤"],
      contexts: ["frontend"],
      count: 1,
      lastUsedAt: new Date().toISOString(),
      confidenceBoost: 0.34
    }]
  });
  const correction = applyLexiconCorrections(transcript.text, lexicon);
  if (!correction.text.includes("react-router-dom")) {
    throw new Error(`Lexicon correction failed: ${JSON.stringify(correction)}`);
  }
  const sidecarScript = join(tempDir, "mock-asr-sidecar.mjs");
  writeFileSync(sidecarScript, `
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    id: "sidecar-transcript-smoke",
    createdAt: "2026-05-11T00:00:00.000Z",
    language: request.language,
    text: "sidecar transcript smoke",
    confidence: 0.91,
    segments: request.segments.map((segment, index) => ({
      id: "sidecar-segment-" + index,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: "sidecar transcript smoke",
      confidence: 0.91
    }))
  }));
});
`);
  const previousSidecarCommand = process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND;
  process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND = `"${process.execPath}" "${sidecarScript}"`;
  const sidecar = new SidecarAsrEngine();
  if (!(await sidecar.isAvailable())) {
    throw new Error("Sidecar ASR engine should be available when command env is configured.");
  }
  const sidecarTranscript = await sidecar.transcribe({
    segments: createMockVadSegments([{ startMs: 0, endMs: 1000 }]),
    language: "en"
  });
  if (sidecarTranscript.text !== "sidecar transcript smoke" || sidecarTranscript.confidence < 0.9) {
    throw new Error(`Sidecar ASR transcript did not normalize expected output: ${JSON.stringify(sidecarTranscript)}`);
  }
  if (previousSidecarCommand === undefined) {
    delete process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND;
  } else {
    process.env.CODEX_WIDGET_ASR_SIDECAR_COMMAND = previousSidecarCommand;
  }
  const clarification = decideClarification({
    utterance: "저거 삭제해",
    intent: { kind: "operate_app", summary: "Operate app", confidence: 0.7 },
    referenceConfidence: 0.42,
    slots: scoreActionSlots({ text: "저거 삭제해", hasPointer: false, currentMode: "screen" })
  });
  if (clarification.action !== "inline_confirmation") {
    throw new Error(`Destructive low-confidence action should clarify: ${JSON.stringify(clarification)}`);
  }

  console.log("vision context smoke ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
