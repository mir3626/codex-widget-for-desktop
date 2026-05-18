import { Bot, Clipboard, FileCheck, Play, RefreshCw, RotateCcw, Save, ShieldCheck, Undo2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AutonomyCapabilityGap,
  AutonomyCapabilityInventoryItem,
  AutonomyDebugBundle,
  AutonomyGeneratedToolSpec,
  AutonomyPermissionProfile,
  AutonomyPermissionRequirement,
  AutonomyRunSummary,
  AutonomyToolRunSummary,
  CapabilityDagNodeSummary
} from "../../shared/protocol.js";
import { daemonFetchJson, daemonPostJson } from "../utils/daemonHttp";
import { formatActivityTime } from "../utils/format";

type AutonomyListPayload = {
  ok: boolean;
  profiles?: AutonomyPermissionProfile[];
  runs?: AutonomyRunSummary[];
  tools?: AutonomyGeneratedToolSpec[];
  inventory?: AutonomyCapabilityInventoryItem[];
  error?: string;
};

type AutonomyRunDetail = {
  ok: boolean;
  run?: AutonomyRunSummary;
  gaps?: AutonomyCapabilityGap[];
  dagNodes?: CapabilityDagNodeSummary[];
  toolRuns?: AutonomyToolRunSummary[];
  error?: string;
};

type AutonomyToolsmithPanelProps = {
  daemonPort: string;
};

