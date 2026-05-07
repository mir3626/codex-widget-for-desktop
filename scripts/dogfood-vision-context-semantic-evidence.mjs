import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

const root = resolve(".");
const sourceReportPath = join(root, "docs", "reports", "review-0-2026-05-07-v1.7.8-dogfood.md");
const assetDir = join(root, "docs", "reports", "vision-context-dogfood-assets");
const screenshotPath = join(assetDir, "semantic-acceptance-context.png");
const artifactPath = join(assetDir, "semantic-acceptance-turn-capture.json");
const tempDir = join(tmpdir(), `codex-widget-vision-context-dogfood-${process.pid}`);
const fakeTurnCapturePath = join(tempDir, "fake-app-server-turn.json");

mkdirSync(assetDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });

const previousEnv = {
  authMode: process.env.CODEX_WIDGET_AUTH_MODE,
  runtime: process.env.CODEX_WIDGET_CODEX_RUNTIME,
  workdir: process.env.CODEX_WIDGET_CODEX_WORKDIR,
  approvalPolicy: process.env.CODEX_WIDGET_CODEX_APPROVAL_POLICY,
  appDataDir: process.env.CODEX_WIDGET_APP_DATA_DIR,
  storageDbPath: process.env.CODEX_WIDGET_STORAGE_DB_PATH,
  blobDir: process.env.CODEX_WIDGET_BLOB_DIR,
  path: process.env.PATH
};

let daemon;
let socket;

try {
  const report = readFileSync(sourceReportPath, "utf8");
  const semanticExcerpt = readSemanticAcceptanceExcerpt(report);
  await captureReportScreenshot({ semanticExcerpt });

  const rawVideoPath = join(tempDir, "semantic-dogfood.webm");
  const rawAudioPath = join(tempDir, "semantic-dogfood.wav");
  writeFileSync(rawVideoPath, "dogfood raw video placeholder");
  writeFileSync(rawAudioPath, "dogfood raw audio placeholder");

  prepareFakeCodex();
  process.env.CODEX_WIDGET_AUTH_MODE = "codex";
  process.env.CODEX_WIDGET_CODEX_RUNTIME = "app-server";
  process.env.CODEX_WIDGET_CODEX_WORKDIR = root;
  process.env.CODEX_WIDGET_CODEX_APPROVAL_POLICY = "on-request";
  process.env.CODEX_WIDGET_APP_DATA_DIR = join(tempDir, "app-data");
  delete process.env.CODEX_WIDGET_STORAGE_DB_PATH;
  delete process.env.CODEX_WIDGET_BLOB_DIR;
  process.env.PATH = `${tempDir}${delimiter}${process.env.PATH ?? ""}`;

  daemon = await startDaemon({ port: 0 });
  const events = [];
  socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
  socket.on("message", (raw) => {
    events.push(JSON.parse(raw.toString()));
  });

  await waitForEvent(events, (event) => event.type === "connected", "daemon connection");
  const initialSnapshot = await waitForEvent(events, (event) => event.type === "session.snapshot", "initial session snapshot");
  const sessionId = initialSnapshot.snapshot.activeSessionId;
  const captureId = "vision-context-semantic-dogfood";

  socket.send(JSON.stringify({
    type: "visionContext.start",
    captureId,
    sessionId,
    source: {
      kind: "browser_tab",
      appName: "Codex Widget",
      windowTitle: "/vibe-review dogfood report",
      url: pathToFileURL(sourceReportPath).href,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 }
    },
    rawMedia: {
      videoPath: rawVideoPath,
      audioPath: rawAudioPath
    }
  }));
  await waitForEvent(events, (event) => event.type === "visionContext.started" && event.captureId === captureId, "vision context start");

  socket.send(JSON.stringify({
    type: "visionContext.event",
    captureId,
    event: {
      type: "speech",
      t: 100,
      text: "이 화면의 Semantic acceptance evidence 상태를 요약하고 complete로 표시해도 되는지 판단해줘.",
      confidence: 0.92
    }
  }));
  socket.send(JSON.stringify({
    type: "visionContext.event",
    captureId,
    event: {
      type: "screenshot",
      t: 130,
      path: screenshotPath,
      purpose: "full",
      text: semanticExcerpt
    }
  }));
  socket.send(JSON.stringify({
    type: "visionContext.stop",
    captureId,
    sendToAgent: true,
    requestId: "vision-context-semantic-dogfood",
    sessionId
  }));

  const capsuleEvent = await waitForEvent(events, (event) => event.type === "visionContext.capsule" && event.captureId === captureId, "vision context capsule");
  const completed = await waitForEvent(events, (event) => event.type === "message.completed" && event.id === "vision-context-semantic-dogfood", "fake app-server completion");
  const fakeTurnCapture = JSON.parse(readFileSync(fakeTurnCapturePath, "utf8"));
  const rawMediaDeleted = !existsSync(rawVideoPath) && !existsSync(rawAudioPath);

  if (!rawMediaDeleted) {
    throw new Error("Raw media files still exist after Vision Context completion.");
  }
  if (capsuleEvent.capsuleSummary?.deletedRawMedia !== 2) {
    throw new Error(`Expected two deleted raw media files, saw ${JSON.stringify(capsuleEvent.capsuleSummary)}`);
  }
  if (!fakeTurnCapture.inputTypes.includes("localImage") || fakeTurnCapture.localImagePaths[0] !== screenshotPath) {
    throw new Error(`Expected screenshot to be sent as localImage: ${JSON.stringify(fakeTurnCapture)}`);
  }
  if (fakeTurnCapture.rawMediaPathMentioned) {
    throw new Error("Raw media path leaked into app-server input.");
  }
  if (!completed.text.includes("semantic-decision=hold-semantic-acceptance")) {
    throw new Error(`Fake app-server did not make the expected hold decision: ${completed.text}`);
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    sourceReportPath: relativeForReport(sourceReportPath),
    screenshotPath: relativeForReport(screenshotPath),
    daemonPort: daemon.port,
    captureId,
    capsuleSummary: capsuleEvent.capsuleSummary,
    appServerResponse: completed.text,
    appServerInput: {
      inputTypes: fakeTurnCapture.inputTypes,
      localImagePaths: fakeTurnCapture.localImagePaths.map(relativeForReport),
      localImageCount: fakeTurnCapture.localImagePaths.length,
      textLength: fakeTurnCapture.inputText.length,
      containsSemanticResidual: fakeTurnCapture.containsSemanticResidual,
      containsSemanticGuidance: fakeTurnCapture.containsSemanticGuidance,
      rawMediaPathMentioned: fakeTurnCapture.rawMediaPathMentioned,
      textExcerpt: fakeTurnCapture.inputText.slice(0, 1200)
    },
    rawMediaDeleted
  };
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`vision context dogfood evidence ok: ${relativeForReport(artifactPath)}`);
} finally {
  socket?.close();
  if (daemon) {
    await daemon.close();
  }
  restoreEnv();
  rmSync(tempDir, { recursive: true, force: true });
}

