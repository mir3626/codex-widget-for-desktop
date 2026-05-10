import { spawn } from "node:child_process";

export function openPathWithSystem(path: string): void {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", path], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [path], { detached: true, stdio: "ignore" }).unref();
}
