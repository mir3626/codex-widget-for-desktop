import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { WebSocketServer } from "ws";

const firstAnswer = [
  "첫 번째 응답은 여러 문단으로 구성됩니다. 이 문장은 사용자 말풍선과 겹치지 않아야 합니다.",
  "",
  "| 순위 | 종목 | 최신 뉴스 요약 |",
  "| --- | --- | --- |",
  "| 1 | NVDA Nvidia | 4월 14일 양자컴퓨팅용 오픈 AI 모델을 공개했고 H200 수출 규제 변수와 맞물려 핵심 리스크가 남아 있습니다. |",
  "| 2 | GOOGL Alphabet | Q1 매출과 Google Cloud 성장률이 강했고 AI 제품 수요가 클라우드 성장의 핵심 동력으로 확인됐습니다. |",
  "| 3 | MSFT Microsoft | Azure 성장과 Copilot 확산 속도는 여전히 시장 검증 대상입니다. |",
  "",
  "마지막 문단입니다. 이어지는 사용자 질문은 이 답변 영역 위에 떠 있지 않고 다음 행에 배치되어야 합니다."
].join("\n");

const secondAnswer = [
  "두 번째 응답입니다. 앞선 답변이 타이핑 중이어도 이 메시지는 timeline 안에서 독립된 행을 차지해야 합니다.",
  "",
  "```tsx",
  "export function Tooltip() {",
  "  return <span role=\"tooltip\">Tip</span>;",
  "}",
  "```"
].join("\n");

const thirdAnswer = "세 번째 응답입니다. Streaming 표시와 skeleton은 세로 중앙 정렬과 레이아웃 흐름을 유지해야 합니다.";

const daemon = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((resolve) => daemon.once("listening", resolve));
const daemonAddress = daemon.address();
if (!daemonAddress || typeof daemonAddress === "string") {
  throw new Error("Fake daemon did not bind to a TCP port.");
}
const daemonPort = daemonAddress.port;
let requestCount = 0;
const askMessages = [];
const clientMessages = [];

