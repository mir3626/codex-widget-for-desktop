import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerEvent } from "../../shared/protocol.js";
import { readNativeDaemonStatus, type NativeDaemonStatus } from "../shell";
import type { LogLine } from "../types";
import { clearDaemonAuth, daemonWebSocketUrl, readDaemonAuth } from "../utils/daemonHttp";

type UseDaemonConnectionInput = {
  daemonPort: string;
  onEvent(event: ServerEvent): void;
  onCleanup(): void;
  appendLog(text: string, tone: LogLine["tone"]): void;
};

export function useDaemonConnection(input: UseDaemonConnectionInput) {
  const [nativeDaemonStatus, setNativeDaemonStatus] = useState<NativeDaemonStatus | null>(null);
  const [status, setStatus] = useState("connecting");
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(input.onEvent);
  const onCleanupRef = useRef(input.onCleanup);

  useEffect(() => {
    onEventRef.current = input.onEvent;
    onCleanupRef.current = input.onCleanup;
  }, [input.onEvent, input.onCleanup]);

  useEffect(() => {
    let stopped = false;
    let retryCount = 0;
    let reconnectTimer: number | null = null;

    function connect() {
      if (stopped) {
        return;
      }

      setStatus(retryCount === 0 ? "connecting" : "reconnecting");
      void openSocket();
    }

    async function openSocket() {
      const auth = await readDaemonAuth(input.daemonPort);
      if (stopped) {
        return;
      }
      const socket = new WebSocket(daemonWebSocketUrl(input.daemonPort, auth));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        retryCount = 0;
        setConnected(true);
        setStatus("connected");
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setConnected(false);
        if (stopped) {
          return;
        }
        if (auth) {
          clearDaemonAuth(input.daemonPort);
        }
        retryCount += 1;
        setStatus("reconnecting");
        const delay = Math.min(2500, 350 + retryCount * 250);
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener("message", (event) => {
        const serverEvent = JSON.parse(event.data as string) as ServerEvent;
        onEventRef.current(serverEvent);
      });
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
      onCleanupRef.current();
    };
  }, [input.daemonPort]);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    async function refreshNativeDaemonStatus() {
      const snapshot = await readNativeDaemonStatus();
      if (!stopped && snapshot) {
        setNativeDaemonStatus(snapshot);
      }
    }

    void refreshNativeDaemonStatus();
    timer = window.setInterval(refreshNativeDaemonStatus, connected ? 5000 : 1500);

    return () => {
      stopped = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [connected]);

  function send(message: ClientMessage): boolean {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      input.appendLog("daemon offline", "error");
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }

  return {
    connected,
    nativeDaemonStatus,
    send,
    status,
    setStatus
  };
}
