#!/usr/bin/env node
import assert from "node:assert/strict";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const fixture = {
  windows: [
    { id: 1001, processName: "notepad.exe", title: "Untitled - Notepad" }
  ],
  elements: [
    { id: "file-menu", role: "menu", label: "File", visible: true, enabled: true },
    { id: "save-item", role: "menuitem", label: "Save", visible: true, enabled: true },
    { id: "editor", role: "Edit", label: "Document", text: "Draft text", visible: true, enabled: true, editable: true, bbox: { x: 10, y: 40, w: 400, h: 200 } },
    { id: "password", role: "Edit", label: "Password", value: "super-secret", inputType: "password", visible: true, enabled: true, editable: true },
    { id: "submit", role: "Button", label: "Submit", visible: true, enabled: true },
    { id: "recent-list", role: "List", label: "Recent files", visible: true, enabled: true },
    { id: "recent-one", role: "ListItem", label: "report.md", visible: true, enabled: true, selected: true }
  ]
};

const smokeAppData = useSmokeAppData("codex-widget-computer-use-uia-semantic-tree-smoke");
const daemon = await startDaemon({ port: 0 });
const baseUrl = `http://127.0.0.1:${daemon.port}`;

try {
  const snapshot = await postJson("/computer-use/snapshot", { fixture });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.result.snapshot.schemaVersion, "computer-use-semantic-tree.v1");
  assert.equal(snapshot.result.snapshot.stats.windowCount, 1);
  assert.equal(snapshot.result.snapshot.stats.roleCounts.button, 1);
  assert.equal(snapshot.result.snapshot.stats.roleCounts.textbox, 2);
  assert.equal(snapshot.result.snapshot.stats.roleCounts.menu, 1);
  assert.equal(snapshot.result.snapshot.stats.roleCounts.list, 1);
  assert.equal(snapshot.result.snapshot.refs["element:password"].valueRedacted, true);
  assert.equal(JSON.stringify(snapshot.result.snapshot).includes("super-secret"), false);

  const found = await postJson("/computer-use/find-elements", {
    fixture,
    role: "button",
    text: "submit",
    visibleOnly: true,
    enabledOnly: true
  });
  assert.equal(found.ok, true);
  assert.equal(found.result.matches.length, 1);
  assert.equal(found.result.matches[0].ref, "element:submit");

  const started = await postJson("/computer-use/sessions", {
    userRequest: "Read a Windows app semantic tree without sending native input.",
    requestedSurface: "tool_workspace",
    riskClass: "read_only"
  });
  assert.equal(started.ok, true);
  const sessionId = started.result.session.sessionId;

  const sessionSnapshot = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/snapshot`, {
    fixture,
    query: { role: "textbox", visibleOnly: true }
  });
  assert.equal(sessionSnapshot.ok, true);
  assert.equal(sessionSnapshot.result.matches.length, 2);
  assert.equal(typeof sessionSnapshot.result.observationId, "string");

  const operation = await postJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/operations`, {
    operation: {
      kind: "find_elements",
      input: {
        fixture,
        query: { role: "menuitem", text: "save" }
      }
    }
  });
  assert.equal(operation.ok, true);
  assert.equal(operation.result.dagNode.status, "completed");
  assert.equal(operation.result.dagNode.output.matches[0].ref, "element:save-item");

  const bundle = await getJson(`/computer-use/sessions/${encodeURIComponent(sessionId)}/debug-bundle`);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundle.observations.some((observation) =>
    observation.kind === "uia" &&
    observation.source === "computer_use_snapshot" &&
    observation.metadata?.readOnlyObserve === true &&
    observation.metadata?.semanticTree?.refs?.["element:submit"]?.role === "button"
  ), true);
  assert.equal(JSON.stringify(bundle.bundle).includes("super-secret"), false);

  console.log(`computer use UIA semantic tree smoke ok on port ${daemon.port}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}
