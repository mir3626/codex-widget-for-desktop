import type { WebSocket } from "ws";
import type { RuntimeStatus } from "../../shared/protocol.js";
import type { CodexAppServerBridge } from "../codexAppServer.js";
import type { StorageService } from "../storage/storage.js";

export function readRuntimeStatus(
  startedAt: number,
  clients: Set<WebSocket>,
  controllers: Map<string, AbortController>,
  codexAppServer: CodexAppServerBridge,
  storage: StorageService
): RuntimeStatus {
  const storageHealth = storage.health({ integrityCheck: false });
  return {
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    clients: clients.size,
    activeRequests: controllers.size,
    storage: {
      state: storageHealth.state,
      databasePath: storageHealth.databasePath,
      blobDir: storageHealth.blobDir,
      schemaVersion: storageHealth.schemaVersion,
      latestSchemaVersion: storageHealth.latestSchemaVersion,
      migrationsApplied: storageHealth.migrationsApplied,
      tableCount: storageHealth.tableCount,
      journalMode: storageHealth.journalMode,
      foreignKeys: storageHealth.foreignKeys,
      integrity: storageHealth.integrity
    },
    codexAppServer: codexAppServer.getStatus()
  };
}
