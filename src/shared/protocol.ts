export type WidgetMode = "agent" | "browser" | "screen" | "terminal";

export type ClientMessage =
  | {
      type: "ask";
      id: string;
      text: string;
      mode: WidgetMode;
    }
  | {
      type: "cancel";
      id: string;
    }
  | {
      type: "ping";
    };

export type ServerEvent =
  | {
      type: "connected";
      daemon: {
        port: number;
        model: string;
        liveModel: boolean;
      };
    }
  | {
      type: "session.state";
      state: "idle" | "thinking" | "streaming" | "tooling" | "cancelled" | "error";
      id?: string;
    }
  | {
      type: "message.delta";
      id: string;
      text: string;
    }
  | {
      type: "message.completed";
      id: string;
      text: string;
    }
  | {
      type: "tool.started";
      id: string;
      tool: string;
      label: string;
    }
  | {
      type: "tool.output";
      id: string;
      tool: string;
      chunk: string;
    }
  | {
      type: "tool.completed";
      id: string;
      tool: string;
    }
  | {
      type: "approval.required";
      id: string;
      action: string;
      reason: string;
    }
  | {
      type: "error";
      id?: string;
      message: string;
    }
  | {
      type: "pong";
    };

export type ToolEmitter = (event: ServerEvent) => void;