daemon.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "connected",
      daemon: {
        port: daemonPort,
        model: "mock",
        liveModel: true,
        auth: {
          mode: "mock",
          configured: true,
          authenticated: true,
          signInAvailable: false,
          signInMethod: null
        }
      }
    })
  );
  socket.send(
    JSON.stringify({
      type: "provider.status",
      providers: [
        { mode: "agent", label: "Agent", state: "ready", detail: "ready", capabilities: [] },
        { mode: "browser", label: "DOM", state: "stub", detail: "waiting", capabilities: [] },
        { mode: "screen", label: "Vision", state: "stub", detail: "waiting", capabilities: [] },
        { mode: "terminal", label: "PTY", state: "ready", detail: "ready", capabilities: [] }
      ]
    })
  );
  socket.send(
    JSON.stringify({
      type: "session.snapshot",
      snapshot: {
        activeSessionId: "active-session",
        sessions: [
          {
            id: "active-session",
            title: "Active smoke session",
            status: "active",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            activeModel: "gpt-5.5",
            activeReasoning: "xhigh",
            activeMode: "agent"
          }
        ],
        trashedSessions: [
          {
            id: "trash-session",
            title: "Deleted smoke session",
            status: "trashed",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            artifactCount: 1
          }
        ],
        messages: []
      }
    })
  );
  socket.send(
    JSON.stringify({
      type: "ledger.snapshot",
      snapshot: {
        sessionId: "active-session",
        artifacts: [],
        activities: [
          {
            id: "activity-provider-smoke",
            sessionId: "active-session",
            level: "info",
            category: "provider",
            summary: "DOM snapshot captured",
            createdAt: "2026-05-06T00:00:00.000Z"
          }
        ],
        providerSnapshots: [
          {
            id: "provider-dom-smoke",
            sessionId: "active-session",
            provider: "dom",
            title: "DOM Smoke Page",
            summary: "example.test · 18 selected chars",
            data: { url: "https://example.test/page", selectionLength: 18 },
            capturedAt: "2026-05-06T00:00:00.000Z"
          },
          {
            id: "provider-vision-smoke",
            sessionId: "active-session",
            provider: "vision",
            title: "Vision Smoke Snapshot",
            summary: "screen smoke · changed yes",
            data: { source: "smoke-capture", imageDataUrlLength: 128 },
            capturedAt: "2026-05-06T00:00:01.000Z"
          }
        ]
      }
    })
  );

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    clientMessages.push(message);
    if (message.type === "ledger.refresh") {
      socket.send(
        JSON.stringify({
          type: "ledger.snapshot",
          snapshot: {
            sessionId: message.sessionId ?? "active-session",
            artifacts: [
              {
                id: "artifact-trash-1",
                sessionId: message.sessionId ?? "active-session",
                title: "Deleted artifact",
                kind: "generated",
                status: "active",
                createdAt: "2026-05-06T00:00:00.000Z",
                updatedAt: "2026-05-06T00:00:00.000Z",
                files: [
                  {
                    id: "artifact-file-trash-1",
                    artifactId: "artifact-trash-1",
                    logicalPath: "reports/report.md",
                    displayName: "report.md",
                    fileKind: "text",
                    mime: "text/markdown",
                    currentVersionId: "artifact-version-trash-1",
                    currentVersionLabel: "v1",
                    operation: "create",
                    size: 128,
                    createdAt: "2026-05-06T00:00:00.000Z",
                    preview: {
                      kind: "text",
                      mime: "text/markdown",
                      data: "# Deleted artifact\npreview text",
                      truncated: false,
                      size: 128
                    },
                    versions: [
                      {
                        id: "artifact-version-trash-1",
                        label: "v1",
                        operation: "create",
                        size: 128,
                        createdAt: "2026-05-06T00:00:00.000Z",
                        hasBefore: false,
                        hasAfter: true,
                        hasDiff: false
                      }
                    ]
                  }
                ]
              }
            ],
            activities: [],
            providerSnapshots: []
          }
        })
      );
      return;
    }
    if (message.type === "provider.vision.start") {
      socket.send(
        JSON.stringify({
          type: "provider.vision",
          state: "started",
          stream: {
            id: message.id,
            sessionId: message.sessionId,
            mode: message.mode,
            status: message.mode === "recording" ? "recording" : "streaming",
            fps: message.fps,
            frameIntervalMs: message.frameIntervalMs,
            startedAt: "2026-05-06T00:00:00.000Z",
            detail: { smoke: true }
          },
          message: message.mode === "recording" ? "WebM recording started" : "Agent screen stream started"
        })
      );
      return;
    }
    if (message.type === "provider.vision.recording.complete") {
      socket.send(
        JSON.stringify({
          type: "provider.vision",
          state: "completed",
          stream: {
            id: message.id,
            mode: "recording",
            status: "stopped",
            recordingBlobId: "blob:renderer-smoke",
            startedAt: "2026-05-06T00:00:00.000Z",
            stoppedAt: "2026-05-06T00:00:01.000Z",
            detail: { size: message.size, durationMs: message.durationMs }
          },
          message: "WebM recording saved"
        })
      );
      return;
    }
    if (message.type === "provider.vision.stop") {
      socket.send(
        JSON.stringify({
          type: "provider.vision",
          state: "stopped",
          stream: {
            id: message.id,
            mode: "agent_stream",
            status: "stopped",
            startedAt: "2026-05-06T00:00:00.000Z",
            stoppedAt: "2026-05-06T00:00:01.000Z",
            detail: { reason: message.reason }
          },
          message: "Vision session stopped"
        })
      );
      return;
    }
    if (message.type === "terminal.input") {
      streamTerminalInput(socket, message);
      return;
    }
    if (message.type === "session.branch") {
      socket.send(
        JSON.stringify({
          type: "session.snapshot",
          snapshot: {
            activeSessionId: "branch-session",
            sessions: [
              {
                id: "active-session",
                title: "Active smoke session",
                status: "active",
                createdAt: "2026-05-06T00:00:00.000Z",
                updatedAt: "2026-05-06T00:00:00.000Z",
                activeModel: "gpt-5.5",
                activeReasoning: "xhigh",
                activeMode: "agent"
              },
              {
                id: "branch-session",
                title: "Branched smoke session",
                status: "active",
                createdAt: "2026-05-06T00:00:01.000Z",
                updatedAt: "2026-05-06T00:00:01.000Z",
                activeModel: "gpt-5.4-mini",
                activeReasoning: "medium",
                activeMode: "agent"
              }
            ],
            trashedSessions: [
              {
                id: "trash-session",
                title: "Deleted smoke session",
                status: "trashed",
                createdAt: "2026-05-06T00:00:00.000Z",
                updatedAt: "2026-05-06T00:00:00.000Z",
                artifactCount: 1
              }
            ],
            messages: []
          }
        })
      );
      return;
    }
    if (message.type !== "ask") {
      return;
    }

    askMessages.push(message);
    if (message.mode === "terminal") {
      streamTerminal(socket, message.id, message.text);
      return;
    }

    requestCount += 1;
    const answer = requestCount === 1 ? firstAnswer : requestCount === 2 ? secondAnswer : thirdAnswer;
    streamAnswer(socket, message.id, answer);
  });
});

