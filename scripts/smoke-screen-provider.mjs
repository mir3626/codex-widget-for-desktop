import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import { buildTurnInput } from "../dist/daemon/codexAppServer.js";
import { augmentRequestWithProviderContext, ProviderRegistry } from "../dist/daemon/providers/providerRegistry.js";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const daemon = await startDaemon({ port: 0 });
const marker = "screen-smoke-ocr-marker";
const screenPayload = {
  source: "smoke-test-capture",
  title: "Screen Smoke Snapshot",
  description: "Synthetic screen snapshot for provider smoke coverage.",
  ocrText: `Visible OCR text includes ${marker}`,
  imageDataUrl: "data:image/jpeg;base64,c2NyZWVu"
};
const response = await fetch(`http://127.0.0.1:${daemon.port}/providers/screen/snapshot`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(screenPayload)
});

if (!response.ok) {
  throw new Error(`Screen snapshot POST failed (${response.status}).`);
}
const posted = await response.json();
if (posted.snapshot?.imageDataUrl || posted.snapshot?.imageDataUrlLength <= 0) {
  throw new Error(`Screen snapshot response should redact image data: ${JSON.stringify(posted)}`);
}
if (typeof posted.snapshot?.imageHash !== "string" || posted.snapshot.imageHash.length !== 64) {
  throw new Error(`Screen snapshot response should include an image hash: ${JSON.stringify(posted)}`);
}
if (posted.snapshot.imageChanged !== true) {
  throw new Error(`First screen snapshot should be marked changed: ${JSON.stringify(posted)}`);
}
if (posted.snapshot.imageDiffRatio !== 1 || posted.snapshot.imageMeaningfullyChanged !== true) {
  throw new Error(`First screen snapshot should be meaningfully changed: ${JSON.stringify(posted)}`);
}

const repeatedResponse = await fetch(`http://127.0.0.1:${daemon.port}/providers/screen/snapshot`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(screenPayload)
});
const repeated = await repeatedResponse.json();
if (repeated.snapshot?.imageChanged !== false || repeated.snapshot?.imageHash !== posted.snapshot.imageHash) {
  throw new Error(`Repeated screen snapshot should be marked unchanged: ${JSON.stringify(repeated)}`);
}
if (repeated.snapshot.imageDiffRatio !== 0 || repeated.snapshot.imageMeaningfullyChanged !== false) {
  throw new Error(`Repeated screen snapshot should not be meaningfully changed: ${JSON.stringify(repeated)}`);
}

const changedPayload = {
  ...screenPayload,
  imageDataUrl: `data:image/jpeg;base64,${Buffer.from("screen-changed").toString("base64")}`
};
const changedResponse = await fetch(`http://127.0.0.1:${daemon.port}/providers/screen/snapshot`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(changedPayload)
});
const changed = await changedResponse.json();
if (changed.snapshot?.imageChanged !== true || changed.snapshot?.imageMeaningfullyChanged !== true) {
  throw new Error(`Changed screen snapshot should be meaningfully changed: ${JSON.stringify(changed)}`);
}
if (!(changed.snapshot.imageDiffRatio > 0.01) || changed.snapshot.imageDiffThreshold !== 0.01) {
  throw new Error(`Changed screen snapshot should include diff ratio and threshold: ${JSON.stringify(changed)}`);
}

const registry = new ProviderRegistry();
registry.setScreenSnapshot(screenPayload);
const originalDiffThreshold = process.env.CODEX_WIDGET_SCREEN_DIFF_THRESHOLD;
process.env.CODEX_WIDGET_SCREEN_DIFF_THRESHOLD = "1";
try {
  const thresholdRegistry = new ProviderRegistry();
  thresholdRegistry.setScreenSnapshot(screenPayload);
  const belowThresholdSnapshot = thresholdRegistry.setScreenSnapshot(changedPayload);
  if (belowThresholdSnapshot.imageDiffThreshold !== 1 || belowThresholdSnapshot.imageMeaningfullyChanged !== false) {
    throw new Error(`Screen diff threshold override was not applied: ${JSON.stringify(belowThresholdSnapshot)}`);
  }
} finally {
  if (originalDiffThreshold === undefined) {
    delete process.env.CODEX_WIDGET_SCREEN_DIFF_THRESHOLD;
  } else {
    process.env.CODEX_WIDGET_SCREEN_DIFF_THRESHOLD = originalDiffThreshold;
  }
}
const augmented = augmentRequestWithProviderContext(
  {
    id: "screen-augment-smoke",
    text: "Summarize the screen.",
    mode: "screen"
  },
  registry
);
const turnInput = buildTurnInput(augmented);
if (!augmented.imageDataUrls?.includes(screenPayload.imageDataUrl)) {
  throw new Error("Screen provider did not attach image data URL to the augmented request.");
}
if (!turnInput.some((item) => item.type === "image" && item.url === screenPayload.imageDataUrl)) {
  throw new Error(`Codex app-server input did not include the screen image: ${JSON.stringify(turnInput)}`);
}

const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
const events = [];

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for screen provider.")), 12000);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      if (event.type === "connected") {
        socket.send(
          JSON.stringify({
            type: "ask",
            id: "screen-smoke-1",
            text: "Summarize the attached screen snapshot.",
            mode: "screen"
          })
        );
      }
      if (event.type === "message.completed") {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on("error", reject);
  });

  const providerStatus = events.find((event) => event.type === "provider.status");
  const screenStatus = providerStatus?.providers?.find((provider) => provider.mode === "screen");
  if (screenStatus?.state !== "ready") {
    throw new Error(`Screen provider was not ready: ${JSON.stringify(screenStatus)}`);
  }

  const toolOutput = events
    .filter((event) => event.type === "tool.output")
    .map((event) => event.chunk ?? "")
    .join("\n");
  if (!toolOutput.includes(marker)) {
    throw new Error(`Screen tool output did not include marker: ${toolOutput}`);
  }
  console.log(`screen provider smoke ok on port ${daemon.port}`);
} finally {
  socket.close();
  await daemon.close();
}
