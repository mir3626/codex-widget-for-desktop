import { spawn } from "node:child_process";
import path from "node:path";
import { startDaemon } from "../dist/daemon/server.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

if (process.platform !== "win32") {
  console.log("screen helper live smoke skipped: Windows-only helper");
  process.exit(0);
}

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const smokeAppData = useSmokeAppData("codex-widget-screen-helper-live");
const daemon = await startDaemon({ port: 0 });
const helperPath = path.resolve("providers/screen-capture-helper/capture-screen.ps1");

try {
  const run = await runPowerShellHelper(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helperPath,
      "-DaemonUrl",
      `http://127.0.0.1:${daemon.port}`,
      "-Description",
      "screen helper live smoke",
      "-MaxWidth",
      "320",
      "-JpegQuality",
      "45",
      "-OcrCommand",
      "echo codex-widget-live-ocr & rem {image}"
    ],
  );

  if (run.code !== 0) {
    throw new Error(
      [
        `status=${run.code ?? "null"}`,
        run.signal ? `signal=${run.signal}` : "",
        run.stdout,
        run.stderr
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  if (!run.stdout.includes("screen snapshot sent")) {
    throw new Error(`Screen helper did not report success: ${run.stdout}`);
  }

  const response = await fetch(`http://127.0.0.1:${daemon.port}/providers/screen/snapshot`);
  if (!response.ok) {
    throw new Error(`Screen snapshot GET failed (${response.status}).`);
  }

  const payload = await response.json();
  const snapshot = payload.snapshot;
  if (
    snapshot?.source !== "windows-screen-capture-helper" ||
    snapshot?.description !== "screen helper live smoke" ||
    snapshot?.ocrText !== "codex-widget-live-ocr" ||
    snapshot?.imageDataUrlLength <= 0
  ) {
    throw new Error(`Unexpected screen helper snapshot: ${JSON.stringify(payload)}`);
  }

  console.log(`screen helper live smoke ok on port ${daemon.port}`);
} finally {
  await daemon.close();
  smokeAppData.cleanup();
}

function runPowerShellHelper(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("screen helper live smoke timed out"));
    }, 60000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
