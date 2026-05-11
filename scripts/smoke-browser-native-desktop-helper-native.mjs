#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const helperPath = path.resolve("dist/browser-native-desktop-helper/browser-native-desktop-helper.exe");

if (process.platform !== "win32") {
  console.log("browser native desktop helper native smoke skipped: Windows-only helper");
  process.exit(0);
}

if (!existsSync(helperPath)) {
  throw new Error(`Missing built native desktop helper. Run npm run build:browser-native-desktop-helper first: ${helperPath}`);
}

await assertHelper("status", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-status",
  command: "status",
  timeoutMs: 5_000,
  session: createSession()
});

const observe = await assertHelper("observe", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-observe",
  command: "observe",
  timeoutMs: 5_000,
  session: createSession()
});

if (!observe.observation || !Array.isArray(observe.observation.elements) || !Array.isArray(observe.observation.windows)) {
  throw new Error(`Observe response should include normalized observation arrays: ${JSON.stringify(observe)}`);
}

const read = await assertHelper("execute read", {
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-execute-read",
  command: "execute",
  timeoutMs: 5_000,
  session: createSession(),
  action: { type: "read", reason: "smoke" }
});

if (!read.after || !Array.isArray(read.after.elements)) {
  throw new Error(`Read execute should return after observation evidence: ${JSON.stringify(read)}`);
}

const blockedSecret = await runHelper({
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-secret",
  command: "execute",
  timeoutMs: 5_000,
  session: createSession(),
  action: { type: "type", target: { kind: "focused" }, text: "secret token value", clearFirst: true }
});

if (blockedSecret.ok !== false || !String(blockedSecret.error ?? "").includes("sensitive")) {
  throw new Error(`Sensitive text input must be blocked: ${JSON.stringify(blockedSecret)}`);
}

const blockedEval = await runHelper({
  schemaVersion: "browser-native-desktop-helper.v1",
  requestId: "native-rs-helper-smoke-evaluate",
  command: "execute",
  timeoutMs: 5_000,
  session: createSession(),
  action: { type: "evaluate", code: "document.cookie" }
});

if (blockedEval.ok !== false || !String(blockedEval.error ?? "").includes("does not support evaluate")) {
  throw new Error(`Evaluate must be blocked: ${JSON.stringify(blockedEval)}`);
}

if (read.metadata?.helperImplementation !== "rust-native") {
  throw new Error(`Native smoke should use rust-native helper metadata: ${JSON.stringify(read.metadata)}`);
}

console.log("browser native desktop helper native smoke ok");

function createSession() {
  return {
    id: "native-rs-helper-smoke",
    mode: "auto_safe_actions",
    source: { kind: "active_tab", browser: "unknown" }
  };
}

async function assertHelper(label, request) {
  const response = await runHelper(request);
  if (response.ok !== true) {
    throw new Error(`${label} expected ok response: ${JSON.stringify(response)}`);
  }
  if (response.metadata?.helper !== "browser-native-desktop-helper") {
    throw new Error(`${label} missing helper metadata: ${JSON.stringify(response)}`);
  }
  return response;
}

function runHelper(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`native helper timed out. stdout=${stdout} stderr=${stderr}`));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if ((code ?? 0) !== 0 || signal) {
        reject(new Error(`native helper exited with ${signal ?? code}. stdout=${stdout} stderr=${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`native helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)} stdout=${stdout} stderr=${stderr}`));
      }
    });
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}
