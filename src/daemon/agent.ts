import type { ServerEvent, ToolEmitter, WidgetMode } from "../shared/protocol.js";
import { delay, emitModePreview } from "./tools.js";

export type AgentRequest = {
  id: string;
  text: string;
  mode: WidgetMode;
};

export type AgentRuntimeOptions = {
  model?: string;
  apiKey?: string;
};

export async function runAgentStream(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal,
  options: AgentRuntimeOptions = {}
): Promise<void> {
  emit({ type: "session.state", state: "thinking", id: request.id });
  await emitModePreview(request.id, request.mode, emit, signal);
  emit({ type: "session.state", state: "streaming", id: request.id });

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    await streamOpenAIResponse(request, emit, signal, {
      apiKey,
      model: options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.2"
    });
    return;
  }

  await streamMockResponse(request, emit, signal);
}

async function streamOpenAIResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal,
  options: Required<AgentRuntimeOptions>
): Promise<void> {
  const { default: OpenAI } = (await import("openai")) as {
    default: new (config: { apiKey: string }) => {
      responses: {
        create: (params: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
      };
    };
  };

  const client = new OpenAI({ apiKey: options.apiKey });
  const instructions = [
    "You are a concise desktop resident coding assistant.",
    "Stream useful progress like Codex, but avoid claiming access to tools that are not attached.",
    "When browser, screen, or terminal mode is selected, explain what you would inspect next and what permission is needed."
  ].join(" ");

  const stream = await client.responses.create({
    model: options.model,
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[mode=${request.mode}] ${request.text}`
          }
        ]
      }
    ],
    stream: true
  });

  let fullText = "";
  for await (const event of stream) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      fullText += event.delta;
      emit({ type: "message.delta", id: request.id, text: event.delta });
    }
  }

  emit({ type: "message.completed", id: request.id, text: fullText });
  emit({ type: "session.state", state: "idle", id: request.id });
}

async function streamMockResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<void> {
  const response = [
    "OPENAI_API_KEY가 설정되지 않아 로컬 데모 스트림으로 답변합니다. ",
    "daemon은 이미 WebSocket 이벤트를 통해 부분 응답, 도구 상태, 완료 이벤트를 위젯으로 push하고 있습니다. ",
    request.mode === "agent"
      ? "실제 키를 설정하면 같은 UI에서 Responses API 스트리밍으로 전환됩니다."
      : "이 모드는 지금은 provider stub이며, 같은 세션에 실제 provider를 붙이면 DOM, 화면, 터미널 출력이 그대로 흘러옵니다."
  ].join("");

  let fullText = "";
  for (const chunk of chunkText(response, 12)) {
    await delay(35, signal);
    fullText += chunk;
    emit({ type: "message.delta", id: request.id, text: chunk });
  }

  emit({ type: "message.completed", id: request.id, text: fullText });
  emit({ type: "session.state", state: "idle", id: request.id });
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

export function daemonInfo(port: number): Extract<ServerEvent, { type: "connected" }>["daemon"] {
  return {
    port,
    model: process.env.OPENAI_MODEL ?? "gpt-5.2",
    liveModel: Boolean(process.env.OPENAI_API_KEY)
  };
}
