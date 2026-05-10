import type { IncomingMessage, ServerResponse } from "node:http";
import { readRequestBody, writeJsonResponse } from "../../http.js";
import { recordRuntimeActivity } from "../../runtimeActivity.js";
import type { HttpRouteContext } from "../context.js";

export async function handleSemanticMemoryRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  const { browserActions, semanticMemory, storage } = context;

  if (request.method === "GET" && url.pathname === "/semantic-memory/settings") {
    writeJsonResponse(response, 200, { ok: true, settings: browserActions.getSemanticMemorySettings() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/semantic-memory/settings") {
    try {
      const payload = JSON.parse(await readRequestBody(request, 128 * 1024));
      const settings = browserActions.setSemanticMemoryEnabled(Boolean(payload.enabled));
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "semantic-memory", settings.enabled ? "Semantic memory enabled" : "Semantic memory disabled", settings);
      writeJsonResponse(response, 200, { ok: true, settings });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid semantic memory settings."
      });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/semantic-memory/report") {
    writeJsonResponse(response, 200, { ok: true, report: semanticMemory.readReport() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/semantic-memory/unresolved") {
    try {
      const recorded = semanticMemory.recordUnresolvedCase(JSON.parse(await readRequestBody(request, 256 * 1024)));
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "semantic-memory", "Semantic unresolved case recorded", {
        id: recorded.id,
        surface: recorded.surface,
        failureKind: recorded.failureKind,
        candidates: recorded.candidates.length
      });
      writeJsonResponse(response, 200, { ok: true, unresolved: recorded });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid semantic unresolved case."
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/semantic-memory/feedback") {
    try {
      const event = semanticMemory.recordFeedbackEvent(JSON.parse(await readRequestBody(request, 256 * 1024)));
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "info", "semantic-memory", `Semantic memory feedback: ${event.source}`, {
        id: event.id,
        deltas: event.memoryDelta.length
      });
      writeJsonResponse(response, 200, { ok: true, event });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid semantic memory feedback."
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/semantic-memory/read") {
    try {
      const readSet = semanticMemory.readMemory(JSON.parse(await readRequestBody(request, 128 * 1024)));
      writeJsonResponse(response, 200, { ok: true, readSet });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid semantic memory query."
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/semantic-memory/reset") {
    try {
      const body = await readRequestBody(request, 128 * 1024);
      const payload = body.trim() ? JSON.parse(body) : {};
      semanticMemory.clearMemory(payload.scope);
      recordRuntimeActivity(storage, storage.ensureSessionSnapshot().activeSessionId, "warn", "semantic-memory", "Semantic memory reset", {
        scope: payload.scope ?? { global: true }
      });
      writeJsonResponse(response, 200, { ok: true, report: semanticMemory.readReport() });
    } catch (error) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid semantic memory reset."
      });
    }
    return true;
  }

  return false;
}
