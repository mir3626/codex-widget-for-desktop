import { loadLocalEnv } from "./env.js";
import { startDaemon } from "./server.js";

loadLocalEnv();

const daemon = await startDaemon({
  port: Number(process.env.CODEX_WIDGET_PORT ?? 4128)
});

console.log(`codex widget daemon listening on ws://127.0.0.1:${daemon.port}`);

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await daemon.close();
  process.exit(0);
};

startParentWatchdog(() => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

function startParentWatchdog(onParentGone: () => void): void {
  const parentPid = Number.parseInt(process.env.CODEX_WIDGET_NATIVE_PARENT_PID ?? "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    return;
  }

  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(timer);
      onParentGone();
    }
  }, 1000);
  timer.unref();
}
