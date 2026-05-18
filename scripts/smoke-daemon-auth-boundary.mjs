#!/usr/bin/env node
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-daemon-auth-boundary");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;
const trustedOrigin = "http://127.0.0.1:5173";
const maliciousOrigin = "https://malicious.example";
const extensionRuntimeId = "abcdefghijklmnopabcdefghijklmnop";
const extensionOrigin = `chrome-extension://${extensionRuntimeId}`;
const otherExtensionOrigin = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba";

try {
  const deniedHandshake = await fetchRaw("/daemon/auth/handshake", {
    headers: { Origin: maliciousOrigin }
  });
  assert.equal(deniedHandshake.status, 403);
  assert.notEqual(deniedHandshake.headers.get("access-control-allow-origin"), "*");

  const deniedExtensionHandshake = await fetchRaw("/daemon/auth/handshake", {
    headers: { Origin: extensionOrigin }
  });
  assert.equal(deniedExtensionHandshake.status, 403);

  const allowedExtensionHealth = await fetchRaw("/storage/health", {
    headers: { Origin: extensionOrigin }
  });
  assert.equal(allowedExtensionHealth.status, 200);
  assert.equal(allowedExtensionHealth.headers.get("access-control-allow-origin"), extensionOrigin);

  const deniedExtensionComputerUseRead = await fetchRaw("/computer-use/autonomy/profiles", {
    headers: { Origin: extensionOrigin }
  });
  assert.equal(deniedExtensionComputerUseRead.status, 403);

  const deniedExtensionScreenSnapshot = await postRaw("/providers/screen/snapshot", {
    source: "malicious-extension",
    title: "should fail"
  }, { Origin: extensionOrigin });
  assert.equal(deniedExtensionScreenSnapshot.status, 403);

  const allowedExtensionHeartbeat = await postRaw("/browser-action/extension/heartbeat", {
    extensionRuntimeId,
    connected: true,
    mode: "idle",
    updatedAt: new Date().toISOString(),
    activeTab: { permission: "allowed" }
  }, { Origin: extensionOrigin });
  assert.equal(allowedExtensionHeartbeat.status, 200);

  const deniedOtherExtensionHeartbeat = await postRaw("/browser-action/extension/heartbeat", {
    extensionRuntimeId: "ponmlkjihgfedcbaponmlkjihgfedcba",
    connected: true,
    mode: "idle",
    updatedAt: new Date().toISOString(),
    activeTab: { permission: "allowed" }
  }, { Origin: otherExtensionOrigin });
  assert.equal(deniedOtherExtensionHeartbeat.status, 403);

  const allowedExtensionDomSnapshot = await postRaw("/providers/dom/snapshot", {
    url: "https://example.test/extension-origin",
    title: "Extension Origin DOM",
    readyState: "complete",
    text: "extension origin route scope",
    elements: []
  }, { Origin: extensionOrigin });
  assert.equal(allowedExtensionDomSnapshot.status, 200);

  const deniedOtherExtensionDomSnapshot = await postRaw("/providers/dom/snapshot", {
    url: "https://example.test/other-extension-origin",
    title: "Other Extension Origin DOM",
    readyState: "complete",
    text: "other extension route scope",
    elements: []
  }, { Origin: otherExtensionOrigin });
  assert.equal(deniedOtherExtensionDomSnapshot.status, 403);

  const allowedOptions = await fetchRaw("/computer-use/autonomy/profiles", {
    method: "OPTIONS",
    headers: {
      Origin: trustedOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-codex-widget-daemon-token,x-codex-widget-daemon-nonce"
    }
  });
  assert.equal(allowedOptions.status, 204);
  assert.equal(allowedOptions.headers.get("access-control-allow-origin"), trustedOrigin);
  assert.match(allowedOptions.headers.get("access-control-allow-headers") ?? "", /x-codex-widget-daemon-token/i);
  assert.match(allowedOptions.headers.get("access-control-allow-headers") ?? "", /x-codex-widget-daemon-nonce/i);

  const deniedOptions = await fetchRaw("/computer-use/autonomy/profiles", {
    method: "OPTIONS",
    headers: {
      Origin: maliciousOrigin,
      "Access-Control-Request-Method": "POST"
    }
  });
  assert.equal(deniedOptions.status, 403);
  assert.notEqual(deniedOptions.headers.get("access-control-allow-origin"), "*");

  const deniedExtensionOptions = await fetchRaw("/computer-use/autonomy/profiles", {
    method: "OPTIONS",
    headers: {
      Origin: extensionOrigin,
      "Access-Control-Request-Method": "POST"
    }
  });
  assert.equal(deniedExtensionOptions.status, 403);

  const missingToken = await postRaw("/computer-use/autonomy/profiles", {
    name: "Missing token should fail",
    mode: "ask"
  }, { Origin: trustedOrigin });
  assert.equal(missingToken.status, 401);

  const handshake = await fetchJson("/daemon/auth/handshake", {
    headers: { Origin: trustedOrigin }
  });
  assert.equal(handshake.ok, true);
  assert.equal(typeof handshake.auth.token, "string");
  assert.equal(handshake.auth.header, "x-codex-widget-daemon-token");

  const noncePayload = await fetchJson(`/daemon/auth/nonce?method=POST&path=${encodeURIComponent("/computer-use/autonomy/profiles")}`, {
    headers: {
      Origin: trustedOrigin,
      "x-codex-widget-daemon-token": handshake.auth.token
    }
  });
  assert.equal(noncePayload.ok, true);
  assert.equal(typeof noncePayload.auth.nonce, "string");

  const created = await postRaw("/computer-use/autonomy/profiles", {
    name: "Authorized CORS profile",
    mode: "ask"
  }, {
    Origin: trustedOrigin,
    "x-codex-widget-daemon-token": handshake.auth.token,
    "x-codex-widget-daemon-nonce": noncePayload.auth.nonce
  });
  assert.equal(created.status, 200);
  assert.equal(created.headers.get("access-control-allow-origin"), trustedOrigin);
  assert.equal((await created.json()).ok, true);

  const replayed = await postRaw("/computer-use/autonomy/profiles", {
    name: "Replayed nonce should fail",
    mode: "ask"
  }, {
    Origin: trustedOrigin,
    "x-codex-widget-daemon-token": handshake.auth.token,
    "x-codex-widget-daemon-nonce": noncePayload.auth.nonce
  });
  assert.equal(replayed.status, 409);

  await assertWebSocketRejected(`ws://127.0.0.1:${daemon.port}`, maliciousOrigin);
  await assertWebSocketAccepted(`ws://127.0.0.1:${daemon.port}?daemonToken=${encodeURIComponent(handshake.auth.token)}`, trustedOrigin);
  await assertWebSocketAccepted(`ws://127.0.0.1:${daemon.port}`);

  console.log(`daemon auth boundary smoke ok on port ${daemon.port}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

async function fetchRaw(path, init = {}) {
  return await fetch(`${baseUrl}${path}`, init);
}

async function fetchJson(path, init = {}) {
  const response = await fetchRaw(path, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function postRaw(path, body, headers = {}) {
  return await fetchRaw(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function assertWebSocketRejected(url, origin) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: origin } });
    socket.once("open", () => {
      socket.close();
      reject(new Error(`WebSocket unexpectedly opened for origin ${origin}`));
    });
    socket.once("unexpected-response", (_request, response) => {
      assert.equal(response.statusCode, 403);
      resolve();
    });
    socket.once("error", (error) => {
      if (/Unexpected server response: 403/.test(error.message)) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

async function assertWebSocketAccepted(url, origin) {
  const socket = new WebSocket(url, origin ? { headers: { Origin: origin } } : undefined);
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ type: "ping" }));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket pong.")), 3000);
      socket.once("message", (raw) => {
        clearTimeout(timeout);
        const event = JSON.parse(raw.toString());
        assert.equal(event.type, "pong");
        resolve();
      });
    });
  } finally {
    socket.close();
  }
}
