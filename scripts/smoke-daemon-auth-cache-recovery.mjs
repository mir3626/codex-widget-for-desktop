#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { startDaemon } from "../dist/daemon/server.js";
import { daemonPostJson, readDaemonAuth } from "../src/renderer/utils/daemonHttp.ts";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-daemon-auth-cache-recovery");
const port = await reserveOpenPort();
const unavailableAuth = await readDaemonAuth(port);
assert.equal(unavailableAuth, null);
let daemon = await startDaemon({ port });

try {
  const firstAuth = await readDaemonAuth(port);
  assert.equal(typeof firstAuth?.token, "string");

  await daemon.close();
  daemon = await startDaemon({ port });

  const payload = await daemonPostJson(port, "/computer-use/autonomy/profiles", {
    name: "Renderer auth cache recovery",
    mode: "ask",
    scope: "one_time",
    maxUses: 1
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.profile?.name, "Renderer auth cache recovery");
  const secondAuth = await readDaemonAuth(port);
  assert.equal(typeof secondAuth?.token, "string");
  assert.notEqual(secondAuth?.token, firstAuth?.token);

  console.log(`daemon auth cache recovery smoke ok on port ${port}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

async function reserveOpenPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}
