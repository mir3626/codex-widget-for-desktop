#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { daemonPostJson, readDaemonAuth } from "../src/renderer/utils/daemonHttp.ts";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-daemon-auth-cache-recovery");
let daemon = await startDaemon({ port: 0 });
const port = daemon.port;

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
