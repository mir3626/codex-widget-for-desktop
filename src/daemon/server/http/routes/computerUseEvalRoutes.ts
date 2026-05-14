import type { IncomingMessage, ServerResponse } from "node:http";
import { createReleaseReadinessSummary, rollupComputerUseEvalMetrics } from "../../../computer-use-eval/index.js";
import { listEffectiveAutonomyCapabilities, ScopedAutonomyRuntime } from "../../../scoped-autonomy/index.js";
import { readRequestBody, writeJsonResponse } from "../../http.js";
import type { HttpRouteContext } from "../context.js";

export async function handleComputerUseEvalRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: HttpRouteContext
): Promise<boolean> {
  if (url.pathname === "/computer-use/eval/runs" && request.method === "GET") {
    const runs = context.storage.listComputerUseEvalRuns({
      sessionId: url.searchParams.get("sessionId") ?? undefined,
      scenarioId: url.searchParams.get("scenarioId") ?? undefined,
      limit: readLimit(url.searchParams.get("limit"))
    });
    writeJsonResponse(response, 200, { ok: true, runs, metrics: rollupComputerUseEvalMetrics(runs) });
    return true;
  }

  if (url.pathname === "/computer-use/eval/runs" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 256 * 1024));
      const run = context.storage.createComputerUseEvalRun({
        scenarioId: typeof body.scenarioId === "string" ? body.scenarioId : body.scenario?.id,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
        modalities: Array.isArray(body.modalities) ? body.modalities : body.scenario?.modalities ?? ["cross_app"],
        prompt: typeof body.prompt === "string" ? body.prompt : body.scenario?.prompt,
        scenario: body.scenario && typeof body.scenario === "object" ? body.scenario : undefined,
        metrics: body.metrics && typeof body.metrics === "object" ? body.metrics : undefined
      });
      writeJsonResponse(response, 200, { ok: true, run });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid eval run request." });
    }
    return true;
  }

  const runMatch = /^\/computer-use\/eval\/runs\/([^/]+)$/.exec(url.pathname);
  if (runMatch && request.method === "GET") {
    const run = context.storage.readComputerUseEvalRun(decodeURIComponent(runMatch[1]));
    if (!run) {
      writeJsonResponse(response, 404, { ok: false, error: "Eval run not found." });
      return true;
    }
    writeJsonResponse(response, 200, {
      ok: true,
      run,
      steps: context.storage.listComputerUseEvalSteps(run.id),
      resources: context.storage.listComputerUseEvalResources(run.id)
    });
    return true;
  }

  if (url.pathname === "/computer-use/eval/readiness" && request.method === "GET") {
    const runs = context.storage.listComputerUseEvalRuns({ limit: readLimit(url.searchParams.get("limit")) });
    writeJsonResponse(response, 200, { ok: true, readiness: createReleaseReadinessSummary(runs) });
    return true;
  }

  if (url.pathname === "/computer-use/perception-graphs" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      graphs: context.storage.listPerceptionGraphs({
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        limit: readLimit(url.searchParams.get("limit"))
      })
    });
    return true;
  }

  if (url.pathname === "/computer-use/failure-memory" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      records: context.storage.listStructuredFailureMemory({
        failureClass: url.searchParams.get("failureClass") as never,
        surface: url.searchParams.get("surface") ?? undefined,
        limit: readLimit(url.searchParams.get("limit"))
      })
    });
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/profiles" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      profiles: context.storage.listAutonomyPermissionProfiles({
        status: url.searchParams.get("status") as never,
        limit: readLimit(url.searchParams.get("limit"))
      })
    });
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/profiles" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 256 * 1024));
      const profile = context.storage.createAutonomyPermissionProfile({
        id: typeof body.id === "string" ? body.id : undefined,
        name: typeof body.name === "string" ? body.name : "Scoped autonomy",
        mode: body.mode === "off" || body.mode === "ask" || body.mode === "scoped_yolo" ? body.mode : "ask",
        scope: body.scope === "one_time" ? "one_time" : "persistent",
        status: body.status === "disabled" || body.status === "expired" ? body.status : "active",
        grants: body.grants && typeof body.grants === "object" ? body.grants : undefined,
        safetyBoundaries: Array.isArray(body.safetyBoundaries) ? body.safetyBoundaries : undefined,
        maxUses: Number.isFinite(Number(body.maxUses)) ? Number(body.maxUses) : undefined,
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined
      });
      writeJsonResponse(response, 200, { ok: true, profile });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy profile request." });
    }
    return true;
  }

  const autonomyProfileMatch = /^\/computer-use\/autonomy\/profiles\/([^/]+)$/.exec(url.pathname);
  if (autonomyProfileMatch && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 256 * 1024));
      const profile = context.storage.updateAutonomyPermissionProfile({
        id: decodeURIComponent(autonomyProfileMatch[1]),
        name: typeof body.name === "string" ? body.name : undefined,
        mode: body.mode === "off" || body.mode === "ask" || body.mode === "scoped_yolo" ? body.mode : undefined,
        scope: body.scope === "one_time" || body.scope === "persistent" ? body.scope : undefined,
        status: body.status === "active" || body.status === "disabled" || body.status === "expired" ? body.status : undefined,
        grants: body.grants && typeof body.grants === "object" ? body.grants : undefined,
        safetyBoundaries: Array.isArray(body.safetyBoundaries) ? body.safetyBoundaries : undefined,
        maxUses: body.maxUses === null ? null : Number.isFinite(Number(body.maxUses)) ? Number(body.maxUses) : undefined,
        usedCount: Number.isFinite(Number(body.usedCount)) ? Number(body.usedCount) : undefined,
        expiresAt: body.expiresAt === null ? null : typeof body.expiresAt === "string" ? body.expiresAt : undefined
      });
      writeJsonResponse(response, 200, { ok: true, profile });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy profile update request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/inventory" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      inventory: listEffectiveAutonomyCapabilities(context.storage)
    });
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/runs" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      runs: context.storage.listAutonomyRuns({
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        statuses: url.searchParams.getAll("status") as never,
        limit: readLimit(url.searchParams.get("limit"))
      })
    });
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/plan" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 512 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const plan = runtime.plan({
        goal: typeof body.goal === "string" ? body.goal : "",
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
        permissionProfileId: typeof body.permissionProfileId === "string" ? body.permissionProfileId : undefined,
        availableCapabilities: Array.isArray(body.availableCapabilities) ? body.availableCapabilities : undefined,
        outputRoot: typeof body.outputRoot === "string" ? body.outputRoot : undefined
      });
      writeJsonResponse(response, 200, { ok: true, plan });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy plan request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/materialize" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 512 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const spec = runtime.materializeTool({
        autonomyRunId: typeof body.autonomyRunId === "string" ? body.autonomyRunId : body.runId,
        gapId: typeof body.gapId === "string" ? body.gapId : ""
      });
      writeJsonResponse(response, 200, { ok: true, spec });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy materialize request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/self-implement" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 512 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const result = await runtime.selfImplementTool({
        autonomyRunId: typeof body.autonomyRunId === "string" ? body.autonomyRunId : body.runId,
        gapId: typeof body.gapId === "string" ? body.gapId : "",
        forceFirstSmokeFailure: Boolean(body.forceFirstSmokeFailure)
      });
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy self-implementation request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/smoke" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 512 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const toolRun = await runtime.runSmoke({
        autonomyRunId: typeof body.autonomyRunId === "string" ? body.autonomyRunId : body.runId,
        toolSpecId: typeof body.toolSpecId === "string" ? body.toolSpecId : ""
      });
      writeJsonResponse(response, 200, { ok: true, toolRun });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy smoke request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/execute" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 1024 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const toolRun = await runtime.execute({
        autonomyRunId: typeof body.autonomyRunId === "string" ? body.autonomyRunId : body.runId,
        toolSpecId: typeof body.toolSpecId === "string" ? body.toolSpecId : "",
        request: body.request && typeof body.request === "object" ? body.request : {}
      });
      writeJsonResponse(response, 200, { ok: true, toolRun });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy execute request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/run-dag" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 1024 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const result = await runtime.runGoalDag({
        goal: typeof body.goal === "string" ? body.goal : "",
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
        permissionProfileId: typeof body.permissionProfileId === "string" ? body.permissionProfileId : undefined,
        outputRoot: typeof body.outputRoot === "string" ? body.outputRoot : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        urls: Array.isArray(body.urls) ? body.urls : undefined,
        sourceDocuments: Array.isArray(body.sourceDocuments) ? body.sourceDocuments : undefined,
        forceFirstSmokeFailure: Boolean(body.forceFirstSmokeFailure)
      });
      writeJsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy DAG run request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/rerun" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 256 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const toolRun = await runtime.rerunToolRun({
        toolRunId: typeof body.toolRunId === "string" ? body.toolRunId : ""
      });
      writeJsonResponse(response, 200, { ok: true, toolRun });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy rerun request." });
    }
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/rollback" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request, 256 * 1024));
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const toolRun = runtime.rollbackRun({
        autonomyRunId: typeof body.autonomyRunId === "string" ? body.autonomyRunId : body.runId,
        includeUserArtifacts: Boolean(body.includeUserArtifacts)
      });
      writeJsonResponse(response, 200, { ok: true, toolRun });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy rollback request." });
    }
    return true;
  }

  const autonomyDebugBundleMatch = /^\/computer-use\/autonomy\/runs\/([^/]+)\/debug-bundle$/.exec(url.pathname);
  if (autonomyDebugBundleMatch && request.method === "GET") {
    try {
      const runtime = new ScopedAutonomyRuntime(context.storage);
      const bundle = runtime.createDebugBundle(decodeURIComponent(autonomyDebugBundleMatch[1]));
      writeJsonResponse(response, 200, { ok: true, bundle });
    } catch (error) {
      writeJsonResponse(response, 404, { ok: false, error: error instanceof Error ? error.message : "Autonomy debug bundle not found." });
    }
    return true;
  }

  const autonomyRunMatch = /^\/computer-use\/autonomy\/runs\/([^/]+)$/.exec(url.pathname);
  if (autonomyRunMatch && request.method === "GET") {
    const run = context.storage.readAutonomyRun(decodeURIComponent(autonomyRunMatch[1]));
    if (!run) {
      writeJsonResponse(response, 404, { ok: false, error: "Autonomy run not found." });
      return true;
    }
    writeJsonResponse(response, 200, {
      ok: true,
      run,
      gaps: context.storage.listAutonomyCapabilityGaps(run.id),
      dagNodes: run.dagRunId ? context.storage.listCapabilityDagNodes(run.dagRunId) : [],
      toolRuns: context.storage.listAutonomyToolRuns({ autonomyRunId: run.id })
    });
    return true;
  }

  if (url.pathname === "/computer-use/autonomy/tools" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      tools: context.storage.listAutonomyToolSpecs({
        capability: url.searchParams.get("capability") ?? undefined,
        limit: readLimit(url.searchParams.get("limit"))
      })
    });
    return true;
  }

  return false;
}

function readLimit(value: string | null): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(500, Math.floor(number)) : 100;
}
