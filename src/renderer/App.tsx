import { Bot, CircleDot, Eye, Globe2, Pin, Send, SquareTerminal, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import mascotUrl from "./assets/mascot.png";
import type { ClientMessage, ServerEvent, WidgetMode } from "../shared/protocol.js";

type LogLine = {
  id: string;
  text: string;
  tone: "muted" | "tool" | "error";
};

const MODES: Array<{ mode: WidgetMode; label: string; icon: typeof Bot }> = [
  { mode: "agent", label: "Agent", icon: Bot },
  { mode: "browser", label: "DOM", icon: Globe2 },
  { mode: "screen", label: "Vision", icon: Eye },
  { mode: "terminal", label: "PTY", icon: SquareTerminal }
];

export function App() {
  const [mode, setMode] = useState<WidgetMode>("agent");
  const [status, setStatus] = useState("connecting");
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("무엇을 도와줄까요?");
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const daemonPort = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("daemonPort") ?? "4128";
  }, []);

  useEffect(() => {
    const socket = new WebSocket(`ws://127.0.0.1:${daemonPort}`);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setConnected(true);
      setStatus("connected");
    });

    socket.addEventListener("close", () => {
      setConnected(false);
      setStatus("offline");
    });

    socket.addEventListener("message", (event) => {
      const serverEvent = JSON.parse(event.data as string) as ServerEvent;
      handleServerEvent(serverEvent);
    });

    return () => {
      socket.close();
    };
  }, [daemonPort]);

  function handleServerEvent(event: ServerEvent) {
    if (event.type === "connected") {
      setStatus(event.daemon.liveModel ? event.daemon.model : "demo");
      appendLog(event.daemon.liveModel ? `model ${event.daemon.model}` : "demo stream", "muted");
      return;
    }

    if (event.type === "session.state") {
      setStatus(event.state);
      if (event.state === "idle") {
        setActiveId(null);
      }
      return;
    }

    if (event.type === "message.delta") {
      setAnswer((current) => {
        if (activeId !== event.id && current === "무엇을 도와줄까요?") {
          return event.text;
        }
        return current + event.text;
      });
      return;
    }

    if (event.type === "message.completed") {
      setActiveId(null);
      return;
    }

    if (event.type === "tool.started") {
      appendLog(`${event.label}`, "tool");
      return;
    }

    if (event.type === "tool.output") {
      appendLog(event.chunk, "muted");
      return;
    }

    if (event.type === "tool.completed") {
      appendLog(`${event.tool} done`, "tool");
      return;
    }

    if (event.type === "error") {
      appendLog(event.message, "error");
    }
  }

  function appendLog(text: string, tone: LogLine["tone"]) {
    setLogLines((current) => [
      { id: crypto.randomUUID(), text, tone },
      ...current.slice(0, 4)
    ]);
  }

  function send(message: ClientMessage) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLog("daemon offline", "error");
      return;
    }
    socket.send(JSON.stringify(message));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || activeId) {
      return;
    }

    const id = crypto.randomUUID();
    setActiveId(id);
    setAnswer("");
    setInput("");
    send({ type: "ask", id, text, mode });
  }

  function cancel() {
    if (!activeId) {
      return;
    }
    send({ type: "cancel", id: activeId });
    setActiveId(null);
  }

  const busy = Boolean(activeId);

  return (
    <main className="widget">
      <section className="bubble" aria-live="polite">
        <div className="window-controls">
          <button className="icon-button" title="Pin" onClick={() => window.widgetShell.togglePin()}>
            <Pin size={16} />
          </button>
          <button className="icon-button" title="Hide" onClick={() => window.widgetShell.hide()}>
            <X size={16} />
          </button>
        </div>

        <div className="status-row">
          <span className={connected ? "status-dot online" : "status-dot"} />
          <span>{status}</span>
        </div>

        <p className={answer ? "answer" : "answer muted"}>{answer || "..."}</p>

        <div className="mode-row" role="tablist" aria-label="Mode">
          {MODES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.mode}
                className={mode === item.mode ? "mode active" : "mode"}
                title={item.label}
                aria-pressed={mode === item.mode}
                onClick={() => setMode(item.mode)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <form className="prompt-row" onSubmit={submit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Codex"
            disabled={!connected}
          />
          {busy ? (
            <button type="button" className="send-button stop" title="Stop" onClick={cancel}>
              <CircleDot size={17} />
            </button>
          ) : (
            <button type="submit" className="send-button" title="Send" disabled={!connected || !input.trim()}>
              <Send size={17} />
            </button>
          )}
        </form>

        <div className="log-list">
          {logLines.map((line) => (
            <div key={line.id} className={`log-line ${line.tone}`}>
              {line.text}
            </div>
          ))}
        </div>
      </section>

      <img className="mascot" src={mascotUrl} alt="" draggable={false} />
    </main>
  );
}