const vite = await createServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false
  }
});
await vite.listen();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 820 } });
await page.addInitScript(() => {
  class FakeMediaStreamTrack extends EventTarget {
    stop() {}
  }

  class FakeMediaStream {
    track = new FakeMediaStreamTrack();
    getTracks() {
      return [this.track];
    }
    getVideoTracks() {
      return [];
    }
  }

  class FakeMediaRecorder extends EventTarget {
    static isTypeSupported() {
      return true;
    }

    state = "inactive";
    mimeType = "video/webm";

    constructor() {
      super();
    }

    start() {
      this.state = "recording";
    }

    stop() {
      if (this.state === "inactive") {
        return;
      }
      this.state = "inactive";
      const dataEvent = new Event("dataavailable");
      Object.defineProperty(dataEvent, "data", {
        value: new Blob(["renderer-webm-smoke"], { type: "video/webm" })
      });
      this.dispatchEvent(dataEvent);
      this.dispatchEvent(new Event("stop"));
    }
  }

  class FakeSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = "en-US";
    onresult = null;
    onerror = null;
    onend = null;

    start() {
      setTimeout(() => {
        this.onresult?.({
          resultIndex: 0,
          results: [
            {
              0: { transcript: "voice prompt smoke" },
              isFinal: true
            }
          ]
        });
        this.onend?.();
      }, 20);
    }

    stop() {
      this.onend?.();
    }

    abort() {
      this.onend?.();
    }
  }

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getDisplayMedia: async () => new FakeMediaStream()
    }
  });
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder
  });
  Object.defineProperty(window, "webkitSpeechRecognition", {
    configurable: true,
    value: FakeSpeechRecognition
  });
  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    value: FakeSpeechRecognition
  });
});

