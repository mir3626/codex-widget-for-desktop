import type { IncomingMessage, ServerResponse } from "node:http";
import { readRequestBody } from "../../http.js";
import type { HttpRouteContext } from "../context.js";

export async function handleOAuthRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  const { auth, onAuthChanged } = context;

  if (request.method === "GET" && url.pathname === "/oauth/token") {
    auth.writeTokenEntryResponse(response);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/oauth/token") {
    try {
      auth.completeTokenEntry(new URLSearchParams(await readRequestBody(request)));
      auth.writeCallbackResponse(response, true, "OAuth token이 저장되었습니다. 위젯으로 돌아가 계속 사용할 수 있습니다.");
    } catch (error) {
      auth.writeCallbackResponse(
        response,
        false,
        error instanceof Error ? error.message : "OAuth token save failed."
      );
    } finally {
      onAuthChanged();
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/oauth/callback") {
    try {
      await auth.completeCallback(url);
      auth.writeCallbackResponse(response, true, "위젯으로 돌아가 계속 사용할 수 있습니다.");
    } catch (error) {
      auth.writeCallbackResponse(
        response,
        false,
        error instanceof Error ? error.message : "OAuth callback failed."
      );
    } finally {
      onAuthChanged();
    }
    return true;
  }

  return false;
}