function readSemanticAcceptanceExcerpt(report) {
  const row = report.split(/\r?\n/).find((line) => line.includes("| Semantic acceptance evidence |"));
  const findingStart = report.indexOf("### review-semantic-acceptance-evidence-still-needed");
  const nextSection = report.indexOf("## Suggested next-sprint scope", findingStart);
  const finding = findingStart >= 0 && nextSection > findingStart
    ? report.slice(findingStart, nextSection).trim()
    : "";
  if (!row || !finding) {
    throw new Error("Unable to extract semantic acceptance residual from dogfood review report.");
  }
  return [
    "Source: /vibe-review dogfood verification v1.7.8",
    row,
    "",
    finding
  ].join("\n");
}

async function captureReportScreenshot({ semanticExcerpt }) {
  const html = `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    background: #f5f7fb;
    color: #111827;
    font-family: Inter, "Segoe UI", Arial, sans-serif;
  }
  main {
    width: 1100px;
    padding: 44px 56px;
  }
  h1 {
    margin: 0 0 22px;
    font-size: 30px;
    font-weight: 750;
  }
  .frame {
    border: 1px solid #c7d2fe;
    background: #ffffff;
    padding: 28px;
    border-radius: 8px;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.48;
    font-size: 18px;
  }
</style>
<main>
  <h1>Vision Context dogfood source: semantic acceptance residual</h1>
  <section class="frame"><pre>${escapeHtml(semanticExcerpt)}</pre></section>
</main>
</html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

function prepareFakeCodex() {
  const fakeCodexPath = join(tempDir, "fake-codex.mjs");
  const fakeCodexSource = `
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const requireFromRepo = createRequire(${JSON.stringify(pathToFileURL(join(root, "package.json")).href)});
const { WebSocketServer } = requireFromRepo("ws");
const args = process.argv.slice(2);
const capturePath = ${JSON.stringify(fakeTurnCapturePath)};
const rawVideoPath = ${JSON.stringify(join(tempDir, "semantic-dogfood.webm"))};
const rawAudioPath = ${JSON.stringify(join(tempDir, "semantic-dogfood.wav"))};

if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in");
  process.exit(0);
}

if (args[0] === "login") {
  console.log("Logged in");
  process.exit(0);
}

