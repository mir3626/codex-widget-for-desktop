import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { asRecord } from "./toolsmithShared.js";

export async function runNodeTool(input: {
  entrypoint: string;
  dependencyWorkspace?: string;
  request: unknown;
  timeoutMs: number;
  maxOutputBytes: number;
  fsReadRoots?: string[];
  fsWriteRoots?: string[];
  allowChildProcess?: boolean;
}): Promise<{ ok: boolean; output: unknown; error?: string }> {
  return new Promise((resolvePromise) => {
    const permission = buildPermissionArgs(input);
    const child = spawn(process.execPath, [...permission.args, input.entrypoint], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: permission.cwd,
      env: buildToolEnvironment(input.dependencyWorkspace),
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, output: {}, error: "generated_tool_timeout" });
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes < input.maxOutputBytes) {
        const remaining = input.maxOutputBytes - stdoutBytes;
        stdout.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.length, remaining);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < 128 * 1024) {
        const remaining = 128 * 1024 - stderrBytes;
        stderr.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.length, remaining);
      }
    });
    child.on("error", (error) => finish({ ok: false, output: {}, error: error.message }));
    child.on("close", (code) => {
      const text = Buffer.concat(stdout).toString("utf8");
      const errorText = Buffer.concat(stderr).toString("utf8");
      try {
        const output = JSON.parse(text || "{}");
        finish({
          ok: code === 0 && asRecord(output).ok !== false,
          output,
          error: code === 0 ? undefined : errorText || `generated_tool_exit_${code}`
        });
      } catch (error) {
        finish({
          ok: false,
          output: { stdout: text },
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    child.stdin.end(JSON.stringify(input.request));

    function finish(result: { ok: boolean; output: unknown; error?: string }) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    }
  });
}

function buildPermissionArgs(input: {
  entrypoint: string;
  dependencyWorkspace?: string;
  request: unknown;
  fsReadRoots?: string[];
  fsWriteRoots?: string[];
  allowChildProcess?: boolean;
}): { args: string[]; cwd: string } {
  const entrypoint = resolve(input.entrypoint);
  const toolDirectory = dirname(entrypoint);
  const request = asRecord(input.request);
  const payload = asRecord(request.input);
  const outputDir = readPath(payload.outputDir);
  const readRoots = uniquePaths([
    toolDirectory,
    input.dependencyWorkspace,
    outputDir,
    readPath(payload.filePath),
    readPath(payload.markdownPath),
    readPath(payload.sourcePath),
    ...(input.fsReadRoots ?? [])
  ]);
  const writeRoots = uniquePaths([
    outputDir ?? toolDirectory,
    ...(input.fsWriteRoots ?? [])
  ]);
  for (const root of writeRoots) {
    mkdirSync(root, { recursive: true });
  }
  const networkGuardPath = writeNetworkGuard(toolDirectory, readStringArray(request.allowedDomains));
  const args = [
    "--permission",
    `--import=${pathToFileURL(networkGuardPath).href}`,
    ...readRoots.map((path) => `--allow-fs-read=${path}`),
    ...writeRoots.map((path) => `--allow-fs-write=${path}`)
  ];
  if (input.allowChildProcess) {
    args.push("--allow-child-process");
  }
  return {
    args,
    cwd: toolDirectory
  };
}

function buildToolEnvironment(dependencyWorkspace: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  if (dependencyWorkspace) {
    env.CODEX_WIDGET_TOOL_DEPENDENCY_ROOT = dependencyWorkspace;
  }
  return env;
}

function readPath(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? resolve(value.trim()) : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)).map((path) => resolve(path)))];
}

function writeNetworkGuard(toolDirectory: string, allowedDomains: string[]): string {
  const guardPath = join(toolDirectory, "network-guard.mjs");
  writeFileSync(guardPath, networkGuardSource(allowedDomains), "utf8");
  return guardPath;
}

function networkGuardSource(allowedDomains: string[]): string {
  return `import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const allowedDomains = ${JSON.stringify(allowedDomains)};

function normalizeHost(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.startsWith("*.")) return "*." + normalizeHost(text.slice(2));
  try {
    return new URL(text.includes("://") ? text : "https://" + text).hostname.toLowerCase();
  } catch {
    return text.replace(/^https?:\\/\\//, "").split("/")[0].split(":")[0].toLowerCase();
  }
}

function matchesDomainGrant(pattern, host) {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedHost = normalizeHost(host);
  if (!normalizedPattern || !normalizedHost) return false;
  if (normalizedPattern === "*") return true;
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHost === suffix || normalizedHost.endsWith("." + suffix);
  }
  return normalizedPattern === normalizedHost;
}

function assertNetworkAllowed(host, operation) {
  if (host && allowedDomains.some((pattern) => matchesDomainGrant(pattern, host))) {
    return;
  }
  const error = new Error("network_access_denied:" + operation + ":" + (host || "unknown_host"));
  error.code = "ERR_NETWORK_ACCESS_DENIED";
  throw error;
}

function hostFromUrlLike(value) {
  if (value instanceof URL) return value.hostname;
  if (typeof value === "string") {
    try {
      return new URL(value).hostname;
    } catch {
      return "";
    }
  }
  if (value && typeof value === "object" && typeof value.url === "string") {
    return hostFromUrlLike(value.url);
  }
  return "";
}

function hostFromOptions(value) {
  if (!value || typeof value !== "object") return "";
  const host = typeof value.hostname === "string"
    ? value.hostname
    : typeof value.host === "string"
      ? value.host
      : "";
  return host.split(":")[0];
}

function hostFromRequestArgs(args) {
  for (const arg of args) {
    const host = hostFromUrlLike(arg) || hostFromOptions(arg);
    if (host) return host;
  }
  return "";
}

function hostFromConnectArgs(args) {
  for (const arg of args) {
    const host = hostFromOptions(arg);
    if (host) return host;
  }
  return typeof args[1] === "string" ? args[1] : "";
}

function patchRequest(target, method, operation) {
  const original = target[method];
  if (typeof original !== "function") return;
  target[method] = function patchedRequest(...args) {
    assertNetworkAllowed(hostFromRequestArgs(args), operation);
    return original.apply(this, args);
  };
}

function patchConnect(target, method, operation) {
  const original = target[method];
  if (typeof original !== "function") return;
  target[method] = function patchedConnect(...args) {
    assertNetworkAllowed(hostFromConnectArgs(args), operation);
    return original.apply(this, args);
  };
}

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function guardedFetch(input, init) {
    assertNetworkAllowed(hostFromUrlLike(input) || hostFromOptions(init), "fetch");
    return originalFetch(input, init);
  };
}

patchRequest(http, "request", "http.request");
patchRequest(http, "get", "http.get");
patchRequest(https, "request", "https.request");
patchRequest(https, "get", "https.get");
patchConnect(net, "connect", "net.connect");
patchConnect(net, "createConnection", "net.createConnection");
patchConnect(tls, "connect", "tls.connect");
`;
}
