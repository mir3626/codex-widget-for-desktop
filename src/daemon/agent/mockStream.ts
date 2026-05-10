import type { ToolEmitter } from "../../shared/protocol.js";
import { delay } from "../tools.js";
import type { AgentRequest } from "../agent.js";

export async function streamMockResponse(
  request: AgentRequest,
  emit: ToolEmitter,
  signal: AbortSignal
): Promise<void> {
  const response = [
    "OAuth 프록시 로그인이 없어 로컬 데모 스트림으로 답변합니다. ",
    "daemon은 이미 WebSocket 이벤트를 통해 부분 응답, 도구 상태, 완료 이벤트를 위젯으로 push하고 있습니다. ",
    request.mode === "agent"
      ? "OAuth provider와 CODEX_WIDGET_AGENT_PROXY_URL을 설정하고 로그인하면 같은 UI에서 프록시 스트리밍으로 전환됩니다."
      : "이 모드는 지금은 provider stub이며, 같은 세션에 OAuth 프록시 provider를 붙이면 DOM, 화면, 터미널 출력이 그대로 흘러옵니다."
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
