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
      if (thread) {
        thread.inputs.push(inputText);
      }
      respond(socket, message.id, { turn: { id: turnId } });
      void runTurn(socket, pendingClientResponses, threadId, thread, turnId, inputText);
      return;
    }

    if (message.method === "turn/interrupt") {
      respond(socket, message.id, { ok: true });
    }
  });
});

async function runTurn(socket, pendingClientResponses, threadId, thread, turnId, inputText) {
  let approvalDecision = "not-requested";
  if (inputText.includes("needs approval")) {
    const approval = await requestClient(socket, pendingClientResponses, "item/commandExecution/requestApproval", {
      item: {
        command: "echo approved",
        reason: "fake command approval"
      }
    });
    approvalDecision = readRecord(approval).decision ?? "missing";
  }

  const history = thread?.inputs.join("\\n") ?? "";
  const remembered = history.includes("alpha") ? "alpha" : "none";
  const text = inputText.includes("what remains after rollback")
    ? \`thread=\${threadId}; history=\${thread?.inputs.length ?? 0}; rollbacks=\${thread?.rollbacks ?? 0}; remembered=\${remembered}\`
    : inputText.includes("needs approval")
      ? \`approved=\${approvalDecision}; remembered=\${remembered}; history=\${thread?.inputs.length ?? 0}\`
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

function readRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
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
  path: process.env.PATH
};

process.env.CODEX_WIDGET_AUTH_MODE = "codex";
process.env.CODEX_WIDGET_CODEX_RUNTIME = "app-server";
process.env.CODEX_WIDGET_CODEX_WORKDIR = root;
process.env.CODEX_WIDGET_CODEX_APPROVAL_POLICY = "on-request";
process.env.PATH = `${tempDir}${delimiter}${process.env.PATH ?? ""}`;

const daemon = await startDaemon({ port: 0 });
const events = [];
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
          decision: "approve"
        })
      );
    }
  });

  await waitForEvent((event) => event.type === "connected", "connected");
  const connected = events.find((event) => event.type === "connected");
  if (connected?.daemon?.auth?.mode !== "codex" || connected.daemon.auth.authenticated !== true) {
    throw new Error(`Expected authenticated codex connection: ${JSON.stringify(connected)}`);
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
  if (!third.text.includes("rollbacks=1") || !third.text.includes("history=2") || !third.text.includes("remembered=alpha")) {
    throw new Error(`Rollback response mismatch: ${third.text}`);
  }

  const deltaCount = events.filter((event) => event.type === "message.delta").length;
  const approvalCount = events.filter((event) => event.type === "interaction.required").length;
  await waitForEvent(
    (event) => event.type === "runtime.status" && event.status?.codexAppServer?.state === "connected",
    "connected app-server runtime status",
    7000
  );
  if (deltaCount < 6) {
    throw new Error(`Expected streaming deltas from app-server, saw ${deltaCount}.`);
  }
  if (approvalCount !== 1) {
    throw new Error(`Expected exactly one approval interaction, saw ${approvalCount}.`);
  }

  console.log(`codex app-server smoke ok: ${deltaCount} deltas, ${approvalCount} approval, port ${daemon.port}`);
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
  restoreEnvValue("PATH", previousEnv.path);
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
