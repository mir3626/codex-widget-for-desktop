import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function useSmokeAppData(prefix = "codex-widget-smoke") {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const previous = {
    appDataDir: process.env.CODEX_WIDGET_APP_DATA_DIR,
    storageDbPath: process.env.CODEX_WIDGET_STORAGE_DB_PATH,
    blobDir: process.env.CODEX_WIDGET_BLOB_DIR
  };

  process.env.CODEX_WIDGET_APP_DATA_DIR = dir;
  delete process.env.CODEX_WIDGET_STORAGE_DB_PATH;
  delete process.env.CODEX_WIDGET_BLOB_DIR;

  return {
    dir,
    cleanup() {
      restoreEnvValue("CODEX_WIDGET_APP_DATA_DIR", previous.appDataDir);
      restoreEnvValue("CODEX_WIDGET_STORAGE_DB_PATH", previous.storageDbPath);
      restoreEnvValue("CODEX_WIDGET_BLOB_DIR", previous.blobDir);
      removeSmokeDir(dir);
    }
  };
}

export function createSmokeAppDataEnv(baseEnv = process.env, prefix = "codex-widget-smoke") {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const env = {
    ...baseEnv,
    CODEX_WIDGET_APP_DATA_DIR: dir
  };
  delete env.CODEX_WIDGET_STORAGE_DB_PATH;
  delete env.CODEX_WIDGET_BLOB_DIR;

  return {
    dir,
    env,
    cleanup() {
      removeSmokeDir(dir);
    }
  };
}

function removeSmokeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  } catch (error) {
    scheduleDeferredCleanup(dir);
    console.warn(`smoke temp cleanup deferred with retry scheduled: ${dir} (${error.code ?? error.message})`);
  }
}

function scheduleDeferredCleanup(dir) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "setTimeout(() => { require('node:fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 40, retryDelay: 250 }); }, 1000);",
      dir
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  child.unref();
}

function restoreEnvValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
