import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExecutionSurfaceKind, RiskClass } from "../../../../shared/protocol.js";
import { readRequestBody, writeJsonResponse } from "../../http.js";
import { readBrowserSourceFromSnapshot } from "../../browser-action/presentation.js";
import type { HttpRouteContext } from "../context.js";

export async function handleComputerUseSessionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  if (url.pathname === "/computer-use/surfaces" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      surfaces: context.computerSessionRuntime.listSurfaces()
    });
    return true;
  }

  if (url.pathname === "/computer-use/sessions" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      sessions: context.computerSessionRuntime.listSessions()
    });
    return true;
  }

  if (url.pathname === "/computer-use/sessions" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 512 * 1024));
      const userRequest = typeof body.userRequest === "string" ? body.userRequest : typeof body.prompt === "string" ? body.prompt : "";
      if (!userRequest.trim()) {
        writeJsonResponse(response, 400, { ok: false, error: "Computer session requires userRequest." });
        return true;
      }
      const result = await context.computerSessionRuntime.start({
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
        userRequest,
        profileId: typeof body.profileId === "string" ? body.profileId : typeof body.permissionProfileId === "string" ? body.permissionProfileId : undefined,
        requestedSurface: readExecutionSurfaceKind(body.requestedSurface),
        riskClass: readRiskClass(body.riskClass),
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : undefined
      });
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid computer session request." });
    }
    return true;
  }

  const debugMatch = /^\/computer-use\/sessions\/([^/]+)\/debug-bundle$/.exec(url.pathname);
  if (debugMatch && request.method === "GET") {
    try {
      const bundle = context.computerSessionRuntime.exportDebugBundle(decodeURIComponent(debugMatch[1]));
      writeJsonResponse(response, 200, { ok: true, bundle });
    } catch (error) {
      writeJsonResponse(response, 404, { ok: false, error: error instanceof Error ? error.message : "Computer session debug bundle not found." });
    }
    return true;
  }

  const operationMatch = /^\/computer-use\/sessions\/([^/]+)\/operations$/.exec(url.pathname);
  if (operationMatch && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 512 * 1024));
      const operation = body.operation && typeof body.operation === "object" ? body.operation : body;
      const result = await context.computerSessionRuntime.executeOperation({
        sessionId: decodeURIComponent(operationMatch[1]),
        operation,
        waitMs: Number.isFinite(Number(body.waitMs)) ? Number(body.waitMs) : undefined
      });
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid computer session operation request." });
    }
    return true;
  }

  const browserPromptMatch = /^\/computer-use\/sessions\/([^/]+)\/browser-action-prompt$/.exec(url.pathname);
  if (browserPromptMatch && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 512 * 1024));
      const text = typeof body.text === "string" ? body.text : typeof body.prompt === "string" ? body.prompt : "";
      if (!text.trim()) {
        writeJsonResponse(response, 400, { ok: false, error: "Browser Action prompt requires text." });
        return true;
      }
      const result = await context.computerSessionRuntime.executeBrowserActionPrompt({
        sessionId: decodeURIComponent(browserPromptMatch[1]),
        text,
        mode: body.mode === "agent" || body.mode === "browser" || body.mode === "screen" || body.mode === "terminal" ? body.mode : "browser",
        source: body.source && typeof body.source === "object" ? body.source : readBrowserSourceFromSnapshot(context.providers.getDomSnapshot())
      });
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid Computer Session Browser Action prompt request." });
    }
    return true;
  }

  const browserPromptContinueMatch = /^\/computer-use\/sessions\/([^/]+)\/browser-action-prompt\/continue$/.exec(url.pathname);
  if (browserPromptContinueMatch && request.method === "POST") {
    try {
      const bodyText = await readRequestBody(request, 128 * 1024);
      const body = bodyText.trim() ? JSON.parse(bodyText) : {};
      const result = await context.computerSessionRuntime.continueBrowserActionPrompt({
        sessionId: decodeURIComponent(browserPromptContinueMatch[1]),
        promptRunId: typeof body.promptRunId === "string" ? body.promptRunId : undefined
      });
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid Computer Session Browser Action prompt continuation request." });
    }
    return true;
  }

  const cancelMatch = /^\/computer-use\/sessions\/([^/]+)\/cancel$/.exec(url.pathname);
  if (cancelMatch && request.method === "POST") {
    try {
      const bodyText = await readRequestBody(request, 64 * 1024);
      const body = bodyText.trim() ? JSON.parse(bodyText) : {};
      const session = await context.computerSessionRuntime.cancel(
        decodeURIComponent(cancelMatch[1]),
        typeof body.reason === "string" ? body.reason : "user_cancelled"
      );
      writeJsonResponse(response, 200, { ok: true, session });
    } catch (error) {
      writeJsonResponse(response, 404, { ok: false, error: error instanceof Error ? error.message : "Computer session not found." });
    }
    return true;
  }

  const rollbackMatch = /^\/computer-use\/sessions\/([^/]+)\/rollback-actions\/([^/]+)$/.exec(url.pathname);
  if (rollbackMatch && request.method === "POST") {
    try {
      const bodyText = await readRequestBody(request, 128 * 1024);
      const body = bodyText.trim() ? JSON.parse(bodyText) : {};
      const result = await context.computerSessionRuntime.executeRollbackAction({
        sessionId: decodeURIComponent(rollbackMatch[1]),
        rollbackActionId: decodeURIComponent(rollbackMatch[2]),
        includeUserArtifacts: body.includeUserArtifacts === true,
        confirmUserArtifacts: body.confirmUserArtifacts === true
      });
      writeJsonResponse(response, 200, { ok: true, ...result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid Computer Session rollback request." });
    }
    return true;
  }

  const profileMatch = /^\/computer-use\/sessions\/([^/]+)\/profile$/.exec(url.pathname);
  if (profileMatch && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 128 * 1024));
      const profileId = typeof body.profileId === "string"
        ? body.profileId
        : typeof body.permissionProfileId === "string"
          ? body.permissionProfileId
          : "";
      if (!profileId.trim()) {
        writeJsonResponse(response, 400, { ok: false, error: "Computer session profile attach requires profileId." });
        return true;
      }
      const result = context.computerSessionRuntime.attachPermissionProfile({
        sessionId: decodeURIComponent(profileMatch[1]),
        profileId: profileId.trim(),
        reason: typeof body.reason === "string" ? body.reason : undefined,
        source: typeof body.source === "string" ? body.source : "computer_use_session_http"
      });
      writeJsonResponse(response, 200, { ok: true, ...result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid computer session profile attach request." });
    }
    return true;
  }

  const sessionMatch = /^\/computer-use\/sessions\/([^/]+)$/.exec(url.pathname);
  if (sessionMatch && request.method === "GET") {
    const session = context.computerSessionRuntime.read(decodeURIComponent(sessionMatch[1]));
    if (!session) {
      writeJsonResponse(response, 404, { ok: false, error: "Computer session not found." });
      return true;
    }
    writeJsonResponse(response, 200, { ok: true, session });
    return true;
  }

  return false;
}

function readExecutionSurfaceKind(value: unknown): ExecutionSurfaceKind | undefined {
  return value === "isolated_browser" ||
    value === "regular_browser_extension" ||
    value === "tool_workspace" ||
    value === "pty_workspace" ||
    value === "foreground_desktop_watch" ||
    value === "future_vm_session"
    ? value
    : undefined;
}

function readRiskClass(value: unknown): RiskClass | undefined {
  return value === "read_only" ||
    value === "local_artifact_create" ||
    value === "browser_state_mutation" ||
    value === "local_file_disclosure" ||
    value === "profile_private_data" ||
    value === "external_submission" ||
    value === "destructive_local_change" ||
    value === "os_settings_mutation" ||
    value === "credential_or_secret" ||
    value === "security_boundary"
    ? value
    : undefined;
}