if (args[0] !== "app-server") {
  console.error("fake codex only supports login and app-server");
  process.exit(2);
}

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 }, () => {
  const address = wss.address();
  if (typeof address === "object" && address) {
    console.error(\`listening on: ws://127.0.0.1:\${address.port}\`);
  }
});

let nextThread = 1;
let nextTurn = 1;
const threads = new Map();

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.method) {
      return;
    }
    if (message.method === "initialize") {
      respond(socket, message.id, { serverInfo: { name: "fake-codex-app-server" } });
      return;
    }
    if (message.method === "initialized") {
      return;
    }
    if (message.method === "thread/start") {
      const threadId = \`thread-\${nextThread++}\`;
      threads.set(threadId, []);
      respond(socket, message.id, { thread: { id: threadId } });
      return;
    }
    if (message.method === "turn/start") {
      const params = readRecord(message.params);
      const turnId = \`turn-\${nextTurn++}\`;
      const input = Array.isArray(params.input) ? params.input.map(readRecord) : [];
      const inputText = input.map((item) => item.text).filter((value) => typeof value === "string").join("\\n");
      const inputTypes = input.map((item) => String(item.type ?? "unknown"));
      const localImagePaths = input.filter((item) => item.type === "localImage" && typeof item.path === "string").map((item) => item.path);
      const capture = {
        inputTypes,
        inputText,
        localImagePaths,
        containsSemanticResidual: inputText.includes("PASS WITH RESIDUAL") && inputText.includes("dogfood-ready"),
        containsSemanticGuidance: inputText.includes("not semantically accepted") || inputText.includes("transcript") || inputText.includes("task-quality artifact"),
        rawMediaPathMentioned: inputText.includes(rawVideoPath) || inputText.includes(rawAudioPath) || input.some((item) => item.path === rawVideoPath || item.path === rawAudioPath)
      };
      writeFileSync(capturePath, JSON.stringify(capture, null, 2));
      respond(socket, message.id, { turn: { id: turnId } });
      const decision = capture.containsSemanticResidual && capture.containsSemanticGuidance && localImagePaths.length > 0 && !capture.rawMediaPathMentioned
        ? "hold-semantic-acceptance"
        : "insufficient-context";
      const text = \`semantic-decision=\${decision}; local-images=\${localImagePaths.length}; residual=\${capture.containsSemanticResidual}; guidance=\${capture.containsSemanticGuidance}; raw-media-mentioned=\${capture.rawMediaPathMentioned}\`;
      setTimeout(() => {
        notify(socket, "item/agentMessage/delta", { turnId, delta: text });
        notify(socket, "turn/completed", { turn: { id: turnId, status: "completed" } });
      }, 10);
    }
  });
});

function respond(socket, id, result) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function notify(socket, method, params) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function readRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
}
`;
  writeFileSync(fakeCodexPath, fakeCodexSource);

  if (process.platform === "win32") {
    writeFileSync(join(tempDir, "codex.cmd"), `@echo off\r\n"${process.execPath}" "${fakeCodexPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`);
  } else {
    const shimPath = join(tempDir, "codex");
    writeFileSync(shimPath, `#!/usr/bin/env sh\nexec "${process.execPath}" "${fakeCodexPath}" "$@"\n`);
    chmodSync(shimPath, 0o755);
  }
}

function waitForEvent(events, predicate, label, timeoutMs = 15_000) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolvePromise, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const event = events.find(predicate);
      if (event) {
        clearInterval(timer);
        resolvePromise(event);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}. Events: ${JSON.stringify(events.slice(-10))}`));
      }
    }, 25);
  });
}

function restoreEnv() {
  restoreEnvValue("CODEX_WIDGET_AUTH_MODE", previousEnv.authMode);
  restoreEnvValue("CODEX_WIDGET_CODEX_RUNTIME", previousEnv.runtime);
  restoreEnvValue("CODEX_WIDGET_CODEX_WORKDIR", previousEnv.workdir);
  restoreEnvValue("CODEX_WIDGET_CODEX_APPROVAL_POLICY", previousEnv.approvalPolicy);
  restoreEnvValue("CODEX_WIDGET_APP_DATA_DIR", previousEnv.appDataDir);
  restoreEnvValue("CODEX_WIDGET_STORAGE_DB_PATH", previousEnv.storageDbPath);
  restoreEnvValue("CODEX_WIDGET_BLOB_DIR", previousEnv.blobDir);
  restoreEnvValue("PATH", previousEnv.path);
}

function restoreEnvValue(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function relativeForReport(path) {
  return path.replace(`${root}\\`, "").replaceAll("\\", "/");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
