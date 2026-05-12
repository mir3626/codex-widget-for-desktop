import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentSessionState } from "./agent.js";
import { CodexAppServerBridge } from "./codexAppServer.js";
import { OAuthSession } from "./oauth.js";
import { ProviderRegistry } from "./providers/providerRegistry.js";
import { subscribeTerminalSessionOutput } from "./providers/terminalSessionProvider.js";
import { createStorageService } from "./storage/storage.js";
import { BrowserActionSessionManager } from "./browser-action/index.js";
import type { BrowserAction, BrowserActionSource, BrowserElement } from "./browser-action/types.js";
import { BrowserChromeCommandBridge, readBrowserChromeCommand } from "./browser-chrome/index.js";
import { BrowserPerceptionService } from "./browser-perception/index.js";
import { CapabilityRuntime, mapCapabilityRuntimeEvent } from "./capability-runtime/index.js";
import { VisionContextSessionManager } from "./vision-context/index.js";
import { browserActionAppServerClientToolContract } from "./agent-tools/index.js";
import { runNativeDesktopHelper } from "./browser-action/adapters/nativeDesktop/helperClient.js";
import { captureScreenSnapshot, resolveBundledOcrCommand } from "./providers/screenCaptureProvider.js";
import { createSemanticMemoryStore } from "./semantic-interface/index.js";
import { createBrowserExtensionBridgeStore } from "./server/browser-bridge/store.js";
import { readExpectedBrowserBridgeBuildInfo } from "./server/browser-bridge/extensionBuild.js";
import {
  clearBrowserActionCommandWaiters,
  type BrowserActionCommandWaiter
} from "./server/browser-action/commandWaiters.js";
import { broadcast, type RetainedMessage } from "./server/events.js";
import { getServerPort } from "./server/http.js";
import { readRuntimeStatus } from "./server/runtimeStatus.js";
import {
  type PendingSemanticClarification
} from "./server/browser-action/clarification.js";
import { handleHttpRequest } from "./server/http/routes.js";
import { syncCodexAppServer } from "./server/runtime/codexAppServerThread.js";
import { handleWebSocketConnection } from "./server/ws/connection.js";

export type DaemonHandle = {
  port: number;
  close: () => Promise<void>;
};

export type DaemonOptions = {
  port?: number;
};

