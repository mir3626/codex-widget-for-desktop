#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const hostDir = resolve("providers/browser-native-host");
const hostScript = join(hostDir, "native-host.mjs");
const hostWrapper = join(hostDir, "codex-widget-dom-native-host.cmd");
const installerScript = join(hostDir, "install-native-messaging-host.ps1");

assertFile(hostScript);
assertFile(hostWrapper);
assertFile(installerScript);

const serverState = {
  body: undefined
};
const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/providers/dom/snapshot") {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    serverState.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
  });
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;

try {
  const response = await runNativeHost({
    type: "domSnapshot",
    daemonUrl: `http://127.0.0.1:${port}/providers/dom/snapshot`,
    snapshot: {
      url: "https://example.test/native",
      title: "Native Host Smoke",
      selection: "selected text",
      text: "document body"
    }
  });

  if (response.ok !== true || response.transport !== "nativeMessaging") {
    throw new Error(`Unexpected native host response: ${JSON.stringify(response)}`);
  }
  if (serverState.body?.title !== "Native Host Smoke" || serverState.body?.selection !== "selected text") {
    throw new Error(`Native host did not post the DOM snapshot: ${JSON.stringify(serverState.body)}`);
  }

  const wrapper = readFileSync(hostWrapper, "utf8");
  for (const marker of ["native-host.mjs", "dist\\node-runtime\\node.exe", "node"]) {
    if (!wrapper.includes(marker)) {
      throw new Error(`Native host wrapper is missing marker: ${marker}`);
    }
  }

  const installer = readFileSync(installerScript, "utf8");
  for (const marker of [
    "NativeMessagingHosts",
    "Google\\Chrome",
    "Microsoft\\Edge",
    "chrome-extension://$ExtensionId/",
    "com.mir3626.codex_widget_dom"
  ]) {
    if (!installer.includes(marker)) {
      throw new Error(`Native host installer is missing marker: ${marker}`);
    }
  }

  console.log(`browser native host smoke ok on port ${port}`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function assertFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing browser native host file: ${path}`);
  }
}

function runNativeHost(message) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [hostScript], {
      cwd: resolve("."),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Native host exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      try {
        resolveRun(readNativeMessage(Buffer.concat(stdout)));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(createNativeMessage(message));
  });
}

function createNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function readNativeMessage(buffer) {
  if (buffer.length < 4) {
    throw new Error("Native host response is missing a length header.");
  }
  const length = buffer.readUInt32LE(0);
  const body = buffer.subarray(4, 4 + length);
  if (body.length !== length) {
    throw new Error("Native host response body is incomplete.");
  }
  return JSON.parse(body.toString("utf8"));
}
