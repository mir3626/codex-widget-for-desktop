import type { IncomingMessage, ServerResponse } from "node:http";
import { summarizeCapabilityDiagnostics } from "../../../capability-runtime/index.js";
import { writeJsonResponse } from "../../http.js";
import type { HttpRouteContext } from "../context.js";

export async function handleCapabilityRoute(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  if (url.pathname === "/capabilities/jobs" && _request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      jobs: context.capabilityRuntime.list({
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        limit: readLimit(url.searchParams.get("limit"))
      })
    });
    return true;
  }

  const match = /^\/capabilities\/jobs\/([^/]+)$/.exec(url.pathname);
  if (match && _request.method === "GET") {
    const job = context.capabilityRuntime.read(decodeURIComponent(match[1]));
    if (!job) {
      writeJsonResponse(response, 404, { ok: false, error: "Capability job not found." });
      return true;
    }
    const resources = context.storage.listCapabilityResources(job.id);
    const locks = context.storage.listCapabilityLocks({ jobId: job.id });
    writeJsonResponse(response, 200, {
      ok: true,
      job,
      resources,
      locks,
      diagnostics: summarizeCapabilityDiagnostics(job, resources, locks)
    });
    return true;
  }

  return false;
}

function readLimit(value: string | null): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(500, Math.floor(number)) : 100;
}
