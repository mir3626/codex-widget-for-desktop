import { loadLocalEnv } from "./env.js";
import { startDaemon } from "./server.js";

loadLocalEnv();

const daemon = await startDaemon({
  port: Number(process.env.CODEX_WIDGET_PORT ?? 4128)
});

console.log(`codex widget daemon listening on ws://127.0.0.1:${daemon.port}`);

const shutdown = async () => {
  await daemon.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