export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonHandle> {
  let serverRef: Server | undefined;
  const controllers = new Map<string, AbortController>();
  const retainedMessages = new Map<string, RetainedMessage>();
  const toolOutputBuffers = new Map<string, Map<string, string>>();
  const clients = new Set<WebSocket>();
  const startedAt = Date.now();
  const auth = new OAuthSession(() => (serverRef ? getServerPort(serverRef) : 0));
  const codexAppServer = new CodexAppServerBridge();
  const providers = new ProviderRegistry();
  const browserPerception = new BrowserPerceptionService();
  const visionContext = new VisionContextSessionManager();
  const browserExtensionBridge = createBrowserExtensionBridgeStore({
    expectedBuild: readExpectedBrowserBridgeBuildInfo()
  });
  const storage = createStorageService();
  const semanticMemory = createSemanticMemoryStore();
  const browserActions = new BrowserActionSessionManager(undefined, semanticMemory);
  const browserChromeCommands = new BrowserChromeCommandBridge();
  const capabilityRuntime = new CapabilityRuntime({
    storage,
    emit: (event) => broadcast(clients, mapCapabilityRuntimeEvent(event))
  });
  const semanticClarifications = new Map<string, PendingSemanticClarification>();
  const browserActionCommandWaiters = new Map<string, BrowserActionCommandWaiter>();
  const requestSessions = new Map<string, string>();
  const agentSession: AgentSessionState = {};
  const unsubscribeTerminalOutput = subscribeTerminalSessionOutput((chunk) => {
    broadcast(clients, { type: "terminal.output", id: "terminal-session", chunk });
  });
  const onAuthChanged = () => {
    broadcast(clients, { type: "auth.status", auth: auth.getStatus() });
    syncCodexAppServer(auth, codexAppServer);
  };
  capabilityRuntime.register("screen_observe", async ({ job }) => {
    const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as { description?: string; crop?: unknown; timeoutMs?: number } : {};
    const capture = await captureScreenSnapshot({
      daemonPort: serverRef ? getServerPort(serverRef) : 0,
      description: input.description,
      crop: input.crop && typeof input.crop === "object" ? input.crop as never : undefined,
      timeoutMs: input.timeoutMs
    });
    return {
      output: { ok: true, output: capture.output },
      summary: "Screen observe capability completed."
    };
  });
  capabilityRuntime.register("desktop_action", async ({ job }) => {
    const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
    const command = input.command === "status" || input.command === "observe" || input.command === "execute" ? input.command : "observe";
    const session = {
      id: job.id,
      mode: "ask_before_action" as const,
      source: normalizeBrowserActionSource(input.source)
    };
    const response = command === "execute"
      ? await runNativeDesktopHelper({
          schemaVersion: "browser-native-desktop-helper.v1",
          requestId: job.id,
          command: "execute",
          timeoutMs: job.timeoutMs,
          session,
          action: readBrowserAction(input.action),
          target: readBrowserElement(input.target)
        })
      : await runNativeDesktopHelper({
          schemaVersion: "browser-native-desktop-helper.v1",
          requestId: job.id,
          command,
          timeoutMs: job.timeoutMs,
          session
        });
    return response.ok
      ? { output: response, summary: `Native desktop ${command} capability completed.` }
      : { status: "failed", output: response, error: response.error ?? `Native desktop ${command} failed.` };
  });
  capabilityRuntime.register("browser_chrome", async ({ job, signal }) => {
    const { command, payload } = readBrowserChromeCommand(job.inputJson);
    const response = await browserChromeCommands.run({ job, command, payload, signal });
    return response.ok
      ? {
          output: response,
          summary: `Browser Chrome ${command} capability completed.`,
          phase: "completed"
        }
      : {
          status: "failed",
          output: response,
          error: response.error ?? `Browser Chrome ${command} failed.`
      };
  });
  capabilityRuntime.register("ocr", async ({ job, helpers, resources, signal }) => {
    const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
    const inlineText = typeof input.text === "string" ? input.text : "";
    if (inlineText) {
      const output = storeOcrTextOutput({ job, resources, text: inlineText, metadata: { source: "inline_text" } });
      return { output, outputBlobIds: output.fullTextBlobId ? [output.fullTextBlobId] : undefined, summary: "OCR capability completed from inline text." };
    }
    const command = readOcrCommand(input);
    if (!command) {
      return { status: "failed", error: "OCR capability requires input.text, input.command, CODEX_WIDGET_SCREEN_OCR_COMMAND, or a bundled OCR runtime." };
    }
    const helper = await helpers.runJson({
      command: process.execPath,
      args: ["-e", OCR_CAPABILITY_HELPER_SCRIPT],
      request: {
        command,
        imagePath: typeof input.imagePath === "string" ? input.imagePath : "",
        maxChars: typeof input.maxChars === "number" ? input.maxChars : 20_000
      },
      timeoutMs: job.timeoutMs,
      signal,
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 128 * 1024
    });
    if (!helper.ok) {
      return { status: "failed", output: helper, error: helper.error ?? "OCR helper failed." };
    }
    const output = helper.output && typeof helper.output === "object" ? helper.output as Record<string, unknown> : {};
    const text = typeof output.text === "string" ? output.text : "";
    if (output.ok === false) {
      return { status: "failed", output, error: typeof output.stderr === "string" && output.stderr ? output.stderr : "OCR helper returned ok=false." };
    }
    const stored = storeOcrTextOutput({ job, resources, text, metadata: { ...(output.metadata && typeof output.metadata === "object" ? output.metadata as Record<string, unknown> : {}), source: "helper" } });
    return {
      output: {
        ...output,
        ...stored
      },
      outputBlobIds: stored.fullTextBlobId ? [stored.fullTextBlobId] : undefined,
      summary: "OCR capability completed through helper supervision."
    };
  });
  capabilityRuntime.register("terminal", async ({ job, helpers, signal }) => {
    const input = job.inputJson && typeof job.inputJson === "object" ? job.inputJson as Record<string, unknown> : {};
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (!command) {
      return { status: "failed", error: "Terminal capability requires a command string." };
    }
    const helper = await helpers.runJson({
      command: process.execPath,
      args: ["-e", TERMINAL_CAPABILITY_HELPER_SCRIPT],
      request: {
        command,
        cwd: typeof input.cwd === "string" ? input.cwd : process.cwd()
      },
      timeoutMs: job.timeoutMs,
      signal,
      maxStdoutBytes: 2 * 1024 * 1024,
      maxStderrBytes: 256 * 1024
    });
    if (!helper.ok) {
      return { status: "failed", output: helper, error: helper.error ?? "Terminal helper failed." };
    }
    const output = helper.output && typeof helper.output === "object" ? helper.output as Record<string, unknown> : {};
    return output.exitCode === 0
      ? { output: helper.output, summary: "Terminal capability completed." }
      : { status: "failed", output: helper.output, error: typeof output.stderr === "string" && output.stderr ? output.stderr : `Terminal command exited with ${output.exitCode}.` };
  });
  capabilityRuntime.register("agent_tool", async ({ job }) => {
    const input = readAgentToolCapabilityInput(job.inputJson);
    if (input.runtime === "app_server_client_tool") {
      return {
        status: "failed",
        output: {
          ok: false,
          status: "blocked",
          contract: browserActionAppServerClientToolContract
        },
        error: browserActionAppServerClientToolContract.reason
      };
    }
    return {
      output: {
        ok: true,
        status: "available",
        runtime: "simulated_daemon",
        toolId: input.toolId,
        capability: input.capability,
        request: input.request
      },
      summary: `Agent tool capability boundary completed: ${input.toolId}`
    };
  });
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, auth, onAuthChanged, providers, browserPerception, browserActions, browserChromeCommands, browserExtensionBridge, clients, storage, capabilityRuntime, semanticMemory, browserActionCommandWaiters);
  });
  serverRef = server;
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    handleWebSocketConnection({
      socket,
      serverPort: getServerPort(server),
      startedAt,
      controllers,
      retainedMessages,
      toolOutputBuffers,
      auth,
      clients,
      requestSessions,
      storage,
      agentSession,
      codexAppServer,
      providers,
      browserPerception,
      visionContext,
      capabilityRuntime,
      browserActions,
      browserChromeCommands,
      browserExtensionBridge,
      semanticMemory,
      semanticClarifications,
      browserActionCommandWaiters
    });
  });

  const requestedPort = options.port ?? Number(process.env.CODEX_WIDGET_PORT ?? 0);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  capabilityRuntime.reconcileStartup();
  syncCodexAppServer(auth, codexAppServer);
  const runtimeStatusTimer = setInterval(() => {
    broadcast(clients, { type: "runtime.status", status: readRuntimeStatus(startedAt, clients, controllers, codexAppServer, storage) });
  }, 5_000);

  return {
    port: getServerPort(server),
    close: async () => {
      clearInterval(runtimeStatusTimer);
      await capabilityRuntime.shutdown();
      browserChromeCommands.cancelAll("daemon_shutdown");
      unsubscribeTerminalOutput();
      await new Promise<void>((resolve, reject) => {
        for (const controller of controllers.values()) {
          controller.abort();
        }
        wss.close((wssError) => {
          if (wssError) {
            reject(wssError);
            return;
          }
          server.close((serverError) => {
            if (serverError) {
              reject(serverError);
              return;
            }
            resolve();
          });
        });
      });
      try {
        await codexAppServer.close();
      } finally {
        try {
          storage.close();
        } finally {
          clearBrowserActionCommandWaiters(browserActionCommandWaiters);
          semanticMemory.close();
        }
      }
    }
  };
}

