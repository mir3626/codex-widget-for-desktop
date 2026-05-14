import { Bot, Clipboard, FileCheck, Play, RefreshCw, Save, ShieldCheck, Wrench } from "lucide-react";
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

  const dagNodes = runDetail?.dagNodes ?? [];
  const toolRuns = runDetail?.toolRuns ?? [];
  const gaps = runDetail?.gaps ?? [];

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

      {latestMissingGrants.length ? (
        <div className="autonomy-blocked-grants">
          {latestMissingGrants.slice(0, 5).map((grant, index) => (
            <span key={`${grant.type}-${grant.value}-${index}`}>{grant.type}: {grant.value}</span>
          ))}
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
  const response = await fetch(`http://127.0.0.1:${daemonPort}${path}`);
  const payload = await response.json() as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed: ${path}`);
  }
  return payload as T;
}

async function postJson<T = unknown>(daemonPort: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${daemonPort}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed: ${path}`);
  }
  return payload as T;
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
    if (requirement.type === "network_domain") grants.networkDomains.push(requirement.value);
    if (requirement.type === "browser_automation") grants.browserAutomation = true;
    if (requirement.type === "browser_domain") grants.browserDomains.push(requirement.value);
    if (requirement.type === "filesystem_read") grants.filesystem.readRoots.push(requirement.value);
    if (requirement.type === "filesystem_write") grants.filesystem.writeRoots.push(requirement.value);
    if (requirement.type === "command") grants.commands.allowPrefixes.push(requirement.value);
    if (requirement.type === "package_install") grants.packageInstall = true;
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

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}