try {
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Vite did not expose a local URL.");
  }

  await page.goto(`${baseUrl}?daemonPort=${daemonPort}`);
  await page.setViewportSize({ width: 320, height: 680 });
  await page.waitForTimeout(120);
  await assertMinimumLayoutControls(page);
  await page.getByRole("button", { name: "Activity details" }).click();
  await page.getByText("Provider history").waitFor();
  await page.getByText("DOM Smoke Page").waitFor();
  await page.getByText("Vision Smoke Snapshot").waitFor();
  await page.getByRole("button", { name: "Activity details" }).click();
  await page.setViewportSize({ width: 500, height: 820 });
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: "Crop" }).check();
  await page.getByLabel("Select crop area").click();
  const cropPicker = page.locator(".screen-crop-picker");
  await cropPicker.waitFor();
  const cropPickerBox = await cropPicker.boundingBox();
  if (!cropPickerBox) {
    throw new Error("Screen crop picker did not expose a drag surface.");
  }
  await page.mouse.move(cropPickerBox.x + 50, cropPickerBox.y + 70);
  await page.mouse.down();
  await page.mouse.move(cropPickerBox.x + 210, cropPickerBox.y + 190, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector(".screen-crop-picker"));
  const cropInputs = page.locator(".screen-crop-grid input");
  if ((await cropInputs.nth(2).inputValue()) !== "160" || (await cropInputs.nth(3).inputValue()) !== "120") {
    throw new Error("Visual screen crop picker did not write the selected size into settings.");
  }
  await cropInputs.nth(0).fill("12");
  await cropInputs.nth(1).fill("34");
  await cropInputs.nth(2).fill("640");
  await cropInputs.nth(3).fill("360");
  await page.getByLabel("Capture screen snapshot").click();
  if (await page.locator(".settings-panel .vision-action-menu").count()) {
    throw new Error("Settings provider capture should not open the Vision action menu.");
  }
  await waitUntil(
    () => clientMessages.some((message) => message.type === "provider.captureScreen"),
    "Timed out waiting for screen capture request."
  );
  const captureRequest = clientMessages.find((message) => message.type === "provider.captureScreen");
  if (
    captureRequest?.crop?.x !== 12 ||
    captureRequest.crop.y !== 34 ||
    captureRequest.crop.width !== 640 ||
    captureRequest.crop.height !== 360
  ) {
    throw new Error(`Capture request did not include configured crop: ${JSON.stringify(captureRequest)}`);
  }
  await page.getByRole("button", { name: "Settings" }).click();

  const visionToolbar = page.locator(".vision-toolbar");
  await visionToolbar.getByLabel("Vision tools").click();
  await page.getByLabel("Agent screen stream cadence").selectOption("2000");
  await page.getByLabel("Vision max duration").selectOption("60000");
  await page.getByRole("menuitem", { name: /Record WebM/ }).click();
  await waitUntil(
    () => clientMessages.some((message) =>
      message.type === "provider.vision.start" &&
      message.mode === "recording" &&
      message.maxDurationMs === 60000 &&
      message.detail?.retention === "recording_blob" &&
      message.detail?.localMaxBytes === 8 * 1024 * 1024
    ),
    "Timed out waiting for Vision recording start."
  );
  await visionToolbar.getByLabel("Vision tools").click();
  await page.getByRole("menuitem", { name: /Stop WebM recording/ }).click();
  await waitUntil(
    () => clientMessages.some((message) => message.type === "provider.vision.recording.complete" && message.mime.startsWith("video/webm")),
    "Timed out waiting for Vision recording completion."
  );
  await visionToolbar.getByLabel("Vision tools").click();
  await page.getByRole("menuitem", { name: /Share with Agent/ }).click();
  await waitUntil(
    () => clientMessages.some((message) =>
      message.type === "provider.vision.start" &&
      message.mode === "agent_stream" &&
      message.frameIntervalMs === 2000 &&
      message.maxDurationMs === 60000 &&
      message.detail?.retention === "metadata_only" &&
      message.detail?.resource?.overlapPolicy === "drop_if_previous_frame_pending"
    ),
    "Timed out waiting for Agent screen stream start."
  );
  await visionToolbar.getByLabel("Vision tools").click();
  await page.mouse.click(4, 4);
  await page.waitForFunction(() => !document.querySelector(".vision-action-menu"));
  await visionToolbar.getByLabel("Vision tools").click();
  await page.getByRole("menuitem", { name: /Stop Agent stream/ }).click();
  await waitUntil(
    () => clientMessages.some((message) => message.type === "provider.vision.stop"),
    "Timed out waiting for Agent screen stream stop."
  );

  await page.getByLabel("Voice prompt").click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Ask Codex"]')?.value.includes("voice prompt smoke"));

  await page.getByLabel("Ask Codex").fill("나스닥 AI섹터 상위 10개종목 뉴스 정리해줘");
  await page.getByLabel("Send prompt").click();
  await page.waitForSelector(".markdown-table-scroll");
  await assertUserBubbleRadius(page);

  await page.getByLabel("Ask Codex").fill("이 중에서 상승여력이 많이 남았다고 판단되는 종목과 그 이유를 알려줘");
  await page.getByLabel("Send prompt").click();
  await page.waitForFunction(() => document.querySelectorAll(".assistant-message").length >= 2);

  await page.getByLabel("Ask Codex").fill("리액트 툴팁 컴포넌트 코드 구현해줘");
  await page.getByLabel("Send prompt").click();
  await page.waitForFunction(() => document.querySelectorAll(".assistant-message").length >= 3);

  await page.waitForTimeout(220);
  await assertNoMessageOverlap(page);
  await assertPromptDoesNotCoverConversation(page);

  await dragPromptResize(page);
  await assertPromptDoesNotCoverConversation(page);
  await assertNoMessageOverlap(page);

  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Regenerate response"]').length === 3);
  await page.getByLabel("More response actions").first().click();
  await assertMenuTopRightAligned(page);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1160, height: 760 });
  await page.waitForTimeout(120);
  await assertWideTableUsesContainer(page);
  await page.setViewportSize({ width: 500, height: 820 });
  await page.waitForTimeout(120);

  await page.getByLabel("Regenerate response").first().click();
  await waitUntil(() => askMessages.length >= 4, "Timed out waiting for regenerate request.");
  const regenerateRequest = askMessages[3];
  if (regenerateRequest.text !== askMessages[0].text || regenerateRequest.regenerate?.dropTurns !== 3) {
    throw new Error(`Regenerate request did not target the clicked answer boundary: ${JSON.stringify(regenerateRequest)}`);
  }
  await page.waitForFunction(() => document.querySelectorAll(".user-message").length === 1);
  await assertNoMessageOverlap(page);

  await page.waitForFunction(() => document.querySelectorAll('[aria-label="More response actions"]').length === 1);
  await page.getByLabel("More response actions").first().click();
  await page.getByRole("menuitem", { name: "Branch in new chat" }).click();
  await waitUntil(() => clientMessages.some((message) => message.type === "session.branch"), "Timed out waiting for branch session reset.");
  await page.getByRole("status").filter({ hasText: "Branched to new session" }).waitFor();
  await page.waitForSelector(".model-row.is-session-updated");
  await page.waitForSelector(".session-tab.active", { state: "attached" });
  await page.getByLabel("Ask Codex").fill("브랜치 후속 질문");
  await page.getByLabel("Send prompt").click();
  await waitUntil(() => askMessages.length >= 5, "Timed out waiting for branch follow-up request.");
  const branchRequest = askMessages[4];
  if (
    branchRequest.text !== "브랜치 후속 질문" ||
    branchRequest.branchContext?.[0]?.role !== "user" ||
    branchRequest.branchContext?.[0]?.text !== askMessages[0].text ||
    branchRequest.branchContext?.[1]?.role !== "assistant" ||
    branchRequest.branchContext?.[1]?.text !== thirdAnswer
  ) {
    throw new Error(`Branch follow-up did not send the selected exchange as context: ${JSON.stringify(branchRequest)}`);
  }
  await page.getByLabel("Ask Codex").fill("브랜치 두 번째 질문");
  await page.getByLabel("Send prompt").click();
  await waitUntil(() => askMessages.length >= 6, "Timed out waiting for second branch request.");
  if (askMessages[5].branchContext) {
    throw new Error(`Branch context should be one-shot, saw: ${JSON.stringify(askMessages[5])}`);
  }

  await page.getByLabel("Session trash").click();
  await assertTrashArtifactIconOrder(page);
  await page.getByLabel("View artifacts for Deleted smoke session").click();
  await waitUntil(
    () => clientMessages.some((message) => message.type === "ledger.refresh" && message.sessionId === "trash-session"),
    "Timed out waiting for trash artifact ledger refresh."
  );
  await page.getByText("Deleted artifact", { exact: true }).click();
  await page.getByText("report.md").waitFor();
  await page.getByText("preview text").waitFor();
  await page.getByText("1 version").click();
  await page.getByRole("button", { name: "Open report.md v1" }).click();
  await waitUntil(
    () => clientMessages.some((message) => message.type === "artifact.open" && message.versionId === "artifact-version-trash-1"),
    "Timed out waiting for versioned artifact open request."
  );
  await page.getByLabel("Session trash").click();

  await page.getByRole("button", { name: "PTY" }).click();
  await page.getByLabel("Toggle PTY guide").click();
  await page.getByText("When to use PTY").waitFor();
  await page.getByLabel("Open PTY popup").waitFor();
  await page.getByLabel("Start terminal session").click();
  await waitUntil(
    () => askMessages.some((message) => message.mode === "terminal" && message.text === "/pty start"),
    "Timed out waiting for terminal quick action."
  );
  await page.waitForFunction(() => document.querySelector(".terminal-viewport")?.textContent?.includes("terminal-viewport-ok"));
  await assertTerminalViewportStable(page);
  await assertPromptDoesNotCoverConversation(page);

  await page.getByLabel("PTY text input").fill("echo direct-input");
  await page.getByLabel("PTY text input").press("Enter");
  await waitUntil(
    () => clientMessages.some((message) => message.type === "terminal.input" && message.data === "echo direct-input\r"),
    "Timed out waiting for terminal viewport raw input."
  );
  await page.waitForFunction(() => document.querySelector(".terminal-viewport")?.textContent?.includes("direct-input-output"));
  await page.getByLabel("Send Ctrl+C").click();
  await waitUntil(
    () => clientMessages.some((message) => message.type === "terminal.input" && message.data === "\u0003"),
    "Timed out waiting for terminal viewport Ctrl+C key input."
  );
  await page.getByLabel("Enable terminal mouse input").click();
  const terminalOutput = page.locator(".terminal-output");
  const outputBox = await terminalOutput.boundingBox();
  if (!outputBox) {
    throw new Error("Terminal output surface not found for mouse test.");
  }
  await terminalOutput.click({ position: { x: 82, y: 48 } });
  await waitUntil(
    () => clientMessages.some((message) => message.type === "terminal.input" && message.label === "mouse press" && /^\x1b\[<0;\d+;\d+M$/.test(message.data)),
    "Timed out waiting for terminal mouse press input."
  );
  await waitUntil(
    () => clientMessages.some((message) => message.type === "terminal.input" && message.label === "mouse release" && /^\x1b\[<3;\d+;\d+m$/.test(message.data)),
    "Timed out waiting for terminal mouse release input."
  );
  await page.mouse.move(outputBox.x + 96, outputBox.y + 62);
  await page.mouse.wheel(0, 80);
  await waitUntil(
    () => clientMessages.some((message) => message.type === "terminal.input" && message.label === "mouse wheel" && /^\x1b\[<65;\d+;\d+M$/.test(message.data)),
    "Timed out waiting for terminal mouse wheel input."
  );

  console.log(`renderer chat layout smoke ok on vite ${baseUrl} daemon ${daemonPort}`);
} finally {
  await browser.close();
  await vite.close();
  await new Promise((resolve) => daemon.close(resolve));
}

function streamAnswer(socket, id, answer) {
  socket.send(JSON.stringify({ type: "session.state", state: "streaming", id }));
  const firstChunk = answer.slice(0, Math.max(24, Math.floor(answer.length / 3)));
  const rest = answer.slice(firstChunk.length);
  socket.send(JSON.stringify({ type: "message.delta", id, text: firstChunk }));
  setTimeout(() => {
    socket.send(JSON.stringify({ type: "message.delta", id, text: rest }));
    socket.send(JSON.stringify({ type: "message.completed", id, text: answer }));
    socket.send(JSON.stringify({ type: "session.state", state: "idle", id }));
  }, 40);
}

function streamTerminal(socket, id, command) {
  const tool = `terminal-session:${id}`;
  const output = command === "/pty start"
    ? "Terminal session started in C:\\\\Users\\\\Tony\\\\Workspace\\\\codex-widget-for-desktop (node-pty).\r\nterminal-viewport-ok\r\n"
    : `terminal-viewport-ok ${command}\r\n`;
  const answer = [
    "### Terminal Session",
    "",
    "`completed` in `C:\\\\Users\\\\Tony\\\\Workspace\\\\codex-widget-for-desktop`",
    "",
    "#### Output",
    "",
    "```text",
    output.trimEnd(),
    "```"
  ].join("\n");

  socket.send(JSON.stringify({ type: "session.state", state: "tooling", id }));
  socket.send(JSON.stringify({ type: "tool.started", id, tool, label: command }));
  setTimeout(() => {
    const split = Math.max(1, Math.floor(output.length / 2));
    socket.send(JSON.stringify({ type: "tool.output", id, tool, chunk: output.slice(0, split) }));
    socket.send(JSON.stringify({ type: "tool.output", id, tool, chunk: output.slice(split) }));
    socket.send(JSON.stringify({ type: "tool.completed", id, tool }));
    socket.send(JSON.stringify({ type: "message.delta", id, text: answer }));
    socket.send(JSON.stringify({ type: "message.completed", id, text: answer }));
    socket.send(JSON.stringify({ type: "session.state", state: "idle", id }));
  }, 40);
}

function streamTerminalInput(socket, message) {
  if (message.label?.startsWith("mouse")) {
    return;
  }
  const label = message.label === "Ctrl+C" ? "ctrl-c" : message.label ?? "input";
  socket.send(JSON.stringify({ type: "terminal.output", id: message.id, chunk: `direct-input-output ${label}\r\n` }));
}

async function assertMinimumLayoutControls(page) {
  const result = await page.evaluate(() => {
    const reasonField = document.querySelector('label[for="codex-widget-reasoning-select"]');
    const reasonLabel = reasonField?.querySelector("span")?.getBoundingClientRect();
    const reasonSelect = document.querySelector("#codex-widget-reasoning-select")?.getBoundingClientRect();
    const eastResize = document.querySelector(".resize-e")?.getBoundingClientRect();
    const southEastResize = document.querySelector(".resize-se")?.getBoundingClientRect();
    const promptResize = document.querySelector(".prompt-resize-handle")?.getBoundingClientRect();
    const voiceButton = document.querySelector(".voice-button")?.getBoundingClientRect();
    const sendButton = document.querySelector(".send-button")?.getBoundingClientRect();
    const logList = document.querySelector(".log-list")?.getBoundingClientRect();
    const mascotStyle = window.getComputedStyle(document.querySelector(".mascot"));
    const logLineCount = document.querySelectorAll(".log-lines .log-line").length;
    return {
      reasonLabelRight: reasonLabel?.right ?? 0,
      reasonSelectLeft: reasonSelect?.left ?? 0,
      reasonSelectWidth: reasonSelect?.width ?? 0,
      eastResizeWidth: eastResize?.width ?? 0,
      southEastResizeWidth: southEastResize?.width ?? 0,
      promptResizeHeight: promptResize?.height ?? 0,
      voiceButtonWidth: voiceButton?.width ?? 0,
      voiceButtonHeight: voiceButton?.height ?? 0,
      sendButtonWidth: sendButton?.width ?? 0,
      sendButtonHeight: sendButton?.height ?? 0,
      logListHeight: logList?.height ?? 0,
      mascotBackgroundImage: mascotStyle.backgroundImage,
      mascotAnimationName: mascotStyle.animationName,
      logLineCount
    };
  });
  if (result.reasonLabelRight > result.reasonSelectLeft - 1 || result.reasonSelectWidth < 78) {
    throw new Error(`Reason select minimum layout is cramped: ${JSON.stringify(result)}`);
  }
  if (result.eastResizeWidth < 8 || result.southEastResizeWidth < 22 || result.promptResizeHeight < 10) {
    throw new Error(`Resize hit areas are too small: ${JSON.stringify(result)}`);
  }
  if (
    Math.abs(result.voiceButtonWidth - result.sendButtonWidth) > 1 ||
    Math.abs(result.voiceButtonHeight - result.sendButtonHeight) > 1
  ) {
    throw new Error(`Voice and send button sizes diverged: ${JSON.stringify(result)}`);
  }
  if (result.logLineCount > 1) {
    throw new Error(`Activity strip should show one log line: ${JSON.stringify(result)}`);
  }
  if (result.logListHeight > 56) {
    throw new Error(`Activity strip should not reserve the old footer height: ${JSON.stringify(result)}`);
  }
  if (!result.mascotBackgroundImage.includes("mascot-motion-sprite") || result.mascotAnimationName !== "mascot-sprite-cycle") {
    throw new Error(`Mascot should use the sprite animation asset: ${JSON.stringify(result)}`);
  }
}

async function assertTrashArtifactIconOrder(page) {
  const result = await page.locator(".session-trash-view").first().evaluate((node) => {
    const children = Array.from(node.children);
    const meta = node.querySelector(".session-trash-artifact-count");
    return {
      childClasses: children.map((child) => child.className),
      metaChildTags: meta ? Array.from(meta.children).map((child) => child.tagName.toLowerCase()) : []
    };
  });
  if (
    result.childClasses[0] !== "session-trash-view-title" ||
    result.childClasses[1] !== "session-trash-artifact-count" ||
    result.metaChildTags[0] !== "svg" ||
    result.metaChildTags[1] !== "span"
  ) {
    throw new Error(`Trash artifact icon should sit directly left of the count: ${JSON.stringify(result)}`);
  }
}

async function assertUserBubbleRadius(page) {
  const radius = await page.locator(".user-message p").first().evaluate((node) => {
    const style = window.getComputedStyle(node);
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius
    ];
  });
  if (radius.some((value) => value !== "12px")) {
    throw new Error(`User bubble radius should be 12px on all corners: ${JSON.stringify(radius)}`);
  }
}

async function assertNoMessageOverlap(page) {
  const overlap = await page.locator(".message").evaluateAll((nodes) => {
    const rects = nodes.map((node) => node.getBoundingClientRect());
    return rects.some((rect, index) => {
      const next = rects[index + 1];
      return next ? rect.bottom > next.top + 1 : false;
    });
  });
  if (overlap) {
    throw new Error("Conversation messages overlap.");
  }
}

async function assertPromptDoesNotCoverConversation(page) {
  const result = await page.evaluate(() => {
    const conversation = document.querySelector(".conversation")?.getBoundingClientRect();
    const prompt = document.querySelector(".prompt-row")?.getBoundingClientRect();
    return {
      conversationBottom: conversation?.bottom ?? 0,
      promptTop: prompt?.top ?? 0
    };
  });
  if (result.conversationBottom > result.promptTop + 1) {
    throw new Error(`Prompt covers conversation: ${JSON.stringify(result)}`);
  }
}

async function dragPromptResize(page) {
  const handle = page.locator(".prompt-resize-handle");
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error("Prompt resize handle not found.");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, Math.max(90, box.y - 96), { steps: 8 });
  await page.mouse.up();
}

