import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  containsSemanticMemorySecret,
  createBrowserSemanticFixture,
  createSemanticMemoryStore,
  replaySemanticDecision,
  traceContainsSecretLikeText
} from "../dist/daemon/semantic-interface/index.js";
import { BrowserActionSessionManager } from "../dist/daemon/browser-action/index.js";
import { startDaemon } from "../dist/daemon/server.js";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import { handleDebugFeedbackMessage } from "../dist/daemon/server/ws/debugFeedbackMessages.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

const appDataDir = mkdtempSync(join(tmpdir(), "codex-widget-semantic-memory-"));
const store = createSemanticMemoryStore({ appDataDir });

try {
  verifyUnresolvedCaseRedaction();
  verifyFeedbackAndReadSet();
  verifyRankerMemoryIntegration();
  verifySafetyBoundaryExclusion();
  await verifyBrowserActionLiveMemoryReadSet();
  await verifyDebugFeedbackSemanticCorrection();
  await verifyExtensionCompletionFeedbackWrite();
  verifyReportAndReset();
  await verifyDaemonEndpoints();
} finally {
  store.close();
  rmSync(appDataDir, { recursive: true, force: true });
}

console.log("semantic memory smoke ok");

function verifyUnresolvedCaseRedaction() {
  const unresolved = store.recordUnresolvedCase({
    surface: "browser_page",
    failureKind: "ambiguous_target",
    utterance: "token=secret_value 개념글 눌러줘",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    candidates: [
      { id: "concept-posts", label: "개념글", reason: "filter button" },
      { id: "concept-sidebar", label: "개념글[동물,기타]", reason: "partial sidebar link" }
    ],
    traceId: "trace-redacted"
  });
  if (!unresolved.utteranceHash || unresolved.redactedUtterance?.includes("secret_value")) {
    throw new Error(`Unresolved case should hash/redact sensitive utterance: ${JSON.stringify(unresolved)}`);
  }
}

function verifyFeedbackAndReadSet() {
  const event = store.recordFeedbackEvent({
    source: "clarification_selected",
    surface: "browser_page",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    utterance: "개념글 눌러줘",
    payload: {
      phrase: "개념글",
      selectedTarget: "개념글",
      rejectedTarget: "개념글[동물,기타]",
      preferredRole: "button",
      preferredRegion: "header",
      preferredAffordance: "filter",
      action: "browser.click",
      safetyClass: "safe_action"
    }
  });
  if (event.memoryDelta.length < 4) {
    throw new Error(`Expected clarification to create multiple typed memory deltas: ${JSON.stringify(event)}`);
  }
  const readSet = store.readMemory({
    phrase: "개념글",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    limit: 20
  });
  if (!readSet.queryHash || !readSet.resultHash || readSet.edges.length < 4) {
    throw new Error(`Expected immutable memory read set with typed edges: ${JSON.stringify(readSet)}`);
  }
}

function verifyRankerMemoryIntegration() {
  const fixture = createBrowserSemanticFixture();
  const memoryReadSet = store.readMemory({
    phrase: "개념글",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    limit: 20
  });
  const outcome = replaySemanticDecision({
    snapshot: fixture.snapshot,
    intent: fixture.intent,
    memoryReadSet,
    now: new Date("2026-05-08T00:00:05.000Z")
  });
  if (outcome.kind !== "act") {
    throw new Error(`Memory-assisted replay should still act on safe concept filter: ${JSON.stringify(outcome)}`);
  }
  const selected = outcome.trace.ranked.find((ranked) => ranked.selected);
  if (!selected?.evidence.memory?.readSetId || selected.evidence.memory.phraseAlias.scoreBp <= 0) {
    throw new Error(`Expected memory axes on selected evidence packet: ${JSON.stringify(selected)}`);
  }
  if (!outcome.trace.rankerTrace.candidateGeneration || !outcome.trace.rankerTrace.targetFingerprint) {
    throw new Error(`Expected ranker trace provenance and fingerprint: ${JSON.stringify(outcome.trace.rankerTrace)}`);
  }
  const redacted = {
    schemaVersion: 1,
    id: "memory-redaction-check",
    createdAt: new Date().toISOString(),
    snapshotId: outcome.trace.snapshotId,
    intentId: outcome.trace.intentId,
    intentHash: outcome.trace.intentHash,
    semanticInterfaceVersion: outcome.trace.semanticInterfaceVersion,
    redactionPolicyVersion: "test",
    summary: { outcome: "selected", hypothesisCount: outcome.trace.ranked.length, warningCount: outcome.trace.warnings.length },
    ranked: outcome.trace.ranked.map((item) => ({
      hypothesisId: item.hypothesisId,
      targetEntityId: item.targetEntityId,
      finalScoreBp: item.finalScoreBp,
      selected: item.selected,
      explanation: item.explanation,
      disqualifiers: item.disqualifiers
    })),
    verdicts: outcome.trace.verdicts,
    warnings: outcome.trace.warnings
  };
  if (traceContainsSecretLikeText(redacted) || containsSemanticMemorySecret(memoryReadSet)) {
    throw new Error("Semantic memory replay/read set should not expose secret-like values.");
  }
}

