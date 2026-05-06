import type { NativeDaemonStatus } from "../shell";

export function formatRuntimeAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "just started";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return `${seconds}s uptime`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 1) {
    return `${minutes}m uptime`;
  }
  return `${hours}h ${minutes % 60}m uptime`;
}

export function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatNativeDaemonStatus(snapshot: NativeDaemonStatus | null, fallback: string): string {
  if (!snapshot) {
    return fallback;
  }
  if (!snapshot.enabled) {
    return "dev services";
  }
  if (snapshot.state === "running") {
    return "daemon running";
  }
  if (snapshot.state === "restarting") {
    return "daemon restarting";
  }
  if (snapshot.state === "starting") {
    return "daemon starting";
  }
  if (snapshot.state === "error") {
    return "daemon error";
  }
  if (snapshot.state === "stopped") {
    return "daemon stopped";
  }
  return fallback;
}