async function assertMenuTopRightAligned(page) {
  const result = await page.evaluate(() => {
    const button = document.querySelector('[aria-label="More response actions"]')?.getBoundingClientRect();
    const menu = document.querySelector(".message-action-menu")?.getBoundingClientRect();
    return {
      buttonTop: button?.top ?? 0,
      buttonLeft: button?.left ?? 0,
      buttonRight: button?.right ?? 0,
      menuTop: menu?.top ?? 0,
      menuBottom: menu?.bottom ?? 0,
      menuLeft: menu?.left ?? 0,
      menuRight: menu?.right ?? 0
    };
  });
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const menuWidth = result.menuRight - result.menuLeft;
  const hasPreferredRightSpace = result.buttonLeft + menuWidth <= viewportWidth - 8;
  const opensAbove = result.menuBottom <= result.buttonTop + 1;
  const staysInViewport = result.menuLeft >= 7 && result.menuRight <= viewportWidth - 7;
  const usesPreferredTopRight = Math.abs(result.buttonLeft - result.menuLeft) <= 3;
  const usesFallbackTopLeft = Math.abs(result.buttonRight - result.menuRight) <= 3;
  if (!opensAbove || !staysInViewport || (hasPreferredRightSpace ? !usesPreferredTopRight : !usesFallbackTopLeft)) {
    throw new Error(`More menu is not top-right aligned: ${JSON.stringify(result)}`);
  }
}