function normalizeBrowserActionSource(input: unknown): BrowserActionSource {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const kind = source.kind === "active_tab" || source.kind === "tab" || source.kind === "controlled_browser" || source.kind === "debug_target"
    ? source.kind
    : "active_tab";
  const browser = source.browser === "chrome" || source.browser === "edge" || source.browser === "chromium" || source.browser === "unknown"
    ? source.browser
    : undefined;
  return {
    kind,
    ...(browser ? { browser } : {}),
    ...(typeof source.tabId === "string" ? { tabId: source.tabId } : {}),
    ...(typeof source.url === "string" ? { url: source.url } : {}),
    ...(typeof source.title === "string" ? { title: source.title } : {}),
    ...(typeof source.windowId === "string" ? { windowId: source.windowId } : {}),
    ...(typeof source.viewRevision === "string" ? { viewRevision: source.viewRevision } : {}),
    ...(typeof source.routeKey === "string" ? { routeKey: source.routeKey } : {}),
    ...(source.freshness === "fresh" || source.freshness === "settling" || source.freshness === "stale" || source.freshness === "unknown" ? { freshness: source.freshness } : {})
  };
}

function readBrowserAction(input: unknown): BrowserAction {
  if (input && typeof input === "object" && typeof (input as Record<string, unknown>).type === "string") {
    return input as BrowserAction;
  }
  return { type: "read", reason: "No executable action payload was provided." };
}

