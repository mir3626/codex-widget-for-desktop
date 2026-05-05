import { spawn, spawnSync, type SpawnOptions, type SpawnSyncOptions } from "node:child_process";

export function spawnCodex(args: string[], options: SpawnOptions = {}) {
  const command = codexCommand(args);
  return spawn(command.file, command.args, {
    ...options,
    shell: false
  });
}

export function spawnCodexSync(args: string[], options: SpawnSyncOptions = {}) {
  const command = codexCommand(args);
  return spawnSync(command.file, command.args, {
    ...options,
    shell: false
  });
}

function codexCommand(args: string[]): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      file: "cmd.exe",
      args: ["/d", "/s", "/c", "codex", ...args]
    };
  }

  return {
    file: "codex",
    args
  };
}