export function AutonomyToolsmithPanel({ daemonPort }: AutonomyToolsmithPanelProps) {
  const [profiles, setProfiles] = useState<AutonomyPermissionProfile[]>([]);
  const [runs, setRuns] = useState<AutonomyRunSummary[]>([]);
  const [tools, setTools] = useState<AutonomyGeneratedToolSpec[]>([]);
  const [inventory, setInventory] = useState<AutonomyCapabilityInventoryItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [runDetail, setRunDetail] = useState<AutonomyRunDetail | null>(null);
  const [profileDraft, setProfileDraft] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [message, setMessage] = useState<string>("");

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null,
    [profiles, selectedProfileId]
  );
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId]
  );
  const latestMissingGrants = useMemo(() => {
    const output = selectedRun && typeof selectedRun.output === "object" && selectedRun.output ? selectedRun.output as Record<string, unknown> : {};
    const permission = output.permission && typeof output.permission === "object" ? output.permission as Record<string, unknown> : {};
    const missing = Array.isArray(permission.missingRequirements) ? permission.missingRequirements : [];
    return missing.filter(isPermissionRequirement);
  }, [selectedRun]);
  const rerunnableToolRun = useMemo(() => {
    const toolRuns = runDetail?.toolRuns ?? [];
    for (let index = toolRuns.length - 1; index >= 0; index -= 1) {
      const toolRun = toolRuns[index];
      if (toolRun.status === "completed" && toolRun.mode === "execute") {
        return toolRun;
      }
    }
    return null;
  }, [runDetail]);

  useEffect(() => {
    void refresh();
  }, [daemonPort]);

  useEffect(() => {
    if (!selectedProfileId && profiles[0]) {
      setSelectedProfileId(profiles[0].id);
    }
    if (selectedProfileId && !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0]?.id ?? "");
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!selectedRunId && runs[0]) {
      setSelectedRunId(runs[0].id);
    }
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? "");
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    setProfileDraft(selectedProfile ? JSON.stringify(profileToEditablePayload(selectedProfile), null, 2) : "");
  }, [selectedProfile?.id]);

  useEffect(() => {
    if (!selectedRun) {
      setRunDetail(null);
      return undefined;
    }
    let cancelled = false;
    fetchJson<AutonomyRunDetail>(daemonPort, `/computer-use/autonomy/runs/${encodeURIComponent(selectedRun.id)}`)
      .then((payload) => {
        if (!cancelled) {
          setRunDetail(payload);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRunDetail({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [daemonPort, selectedRun?.id, selectedRun?.updatedAt]);

  async function refresh() {
    setStatus("loading");
    setMessage("");
    try {
      const [profilesPayload, runsPayload, toolsPayload, inventoryPayload] = await Promise.all([
        fetchJson<AutonomyListPayload>(daemonPort, "/computer-use/autonomy/profiles?limit=20"),
        fetchJson<AutonomyListPayload>(daemonPort, "/computer-use/autonomy/runs?limit=12"),
        fetchJson<AutonomyListPayload>(daemonPort, "/computer-use/autonomy/tools?limit=20"),
        fetchJson<AutonomyListPayload>(daemonPort, "/computer-use/autonomy/inventory?limit=50")
      ]);
      setProfiles(profilesPayload.profiles ?? []);
      setRuns(runsPayload.runs ?? []);
      setTools(toolsPayload.tools ?? []);
      setInventory(inventoryPayload.inventory ?? []);
      setStatus("idle");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function createDefaultProfile() {
    const payload = {
      name: "Scoped one-time web PDF",
      mode: "scoped_yolo",
      scope: "one_time",
      maxUses: 1,
      grants: {
        network: true,
        networkDomains: ["openai.com", "platform.openai.com", "help.openai.com", "example.com"],
        browserAutomation: false,
        browserDomains: [],
        filesystem: { readRoots: [], writeRoots: [] },
        commands: { allowPrefixes: ["node"], denyPatterns: [] },
        packageInstall: false,
        packageAllowlist: ["file:*"],
        osMutation: false,
        generatedToolMaterialization: true,
        generatedToolExecution: true,
        generatedCode: true,
        credentialAccess: "never",
        riskClasses: ["read_only", "reversible"],
        maxRuntimeMs: 30000,
        maxOutputBytes: 2097152,
        maxIterations: 3
      }
    };
    await postJson(daemonPort, "/computer-use/autonomy/profiles", payload);
    await refresh();
  }

  async function createOneTimeFromMissingGrants() {
    const grants = grantsFromMissingRequirements(latestMissingGrants);
    await postJson(daemonPort, "/computer-use/autonomy/profiles", {
      name: "One-time blocked-run grant",
      mode: "scoped_yolo",
      scope: "one_time",
      maxUses: 1,
      grants
    });
    await refresh();
  }

  async function saveProfileDraft() {
    if (!selectedProfile) {
      return;
    }
    const payload = JSON.parse(profileDraft) as Record<string, unknown>;
    await postJson(daemonPort, `/computer-use/autonomy/profiles/${encodeURIComponent(selectedProfile.id)}`, payload);
    await refresh();
  }

  async function updateProfileStatus(statusValue: "disabled" | "expired") {
    if (!selectedProfile) {
      return;
    }
    await postJson(daemonPort, `/computer-use/autonomy/profiles/${encodeURIComponent(selectedProfile.id)}`, { status: statusValue });
    await refresh();
  }

  async function runSampleDag() {
    if (!selectedProfile) {
      return;
    }
    setStatus("loading");
    const payload = {
      goal: "OpenAI homepage Codex command support report to PDF",
      permissionProfileId: selectedProfile.id,
      title: "OpenAI Codex command support report",
      urls: ["https://openai.com/codex/", "https://platform.openai.com/docs/codex"]
    };
    const response = await postJson<{ ok: boolean; result?: { run?: AutonomyRunSummary }; error?: string }>(daemonPort, "/computer-use/autonomy/run-dag", payload);
    if (response.result?.run?.id) {
      setSelectedRunId(response.result.run.id);
    }
    setStatus("idle");
    await refresh();
  }

  async function copyDebugBundle() {
    if (!selectedRun) {
      return;
    }
    const payload = await fetchJson<{ ok: boolean; bundle?: AutonomyDebugBundle }>(
      daemonPort,
      `/computer-use/autonomy/runs/${encodeURIComponent(selectedRun.id)}/debug-bundle`
    );
    await navigator.clipboard?.writeText(JSON.stringify(payload.bundle ?? payload, null, 2)).catch(() => undefined);
    setMessage("Debug bundle copied");
  }

  async function rerunSelectedToolRun() {
    if (!rerunnableToolRun) {
      return;
    }
    setStatus("loading");
    const response = await postJson<{ ok: boolean; toolRun?: AutonomyToolRunSummary; error?: string }>(daemonPort, "/computer-use/autonomy/rerun", {
      toolRunId: rerunnableToolRun.id
    });
    setMessage(`Rerun ${response.toolRun?.status ?? "submitted"} for ${shortId(rerunnableToolRun.id)}`);
    setStatus("idle");
    await refresh();
  }

  async function rollbackSelectedRun() {
    if (!selectedRun) {
      return;
    }
    setStatus("loading");
    const response = await postJson<{ ok: boolean; toolRun?: AutonomyToolRunSummary; error?: string }>(daemonPort, "/computer-use/autonomy/rollback", {
      autonomyRunId: selectedRun.id,
      includeUserArtifacts: false
    });
    setMessage(`Rollback ${response.toolRun?.status ?? "submitted"} for ${shortId(selectedRun.id)}`);
    setStatus("idle");
    await refresh();
  }

  const dagNodes = runDetail?.dagNodes ?? [];
  const toolRuns = runDetail?.toolRuns ?? [];
  const gaps = runDetail?.gaps ?? [];
  const selectedRunTools = selectedRun
    ? tools.filter((tool) => selectedRun.toolSpecIds.includes(tool.id))
    : [];
  const runEvidence = summarizeToolsmithRunEvidence(selectedRunTools, toolRuns);
  const rerunHistory = summarizeRerunHistory(toolRuns);

  return (
    <section className="autonomy-panel" aria-label="Autonomy Toolsmith">
      <div className="capability-jobs-head">
        <div>
          <Bot size={12} />
          <strong>Autonomy Toolsmith</strong>
          <span>{runs.length ? `${runs.length} runs` : "ready"}</span>
        </div>
        <div className="capability-jobs-actions">
          <button type="button" aria-label="Run sample autonomy DAG" data-tooltip="Run sample DAG" disabled={!selectedProfile || status === "loading"} onClick={() => void runSampleDag()}>
            <Play size={12} />
          </button>
          <button type="button" aria-label="Copy autonomy debug bundle" data-tooltip="Copy debug bundle" disabled={!selectedRun} onClick={() => void copyDebugBundle()}>
            <Clipboard size={12} />
          </button>
          <button type="button" aria-label="Rerun selected autonomy tool run" data-tooltip="Rerun last tool" disabled={!rerunnableToolRun || status === "loading"} onClick={() => void rerunSelectedToolRun()}>
            <RotateCcw size={12} />
          </button>
          <button type="button" aria-label="Rollback selected autonomy run" data-tooltip="Rollback run" disabled={!selectedRun || status === "loading"} onClick={() => void rollbackSelectedRun()}>
            <Undo2 size={12} />
          </button>
          <button type="button" aria-label="Refresh autonomy state" data-tooltip="Refresh autonomy" onClick={() => void refresh()}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="autonomy-select-row">
        <label>
          <ShieldCheck size={11} />
          <select value={selectedProfile?.id ?? ""} onChange={(event) => setSelectedProfileId(event.target.value)}>
            {profiles.length ? profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            )) : <option value="">No profile</option>}
          </select>
        </label>
        <label>
          <FileCheck size={11} />
          <select value={selectedRun?.id ?? ""} onChange={(event) => setSelectedRunId(event.target.value)}>
            {runs.length ? runs.map((run) => (
              <option key={run.id} value={run.id}>{run.status} - {shortId(run.id)}</option>
            )) : <option value="">No run</option>}
          </select>
        </label>
      </div>

      <div className="autonomy-actions-row">
        <button type="button" onClick={() => void createDefaultProfile()}>Create</button>
        <button type="button" disabled={!selectedProfile} onClick={() => void saveProfileDraft()}>
          <Save size={11} />
          Save
        </button>
        <button type="button" disabled={!selectedProfile} onClick={() => void updateProfileStatus("disabled")}>Disable</button>
        <button type="button" disabled={!selectedProfile} onClick={() => void updateProfileStatus("expired")}>Expire</button>
        <button type="button" disabled={!latestMissingGrants.length} onClick={() => void createOneTimeFromMissingGrants()}>Grant Block</button>
      </div>

      {selectedProfile ? (
        <textarea
          className="autonomy-profile-editor"
          value={profileDraft}
          spellCheck={false}
          onChange={(event) => setProfileDraft(event.target.value)}
          aria-label="Autonomy permission profile JSON"
        />
      ) : null}

      <div className="autonomy-metrics">
        <div>
          <dt>Inventory</dt>
          <dd>{inventory.filter((item) => item.status === "available" || item.status === "generated").length}/{inventory.length}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{tools.filter((tool) => tool.status === "active" || tool.status === "smoke_passed").length}/{tools.length}</dd>
        </div>
        <div>
          <dt>DAG</dt>
          <dd>{dagNodes.filter((node) => node.status === "completed").length}/{dagNodes.length}</dd>
        </div>
      </div>

      {selectedRun ? (
        <div className="autonomy-evidence-grid">
          <div className="autonomy-evidence-card">
            <span className={`capability-status ${runEvidence.stabilityTone}`}>{runEvidence.stability}</span>
            <strong>Stability</strong>
            <small>{runEvidence.rerunSummary}</small>
          </div>
          <div className="autonomy-evidence-card">
            <span className={`capability-status ${runEvidence.rollbackTone}`}>{runEvidence.rollbackStatus}</span>
            <strong>Rollback</strong>
            <small>{runEvidence.rollbackSummary}</small>
          </div>
          <div className="autonomy-evidence-card">
            <span className="capability-status active">{runEvidence.dependencyCount}</span>
            <strong>Dependencies</strong>
            <small>{runEvidence.dependencySummary}</small>
          </div>
          <div className="autonomy-evidence-card">
            <span className={`capability-status ${runEvidence.dependencyPolicyTone}`}>{runEvidence.dependencyPolicyStatus}</span>
            <strong>Package policy</strong>
            <small>{runEvidence.dependencyPolicySummary}</small>
          </div>
          <div className="autonomy-evidence-card">
            <span className="capability-status active">{runEvidence.artifactContractCount}</span>
            <strong>Artifact contract</strong>
            <small>{runEvidence.artifactSummary}</small>
          </div>
        </div>
      ) : null}

      {rerunHistory.length ? (
        <div className="autonomy-rerun-history" aria-label="Toolsmith rerun comparison history">
          <div className="computer-use-section-title">
            <RotateCcw size={11} />
            <strong>Rerun history</strong>
          </div>
          {rerunHistory.slice(0, 6).map((item) => (
            <div key={item.id} className="autonomy-rerun-row">
              <span className={`capability-status ${item.tone}`}>{item.verdict}</span>
              <div>
                <strong>{item.summary}</strong>
                <small>{item.detail}</small>
              </div>
              <small>{formatActivityTime(item.timestamp)}</small>
            </div>
          ))}
        </div>
      ) : null}

      {latestMissingGrants.length ? (
        <div className="autonomy-blocked-grants">
          {latestMissingGrants.slice(0, 5).map((grant, index) => (
            <span key={`${grant.type}-${grant.value}-${index}`} title={grant.reason}>{grant.type}: {grant.value}</span>
          ))}
          {latestMissingGrants.length > 5 ? <span>+{latestMissingGrants.length - 5} more</span> : null}
        </div>
      ) : null}

      <div className="autonomy-dag-list">
        {dagNodes.slice(0, 10).map((node) => (
          <div key={node.id} className="autonomy-dag-row">
            <span className={`capability-status ${statusTone(node.status)}`}>{node.status}</span>
            <strong>{node.kind}</strong>
            <small>{node.elapsedMs ? `${node.elapsedMs}ms` : shortId(node.id)}</small>
          </div>
        ))}
      </div>

      {gaps.length || toolRuns.length ? (
        <details className="capability-job-json">
          <summary>
            <Wrench size={11} />
            Toolsmith JSON
          </summary>
          <pre>{JSON.stringify({ gaps, toolRuns: toolRuns.slice(0, 8), tools: tools.slice(0, 5) }, null, 2).slice(0, 3200)}</pre>
        </details>
      ) : null}
      {message || status === "failed" ? <p className={status === "failed" ? "capability-job-error" : undefined}>{message || "Autonomy refresh failed"}</p> : null}
      {selectedRun ? <small className="autonomy-updated">Updated {formatActivityTime(selectedRun.updatedAt)}</small> : null}
    </section>
  );
}

async function fetchJson<T>(daemonPort: string, path: string): Promise<T> {
  return await daemonFetchJson<T>(daemonPort, path);
}

async function postJson<T = unknown>(daemonPort: string, path: string, body: unknown): Promise<T> {
  return await daemonPostJson<T>(daemonPort, path, body);
}

function profileToEditablePayload(profile: AutonomyPermissionProfile): Record<string, unknown> {
  return {
    name: profile.name,
    mode: profile.mode,
    scope: profile.scope,
    status: profile.status,
    maxUses: profile.maxUses ?? null,
    expiresAt: profile.expiresAt ?? null,
    grants: profile.grants,
    safetyBoundaries: profile.safetyBoundaries
  };
}

function grantsFromMissingRequirements(requirements: AutonomyPermissionRequirement[]): Record<string, unknown> {
  const grants = {
    network: false,
    networkDomains: [] as string[],
    browserAutomation: false,
    browserDomains: [] as string[],
    filesystem: { readRoots: [] as string[], writeRoots: [] as string[] },
    commands: { allowPrefixes: [] as string[], denyPatterns: [] as string[] },
    packageInstall: false,
    packageAllowlist: ["file:*"] as string[],
    osMutation: false,
    generatedToolMaterialization: false,
    generatedToolExecution: false,
    generatedCode: false,
    credentialAccess: "never",
    riskClasses: [] as string[],
    maxRuntimeMs: 30000,
    maxOutputBytes: 2097152,
    maxIterations: 3
  };
  for (const requirement of requirements) {
    if (requirement.type === "network") grants.network = true;
    if (requirement.type === "network_domain") {
      grants.network = true;
      grants.networkDomains.push(requirement.value);
    }
    if (requirement.type === "browser_automation") grants.browserAutomation = true;
    if (requirement.type === "browser_domain") {
      grants.browserAutomation = true;
      grants.browserDomains.push(requirement.value);
    }
    if (requirement.type === "filesystem_read") grants.filesystem.readRoots.push(requirement.value);
    if (requirement.type === "filesystem_write") grants.filesystem.writeRoots.push(requirement.value);
    if (requirement.type === "command") grants.commands.allowPrefixes.push(requirement.value);
    if (requirement.type === "package_install") {
      grants.packageInstall = true;
      if (requirement.value.startsWith("npm:") || requirement.value.startsWith("file:")) {
        grants.packageAllowlist.push(requirement.value);
      }
    }
    if (requirement.type === "os_mutation") grants.osMutation = true;
    if (requirement.type === "generated_tool_materialization") grants.generatedToolMaterialization = true;
    if (requirement.type === "generated_tool_execution") grants.generatedToolExecution = true;
    if (requirement.type === "generated_code") grants.generatedCode = true;
    if (requirement.type === "risk_class") grants.riskClasses.push(requirement.value);
  }
  grants.networkDomains = [...new Set(grants.networkDomains)];
  grants.browserDomains = [...new Set(grants.browserDomains)];
  grants.filesystem.readRoots = [...new Set(grants.filesystem.readRoots)];
  grants.filesystem.writeRoots = [...new Set(grants.filesystem.writeRoots)];
  grants.commands.allowPrefixes = [...new Set(grants.commands.allowPrefixes)];
  grants.packageAllowlist = [...new Set(grants.packageAllowlist)];
  grants.riskClasses = [...new Set(grants.riskClasses.length ? grants.riskClasses : ["read_only"])];
  return grants;
}

function isPermissionRequirement(value: unknown): value is AutonomyPermissionRequirement {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string" && typeof (value as { value?: unknown }).value === "string");
}

function statusTone(status: string): string {
  if (status === "completed" || status === "active" || status === "smoke_passed") return "ok";
  if (status === "failed" || status === "blocked" || status === "smoke_failed") return "error";
  if (status === "cancelled" || status === "skipped") return "warn";
  return "active";
}

function summarizeToolsmithRunEvidence(
  tools: AutonomyGeneratedToolSpec[],
  toolRuns: AutonomyToolRunSummary[]
): {
  stability: string;
  stabilityTone: string;
  rerunSummary: string;
  rollbackStatus: string;
  rollbackTone: string;
  rollbackSummary: string;
  dependencyCount: number;
  dependencySummary: string;
  dependencyPolicyStatus: string;
  dependencyPolicyTone: string;
  dependencyPolicySummary: string;
  artifactContractCount: number;
  artifactSummary: string;
} {
  const stabilityRatings = tools
    .map((tool) => tool.manifest?.stability.rating ?? tool.stabilityRating)
    .filter(Boolean)
    .map(String);
  const stability = stabilityRatings.length ? [...new Set(stabilityRatings)].join("+") : "unknown";
  const manifestRerunCount = tools.reduce((sum, tool) => sum + (tool.manifest?.stability.rerunCount ?? 0), 0);
  const latestRerunStatusValue = tools
    .map((tool) => tool.manifest?.stability.lastRerunStatus)
    .find(Boolean);
  const latestRerunStatus = latestRerunStatusValue ? String(latestRerunStatusValue) : undefined;
  const rerunRuns = toolRuns.filter((run) => run.mode === "rerun");
  const latestRerun = rerunRuns[0];
  const latestRerunOutput = readRecord(latestRerun?.output);
  const latestComparison = readRecord(latestRerunOutput.rerunComparison);
  const artifactComparison = readRecord(latestComparison.artifactComparison);
  const changedArtifacts = Array.isArray(artifactComparison.changed) ? artifactComparison.changed.length : 0;
  const missingArtifacts = Array.isArray(artifactComparison.missing) ? artifactComparison.missing.length : 0;
  const addedArtifacts = Array.isArray(artifactComparison.added) ? artifactComparison.added.length : 0;
  const artifactDelta = changedArtifacts + missingArtifacts + addedArtifacts;
  const rerunSummary = [
    `${manifestRerunCount || rerunRuns.length} reruns`,
    latestRerunStatus ? `last ${latestRerunStatus}` : latestRerun ? `last ${latestRerun.status}` : "no comparison",
    latestComparison.schemaVersion === "toolsmith-rerun-comparison.v1" ? `artifact delta ${artifactDelta}` : undefined,
    tools.length ? `${tools.length} tools` : "no tool"
  ].filter((part): part is string => Boolean(part)).join(" · ");

  const rollbackRuns = toolRuns.filter((run) => run.mode === "rollback");
  const latestRollback = rollbackRuns[0];
  const latestRollbackOutput = readRecord(latestRollback?.output);
  const deleted = Array.isArray(latestRollbackOutput.deleted) ? latestRollbackOutput.deleted.length : 0;
  const skipped = Array.isArray(latestRollbackOutput.skipped) ? latestRollbackOutput.skipped.length : 0;
  const rollbackActions = tools.flatMap((tool) => tool.manifest?.rollback ?? []);
  const rollbackStatus = latestRollback?.status ?? (rollbackActions.length ? "planned" : "none");
  const rollbackSummary = latestRollback
    ? `${deleted} deleted · ${skipped} skipped · ${shortId(latestRollback.id)}`
    : `${rollbackActions.length} actions · safe cleanup first`;

  const dependencies = tools.flatMap((tool) => tool.manifest?.dependencies ?? []);
  const dependencySummary = dependencies.length
    ? summarizeDependencySources(dependencies)
    : "no manifest dependency evidence";
  const dependencyPrepareRun = toolRuns.find((run) => run.mode === "dependency_prepare");
  const dependencyPolicy = readRecord(readRecord(dependencyPrepareRun?.output).policyReview);
  const installIsolation = readRecord(dependencyPolicy.installIsolation);
  const dependencyPolicyStatus = typeof dependencyPolicy.reviewOutcome === "string"
    ? dependencyPolicy.reviewOutcome === "passed_local_or_allowlisted_dependency_policy"
      ? "passed"
      : "review"
    : dependencyPolicy.schemaVersion === "toolsmith-dependency-policy-review.v1"
      ? "pending"
      : "none";
  const dependencyPolicySummary = dependencyPolicy.schemaVersion === "toolsmith-dependency-policy-review.v1"
    ? [
      `local ${Number(dependencyPolicy.localFilePackageCount ?? 0)}`,
      `external ${Number(dependencyPolicy.externalRegistryPackageCount ?? 0)}`,
      installIsolation.ignoreScripts === true ? "scripts off" : "scripts unknown",
      dependencyPolicy.lockfileProvenancePresent === true ? "lock proven" : dependencyPolicy.lockfileRequired === true ? "lock pending" : undefined
    ].filter((part): part is string => Boolean(part)).join(" · ")
    : "no policy review";
  const artifactContracts = tools.flatMap((tool) => tool.manifest?.artifactContract ?? []);
  const artifactSummary = artifactContracts.length
    ? `${artifactContracts.filter((artifact) => artifact.required).length} required · ${artifactContracts.map((artifact) => artifact.role).slice(0, 3).join(", ")}`
    : "no contract";

  return {
    stability,
    stabilityTone: stability === "high" || stability === "medium" ? "ok" : stability === "low" ? "error" : "warn",
    rerunSummary,
    rollbackStatus,
    rollbackTone: statusTone(rollbackStatus),
    rollbackSummary,
    dependencyCount: dependencies.length,
    dependencySummary,
    dependencyPolicyStatus,
    dependencyPolicyTone: dependencyPolicyStatus === "passed" ? "ok" : dependencyPolicyStatus === "none" ? "warn" : "active",
    dependencyPolicySummary,
    artifactContractCount: artifactContracts.length,
    artifactSummary
  };
}

type RerunHistoryItem = {
  id: string;
  verdict: string;
  tone: string;
  summary: string;
  detail: string;
  timestamp: string;
};

function summarizeRerunHistory(toolRuns: AutonomyToolRunSummary[]): RerunHistoryItem[] {
  return toolRuns
    .filter((run) => run.mode === "rerun")
    .map((run) => {
      const output = readRecord(run.output);
      const comparison = readRecord(output.rerunComparison);
      const artifactComparison = readRecord(comparison.artifactComparison);
      const matched = comparison.schemaVersion === "toolsmith-rerun-comparison.v1"
        ? comparison.matched === true && run.status === "completed"
        : run.status === "completed";
      const changed = readArrayLength(artifactComparison.changed);
      const missing = readArrayLength(artifactComparison.missing);
      const added = readArrayLength(artifactComparison.added);
      const leftCount = typeof artifactComparison.leftCount === "number" ? artifactComparison.leftCount : undefined;
      const rightCount = typeof artifactComparison.rightCount === "number" ? artifactComparison.rightCount : undefined;
      const scalarMatched = comparison.scalarMatched === true;
      const artifactMatched = artifactComparison.matched === true;
      const verdict = run.status !== "completed"
        ? run.status
        : matched
          ? "matched"
          : "changed";
      const summary = comparison.schemaVersion === "toolsmith-rerun-comparison.v1"
        ? `scalar ${scalarMatched ? "matched" : "changed"} · artifacts ${artifactMatched ? "matched" : "changed"}`
        : "comparison unavailable";
      const detail = [
        `${changed} changed`,
        `${missing} missing`,
        `${added} added`,
        leftCount !== undefined && rightCount !== undefined ? `${leftCount}/${rightCount} artifacts` : undefined,
        run.elapsedMs ? `${run.elapsedMs}ms` : undefined,
        shortId(run.id)
      ].filter((part): part is string => Boolean(part)).join(" · ");
      return {
        id: run.id,
        verdict,
        tone: matched ? "ok" : run.status === "completed" ? "warn" : statusTone(run.status),
        summary,
        detail,
        timestamp: run.completedAt ?? run.updatedAt ?? run.createdAt
      };
    });
}

function summarizeDependencySources(dependencies: NonNullable<AutonomyGeneratedToolSpec["manifest"]>["dependencies"]): string {
  const counts = new Map<string, number>();
  for (const dependency of dependencies) {
    counts.set(dependency.source, (counts.get(dependency.source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => `${source}:${count}`)
    .join(" · ");
}

function readArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}
