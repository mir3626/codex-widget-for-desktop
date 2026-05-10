import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJsonResponse } from "../../http.js";
import type { HttpRouteContext } from "../context.js";

export async function handleStorageRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/storage/health") {
    writeJsonResponse(response, 200, { ok: true, storage: context.storage.health({ integrityCheck: true }) });
    return true;
  }
  return false;
}