async function assertWideTableUsesContainer(page) {
  const result = await page.evaluate(() => {
    const scroll = document.querySelector(".markdown-table-scroll")?.getBoundingClientRect();
    const table = document.querySelector(".markdown-table-scroll table")?.getBoundingClientRect();
    return {
      scrollWidth: scroll?.width ?? 0,
      tableWidth: table?.width ?? 0
    };
  });
  if (Math.abs(result.scrollWidth - result.tableWidth) > 3) {
    throw new Error(`Wide table does not fill its container: ${JSON.stringify(result)}`);
  }
}

async function assertTerminalViewportStable(page) {
  const result = await page.evaluate(() => {
    const terminal = document.querySelector(".terminal-viewport")?.getBoundingClientRect();
    const conversation = document.querySelector(".conversation")?.getBoundingClientRect();
    const output = document.querySelector(".terminal-output")?.getBoundingClientRect();
    return {
      terminalLeft: terminal?.left ?? 0,
      terminalRight: terminal?.right ?? 0,
      terminalHeight: terminal?.height ?? 0,
      conversationLeft: conversation?.left ?? 0,
      conversationRight: conversation?.right ?? 0,
      outputHeight: output?.height ?? 0
    };
  });
  if (
    result.terminalHeight < 120 ||
    result.outputHeight < 70 ||
    result.terminalLeft < result.conversationLeft - 1 ||
    result.terminalRight > result.conversationRight + 1
  ) {
    throw new Error(`Terminal viewport is not stable inside the conversation: ${JSON.stringify(result)}`);
  }
}

async function waitUntil(predicate, message) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 6000) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
