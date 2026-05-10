import type { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { spawnCodex } from "../codexCli.js";
import type { CodexExecutionContext } from "../codexRuntime.js";
import { APP_SERVER_START_TIMEOUT_MS } from "./constants.js";

export type AppServerConnection = {
  child: ChildProcess;
  ws: WebSocket;
};

export async function startAppServerConnection(input: {
  context: CodexExecutionContext;
  onSpawn?: (child: ChildProcess) => void;
  onSocket?: (ws: WebSocket) => void;
  onMessage: (raw: string) => void;
  onSocketClose: () => void;
  onSocketError: (error: Error) => void;
  onChildExit: (code: number | null) => void;
}): Promise<AppServerConnection> {
  const child = spawnCodex(["app-server", "--listen", "ws://127.0.0.1:0"], {
    cwd: input.context.workdir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  input.onSpawn?.(child);

  child.stdout?.resume();
  child.on("exit", (code) => input.onChildExit(code));

  const url = await waitForListeningUrl(child);
  const ws = new WebSocket(url);
  input.onSocket?.(ws);

  ws.on("message", (raw) => input.onMessage(raw.toString()));
  ws.on("close", () => input.onSocketClose());
  ws.on("error", (error) => input.onSocketError(error instanceof Error ? error : new Error(String(error))));

  await waitForSocketOpen(ws);
  return { child, ws };
}

function waitForSocketOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out connecting to Codex app-server.")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForListeningUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(`Codex app-server did not announce a WebSocket URL. ${stderr.trim()}`));
    }, APP_SERVER_START_TIMEOUT_MS);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      const match = /listening on:\s*(ws:\/\/[^\s]+)/.exec(stderr);
      if (!match?.[1]) {
        return;
      }
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Codex app-server exited before startup completed (${code ?? "unknown"}). ${stderr.trim()}`));
    });
  });
}
