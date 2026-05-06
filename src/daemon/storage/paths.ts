import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

export type StoragePathOptions = {
  appDataDir?: string;
  databasePath?: string;
  blobDir?: string;
};

export type StoragePaths = {
  appDataDir: string;
  databasePath: string;
  blobDir: string;
};

const APP_DIR_NAME = "Codex Widget";

export function resolveStoragePaths(options: StoragePathOptions = {}): StoragePaths {
  const appDataDir = resolvePath(
    options.appDataDir ??
      process.env.CODEX_WIDGET_APP_DATA_DIR ??
      resolveDefaultAppDataDir()
  );
  const databasePath = resolvePath(
    options.databasePath ??
      process.env.CODEX_WIDGET_STORAGE_DB_PATH ??
      join(appDataDir, "codex-widget.sqlite")
  );
  const blobDir = resolvePath(
    options.blobDir ??
      process.env.CODEX_WIDGET_BLOB_DIR ??
      join(appDataDir, "blobs")
  );

  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(blobDir, { recursive: true });

  return {
    appDataDir,
    databasePath,
    blobDir
  };
}

function resolveDefaultAppDataDir(): string {
  if (platform() === "win32") {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
    return join(base, APP_DIR_NAME);
  }

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  }

  const xdgDataHome = process.env.XDG_DATA_HOME;
  return join(xdgDataHome && xdgDataHome.trim() ? xdgDataHome : join(homedir(), ".local", "share"), "codex-widget");
}

function resolvePath(path: string): string {
  return resolve(path.trim() || ".");
}
