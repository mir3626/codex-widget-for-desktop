import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";

const root = resolve(".");
const tempDir = join(tmpdir(), `codex-widget-app-server-smoke-${process.pid}`);
mkdirSync(tempDir, { recursive: true });

const fakeCodexPath = join(tempDir, "fake-codex.mjs");
const fakeCodexSource = `
import { createRequire } from "node:module";

const requireFromRepo = createRequire(${JSON.stringify(pathToFileURL(join(root, "package.json")).href)});
const { WebSocketServer } = requireFromRepo("ws");
const args = process.argv.slice(2);

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

const threads = new Map();
let nextThread = 1;
let nextTurn = 1;
let nextRequest = 1;

wss.on("connection", (socket) => {
  const pendingClientResponses = new Map();

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id !== undefined && !message.method) {
      const pending = pendingClientResponses.get(String(message.id));
      if (pending) {
        pendingClientResponses.delete(String(message.id));
        pending.resolve(message.result);
      }
      return;
    }

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
      threads.set(threadId, { inputs: [], rollbacks: 0 });
      respond(socket, message.id, { thread: { id: threadId } });
      return;
    }

    if (message.method === "thread/rollback") {
      const params = readRecord(message.params);
      const thread = threads.get(String(params.threadId));
      if (thread) {
        const count = Math.max(0, Math.floor(Number(params.numTurns ?? 0)));
        thread.inputs.splice(Math.max(0, thread.inputs.length - count), count);
        thread.rollbacks += 1;
      }
      respond(socket, message.id, { ok: true });
      return;
    }

    if (message.method === "turn/start") {
      const params = readRecord(message.params);
      const threadId = String(params.threadId);
      const thread = threads.get(threadId);
      const turnId = \`turn-\${nextTurn++}\`;
      const inputText = readInputText(params.input);
      const localImageCount = readInputCount(params.input, "localImage");
      if (thread) {
        thread.inputs.push(inputText);
      }
      respond(socket, message.id, { turn: { id: turnId } });
      void runTurn(socket, pendingClientResponses, threadId, thread, turnId, inputText, { localImageCount });
      return;
    }

    if (message.method === "turn/interrupt") {
      respond(socket, message.id, { ok: true });
    }
  });
});

async function runTurn(socket, pendingClientResponses, threadId, thread, turnId, inputText, metadata = {}) {
  let approvalDecision = "not-requested";
  if (inputText.includes("needs approval")) {
    const approval = await requestClient(socket, pendingClientResponses, "item/commandExecution/requestApproval", {
      item: {
        command: "echo approved",
        reason: "fake command approval"
      }
    });
    approvalDecision = normalizeApprovalDecision(readRecord(approval).decision);
  }
  if (inputText.includes("open browser")) {
    const approval = await requestClient(socket, pendingClientResponses, "item/openUrl/requestApproval", {
      item: {
        type: "openUrl",
        url: "https://example.test/docs",
        reason: "fake browser open approval"
      }
    });
    approvalDecision = normalizeApprovalDecision(readRecord(approval).decision);
  }
  if (inputText.includes("open google with powershell")) {
    const approval = await requestClient(socket, pendingClientResponses, "item/commandExecution/requestApproval", {
      item: {
        command: "\\"C:\\\\Program Files\\\\WindowsApps\\\\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\\\\pwsh.exe\\" -Command 'Start-Process \\"https://www.google.com\\"'",
        reason: "fake PowerShell browser open approval"
      }
    });
    approvalDecision = normalizeApprovalDecision(readRecord(approval).decision);
  }
  if (inputText.includes("powershell command approval")) {
    const approval = await requestClient(socket, pendingClientResponses, "item/commandExecution/requestApproval", {
      item: {
        command: "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \\"Get-Date\\"",
        reason: "fake PowerShell command approval"
      }
    });
    approvalDecision = normalizeApprovalDecision(readRecord(approval).decision);
  }
  if (inputText.includes("powershell remembered policy")) {
    const approval = await requestClient(socket, pendingClientResponses, "item/commandExecution/requestApproval", {
      item: {
        command: "pwsh -NoProfile -Command \\"Write-Output remembered\\"",
        reason: "fake remembered PowerShell command approval"
      }
    });
    approvalDecision = normalizeApprovalDecision(readRecord(approval).decision);
  }

  const history = thread?.inputs.join("\\n") ?? "";
  const remembered = history.includes("alpha") ? "alpha" : "none";
  const hasAlpha = history.includes("alpha");
  const hasBeta = history.includes("beta");
  const text = inputText.includes("what can the PTY button do")
    ? \`widgetContext=\${inputText.includes("Codex Widget desktop context:")}; pty=\${inputText.includes("PTY button/use cases")}; controls=\${inputText.includes("Mode tabs: Agent")}; persona=\${inputText.includes("Default Dog")}\`
    : inputText.includes("session beta isolated")
    ? \`thread=\${threadId}; history=\${thread?.inputs.length ?? 0}; alpha=\${hasAlpha}; beta=\${hasBeta}\`
    : inputText.includes("session alpha rebound")
    ? \`thread=\${threadId}; history=\${thread?.inputs.length ?? 0}; alpha=\${hasAlpha}; beta=\${hasBeta}\`
    : inputText.includes("what remains after rollback")
    ? \`thread=\${threadId}; history=\${thread?.inputs.length ?? 0}; rollbacks=\${thread?.rollbacks ?? 0}; remembered=\${remembered}\`
    : inputText.includes("needs approval")
      ? \`approved=\${approvalDecision}; remembered=\${remembered}; history=\${thread?.inputs.length ?? 0}\`
    : inputText.includes("open browser")
      ? \`browser-open=\${approvalDecision}; history=\${thread?.inputs.length ?? 0}\`
    : inputText.includes("open google with powershell")
      ? \`powershell-browser-open=\${approvalDecision}; history=\${thread?.inputs.length ?? 0}\`
    : inputText.includes("powershell command approval") || inputText.includes("powershell remembered policy")
      ? \`powershell-approved=\${approvalDecision}; history=\${thread?.inputs.length ?? 0}\`
    : inputText.includes("Vision Context Task")
      ? \`vision-context-local-images=\${metadata.localImageCount ?? 0}; history=\${thread?.inputs.length ?? 0}\`
      : \`stored alpha; history=\${thread?.inputs.length ?? 0}\`;

  const midpoint = Math.max(1, Math.floor(text.length / 2));
  await delay(10);
  notify(socket, "item/agentMessage/delta", { turnId, delta: text.slice(0, midpoint) });
  await delay(10);
  notify(socket, "item/agentMessage/delta", { turnId, delta: text.slice(midpoint) });
  await delay(5);
  notify(socket, "turn/completed", { turn: { id: turnId, status: "completed" } });
}

function requestClient(socket, pendingClientResponses, method, params) {
  const id = \`server-\${nextRequest++}\`;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingClientResponses.delete(id);
      reject(new Error(\`\${method} timed out\`));
    }, 5000);
    pendingClientResponses.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      }
    });
  });
}

function respond(socket, id, result) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function notify(socket, method, params) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function readInputText(input) {
  return Array.isArray(input)
    ? input.map((item) => readRecord(item).text).filter((value) => typeof value === "string").join("\\n")
    : "";
}

function readInputCount(input, type) {
  return Array.isArray(input) ? input.filter((item) => readRecord(item).type === type).length : 0;
}

function readRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
}

function normalizeApprovalDecision(value) {
  if (value === "accept" || value === "acceptForSession") {
    return "approve";
  }
  return typeof value === "string" ? value : "missing";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;
writeFileSync(fakeCodexPath, fakeCodexSource);

if (process.platform === "win32") {
  writeFileSync(
    join(tempDir, "codex.cmd"),
    `@echo off\r\n"${process.execPath}" "${fakeCodexPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`
  );
} else {
  const shimPath = join(tempDir, "codex");
  writeFileSync(shimPath, `#!/usr/bin/env sh\nexec "${process.execPath}" "${fakeCodexPath}" "$@"\n`);
  chmodSync(shimPath, 0o755);
}

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

