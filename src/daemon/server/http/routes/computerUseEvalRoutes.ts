import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { auditComputerUseVerifier, createReleaseReadinessSummary, rollupComputerUseEvalMetrics } from "../../../computer-use-eval/index.js";
import { listEffectiveAutonomyCapabilities, ScopedAutonomyRuntime, validateAutonomyPermissionProfileBoundaryUnlocks } from "../../../scoped-autonomy/index.js";
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

  const runVerifierAuditMatch = /^\/computer-use\/eval\/runs\/([^/]+)\/verifier-audit$/.exec(url.pathname);
  if (runVerifierAuditMatch && request.method === "GET") {
    const audit = auditComputerUseVerifier({
      storage: context.storage,
      runId: decodeURIComponent(runVerifierAuditMatch[1]),
      includePassing: url.searchParams.get("includePassing") === "1"
    });
    if (audit.runsAudited === 0) {
      writeJsonResponse(response, 404, { ok: false, error: "Eval run not found." });
      return true;
    }
    writeJsonResponse(response, 200, { ok: true, audit });
    return true;
  }

  const resourceContentMatch = /^\/computer-use\/eval\/runs\/([^/]+)\/resources\/([^/]+)\/content$/.exec(url.pathname);
  if (resourceContentMatch && request.method === "GET") {
    const runId = decodeURIComponent(resourceContentMatch[1]);
    const resourceId = decodeURIComponent(resourceContentMatch[2]);
    const resource = context.storage.listComputerUseEvalResources(runId).find((candidate) => candidate.id === resourceId);
    if (!resource) {
      writeJsonResponse(response, 404, { ok: false, error: "Eval resource not found." });
      return true;
    }
    if (!isDownloadableEvalResource(resource.role)) {
      writeJsonResponse(response, 403, { ok: false, error: "Eval resource content is not downloadable." });
      return true;
    }
    if (!resource.blobId) {
      writeJsonResponse(response, 404, { ok: false, error: "Eval resource has no blob content." });
      return true;
    }
    const blob = context.storage.readBlob(resource.blobId);
    if (!blob || !existsSync(blob.path)) {
      writeJsonResponse(response, 404, { ok: false, error: "Eval resource blob is missing." });
      return true;
    }
    if (blob.size > 25 * 1024 * 1024) {
      writeJsonResponse(response, 413, { ok: false, error: "Eval resource blob is too large for direct download." });
      return true;
    }
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    response.writeHead(200, {
      "Content-Type": blob.mime,
      "Content-Length": String(blob.size),
      "Content-Disposition": `${disposition}; filename="${artifactFilename(resource.role, blob.mime)}"`,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(blob.path).pipe(response);
    return true;
  }

  if (url.pathname === "/computer-use/eval/readiness" && request.method === "GET") {
    const runs = context.storage.listComputerUseEvalRuns({ limit: readLimit(url.searchParams.get("limit")) });
    writeJsonResponse(response, 200, {
      ok: true,
      readiness: {
        ...createReleaseReadinessSummary(runs),
        verifierAudit: auditComputerUseVerifier({
          storage: context.storage,
          limit: readLimit(url.searchParams.get("limit"))
        })
      }
    });
    return true;
  }

  if (url.pathname === "/computer-use/eval/promotion-gate" && request.method === "GET") {
    const promotionGate = readLatestPromotionGateEvidence();
    if (!promotionGate) {
      writeJsonResponse(response, 404, { ok: false, error: "Computer Use promotion gate evidence not found." });
      return true;
    }
    writeJsonResponse(response, 200, { ok: true, ...promotionGate });
    return true;
  }

  if (url.pathname === "/computer-use/eval/dogfood-reports" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      reports: listLatestDogfoodReports(readLimit(url.searchParams.get("limit")))
    });
    return true;
  }

  if (url.pathname === "/computer-use/eval/dogfood-reports/content" && request.method === "GET") {
    const reportPath = resolveDogfoodReportPath(url.searchParams.get("path"));
    if (!reportPath) {
      writeJsonResponse(response, 400, { ok: false, error: "Dogfood report path is not allowed." });
      return true;
    }
    if (!existsSync(reportPath)) {
      writeJsonResponse(response, 404, { ok: false, error: "Dogfood report not found." });
      return true;
    }
    const stat = statSync(reportPath);
    if (stat.size > 10 * 1024 * 1024) {
      writeJsonResponse(response, 413, { ok: false, error: "Dogfood report is too large for direct viewing." });
      return true;
    }
    response.writeHead(200, {
      "Content-Type": dogfoodReportContentType(reportPath),
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${basename(reportPath)}"`,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(reportPath).pipe(response);
    return true;
  }

  if (url.pathname === "/computer-use/eval/verifier-audit" && request.method === "GET") {
    writeJsonResponse(response, 200, {
      ok: true,
      audit: auditComputerUseVerifier({
        storage: context.storage,
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        scenarioId: url.searchParams.get("scenarioId") ?? undefined,
        limit: readLimit(url.searchParams.get("limit")),
        includePassing: url.searchParams.get("includePassing") === "1"
      })
    });
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
      const profileInput = {
        id: typeof body.id === "string" ? body.id : undefined,
        name: typeof body.name === "string" ? body.name : "Scoped autonomy",
        mode: body.mode === "off" || body.mode === "ask" || body.mode === "scoped_yolo" ? body.mode : "ask",
        scope: body.scope === "one_time" ? "one_time" as const : "persistent" as const,
        status: body.status === "disabled" || body.status === "expired" ? body.status : "active",
        grants: body.grants && typeof body.grants === "object" ? body.grants : undefined,
        safetyBoundaries: Array.isArray(body.safetyBoundaries) ? body.safetyBoundaries : undefined,
        maxUses: Number.isFinite(Number(body.maxUses)) ? Number(body.maxUses) : undefined,
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined
      };
      const validation = validateAutonomyPermissionProfileBoundaryUnlocks(profileInput);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const profile = context.storage.createAutonomyPermissionProfile(profileInput);
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
      const id = decodeURIComponent(autonomyProfileMatch[1]);
      const current = context.storage.readAutonomyPermissionProfile(id);
      if (!current) {
        throw new Error(`Autonomy permission profile not found: ${id}`);
      }
      const profileInput = {
        id,
        name: typeof body.name === "string" ? body.name : undefined,
        mode: body.mode === "off" || body.mode === "ask" || body.mode === "scoped_yolo" ? body.mode : undefined,
        scope: body.scope === "one_time" || body.scope === "persistent" ? body.scope : undefined,
        status: body.status === "active" || body.status === "disabled" || body.status === "expired" ? body.status : undefined,
        grants: body.grants && typeof body.grants === "object" ? body.grants : undefined,
        safetyBoundaries: Array.isArray(body.safetyBoundaries) ? body.safetyBoundaries : undefined,
        maxUses: body.maxUses === null ? null : Number.isFinite(Number(body.maxUses)) ? Number(body.maxUses) : undefined,
        usedCount: Number.isFinite(Number(body.usedCount)) ? Number(body.usedCount) : undefined,
        expiresAt: body.expiresAt === null ? null : typeof body.expiresAt === "string" ? body.expiresAt : undefined
      };
      const nextScope = profileInput.scope ?? current.scope;
      const validation = validateAutonomyPermissionProfileBoundaryUnlocks({
        mode: profileInput.mode ?? current.mode,
        scope: nextScope,
        maxUses: nextScope === "one_time" ? 1 : profileInput.maxUses === null ? undefined : profileInput.maxUses ?? current.maxUses,
        safetyBoundaries: profileInput.safetyBoundaries ?? current.safetyBoundaries
      });
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const profile = context.storage.updateAutonomyPermissionProfile(profileInput);
      writeJsonResponse(response, 200, { ok: true, profile });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid autonomy profile update request." });
    }
    return true;
  }

  const autonomyCredentialLeaseRevokeMatch = /^\/computer-use\/autonomy\/profiles\/([^/]+)\/credential-leases\/([^/]+)\/revoke$/.exec(url.pathname);
  if (autonomyCredentialLeaseRevokeMatch && request.method === "POST") {
    try {
      const bodyText = await readRequestBody(request, 64 * 1024);
      const body = bodyText.trim() ? JSON.parse(bodyText) : {};
      const profile = context.storage.revokeAutonomyCredentialLease({
        profileId: decodeURIComponent(autonomyCredentialLeaseRevokeMatch[1]),
        leaseId: decodeURIComponent(autonomyCredentialLeaseRevokeMatch[2]),
        reason: typeof body.reason === "string" ? body.reason : undefined
      });
      writeJsonResponse(response, 200, { ok: true, profile });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid credential lease revoke request." });
    }
    return true;
  }

  const autonomyBrowserProfileLeaseRevokeMatch = /^\/computer-use\/autonomy\/profiles\/([^/]+)\/browser-profile-leases\/([^/]+)\/revoke$/.exec(url.pathname);
  if (autonomyBrowserProfileLeaseRevokeMatch && request.method === "POST") {
    try {
      const bodyText = await readRequestBody(request, 64 * 1024);
      const body = bodyText.trim() ? JSON.parse(bodyText) : {};
      const profile = context.storage.revokeAutonomyCredentialLease({
        profileId: decodeURIComponent(autonomyBrowserProfileLeaseRevokeMatch[1]),
        leaseId: decodeURIComponent(autonomyBrowserProfileLeaseRevokeMatch[2]),
        reason: typeof body.reason === "string" ? body.reason : "browser_profile_lease_revoked"
      });
      writeJsonResponse(response, 200, {
        ok: true,
        profile,
        audit: {
          schemaVersion: "browser-profile-lease-revoke-audit.v1",
          leaseId: decodeURIComponent(autonomyBrowserProfileLeaseRevokeMatch[2]),
          redaction: {
            cookies: "never_store",
            credentials: "redacted",
            browserHistory: "domain_only"
          }
        }
      });
    } catch (error) {
      writeJsonResponse(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid browser profile lease revoke request." });
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

function isDownloadableEvalResource(role: string): boolean {
  return /artifact|file|toolsmith|report|pdf|citation|markdown|download/i.test(role) &&
    role !== "perception_graph" &&
    !/screenshot|screen|ocr_region|raw_audio|microphone/i.test(role);
}

function artifactFilename(role: string, mime: string): string {
  const extension = extensionForMime(mime);
  const stem = role.replace(/[^a-z0-9_.-]+/gi, "_").replace(/^_+|_+$/g, "") || "computer-use-artifact";
  return `${stem}${extension}`;
}

function readLatestPromotionGateEvidence(): { promotionGate: unknown; evidencePath: string; reportPath: string } | null {
  const assetsRoot = join(process.cwd(), "docs", "reports", "assets");
  if (!existsSync(assetsRoot)) {
    return null;
  }
  const latest = readdirSync(assetsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = /^computer-use-promotion-gate-(\d{4}-\d{2}-\d{2})$/.exec(entry.name);
      if (!match) {
        return null;
      }
      const evidencePath = join(assetsRoot, entry.name, "evidence.json");
      if (!existsSync(evidencePath)) {
        return null;
      }
      return {
        date: match[1],
        evidencePath,
        reportPath: join(process.cwd(), "docs", "reports", `computer-use-promotion-gate-${match[1]}.md`)
      };
    })
    .filter((entry): entry is { date: string; evidencePath: string; reportPath: string } => entry !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  if (!latest) {
    return null;
  }
  return {
    promotionGate: JSON.parse(readFileSync(latest.evidencePath, "utf8")),
    evidencePath: relativeRepoPath(latest.evidencePath),
    reportPath: relativeRepoPath(latest.reportPath)
  };
}

type DogfoodReportSummary = {
  id: string;
  title: string;
  date: string;
  kind: string;
  reportPath: string;
  evidencePath?: string;
  dogfoodPath?: string;
};

function listLatestDogfoodReports(limit: number): DogfoodReportSummary[] {
  const reportsRoot = join(process.cwd(), "docs", "reports");
  if (!existsSync(reportsRoot)) {
    return [];
  }
  return readdirSync(reportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry): DogfoodReportSummary | null => {
      const match = /^(.*)-(\d{4}-\d{2}-\d{2})\.md$/.exec(entry.name);
      if (!match) {
        return null;
      }
      const stem = match[1];
      const date = match[2];
      if (!isComputerUseReportStem(stem)) {
        return null;
      }
      const reportPath = join(reportsRoot, entry.name);
      const evidencePath = join(process.cwd(), "docs", "reports", "assets", `${stem}-${date}`, "evidence.json");
      const dogfoodPath = join(process.cwd(), "docs", "dogfood", `${stem}-${date}.json`);
      const report: DogfoodReportSummary = {
        id: `${stem}-${date}`,
        title: dogfoodReportTitle(stem),
        date,
        kind: dogfoodReportKind(stem),
        reportPath: relativeRepoPath(reportPath)
      };
      if (existsSync(evidencePath)) {
        report.evidencePath = relativeRepoPath(evidencePath);
      }
      if (existsSync(dogfoodPath)) {
        report.dogfoodPath = relativeRepoPath(dogfoodPath);
      }
      return report;
    })
    .filter((entry): entry is DogfoodReportSummary => entry !== null)
    .sort((a, b) => `${b.date}:${b.id}`.localeCompare(`${a.date}:${a.id}`))
    .slice(0, limit);
}

function isComputerUseReportStem(stem: string): boolean {
  return stem.startsWith("computer-use-") ||
    stem.startsWith("scoped-autonomy-") ||
    stem === "windows-codex-computer-use-parity-audit";
}

function dogfoodReportKind(stem: string): string {
  if (stem.includes("promotion-gate")) return "promotion_gate";
  if (stem.includes("parity-audit")) return "parity_audit";
  if (stem.includes("browser-chrome")) return "browser_chrome";
  if (stem.includes("browser-prompt") || stem.includes("browser-live")) return "browser_action";
  if (stem.includes("scoped-autonomy") || stem.includes("toolsmith")) return "toolsmith";
  return "dogfood";
}

function dogfoodReportTitle(stem: string): string {
  return stem
    .replace(/^computer-use-/, "")
    .replace(/^scoped-autonomy-/, "toolsmith-")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveDogfoodReportPath(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/");
  if (
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }
  const allowedPrefix = normalized.startsWith("docs/reports/") || normalized.startsWith("docs/dogfood/");
  if (!allowedPrefix) {
    return null;
  }
  const extension = extname(normalized).toLowerCase();
  if (extension !== ".md" && extension !== ".json" && extension !== ".jsonl" && extension !== ".txt") {
    return null;
  }
  const root = resolve(process.cwd());
  const resolved = resolve(root, normalized);
  return resolved === root || !resolved.startsWith(`${root}${sep}`) ? null : resolved;
}

function dogfoodReportContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".md") return "text/markdown; charset=utf-8";
  if (extension === ".json" || extension === ".jsonl") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function relativeRepoPath(path: string): string {
  const root = process.cwd().replace(/\\/g, "/");
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}

function extensionForMime(mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "application/json") return ".json";
  if (normalized === "text/markdown") return ".md";
  if (normalized.startsWith("text/")) return ".txt";
  if (normalized === "text/x-diff") return ".diff";
  return ".bin";
}

function readLimit(value: string | null): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(500, Math.floor(number)) : 100;
}