function readBrowserElement(input: unknown): BrowserElement | undefined {
  return input && typeof input === "object" ? input as BrowserElement : undefined;
}

function readOcrCommand(input: Record<string, unknown>): string | undefined {
  const configured = typeof input.command === "string" && input.command.trim()
    ? input.command.trim()
    : process.env.CODEX_WIDGET_SCREEN_OCR_COMMAND?.trim() || resolveBundledOcrCommand();
  if (!configured) {
    return undefined;
  }
  const imagePath = typeof input.imagePath === "string" ? input.imagePath : "";
  if (imagePath && configured.includes("{image}")) {
    return configured.replace(/\{image\}/g, quoteShellArgument(imagePath));
  }
  if (imagePath && !configured.includes("{image}")) {
    return `${configured} ${quoteShellArgument(imagePath)}`;
  }
  return configured;
}

function storeOcrTextOutput(input: {
  job: import("../shared/protocol.js").CapabilityJobSummary;
  resources: import("./capability-runtime/index.js").CapabilityResourceManagerLike;
  text: string;
  metadata?: Record<string, unknown>;
}): { ok: true; text: string; fullTextBlobId?: string; metadata: Record<string, unknown> } {
  const maxPreviewChars = 20_000;
  const text = input.text.slice(0, maxPreviewChars);
  const truncated = input.text.length > maxPreviewChars;
  let fullTextBlobId: string | undefined;
  if (truncated) {
    const resource = input.resources.storeBuffer({
      job: input.job,
      role: "ocr_text",
      bytes: Buffer.from(input.text, "utf8"),
      mime: "text/plain",
      displayName: `${input.job.id}-ocr.txt`,
      retention: "evidence",
      preview: { kind: "text", data: text, truncated: true, size: Buffer.byteLength(input.text, "utf8") },
      redaction: { mode: "text_preview" }
    });
    fullTextBlobId = resource.blobId;
  }
  return {
    ok: true,
    text,
    fullTextBlobId,
    metadata: {
      ...input.metadata,
      textLength: input.text.length,
      truncated
    }
  };
}

function quoteShellArgument(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function readAgentToolCapabilityInput(input: unknown): {
  runtime: string;
  toolId: string;
  capability: string;
  request: Record<string, unknown>;
} {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    runtime: typeof record.runtime === "string" ? record.runtime : "simulated_daemon",
    toolId: typeof record.toolId === "string" && record.toolId.trim() ? record.toolId.trim().slice(0, 120) : "agent_tool",
    capability: typeof record.capability === "string" && record.capability.trim() ? record.capability.trim().slice(0, 120) : "agent_tool",
    request: redactCapabilityRequest(record.request && typeof record.request === "object" ? record.request as Record<string, unknown> : record)
  };
}

function redactCapabilityRequest(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 40)) {
    if (/password|token|cookie|credential|payment|card|secret/i.test(key)) {
      output[key] = "[redacted]";
    } else if (typeof value === "string") {
      output[key] = value.slice(0, 1024);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value.slice(0, 20).map((item) => typeof item === "string" ? item.slice(0, 256) : item);
    } else if (value && typeof value === "object") {
      output[key] = "[object]";
    }
  }
  return output;
}

