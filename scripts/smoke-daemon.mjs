import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-daemon-smoke");
const daemon = await startDaemon({ port: 0 });
const events = [];
const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
let branchRequested = false;
let sessionResetDuringBranch = false;

function waitForCompletion() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon stream.")), 8000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (branchRequested && event.type === "session.reset") {
        sessionResetDuringBranch = true;
      }
      if (event.type === "connected") {
        socket.send(
          JSON.stringify({
            type: "ask",
            id: "smoke-1",
            text: "smoke test",
            mode: "agent"
          })
        );
      }
      if (event.type === "message.completed") {
        if (event.id === "smoke-1") {
          branchRequested = true;
          socket.send(
            JSON.stringify({
              type: "session.branch",
              messages: [
                { role: "user", text: "smoke test" },
                { role: "assistant", text: event.text }
              ],
              sourceMessageId: "smoke-1",
              title: "smoke test"
            })
          );
          socket.send(
            JSON.stringify({
              type: "ask",
              id: "smoke-2",
              text: "branch follow-up",
              mode: "agent",
              branchContext: [
                { role: "user", text: "smoke test" },
                { role: "assistant", text: event.text }
              ]
            })
          );
          return;
        }

        if (event.id === "smoke-2") {
          socket.send(
            JSON.stringify({
              type: "ask",
              id: "smoke-3",
              text: "capture ledger artifact",
              mode: "browser"
            })
          );
          return;
        }

        if (event.id === "smoke-3") {
          clearTimeout(timeout);
          resolve(event);
        }
      }
    });
    socket.on("error", reject);
  });
}

try {
  await waitForCompletion();
  socket.send(
    JSON.stringify({
      type: "provider.vision.start",
      id: "vision-recording-smoke",
      mode: "recording",
      fps: 4,
      frameIntervalMs: 250,
      maxDurationMs: 60000,
      detail: { localMaxBytes: 8388608 }
    })
  );
  await waitForEvent((event) => event.type === "provider.vision" && event.stream?.id === "vision-recording-smoke" && event.state === "started");
  socket.send(
    JSON.stringify({
      type: "provider.vision.recording.complete",
      id: "vision-recording-smoke",
      mime: "video/webm",
      dataUrl: `data:video/webm;base64,${Buffer.from("daemon-webm-smoke").toString("base64")}`,
      durationMs: 640,
      size: 17
    })
  );
  await waitForEvent((event) => event.type === "provider.vision" && event.stream?.id === "vision-recording-smoke" && event.state === "completed");
  socket.send(
    JSON.stringify({
      type: "provider.vision.start",
      id: "vision-stream-smoke",
      mode: "agent_stream",
      fps: 0.5,
      frameIntervalMs: 2000,
      maxDurationMs: 60000,
      detail: { resource: { maxFrameWidth: 960, jpegQuality: 0.68, overlapPolicy: "drop_if_previous_frame_pending" } }
    })
  );
  await waitForEvent((event) => event.type === "provider.vision" && event.stream?.id === "vision-stream-smoke" && event.stream?.status === "streaming");
  socket.send(JSON.stringify({ type: "provider.vision.stop", id: "vision-stream-smoke", reason: "smoke complete" }));
  await waitForEvent((event) => event.type === "provider.vision" && event.stream?.id === "vision-stream-smoke" && event.state === "stopped");
  await waitForEvent((event) => event.type === "ledger.snapshot" && event.snapshot?.activities?.some((activity) => activity.category === "vision"));
  const deltaCount = events.filter((event) => event.type === "message.delta").length;
  const providerStatus = events.find((event) => event.type === "provider.status");
  const runtimeStatus = events.find((event) => event.type === "runtime.status");
  const sessionSnapshots = events.filter((event) => event.type === "session.snapshot");
  if (deltaCount === 0) {
    throw new Error("No streamed delta events were emitted.");
  }
  if (sessionResetDuringBranch) {
    throw new Error("session.branch should not broadcast a visible session.reset event.");
  }
  if (!providerStatus || providerStatus.providers?.length !== 4) {
    throw new Error("Provider status event was not emitted.");
  }
  if (!runtimeStatus || typeof runtimeStatus.status?.uptimeSeconds !== "number") {
    throw new Error("Runtime status event was not emitted.");
  }
  if (runtimeStatus.status.storage?.state !== "ready" || runtimeStatus.status.storage.integrity !== "not_checked") {
    throw new Error(`Storage status was not ready: ${JSON.stringify(runtimeStatus.status.storage)}`);
  }
  if (!sessionSnapshots.some((event) => typeof event.snapshot?.activeSessionId === "string")) {
    throw new Error("Initial session snapshot was not emitted.");
  }
  if (!sessionSnapshots.some((event) => event.snapshot?.sessions?.length >= 2)) {
    throw new Error("Branch session snapshot did not create a second durable session.");
  }
  if (
    !sessionSnapshots.some((event) =>
      event.snapshot?.messages?.some((message) => message.role === "user" && message.text === "smoke test") &&
      event.snapshot?.messages?.some((message) => message.role === "assistant" && message.text.length > 0)
    )
  ) {
    throw new Error("Branch snapshot did not replay the source user/assistant pair.");
  }
  const ledgerSnapshots = events.filter((event) => event.type === "ledger.snapshot");
  if (!ledgerSnapshots.some((event) => event.snapshot?.activities?.length > 0)) {
    throw new Error("Ledger activity snapshots were not emitted.");
  }
  if (!ledgerSnapshots.some((event) => event.snapshot?.artifacts?.some((artifact) => artifact.files?.length > 0))) {
    throw new Error("Tool output artifact was not recorded in the ledger.");
  }
  if (!events.some((event) => event.type === "provider.vision" && event.stream?.recordingBlobId)) {
    throw new Error("Vision recording completion did not persist blob metadata.");
  }
  if (!ledgerSnapshots.some((event) => event.snapshot?.activities?.some((activity) => activity.category === "vision"))) {
    throw new Error("Vision activity was not recorded in the ledger.");
  }
  if (
    !ledgerSnapshots.some((event) =>
      event.snapshot?.activities?.some((activity) =>
        activity.category === "vision" &&
        activity.detail?.guardrails?.frameIntervalMs === 2000 &&
        activity.detail?.guardrails?.overlapPolicy === "drop_if_previous_frame_pending"
      )
    )
  ) {
    throw new Error("Vision stream guardrail diagnostics were not recorded in the ledger.");
  }
  const storageHealth = await fetch(`http://127.0.0.1:${daemon.port}/storage/health`).then((response) => response.json());
  if (
    !storageHealth.ok ||
    storageHealth.storage?.schemaVersion !== storageHealth.storage?.latestSchemaVersion ||
    storageHealth.storage?.integrity !== "ok"
  ) {
    throw new Error(`Storage health endpoint failed: ${JSON.stringify(storageHealth)}`);
  }
  console.log(`daemon smoke ok: ${deltaCount} deltas on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
  smokeAppData.cleanup();
}

function waitForEvent(predicate) {
  return new Promise((resolve, reject) => {
    const existing = events.find(predicate);
    if (existing) {
      resolve(existing);
      return;
    }
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for daemon event."));
    }, 8000);
    function onMessage(raw) {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (predicate(event)) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(event);
      }
    }
    socket.on("message", onMessage);
  });
}
