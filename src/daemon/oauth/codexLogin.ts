import { spawnCodex, spawnCodexSync } from "../codexCli.js";

export type CodexLoginState = {
  signInInProgress: boolean;
  disconnected: boolean;
  lastError?: string;
};

export function isCodexLoggedIn(): boolean {
  const result = spawnCodexSync(["login", "status"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status === 0 && /Logged in/i.test(output);
}

export function startCodexLogin(input: {
  state: CodexLoginState;
  onAuthChanged: () => void;
}): void {
  if (isCodexLoggedIn()) {
    input.state.signInInProgress = false;
    input.state.disconnected = false;
    input.state.lastError = undefined;
    queueMicrotask(input.onAuthChanged);
    return;
  }

  if (input.state.signInInProgress) {
    return;
  }

  input.state.signInInProgress = true;
  input.state.lastError = undefined;
  const child = spawnCodex(["login"], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true
  });

  child.on("error", (error) => {
    input.state.signInInProgress = false;
    input.state.lastError = error.message;
    input.onAuthChanged();
  });

  child.on("exit", (code) => {
    input.state.signInInProgress = false;
    input.state.lastError = code === 0 ? undefined : `codex login exited with ${code ?? "unknown"}`;
    input.onAuthChanged();
  });
}