const TERMINAL_CAPABILITY_HELPER_SCRIPT = String.raw`
const { spawn } = require("node:child_process");

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  let request;
  try {
    request = JSON.parse(stdin || "{}");
  } catch (error) {
    writeResult({
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "Invalid terminal request JSON: " + (error && error.message ? error.message : String(error)),
      shell: null
    });
    return;
  }

  const command = typeof request.command === "string" ? request.command : "";
  const cwd = typeof request.cwd === "string" && request.cwd ? request.cwd : process.cwd();
  if (!command.trim()) {
    writeResult({
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "Terminal command is empty.",
      shell: null
    });
    return;
  }

  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "sh";
  const args = isWindows ? ["/d", "/s", "/c", command] : ["-lc", command];
  const child = spawn(shell, args, {
    cwd,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let settled = false;
  const stdout = [];
  const stderr = [];
  const limits = { stdout: 512 * 1024, stderr: 128 * 1024 };
  const sizes = { stdout: 0, stderr: 0 };
  const truncated = { stdout: false, stderr: false };

  child.stdout.on("data", (chunk) => appendBounded(stdout, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendBounded(stderr, "stderr", chunk));
  child.on("error", (error) => {
    finish({
      ok: false,
      exitCode: null,
      signal: null,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: error && error.message ? error.message : String(error),
      shell: describeShell(shell, args),
      truncated
    });
  });
  child.on("close", (exitCode, signal) => {
    finish({
      ok: exitCode === 0,
      exitCode,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      shell: describeShell(shell, args),
      truncated
    });
  });

  function appendBounded(target, key, chunk) {
    if (truncated[key]) {
      return;
    }
    const remaining = limits[key] - sizes[key];
    if (chunk.length > remaining) {
      if (remaining > 0) {
        target.push(chunk.subarray(0, remaining));
        sizes[key] += remaining;
      }
      truncated[key] = true;
      return;
    }
    target.push(chunk);
    sizes[key] += chunk.length;
  }

  function finish(payload) {
    if (settled) {
      return;
    }
    settled = true;
    writeResult(payload);
  }
});

function describeShell(shell, args) {
  return [shell].concat(args).join(" ");
}

function writeResult(payload) {
  process.stdout.write(JSON.stringify(payload));
}
`;

const OCR_CAPABILITY_HELPER_SCRIPT = String.raw`
const { spawn } = require("node:child_process");

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  let request;
  try {
    request = JSON.parse(stdin || "{}");
  } catch (error) {
    writeResult({ ok: false, text: "", stderr: "Invalid OCR request JSON: " + readError(error), metadata: { reason: "invalid_json" } });
    return;
  }
  const command = typeof request.command === "string" ? request.command.trim() : "";
  if (!command) {
    writeResult({ ok: false, text: "", stderr: "OCR command is empty.", metadata: { reason: "missing_command" } });
    return;
  }
  const shell = process.platform === "win32" ? "cmd.exe" : "sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  const child = spawn(shell, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const maxTextBytes = 512 * 1024;
  const maxStderrBytes = 128 * 1024;
  const startedAt = Date.now();
  child.stdout.on("data", (chunk) => {
    if (stdoutBytes < maxTextBytes) {
      const remaining = maxTextBytes - stdoutBytes;
      stdout.push(chunk.subarray(0, remaining));
      stdoutBytes += Math.min(chunk.length, remaining);
    }
  });
  child.stderr.on("data", (chunk) => {
    if (stderrBytes < maxStderrBytes) {
      const remaining = maxStderrBytes - stderrBytes;
      stderr.push(chunk.subarray(0, remaining));
      stderrBytes += Math.min(chunk.length, remaining);
    }
  });
  child.on("error", (error) => {
    writeResult({ ok: false, text: "", stderr: readError(error), metadata: { reason: "spawn_error", elapsedMs: Date.now() - startedAt } });
  });
  child.on("close", (exitCode, signal) => {
    const text = Buffer.concat(stdout).toString("utf8").slice(0, Number(request.maxChars) || 20000);
    const errorText = Buffer.concat(stderr).toString("utf8");
    writeResult({
      ok: exitCode === 0,
      text,
      stderr: errorText,
      exitCode,
      signal,
      metadata: {
        reason: exitCode === 0 ? "completed" : "non_zero_exit",
        imagePathProvided: Boolean(request.imagePath),
        elapsedMs: Date.now() - startedAt
      }
    });
  });
});

function readError(error) {
  return error && error.message ? error.message : String(error);
}

function writeResult(payload) {
  process.stdout.write(JSON.stringify(payload));
}
`;
