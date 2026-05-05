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

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    clientMessages.push(message);
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

try {
  const baseUrl = vite.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Vite did not expose a local URL.");
  }

  await page.goto(`${baseUrl}?daemonPort=${daemonPort}`);
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
  await page.getByLabel("Capture screen").click();
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

  await page.getByLabel("Ask Codex").fill("나스닥 AI섹터 상위 10개종목 뉴스 정리해줘");
  await page.getByLabel("Send prompt").click();
  await page.waitForSelector(".markdown-table-scroll");

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

  await page.getByRole("button", { name: "PTY" }).click();
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
    () => askMessages.some((message) => message.mode === "terminal" && message.text === "/pty write echo direct-input\\r"),
    "Timed out waiting for terminal viewport raw input."
  );
  await page.waitForFunction(() => document.querySelector(".terminal-viewport")?.textContent?.includes("echo direct-input"));
  await page.getByLabel("Send Ctrl+C").click();
  await waitUntil(
    () => askMessages.some((message) => message.mode === "terminal" && message.text === "/pty key ctrl-c"),
    "Timed out waiting for terminal viewport Ctrl+C key input."
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
      buttonRight: button?.right ?? 0,
      menuBottom: menu?.bottom ?? 0,
      menuRight: menu?.right ?? 0
    };
  });
  if (Math.abs(result.buttonRight - result.menuRight) > 3 || result.menuBottom > result.buttonTop + 1) {
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