function verifySafetyBoundaryExclusion() {
  store.recordFeedbackEvent({
    source: "manual_rule",
    surface: "browser_page",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    utterance: "삭제",
    payload: {
      phrase: "삭제",
      selectedTarget: "delete",
      preferredAffordance: "submit",
      safetyClass: "blocked"
    }
  });
  const readSet = store.readMemory({
    phrase: "삭제",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/list" },
    limit: 20
  });
  if (readSet.edges.some((edge) => edge.safetyClass === "blocked") || !readSet.exclusions.some((item) => item.reason === "safety_boundary")) {
    throw new Error(`Blocked memory edges should be excluded from ranker read sets: ${JSON.stringify(readSet)}`);
  }
}

async function verifyBrowserActionLiveMemoryReadSet() {
  const manager = new BrowserActionSessionManager(undefined, store);
  const session = manager.start({
    id: "semantic-memory-browser-action-smoke",
    mode: "auto_safe_actions",
    source: { kind: "active_tab", url: "https://example.test/list", title: "Semantic Memory Smoke" }
  });
  const snapshot = {
    url: "https://example.test/list",
    title: "Semantic Memory Smoke",
    readyState: "complete",
    viewport: { width: 1024, height: 768, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    text: "개념글 목록 사이드바",
    elements: [
      {
        id: "concept-posts",
        role: "button",
        tagName: "button",
        label: "개념글",
        text: "개념글",
        selector: "#concept-posts",
        bbox: { x: 240, y: 92, w: 86, h: 36 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "concept-sidebar",
        role: "link",
        tagName: "a",
        label: "개념글[동물,기타]",
        text: "개념글[동물,기타]",
        selector: "#concept-sidebar",
        bbox: { x: 28, y: 190, w: 150, h: 28 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.92,
        riskHints: []
      }
    ]
  };
  manager.observe({ actionSessionId: session.id, snapshot });
  const execution = await manager.execute({
    actionSessionId: session.id,
    snapshot,
    action: { type: "click", target: { kind: "text", text: "개념글" } },
    targetHint: "개념글"
  });
  if (execution.result.status !== "pending" || execution.command?.target?.id !== "concept-posts") {
    throw new Error(`Browser Action should still queue the memory-assisted safe target: ${JSON.stringify(execution)}`);
  }
  const semanticMemory = execution.result.safety.metadata?.semanticMemory;
  if (!semanticMemory || typeof semanticMemory !== "object" || !("readSetId" in semanticMemory)) {
    throw new Error(`Browser Action safety metadata should include memory read-set provenance: ${JSON.stringify(execution.result.safety)}`);
  }
}

async function verifyDebugFeedbackSemanticCorrection() {
  const debugAppDataDir = mkdtempSync(join(tmpdir(), "codex-widget-semantic-debug-feedback-"));
  const debugStorage = createStorageService({ appDataDir: debugAppDataDir });
  const debugMemory = createSemanticMemoryStore({ appDataDir: debugAppDataDir });
  try {
    const handled = await handleDebugFeedbackMessage({
      type: "debug.feedback.save",
      messageId: "semantic-debug-1",
      reason: "특갤 첫번째글 눌러달라고했는데 실시간 베스트 갤러리 글을 누름",
      userText: "특갤 첫번째 글 눌러줘",
      assistantText: "브라우저 동작을 완료했습니다. 실행: click link: 1번째 글 현재 페이지: 대만 1일차 카페투어 결과 - 실시간 베스트 갤러리 (https://gall.dcinside.com/board/view/?id=dcbest&no=429653) 검증: Action changed the browser route or URL.",
      mode: "browser",
      tags: ["assistant-response", "manual-debug"]
    }, {
      storage: debugStorage,
      semanticMemory: debugMemory,
      clients: new Set()
    });
    if (!handled) {
      throw new Error("Debug feedback handler should accept debug feedback save messages.");
    }
    const readSet = debugMemory.readMemory({
      phrase: "1번째 글",
      scope: { surface: "browser_page", origin: "https://gall.dcinside.com" },
      limit: 20
    });
    const avoid = readSet.edges.find((edge) => edge.relation === "avoid_target" && edge.source === "user_correction");
    if (!avoid || !avoid.toKey.includes("dcbest")) {
      throw new Error(`Manual debug feedback should create avoid-target semantic memory for the wrong page: ${JSON.stringify(readSet)}`);
    }
  } finally {
    debugMemory.close();
    debugStorage.close();
    rmSync(debugAppDataDir, { recursive: true, force: true });
  }

  const successAppDataDir = mkdtempSync(join(tmpdir(), "codex-widget-semantic-debug-feedback-success-"));
  const successStorage = createStorageService({ appDataDir: successAppDataDir });
  const successMemory = createSemanticMemoryStore({ appDataDir: successAppDataDir });
  try {
    const handled = await handleDebugFeedbackMessage({
      type: "debug.feedback.save",
      messageId: "semantic-debug-success-1",
      reason: "정상적으로 동작 수행했는데 failed로 기록됨",
      userText: "특갤 열어줘",
      assistantText: "브라우저 동작을 완료했습니다. 실행: navigate https://gall.dcinside.com/mgallery/board/lists/?id=programming 현재 페이지: 프로그래밍 갤러리 (https://gall.dcinside.com/mgallery/board/lists/?id=programming) 검증: Action changed the browser route or URL.",
      mode: "browser",
      tags: ["assistant-response", "manual-debug"]
    }, {
      storage: successStorage,
      semanticMemory: successMemory,
      clients: new Set()
    });
    if (!handled) {
      throw new Error("Debug feedback handler should accept successful debug feedback save messages.");
    }
    for (const phrase of ["특갤 열어줘", "특갤"]) {
      const readSet = successMemory.readMemory({
        phrase,
        scope: { surface: "browser_page", origin: "https://gall.dcinside.com" },
        limit: 20
      });
      const avoid = readSet.edges.find((edge) => edge.relation === "avoid_target" && edge.source === "user_correction");
      if (avoid) {
        throw new Error(`Successful manual debug feedback must not create avoid-target semantic memory: ${JSON.stringify(readSet)}`);
      }
    }
  } finally {
    successMemory.close();
    successStorage.close();
    rmSync(successAppDataDir, { recursive: true, force: true });
  }
}

async function verifyExtensionCompletionFeedbackWrite() {
  const manager = new BrowserActionSessionManager(undefined, store);
  const session = manager.start({
    id: "semantic-memory-extension-completion-smoke",
    mode: "auto_safe_actions",
    source: { kind: "active_tab", url: "https://example.test/list", title: "Extension Completion Smoke" }
  });
  const snapshot = {
    url: "https://example.test/list",
    title: "Extension Completion Smoke",
    readyState: "complete",
    viewport: { width: 1024, height: 768, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    text: "첫번째 글",
    elements: [
      {
        id: "first-post",
        role: "link",
        tagName: "a",
        label: "첫번째 글",
        text: "첫번째 글",
        href: "https://example.test/post/1",
        selector: "a[href=\"/post/1\"]",
        bbox: { x: 120, y: 120, w: 180, h: 32 },
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      }
    ]
  };
  manager.observe({ actionSessionId: session.id, snapshot });
  let transaction = manager.beginInteraction({
    requestId: "semantic-extension-1",
    actionSessionId: session.id,
    sessionId: "semantic-extension-session",
    utterance: "첫번째 글 눌러줘",
    source: "prompt",
    mode: "auto_safe_actions",
    browserSource: session.source
  });
  transaction = manager.recordInteractionIntent(transaction.transactionId, {
    utterance: "첫번째 글 눌러줘",
    actionFamily: "click",
    targetPhrase: "첫번째 글",
    targetRole: "link",
    sideEffect: true,
    confidence: 0.9,
    locale: "ko"
  }) ?? transaction;
  const execution = await manager.execute({
    actionSessionId: session.id,
    snapshot,
    action: { type: "click", target: { kind: "text", role: "link", text: "첫번째 글" } },
    targetHint: "첫번째 글",
    transaction,
    approved: true
  });
  if (!execution.command) {
    throw new Error(`Browser action should queue an extension command: ${JSON.stringify(execution)}`);
  }
  const completed = manager.completeExtensionCommand({
    requestId: execution.command.requestId,
    adapterId: "extension",
    ok: true,
    after: {
      url: "https://example.test/post/1",
      title: "첫번째 글",
      readyState: "complete",
      viewport: snapshot.viewport,
      text: "첫번째 글 본문",
      elements: []
    }
  });
  if (completed.result.verification.status !== "passed") {
    throw new Error(`Extension completion should verify successfully: ${JSON.stringify(completed.result)}`);
  }
  const readSet = store.readMemory({
    phrase: "첫번째 글",
    scope: { surface: "browser_page", origin: "https://example.test", viewPattern: "/post/1" },
    limit: 20
  });
  if (!readSet.edges.some((edge) => edge.source === "verified_success" && edge.relation === "phrase_alias")) {
    throw new Error(`Extension completion should write verified-success semantic feedback: ${JSON.stringify(readSet)}`);
  }
}

function verifyReportAndReset() {
  const report = store.readReport();
  if (report.edgeCount < 4 || report.unresolvedCount < 1 || report.feedbackCount < 1) {
    throw new Error(`Expected semantic memory report counts: ${JSON.stringify(report)}`);
  }
  store.clearMemory({ global: true });
  const empty = store.readReport();
  if (empty.edgeCount !== 0 || empty.unresolvedCount !== 0 || empty.feedbackCount !== 0) {
    throw new Error(`Semantic memory reset should delete local records: ${JSON.stringify(empty)}`);
  }
}

async function verifyDaemonEndpoints() {
  process.env.CODEX_WIDGET_AUTH_MODE = "mock";
  const smokeAppData = useSmokeAppData("codex-widget-semantic-memory-endpoints");
  const daemon = await startDaemon({ port: 0 });
  const baseUrl = `http://127.0.0.1:${daemon.port}`;
  try {
    const settings = await fetch(`${baseUrl}/semantic-memory/settings`).then((response) => response.json());
    if (!settings.ok || settings.settings.enabled !== true) {
      throw new Error(`Semantic memory settings endpoint should default to enabled: ${JSON.stringify(settings)}`);
    }
    const disabled = await postJson(`${baseUrl}/semantic-memory/settings`, { enabled: false });
    if (!disabled.ok || disabled.settings.enabled !== false) {
      throw new Error(`Semantic memory settings endpoint should disable read-set use: ${JSON.stringify(disabled)}`);
    }
    const enabled = await postJson(`${baseUrl}/semantic-memory/settings`, { enabled: true });
    if (!enabled.ok || enabled.settings.enabled !== true) {
      throw new Error(`Semantic memory settings endpoint should re-enable read-set use: ${JSON.stringify(enabled)}`);
    }
    const unresolved = await postJson(`${baseUrl}/semantic-memory/unresolved`, {
      surface: "browser_page",
      failureKind: "ambiguous_target",
      utterance: "password=secret_value 새 채팅 눌러줘",
      scope: { surface: "browser_page", origin: "app://widget", viewPattern: "chat" },
      candidates: [{ id: "new-chat", label: "새 채팅" }]
    });
    if (!unresolved.ok || unresolved.unresolved.redactedUtterance.includes("secret_value")) {
      throw new Error(`Semantic memory unresolved endpoint should redact: ${JSON.stringify(unresolved)}`);
    }
    const feedback = await postJson(`${baseUrl}/semantic-memory/feedback`, {
      source: "clarification_selected",
      surface: "browser_page",
      scope: { surface: "browser_page", origin: "app://widget", viewPattern: "chat" },
      utterance: "새 채팅",
      payload: {
        phrase: "새 채팅",
        selectedTarget: "새 채팅",
        preferredRole: "button",
        preferredRegion: "header",
        preferredAffordance: "activate",
        safetyClass: "safe_action"
      }
    });
    if (!feedback.ok || feedback.event.memoryDelta.length < 3) {
      throw new Error(`Semantic memory feedback endpoint should produce deltas: ${JSON.stringify(feedback)}`);
    }
    const read = await postJson(`${baseUrl}/semantic-memory/read`, {
      phrase: "새 채팅",
      scope: { surface: "browser_page", origin: "app://widget", viewPattern: "chat" }
    });
    if (!read.ok || !read.readSet.resultHash || read.readSet.edges.length < 3) {
      throw new Error(`Semantic memory read endpoint should return read set: ${JSON.stringify(read)}`);
    }
    const reportResponse = await fetch(`${baseUrl}/semantic-memory/report`);
    const report = await reportResponse.json();
    if (!report.ok || report.report.feedbackCount < 1) {
      throw new Error(`Semantic memory report endpoint should return counts: ${JSON.stringify(report)}`);
    }
    const reset = await postJson(`${baseUrl}/semantic-memory/reset`, { scope: { global: true } });
    if (!reset.ok || reset.report.edgeCount !== 0) {
      throw new Error(`Semantic memory reset endpoint should clear memory: ${JSON.stringify(reset)}`);
    }
  } finally {
    await daemon.close();
    smokeAppData.cleanup();
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}