process.env.CODEX_WIDGET_AUTH_MODE = "codex";
process.env.CODEX_WIDGET_CODEX_RUNTIME = "app-server";
process.env.CODEX_WIDGET_CODEX_WORKDIR = root;
process.env.CODEX_WIDGET_CODEX_APPROVAL_POLICY = "on-request";
process.env.CODEX_WIDGET_APP_DATA_DIR = join(tempDir, "app-data");
delete process.env.CODEX_WIDGET_STORAGE_DB_PATH;
delete process.env.CODEX_WIDGET_BLOB_DIR;
process.env.PATH = `${tempDir}${delimiter}${process.env.PATH ?? ""}`;

const daemon = await startDaemon({ port: 0 });
const events = [];
let rememberNextApproval = true;
let socket;

try {
  socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
  socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    events.push(event);
    if (event.type === "interaction.required" && event.interaction.kind === "approval") {
      socket.send(
        JSON.stringify({
          type: "interaction.respond",
          id: event.interaction.id,
          decision: rememberNextApproval ? "always_allow" : "approve",
          action: event.interaction.action
        })
      );
      rememberNextApproval = false;
    }
  });

  await waitForEvent((event) => event.type === "connected", "connected");
  const connected = events.find((event) => event.type === "connected");
  if (connected?.daemon?.auth?.mode !== "codex" || connected.daemon.auth.authenticated !== true) {
    throw new Error(`Expected authenticated codex connection: ${JSON.stringify(connected)}`);
  }
  const initialSnapshot = await waitForEvent((event) => event.type === "session.snapshot", "initial session snapshot");
  const sessionA = initialSnapshot.snapshot.activeSessionId;
  if (!sessionA) {
    throw new Error("Expected an initial active session.");
  }

  socket.send(JSON.stringify({ type: "ask", id: "app-1", text: "remember alpha", mode: "agent" }));
  const first = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-1",
    "first app-server completion"
  );
  if (!first.text.includes("stored alpha")) {
    throw new Error(`Unexpected first response: ${first.text}`);
  }

  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-2",
      text: "needs approval and recall alpha",
      mode: "agent"
    })
  );
  await waitForEvent(
    (event) => event.type === "interaction.required" && event.interaction.requestId === "app-2",
    "approval interaction"
  );
  const second = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-2",
    "second app-server completion"
  );
  if (!second.text.includes("approved=approve") || !second.text.includes("remembered=alpha")) {
    throw new Error(`Approval/context response mismatch: ${second.text}`);
  }

  const permissionSnapshot = await waitForEvent(
    (event) =>
      event.type === "execution.permissions" &&
      event.permissions?.some((permission) => permission.action === "echo approved" && permission.decision === "allow"),
    "remembered execution permission"
  );
  if (!permissionSnapshot.permissions.some((permission) => permission.action === "echo approved" && permission.decision === "allow")) {
    throw new Error(`Saved execution permission missing: ${JSON.stringify(permissionSnapshot)}`);
  }

  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-2b",
      text: "needs approval remembered policy",
      mode: "agent"
    })
  );
  const rememberedApproval = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-2b",
    "remembered approval completion"
  );
  if (!rememberedApproval.text.includes("approved=approve")) {
    throw new Error(`Saved approval did not approve the next request: ${rememberedApproval.text}`);
  }

  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-3",
      text: "what remains after rollback",
      mode: "agent",
      regenerate: { dropTurns: 1 }
    })
  );
  const third = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-3",
    "rollback app-server completion"
  );
  if (!third.text.includes("rollbacks=1") || !third.text.includes("history=3") || !third.text.includes("remembered=alpha")) {
    throw new Error(`Rollback response mismatch: ${third.text}`);
  }

  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-4",
      text: "what can the PTY button do?",
      mode: "agent"
    })
  );
  const fourth = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-4",
    "widget context app-server completion"
  );
  if (!fourth.text.includes("widgetContext=true") || !fourth.text.includes("pty=true") || !fourth.text.includes("controls=true") || !fourth.text.includes("persona=true")) {
    throw new Error(`Widget context was not injected into app-server turns: ${fourth.text}`);
  }

  const externalUrlEventsBeforeBrowserOpen = events.filter((event) => event.type === "external.url").length;
  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-open-browser",
      text: "open browser to docs",
      mode: "agent"
    })
  );
  const browserOpen = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-open-browser",
    "browser open approval completion"
  );
  if (!browserOpen.text.includes("browser-open=approve")) {
    throw new Error(`Browser open approval did not approve: ${browserOpen.text}`);
  }
  const externalUrlEventsAfterBrowserOpen = events.filter((event) => event.type === "external.url").length;
  if (externalUrlEventsAfterBrowserOpen !== externalUrlEventsBeforeBrowserOpen) {
    throw new Error("Browser open approval should not emit external.url; Codex runtime owns the side effect.");
  }

  const externalUrlEventsBeforePowerShellOpen = events.filter((event) => event.type === "external.url").length;
  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-open-google-powershell",
      text: "open google with powershell",
      mode: "agent"
    })
  );
  const googlePowerShellOpen = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-open-google-powershell",
    "PowerShell browser open approval completion"
  );
  if (!googlePowerShellOpen.text.includes("powershell-browser-open=approve")) {
    throw new Error(`PowerShell browser-open approval did not approve: ${googlePowerShellOpen.text}`);
  }
  const externalUrlEventsAfterPowerShellOpen = events.filter((event) => event.type === "external.url").length;
  if (externalUrlEventsAfterPowerShellOpen !== externalUrlEventsBeforePowerShellOpen) {
    throw new Error("PowerShell browser-open approval should not emit external.url; Codex runtime owns the side effect.");
  }

  rememberNextApproval = true;
  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-powershell-approval",
      text: "powershell command approval",
      mode: "agent"
    })
  );
  const powerShellApproval = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-powershell-approval",
    "PowerShell approval completion"
  );
  if (!powerShellApproval.text.includes("powershell-approved=approve")) {
    throw new Error(`PowerShell command approval did not approve: ${powerShellApproval.text}`);
  }
  await waitForEvent(
    (event) =>
      event.type === "execution.permissions" &&
      event.permissions?.some((permission) => permission.action === "PowerShell command" && permission.decision === "allow"),
    "remembered PowerShell permission"
  );
  const interactionsBeforePowerShellRemembered = events.filter((event) => event.type === "interaction.required").length;
  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-powershell-remembered",
      text: "powershell remembered policy",
      mode: "agent"
    })
  );
  const powerShellRemembered = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-powershell-remembered",
    "remembered PowerShell approval completion"
  );
  if (!powerShellRemembered.text.includes("powershell-approved=approve")) {
    throw new Error(`Remembered PowerShell policy did not approve: ${powerShellRemembered.text}`);
  }
  const interactionsAfterPowerShellRemembered = events.filter((event) => event.type === "interaction.required").length;
  if (interactionsAfterPowerShellRemembered !== interactionsBeforePowerShellRemembered) {
    throw new Error("Remembered PowerShell policy still showed an approval interaction.");
  }

  socket.send(JSON.stringify({ type: "session.create", title: "session beta", mode: "agent" }));
  const betaSnapshot = await waitForEvent(
    (event) => event.type === "session.snapshot" && event.snapshot.activeSessionId !== sessionA,
    "beta session snapshot"
  );
  const sessionB = betaSnapshot.snapshot.activeSessionId;
  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-beta",
      text: "session beta isolated",
      mode: "agent",
      sessionId: sessionB
    })
  );
  const beta = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-beta",
    "beta session completion"
  );
  if (!beta.text.includes("thread=thread-2") || !beta.text.includes("history=1") || !beta.text.includes("alpha=false") || !beta.text.includes("beta=true")) {
    throw new Error(`Session B should use an isolated app-server thread: ${beta.text}`);
  }

  socket.send(JSON.stringify({ type: "session.open", sessionId: sessionA }));
  await waitForEvent(
    (event) => event.type === "session.snapshot" && event.snapshot.activeSessionId === sessionA,
    "session A reopen snapshot"
  );
  socket.send(
    JSON.stringify({
      type: "ask",
      id: "app-alpha-rebound",
      text: "session alpha rebound",
      mode: "agent",
      sessionId: sessionA
    })
  );
  const alphaRebound = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-alpha-rebound",
    "session A rebound completion"
  );
  if (!alphaRebound.text.includes("thread=thread-1") || !alphaRebound.text.includes("alpha=true") || alphaRebound.text.includes("beta=true")) {
    throw new Error(`Session A should rebind to its original app-server thread: ${alphaRebound.text}`);
  }

  const visionImagePath = join(tempDir, "vision-context-local-image.png");
  writeFileSync(visionImagePath, "vision-local-image");
  socket.send(
    JSON.stringify({
      type: "visionContext.start",
      captureId: "vision-context-app-server-smoke",
      sessionId: sessionA,
      source: {
        kind: "screen",
        appName: "Smoke",
        windowTitle: "Vision Context smoke",
        viewport: { width: 800, height: 600 }
      }
    })
  );
  await waitForEvent(
    (event) => event.type === "visionContext.started" && event.captureId === "vision-context-app-server-smoke",
    "vision context start"
  );
  socket.send(
    JSON.stringify({
      type: "visionContext.event",
      captureId: "vision-context-app-server-smoke",
      event: {
        type: "speech",
        t: 10,
        text: "이 화면을 설명해줘",
        confidence: 0.9
      }
    })
  );
  socket.send(
    JSON.stringify({
      type: "visionContext.event",
      captureId: "vision-context-app-server-smoke",
      event: {
        type: "screenshot",
        t: 20,
        path: visionImagePath,
        purpose: "full"
      }
    })
  );
  socket.send(
    JSON.stringify({
      type: "visionContext.stop",
      captureId: "vision-context-app-server-smoke",
      sendToAgent: true,
      requestId: "app-vision-context",
      sessionId: sessionA
    })
  );
  await waitForEvent(
    (event) => event.type === "visionContext.sent" && event.requestId === "app-vision-context",
    "vision context sent"
  );
  const visionContextTurn = await waitForEvent(
    (event) => event.type === "message.completed" && event.id === "app-vision-context",
    "vision context app-server completion"
  );
  if (!visionContextTurn.text.includes("vision-context-local-images=1")) {
    throw new Error(`Vision Context turn did not send a localImage input: ${visionContextTurn.text}`);
  }

  const deltaCount = events.filter((event) => event.type === "message.delta").length;
  const approvalCount = events.filter((event) => event.type === "interaction.required").length;
  const appliedPermissionCount = events.filter((event) => event.type === "execution.permission.applied").length;
  await waitForEvent(
    (event) => event.type === "runtime.status" && event.status?.codexAppServer?.state === "connected",
    "connected app-server runtime status",
    7000
  );
  if (deltaCount < 6) {
    throw new Error(`Expected streaming deltas from app-server, saw ${deltaCount}.`);
  }
  if (approvalCount !== 4) {
    throw new Error(`Expected exactly four approval interactions, saw ${approvalCount}.`);
  }
  if (appliedPermissionCount < 2) {
    throw new Error(`Expected saved execution permission to be applied, saw ${appliedPermissionCount}.`);
  }

  console.log(`codex app-server smoke ok: ${deltaCount} deltas, ${approvalCount} approvals, port ${daemon.port}`);
} finally {
  socket?.close();
  await daemon.close();
  restoreEnv();
  rmSync(tempDir, { recursive: true, force: true });
}

function waitForEvent(predicate, label, timeoutMs = 8000) {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);

    const interval = setInterval(() => {
      const match = events.find(predicate);
      if (!match) {
        return;
      }
      clearTimeout(timeout);
      clearInterval(interval);
      resolvePromise(match);
    }, 10);
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

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
