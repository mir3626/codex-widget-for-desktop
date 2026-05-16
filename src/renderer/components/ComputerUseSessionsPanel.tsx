import { Clipboard, Download, MonitorCog, Play, Plus, RefreshCw, Save, ShieldCheck, Square, StepForward, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AutonomyPermissionProfile,
  AutonomyPermissionRequirement,
  AutonomyRiskClass,
  CapabilityDagNodeSummary,
  CapabilityJobSummary,
  ComputerSessionDebugBundle,
  ComputerSessionRollbackActionSummary,
  ComputerSessionSummary,
  ExecutionSurface,
  ExecutionSurfaceKind
} from "../../shared/protocol.js";
import { formatActivityTime } from "../utils/format";

type ComputerUseListPayload = {
  ok: boolean;
  sessions?: ComputerSessionSummary[];
  surfaces?: ExecutionSurface[];
  profiles?: AutonomyPermissionProfile[];
  error?: string;
};

type ComputerUseDebugBundlePayload = {
  ok: boolean;
  bundle?: ComputerSessionDebugBundle;
  error?: string;
};

type PromotionGatePayload = {
  ok: boolean;
  promotionGate?: PromotionGateSummary;
  evidencePath?: string;
  reportPath?: string;
  error?: string;
};

type ComputerUseDogfoodReportSummary = {
  id: string;
  title: string;
  date: string;
  kind: string;
  reportPath: string;
  evidencePath?: string;
  dogfoodPath?: string;
};

type ComputerUseDogfoodReportsPayload = {
  ok: boolean;
  reports?: ComputerUseDogfoodReportSummary[];
  error?: string;
};

type PromotionGateSummary = {
  schemaVersion: string;
  generatedAt?: string;
  summary?: {
    overallStatus?: string;
    promotableSlices?: string[];
    blockedSlices?: string[];
    passedNonPromotableSlices?: string[];
  };
  gates?: Array<{
    id: string;
    status: string;
    promotable?: boolean;
    promotionClass?: string;
    reasons?: string[];
    metrics?: Record<string, unknown>;
  }>;
};

type AutonomyProfilePayload = {
  ok: boolean;
  profile?: AutonomyPermissionProfile;
  error?: string;
};

type ComputerUseSessionsPanelProps = {
  daemonPort: string;
  refreshSignal?: number;
  onApproveCapabilityJob: (jobId: string) => void;
  onCancelCapabilityJob: (jobId: string) => void;
};

export function ComputerUseSessionsPanel({
  daemonPort,
  refreshSignal = 0,
  onApproveCapabilityJob,
  onCancelCapabilityJob
}: ComputerUseSessionsPanelProps) {
  const [sessions, setSessions] = useState<ComputerSessionSummary[]>([]);
  const [surfaces, setSurfaces] = useState<ExecutionSurface[]>([]);
  const [profiles, setProfiles] = useState<AutonomyPermissionProfile[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [managedProfileId, setManagedProfileId] = useState<string>("");
  const [profileDraft, setProfileDraft] = useState<string>("");
  const [profileDraftMode, setProfileDraftMode] = useState<"create" | "edit">("create");
  const [bundle, setBundle] = useState<ComputerSessionDebugBundle | null>(null);
  const [promotionGate, setPromotionGate] = useState<PromotionGateSummary | null>(null);
  const [dogfoodReports, setDogfoodReports] = useState<ComputerUseDogfoodReportSummary[]>([]);
  const [requestDraft, setRequestDraft] = useState("OpenAI Codex 문서를 조사해줘");
  const [promptDraft, setPromptDraft] = useState("현재 페이지를 읽어줘");
  const [sourceUrl, setSourceUrl] = useState("https://example.com/");
  const [surfaceKind, setSurfaceKind] = useState<ExecutionSurfaceKind>("isolated_browser");
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [lastLiveRefreshAt, setLastLiveRefreshAt] = useState("");
  const liveRefreshTimerRef = useRef<number | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId]
  );
  const activeProfiles = useMemo(
    () => profiles.filter((profile) => profile.status === "active"),
    [profiles]
  );
  const selectedProfile = useMemo(
    () => activeProfiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [activeProfiles, selectedProfileId]
  );
  const managedProfile = useMemo(
    () => profiles.find((profile) => profile.id === managedProfileId) ?? null,
    [managedProfileId, profiles]
  );
  const selectedProfileGrantDetails = useMemo(
    () => selectedProfile ? collectProfileGrantDetails(selectedProfile) : [],
    [selectedProfile]
  );
  const managedProfileDraftValidation = useMemo(
    () => validateManagedProfileDraft(profileDraft),
    [profileDraft]
  );
  const selectedSurfaceKind = selectedSession?.selectedSurface?.kind ?? surfaceKind;
  const awaitingJobs = useMemo(
    () => (bundle?.capabilityJobs ?? []).filter((job) => job.status === "awaiting_approval"),
    [bundle?.capabilityJobs]
  );
  const oneTimeProfileRequirements = useMemo(
    () => deriveOneTimeProfileRequirements({
      session: selectedSession,
      bundle,
      awaitingJobs,
      selectedSurfaceKind
    }),
    [awaitingJobs, bundle, selectedSession, selectedSurfaceKind]
  );
  const oneTimeProfileDraft = useMemo(
    () => summarizeOneTimeProfileDraft(oneTimeProfileRequirements),
    [oneTimeProfileRequirements]
  );
  const browserChromePublicProof = useMemo(
    () => summarizeBrowserChromePublicExtensionProof(promotionGate),
    [promotionGate]
  );
  const toolsmithBreadthProof = useMemo(
    () => summarizeToolsmithSelfImplementationProof(promotionGate),
    [promotionGate]
  );
  const toolsmithLiveBreadthProof = useMemo(
    () => summarizeToolsmithGeneratedToolLiveBreadthProof(promotionGate),
    [promotionGate]
  );
  const nativeBoundaryProof = useMemo(
    () => summarizeNativeBoundaryProof(promotionGate),
    [promotionGate]
  );

  useEffect(() => {
    void refresh();
  }, [daemonPort]);

  useEffect(() => {
    if (!refreshSignal) {
      return undefined;
    }
    if (liveRefreshTimerRef.current !== null) {
      window.clearTimeout(liveRefreshTimerRef.current);
    }
    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      void refresh({ quiet: true });
    }, 250);
    return () => {
      if (liveRefreshTimerRef.current !== null) {
        window.clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
    };
  }, [daemonPort, refreshSignal]);

  useEffect(() => {
    if (!selectedSessionId && sessions[0]) {
      setSelectedSessionId(sessions[0].sessionId);
    }
    if (selectedSessionId && !sessions.some((session) => session.sessionId === selectedSessionId)) {
      setSelectedSessionId(sessions[0]?.sessionId ?? "");
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (selectedProfileId && activeProfiles.length && !activeProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId("");
    }
  }, [activeProfiles, selectedProfileId]);

  useEffect(() => {
    if (profileDraftMode === "create") {
      return;
    }
    if (managedProfileId && profiles.length && !profiles.some((profile) => profile.id === managedProfileId)) {
      setManagedProfileId("");
      setProfileDraftMode("create");
    }
  }, [managedProfileId, profileDraftMode, profiles]);

  useEffect(() => {
    if (managedProfile) {
      setProfileDraft(JSON.stringify(profileToEditablePayload(managedProfile), null, 2));
      setProfileDraftMode("edit");
      return;
    }
    if (!profileDraft.trim()) {
      setProfileDraft(JSON.stringify(createSafeManagedProfileDraft(), null, 2));
      setProfileDraftMode("create");
    }
  }, [managedProfile?.id, managedProfile?.updatedAt]);

  useEffect(() => {
    if (!selectedSession) {
      setBundle(null);
      return undefined;
    }
    let cancelled = false;
    fetchJson<ComputerUseDebugBundlePayload>(daemonPort, `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/debug-bundle`)
      .then((payload) => {
        if (!cancelled) {
          setBundle(payload.bundle ?? null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [daemonPort, lastLiveRefreshAt, selectedSession?.sessionId, selectedSession?.updatedAt]);

  async function refresh(options: { quiet?: boolean } = {}) {
    const quiet = options.quiet === true;
    if (!quiet) {
      setStatus("loading");
      setMessage("");
    }
    try {
      const [surfacesPayload, sessionsPayload, profilesPayload, promotionPayload, dogfoodReportsPayload] = await Promise.all([
        fetchJson<ComputerUseListPayload>(daemonPort, "/computer-use/surfaces"),
        fetchJson<ComputerUseListPayload>(daemonPort, "/computer-use/sessions"),
        fetchJson<ComputerUseListPayload>(daemonPort, "/computer-use/autonomy/profiles?limit=50"),
        fetchJson<PromotionGatePayload>(daemonPort, "/computer-use/eval/promotion-gate").catch(() => null),
        fetchJson<ComputerUseDogfoodReportsPayload>(daemonPort, "/computer-use/eval/dogfood-reports?limit=8").catch(() => null)
      ]);
      setSurfaces(surfacesPayload.surfaces ?? []);
      setSessions(sessionsPayload.sessions ?? []);
      setProfiles(profilesPayload.profiles ?? []);
      setPromotionGate(promotionPayload?.promotionGate ?? null);
      setDogfoodReports(dogfoodReportsPayload?.reports ?? []);
      if (quiet) {
        setLastLiveRefreshAt(new Date().toISOString());
      } else {
        setStatus("idle");
      }
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      if (quiet) {
        setMessage(`Live Computer Use refresh failed: ${nextMessage}`);
      } else {
        setStatus("failed");
        setMessage(nextMessage);
      }
    }
  }

  async function createSession() {
    if (!requestDraft.trim()) {
      return;
    }
    setStatus("loading");
    const payload = await postJson<{ ok: boolean; result?: { session?: ComputerSessionSummary }; error?: string }>(daemonPort, "/computer-use/sessions", {
      userRequest: requestDraft.trim(),
      profileId: selectedProfile?.status === "active" ? selectedProfile.id : undefined,
      requestedSurface: surfaceKind,
      metadata: {
        createsLocalArtifact: /pdf|문서|저장|artifact|file/i.test(requestDraft),
        requiresForeground: surfaceKind === "foreground_desktop_watch",
        requiresTerminal: surfaceKind === "pty_workspace",
        requiresGeneratedTool: surfaceKind === "tool_workspace"
      }
    });
    if (payload.result?.session?.sessionId) {
      setSelectedSessionId(payload.result.session.sessionId);
    }
    setStatus("idle");
    await refresh();
  }

  async function runBrowserPrompt() {
    if (!selectedSession || !promptDraft.trim()) {
      return;
    }
    setStatus("loading");
    const source = sourceUrl.trim()
      ? {
          kind: selectedSurfaceKind === "isolated_browser" ? "controlled_browser" : "active_tab",
          browser: "chromium",
          url: sourceUrl.trim()
        }
      : undefined;
    await postJson(daemonPort, `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/browser-action-prompt`, {
      text: promptDraft.trim(),
      mode: "browser",
      source
    });
    setStatus("idle");
    await refresh();
  }

  async function continuePromptRun() {
    if (!selectedSession || !bundle?.promptRuns.length) {
      return;
    }
    setStatus("loading");
    const promptRun = bundle.promptRuns.find((run) => run.status === "running" || run.status === "awaiting_approval" || run.status === "pending") ?? bundle.promptRuns[0];
    await postJson(daemonPort, `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/browser-action-prompt/continue`, {
      promptRunId: promptRun.id
    });
    setStatus("idle");
    await refresh();
  }

  async function cancelSession() {
    if (!selectedSession) {
      return;
    }
    await postJson(daemonPort, `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/cancel`, {
      reason: "renderer_computer_use_panel_cancel"
    });
    await refresh();
  }

  async function copyDebugBundle() {
    const payload = bundle ?? (selectedSession
      ? (await fetchJson<ComputerUseDebugBundlePayload>(daemonPort, `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/debug-bundle`)).bundle
      : null);
    await navigator.clipboard?.writeText(JSON.stringify(payload ?? {}, null, 2)).catch(() => undefined);
    setMessage("Computer Use debug bundle copied");
  }

  async function saveDebugBundle() {
    const payload = bundle ?? (selectedSession
      ? (await fetchJson<ComputerUseDebugBundlePayload>(daemonPort, `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/debug-bundle`)).bundle
      : null);
    if (!payload) {
      setMessage("Computer Use debug bundle is unavailable.");
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `computer-use-debug-${shortId(payload.session.sessionId)}.json`;
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setMessage("Computer Use debug bundle saved");
  }

  async function copyArtifactResource(resourceId: string) {
    const url = artifactContentUrl(resourceId);
    if (!url) {
      setMessage("Artifact content is unavailable.");
      return;
    }
    const response = await fetch(url);
    if (!response.ok) {
      setMessage(`Artifact copy failed: ${response.status}`);
      return;
    }
    const text = await response.text();
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    setMessage("Artifact text copied");
  }

  function openArtifactResource(resourceId: string) {
    const url = artifactContentUrl(resourceId);
    if (!url) {
      setMessage("Artifact content is unavailable.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function saveArtifactResource(resourceId: string) {
    const url = artifactContentUrl(resourceId, true);
    if (!url) {
      setMessage("Artifact content is unavailable.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function openDogfoodReport(path?: string) {
    if (!path) {
      setMessage("Dogfood report artifact is unavailable.");
      return;
    }
    window.open(dogfoodReportContentUrl(path), "_blank", "noopener,noreferrer");
  }

  async function runRollbackAction(rollbackActionId: string, includeUserArtifacts = false) {
    if (!selectedSession) {
      return;
    }
    setStatus("loading");
    try {
      const payload = await postJson<{ ok: boolean; error?: string }>(
        daemonPort,
        `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/rollback-actions/${encodeURIComponent(rollbackActionId)}`,
        {
          includeUserArtifacts,
          confirmUserArtifacts: includeUserArtifacts
        }
      );
      if (!payload.ok) {
        throw new Error(payload.error ?? "Rollback action failed.");
      }
      await refresh();
      setMessage(includeUserArtifacts ? "Rollback completed with artifact deletion." : "Safe rollback completed.");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function artifactContentUrl(resourceId: string, download = false): string {
    const runId = bundle?.evalRun?.id ?? selectedSession?.evalRunId;
    if (!runId) {
      return "";
    }
    const query = download ? new URLSearchParams({ download: "1" }).toString() : "";
    const suffix = query ? `?${query}` : "";
    return `http://127.0.0.1:${daemonPort}/computer-use/eval/runs/${encodeURIComponent(runId)}/resources/${encodeURIComponent(resourceId)}/content${suffix}`;
  }

  function dogfoodReportContentUrl(path: string): string {
    const query = new URLSearchParams({ path }).toString();
    return `http://127.0.0.1:${daemonPort}/computer-use/eval/dogfood-reports/content?${query}`;
  }

  async function createOneTimeProfileForBlockedRun() {
    if (!selectedSession || !oneTimeProfileRequirements.length) {
      setMessage("No profile grant can satisfy this blocker.");
      return;
    }
    setStatus("loading");
    try {
      const profilePayload = await postJson<AutonomyProfilePayload>(daemonPort, "/computer-use/autonomy/profiles", {
        name: `One-time Computer Use ${shortId(selectedSession.sessionId)}`,
        mode: "scoped_yolo",
        scope: "one_time",
        status: "active",
        maxUses: 1,
        grants: grantsFromPermissionRequirements(oneTimeProfileRequirements),
        safetyBoundaries: [
          "approval_required_for_high_risk_actions",
          "restricted_pages_are_not_bypassed",
          "credentials_are_not_automated",
          "foreground_desktop_requires_watch_mode",
          "generated_code_must_remain_in_runtime_workspace"
        ]
      });
      if (!profilePayload.profile?.id) {
        throw new Error(profilePayload.error ?? "One-time profile was not created.");
      }
      await postJson(daemonPort, `/computer-use/sessions/${encodeURIComponent(selectedSession.sessionId)}/profile`, {
        profileId: profilePayload.profile.id,
        source: "renderer_computer_use_blocked_run",
        reason: selectedSession.blockedReason ?? selectedSession.requiresUserAction ?? "blocked_run_one_time_profile"
      });
      setSelectedProfileId(profilePayload.profile.id);
      await refresh();
      setMessage(`One-time profile attached: ${profilePayload.profile.name}`);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function updateSelectedProfileStatus(statusValue: "disabled" | "expired") {
    if (!selectedProfile) {
      return;
    }
    setStatus("loading");
    try {
      const payload = await postJson<AutonomyProfilePayload>(
        daemonPort,
        `/computer-use/autonomy/profiles/${encodeURIComponent(selectedProfile.id)}`,
        { status: statusValue }
      );
      if (!payload.ok) {
        throw new Error(payload.error ?? "Permission profile update failed.");
      }
      setSelectedProfileId("");
      await refresh();
      setMessage(`Profile ${statusValue}: ${selectedProfile.name}`);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function startManagedProfileCreate() {
    setManagedProfileId("");
    setProfileDraftMode("create");
    setProfileDraft(JSON.stringify(createSafeManagedProfileDraft(), null, 2));
    setMessage("New one-time profile draft ready.");
  }

  async function saveManagedProfileDraft() {
    const validation = validateManagedProfileDraft(profileDraft);
    if (!validation.ok || !validation.payload) {
      setStatus("failed");
      setMessage(`Profile draft blocked: ${validation.errors.join(" ")}`);
      return;
    }
    setStatus("loading");
    try {
      const payload = profileDraftMode === "edit" && managedProfile
        ? await postJson<AutonomyProfilePayload>(
          daemonPort,
          `/computer-use/autonomy/profiles/${encodeURIComponent(managedProfile.id)}`,
          validation.payload
        )
        : await postJson<AutonomyProfilePayload>(daemonPort, "/computer-use/autonomy/profiles", validation.payload);
      if (!payload.ok || !payload.profile) {
        throw new Error(payload.error ?? "Permission profile save failed.");
      }
      setManagedProfileId(payload.profile.id);
      if (payload.profile.status === "active" && !selectedProfileId) {
        setSelectedProfileId(payload.profile.id);
      }
      await refresh();
      setMessage(`${profileDraftMode === "edit" ? "Profile saved" : "Profile created"}: ${payload.profile.name}`);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function updateManagedProfileStatus(statusValue: "disabled" | "expired") {
    if (!managedProfile) {
      return;
    }
    setStatus("loading");
    try {
      const payload = await postJson<AutonomyProfilePayload>(
        daemonPort,
        `/computer-use/autonomy/profiles/${encodeURIComponent(managedProfile.id)}`,
        { status: statusValue }
      );
      if (!payload.ok) {
        throw new Error(payload.error ?? "Permission profile update failed.");
      }
      if (selectedProfileId === managedProfile.id) {
        setSelectedProfileId("");
      }
      await refresh();
      setMessage(`Managed profile ${statusValue}: ${managedProfile.name}`);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const dagNodes = bundle?.dagNodes ?? [];
  const promptRuns = bundle?.promptRuns ?? [];
  const capabilityJobs = bundle?.capabilityJobs ?? [];
  const observations = bundle?.observations ?? [];
  const perceptionGraphs = bundle?.perceptionGraphs ?? [];
  const evalResources = bundle?.evalResources ?? [];
  const artifactResources = evalResources.filter(isArtifactResource);
  const sourceRows = collectToolsmithSourceRows(observations);
  const artifactProof = summarizeArtifactProof(artifactResources);
  const sourceQuality = summarizeToolsmithSourceQuality(sourceRows);
  const observationPreviews = collectObservationPreviewPairs(observations);
  const browserChromeEvidenceRows = collectBrowserChromeEvidenceRows(capabilityJobs, observations);
  const actionFeedbacks = bundle?.actionFeedbacks ?? [];
  const failureMemory = bundle?.failureMemory ?? [];
  const rollbackActions = bundle?.rollbackActions ?? [];
  const terminalDeltaRows = collectTerminalDeltaEvidenceRows(observations, rollbackActions);
  const terminalDeltaProof = summarizeTerminalDeltaProof(terminalDeltaRows);
  const verifierAudit = bundle?.verifierAudit ?? null;
  const verifierAuditRows = verifierAudit?.audits ?? [];
  const verifierIssueCount = verifierAudit
    ? verifierAudit.falsePositiveCandidates + verifierAudit.falseNegativeRecords + verifierAudit.inconclusiveRecords + verifierAudit.missingVerifierEvidence
    : 0;

  return (
    <section className="computer-use-panel" aria-label="Computer Use Sessions">
      <div className="capability-jobs-head">
        <div>
          <MonitorCog size={12} />
          <strong>Computer Use</strong>
          <span>{sessions.length ? `${sessions.length} sessions` : "ready"}</span>
        </div>
        <div className="capability-jobs-actions">
          <button type="button" aria-label="Run Browser Action prompt" data-tooltip="Run prompt" disabled={!selectedSession || status === "loading"} onClick={() => void runBrowserPrompt()}>
            <Play size={12} />
          </button>
          <button type="button" aria-label="Continue Computer Use prompt run" data-tooltip="Continue prompt" disabled={!selectedSession || !promptRuns.length} onClick={() => void continuePromptRun()}>
            <StepForward size={12} />
          </button>
          <button type="button" aria-label="Copy Computer Use debug bundle" data-tooltip="Copy debug bundle" disabled={!selectedSession} onClick={() => void copyDebugBundle()}>
            <Clipboard size={12} />
          </button>
          <button type="button" aria-label="Save Computer Use debug bundle" data-tooltip="Save debug bundle" disabled={!selectedSession} onClick={() => void saveDebugBundle()}>
            <Download size={12} />
          </button>
          <button type="button" aria-label="Refresh Computer Use sessions" data-tooltip="Refresh Computer Use" onClick={() => void refresh()}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="computer-use-create-row computer-use-create-row-profile">
        <select value={surfaceKind} onChange={(event) => setSurfaceKind(event.target.value as ExecutionSurfaceKind)} aria-label="Computer Use surface">
          {(surfaces.length ? surfaces : fallbackSurfaces()).map((surface) => (
            <option key={surface.kind} value={surface.kind}>{surface.kind}</option>
          ))}
        </select>
        <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} aria-label="Computer Use permission profile">
          <option value="">No profile</option>
          {activeProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.scope === "one_time" ? "1x" : "persist"} · {profile.name}</option>
          ))}
        </select>
        <input value={requestDraft} onChange={(event) => setRequestDraft(event.target.value)} aria-label="Computer Use request" />
        <button type="button" onClick={() => void createSession()} disabled={status === "loading" || !requestDraft.trim()}>
          <Play size={11} />
          Start
        </button>
      </div>

      <div className="computer-use-create-row">
        <select value={selectedSession?.sessionId ?? ""} onChange={(event) => setSelectedSessionId(event.target.value)} aria-label="Computer Use session">
          {sessions.length ? sessions.map((session) => (
            <option key={session.sessionId} value={session.sessionId}>{session.state} · {shortId(session.sessionId)}</option>
          )) : <option value="">No session</option>}
        </select>
        <input value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} aria-label="Computer Use Browser Action prompt" />
        <button type="button" onClick={() => void cancelSession()} disabled={!selectedSession || !canCancelSession(selectedSession.state)}>
          <Square size={11} />
          Stop
        </button>
      </div>

      <input className="computer-use-source-input" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} aria-label="Computer Use browser source URL" />

      {selectedProfile ? (
        <div className="computer-use-profile-detail" aria-label="Selected permission profile details">
          <div className="computer-use-profile-detail-head">
            <div>
              <strong>{selectedProfile.name}</strong>
              <small>{selectedProfile.scope} · {selectedProfile.mode} · {selectedProfile.status}</small>
            </div>
            <div className="computer-use-profile-detail-actions">
              <button type="button" aria-label="Disable selected permission profile" disabled={status === "loading"} onClick={() => void updateSelectedProfileStatus("disabled")}>Disable</button>
              <button type="button" aria-label="Expire selected permission profile" disabled={status === "loading"} onClick={() => void updateSelectedProfileStatus("expired")}>Expire</button>
            </div>
          </div>
          <dl className="computer-use-profile-detail-grid">
            <Metric label="Risk" value={selectedProfile.grants.riskClasses.join(", ") || "read_only"} />
            <Metric label="Browser" value={selectedProfile.grants.browserAutomation ? formatCountOrList(selectedProfile.grants.browserDomains.length ? selectedProfile.grants.browserDomains : ["enabled"]) : "off"} />
            <Metric label="Commands" value={`${selectedProfile.grants.commands.allowPrefixes.length}`} />
            <Metric label="Writes" value={`${selectedProfile.grants.filesystem.writeRoots.length}`} />
            <Metric label="Generated" value={selectedProfile.grants.generatedCode || selectedProfile.grants.generatedToolExecution ? "on" : "off"} />
            <Metric label="Credentials" value={selectedProfile.grants.credentialAccess} />
            <Metric label="Use" value={formatProfileUse(selectedProfile)} />
            <Metric label="Expires" value={selectedProfile.expiresAt ? formatActivityTime(selectedProfile.expiresAt) : "manual"} />
          </dl>
          {selectedProfileGrantDetails.length ? (
            <div className="computer-use-profile-grant-list" aria-label="Selected permission profile grant details">
              {selectedProfileGrantDetails.map((detail, index) => (
                <span key={`${detail.label}-${detail.value}-${index}`}>
                  <strong>{detail.label}</strong>
                  <code>{detail.value}</code>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="computer-use-profile-manager" aria-label="Permission profile manager">
        <div className="computer-use-profile-detail-head">
          <div>
            <strong>Permission profiles</strong>
            <small>{profiles.length} total · {activeProfiles.length} active · editor {profileDraftMode}</small>
          </div>
          <div className="computer-use-profile-detail-actions">
            <button type="button" aria-label="New managed permission profile" disabled={status === "loading"} onClick={startManagedProfileCreate}>
              <Plus size={10} />
              New
            </button>
            <button type="button" aria-label="Save managed permission profile" disabled={status === "loading"} onClick={() => void saveManagedProfileDraft()}>
              <Save size={10} />
              Save
            </button>
          </div>
        </div>
        <div className="computer-use-profile-manager-row">
          <select
            value={managedProfileId}
            onChange={(event) => {
              setManagedProfileId(event.target.value);
              setProfileDraftMode(event.target.value ? "edit" : "create");
              if (!event.target.value) {
                setProfileDraft(JSON.stringify(createSafeManagedProfileDraft(), null, 2));
              }
            }}
            aria-label="Managed permission profile"
          >
            <option value="">New one-time draft</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.status} · {profile.scope === "one_time" ? "1x" : "persist"} · {profile.name}</option>
            ))}
          </select>
          <button type="button" disabled={!managedProfile || status === "loading"} onClick={() => void updateManagedProfileStatus("disabled")}>Disable</button>
          <button type="button" disabled={!managedProfile || status === "loading"} onClick={() => void updateManagedProfileStatus("expired")}>Expire</button>
        </div>
        <textarea
          className="computer-use-profile-editor"
          value={profileDraft}
          spellCheck={false}
          onChange={(event) => setProfileDraft(event.target.value)}
          aria-label="Computer Use permission profile JSON editor"
        />
        <div className={`computer-use-profile-validation ${managedProfileDraftValidation.ok ? "ok" : "blocked"}`} aria-label="Computer Use permission profile validation">
          <strong>{managedProfileDraftValidation.ok ? "Draft allowed" : "Draft blocked"}</strong>
          <small>{managedProfileDraftValidation.summary}</small>
        </div>
      </div>

      {promotionGate ? (
        <div className="computer-use-section">
          <div className="computer-use-section-title">
            <Workflow size={11} />
            <strong>Promotion gate</strong>
          </div>
          <dl className="computer-use-audit-metrics">
            <Metric label="Status" value={promotionGate.summary?.overallStatus ?? "unknown"} />
            <Metric label="Promote" value={`${promotionGate.summary?.promotableSlices?.length ?? 0}`} />
            <Metric label="Blocked" value={`${promotionGate.summary?.blockedSlices?.length ?? 0}`} />
            <Metric label="Guarded" value={`${promotionGate.summary?.passedNonPromotableSlices?.length ?? 0}`} />
          </dl>
          {(promotionGate.gates ?? []).map((gate) => (
            <div key={gate.id} className="computer-use-dag-row">
              <span className={`capability-status ${promotionGateTone(gate)}`}>{promotionGateLabel(gate)}</span>
              <strong>{gate.id}</strong>
              <small>{summarizePromotionGate(gate)}</small>
            </div>
          ))}
          {browserChromePublicProof ? (
            <div className="computer-use-proof-panel" aria-label="Browser Chrome public extension proof">
              <div className="computer-use-section-title">
                <ShieldCheck size={11} />
                <strong>Public extension proof</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Samples" value={browserChromePublicProof.sampleCount} />
                <Metric label="p95" value={browserChromePublicProof.p95Latency} />
                <Metric label="Hosts" value={browserChromePublicProof.hosts} />
                <Metric label="Profile" value={browserChromePublicProof.profileApproval} />
              </dl>
              <div className="computer-use-dag-row">
                <span className={`capability-status ${browserChromePublicProof.promotable ? "ok" : "warn"}`}>{browserChromePublicProof.promotable ? "eligible" : "guarded"}</span>
                <strong>{browserChromePublicProof.coverage}</strong>
                <small>{browserChromePublicProof.permissionTypes} · {browserChromePublicProof.redaction}</small>
              </div>
            </div>
          ) : null}
          {toolsmithBreadthProof ? (
            <div className="computer-use-proof-panel" aria-label="Toolsmith self-implementation breadth proof">
              <div className="computer-use-section-title">
                <ShieldCheck size={11} />
                <strong>Toolsmith breadth proof</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Scenarios" value={toolsmithBreadthProof.scenarios} />
                <Metric label="Classes" value={toolsmithBreadthProof.classes} />
                <Metric label="Samples" value={toolsmithBreadthProof.samples} />
                <Metric label="p95" value={toolsmithBreadthProof.p95Latency} />
                <Metric label="Reruns" value={toolsmithBreadthProof.reruns} />
                <Metric label="Paths" value={toolsmithBreadthProof.paths} />
              </dl>
              <div className="computer-use-dag-row">
                <span className={`capability-status ${toolsmithBreadthProof.promotable ? "ok" : "warn"}`}>{toolsmithBreadthProof.status}</span>
                <strong>{toolsmithBreadthProof.coverage}</strong>
                <small>{toolsmithBreadthProof.nativeBoundary} · {toolsmithBreadthProof.promotionGuard}</small>
              </div>
            </div>
          ) : null}
          {toolsmithLiveBreadthProof ? (
            <div className="computer-use-proof-panel" aria-label="Toolsmith generated-tool live breadth proof">
              <div className="computer-use-section-title">
                <ShieldCheck size={11} />
                <strong>Toolsmith live breadth proof</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Samples" value={toolsmithLiveBreadthProof.samples} />
                <Metric label="p95" value={toolsmithLiveBreadthProof.p95Latency} />
                <Metric label="Classes" value={toolsmithLiveBreadthProof.classes} />
                <Metric label="Runs" value={toolsmithLiveBreadthProof.runs} />
              </dl>
              <div className="computer-use-dag-row">
                <span className={`capability-status ${toolsmithLiveBreadthProof.promotable ? "ok" : "warn"}`}>{toolsmithLiveBreadthProof.status}</span>
                <strong>{toolsmithLiveBreadthProof.coverage}</strong>
                <small>{toolsmithLiveBreadthProof.sourceProof} · {toolsmithLiveBreadthProof.redaction}</small>
              </div>
            </div>
          ) : null}
          {nativeBoundaryProof ? (
            <div className="computer-use-proof-panel" aria-label="Computer Use native boundary proof">
              <div className="computer-use-section-title">
                <ShieldCheck size={11} />
                <strong>Native boundary proof</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Input" value={nativeBoundaryProof.foregroundInput} />
                <Metric label="Picker" value={nativeBoundaryProof.filePicker} />
                <Metric label="Popup" value={nativeBoundaryProof.permissionBubble} />
                <Metric label="Signing" value={nativeBoundaryProof.signing} />
                <Metric label="Preflight" value={nativeBoundaryProof.preflight} />
                <Metric label="Drift" value={nativeBoundaryProof.driftAbort} />
                <Metric label="Executor" value={nativeBoundaryProof.executor} />
                <Metric label="Helper v2" value={nativeBoundaryProof.helperV2} />
              </dl>
              <div className="computer-use-dag-row">
                <span className={`capability-status ${nativeBoundaryProof.promotable ? "ok" : "warn"}`}>{nativeBoundaryProof.status}</span>
                <strong>{nativeBoundaryProof.coverage}</strong>
                <small>{nativeBoundaryProof.redaction} · {nativeBoundaryProof.releaseGuard}</small>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {dogfoodReports.length ? (
        <div className="computer-use-section" aria-label="Computer Use dogfood report links">
          <div className="computer-use-section-title">
            <Workflow size={11} />
            <strong>Dogfood reports</strong>
          </div>
          <dl className="computer-use-inline-metrics">
            <Metric label="Reports" value={`${dogfoodReports.length}`} />
            <Metric label="Evidence" value={`${dogfoodReports.filter((report) => report.evidencePath).length}`} />
            <Metric label="Dogfood" value={`${dogfoodReports.filter((report) => report.dogfoodPath).length}`} />
            <Metric label="Latest" value={dogfoodReports[0]?.date ?? "none"} />
          </dl>
          {dogfoodReports.slice(0, 6).map((report) => (
            <div key={report.id} className="computer-use-artifact-row">
              <span className="capability-status ok">{report.kind}</span>
              <div className="computer-use-approval-copy">
                <strong>{report.title}</strong>
                <small>{report.date} · {report.reportPath}</small>
              </div>
              <div className="computer-use-artifact-actions">
                <button type="button" onClick={() => openDogfoodReport(report.reportPath)}>Report</button>
                <button type="button" disabled={!report.evidencePath} onClick={() => openDogfoodReport(report.evidencePath)}>Evidence</button>
                <button type="button" disabled={!report.dogfoodPath} onClick={() => openDogfoodReport(report.dogfoodPath)}>Dogfood</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {selectedSession ? (
        <>
          <dl className="computer-use-metrics">
            <Metric label="State" value={selectedSession.state} />
            <Metric label="Surface" value={selectedSurfaceKind} />
            <Metric label="Profile" value={selectedSession.profileId ? shortId(selectedSession.profileId) : "none"} />
            <Metric label="DAG" value={`${dagNodes.length} nodes`} />
            <Metric label="Jobs" value={`${capabilityJobs.length} jobs`} />
            <Metric label="Live" value={lastLiveRefreshAt ? formatActivityTime(lastLiveRefreshAt) : "manual"} />
            <Metric label="Evidence" value={`${observations.length}/${perceptionGraphs.length}/${evalResources.length}`} />
            <Metric label="Feedback" value={`${actionFeedbacks.length} rows`} />
            <Metric label="Memory" value={`${failureMemory.length} records`} />
            <Metric label="Rollback" value={`${rollbackActions.length} actions`} />
            <Metric label="Verifier" value={verifierAudit ? `${verifierIssueCount} issues` : "none"} />
          </dl>

          {selectedSession.blockedReason || selectedSession.requiresUserAction ? (
            <div className="computer-use-alert">
              <div className="computer-use-alert-copy">
                <strong>{selectedSession.blockedReason ?? selectedSession.requiresUserAction}</strong>
                <small>{oneTimeProfileRequirements.length ? `${oneTimeProfileRequirements.length} grants · ${selectedSession.riskClass}` : `external blocker · ${selectedSession.riskClass}`}</small>
                {oneTimeProfileRequirements.length ? (
                  <div className="computer-use-block-grants">
                    {oneTimeProfileRequirements.slice(0, 4).map((grant, index) => (
                      <span key={`${grant.type}-${grant.value}-${index}`} title={grant.reason}>{grant.type}: {grant.value}</span>
                    ))}
                    {oneTimeProfileRequirements.length > 4 ? <span>+{oneTimeProfileRequirements.length - 4} more</span> : null}
                  </div>
                ) : null}
                {oneTimeProfileDraft ? (
                  <div className="computer-use-profile-draft" aria-label="One-time permission profile draft">
                    <div>
                      <strong>Draft one-time profile</strong>
                      <span>{oneTimeProfileDraft.scope} · max {oneTimeProfileDraft.maxUses} use · credentials {oneTimeProfileDraft.credentialAccess}</span>
                    </div>
                    <small>{oneTimeProfileDraft.summary}</small>
                    <div className="computer-use-profile-draft-grid">
                      <span title={oneTimeProfileDraft.riskClasses.join(", ")}>risk {oneTimeProfileDraft.riskClasses.join(", ")}</span>
                      <span title={oneTimeProfileDraft.browserGrants.join(", ")}>browser {formatCountOrList(oneTimeProfileDraft.browserGrants)}</span>
                      <span title={oneTimeProfileDraft.commandGrants.join(", ")}>commands {formatCountOrList(oneTimeProfileDraft.commandGrants)}</span>
                      <span title={oneTimeProfileDraft.fileWriteRoots.join(", ")}>writes {formatCountOrList(oneTimeProfileDraft.fileWriteRoots)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                disabled={!oneTimeProfileRequirements.length || status === "loading"}
                onClick={() => void createOneTimeProfileForBlockedRun()}
              >
                <ShieldCheck size={11} />
                One-time
              </button>
            </div>
          ) : null}

          {awaitingJobs.length ? (
            <div className="computer-use-approval-list">
              {awaitingJobs.slice(0, 3).map((job) => (
                <ApprovalRow key={job.id} job={job} onApprove={onApproveCapabilityJob} onCancel={onCancelCapabilityJob} />
              ))}
            </div>
          ) : null}

          {observationPreviews.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Before / after</strong>
              </div>
              {observationPreviews.slice(0, 4).map((preview) => (
                <div key={preview.key} className="computer-use-observation-preview">
                  <div className="computer-use-observation-preview-head">
                    <span className={`capability-status ${preview.after?.metadata?.verification === "passed" ? "ok" : "active"}`}>{preview.actionType}</span>
                    <strong>{preview.targetSummary ?? preview.source}</strong>
                    <small>{preview.capabilityJobId ? shortId(preview.capabilityJobId) : shortId(preview.key)}</small>
                  </div>
                  <div className="computer-use-observation-preview-grid">
                    <ObservationPreviewPane label="Before" observation={preview.before} />
                    <ObservationPreviewPane label="After" observation={preview.after} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {actionFeedbacks.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Feedback</strong>
              </div>
              {actionFeedbacks.slice(0, 5).map((feedback) => (
                <div key={feedback.id} className="computer-use-dag-row">
                  <span className={`capability-status ${statusTone(feedback.status)}`}>{feedback.actionType}</span>
                  <strong>{feedback.summary}</strong>
                  <small>{summarizeActionFeedback(feedback)}</small>
                </div>
              ))}
            </div>
          ) : null}

          {browserChromeEvidenceRows.length ? (
            <div className="computer-use-section" aria-label="Browser Chrome evidence">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Browser Chrome</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Rows" value={`${browserChromeEvidenceRows.length}`} />
                <Metric label="Risk" value={`${browserChromeEvidenceRows.filter((row) => row.riskClass !== "read_only").length}`} />
                <Metric label="Files" value={`${browserChromeEvidenceRows.filter((row) => row.resourceSummary !== "no resources").length}`} />
                <Metric label="Redact" value={browserChromeEvidenceRows.some((row) => row.redactionSummary.includes("redacted")) ? "on" : "unknown"} />
              </dl>
              {browserChromeEvidenceRows.slice(0, 8).map((row) => (
                <div key={row.id} className="computer-use-dag-row">
                  <span className={`capability-status ${statusTone(row.status)}`}>{row.command}</span>
                  <strong>{row.summary}</strong>
                  <small>{row.riskClass} · {row.verification} · {row.redactionSummary} · {row.resourceSummary}</small>
                </div>
              ))}
            </div>
          ) : null}

          {terminalDeltaRows.length ? (
            <div className="computer-use-section" aria-label="Terminal artifact delta evidence">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Terminal artifact deltas</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Created" value={`${terminalDeltaProof.createdCount}`} />
                <Metric label="Modified" value={`${terminalDeltaProof.modifiedCount}`} />
                <Metric label="Deleted" value={`${terminalDeltaProof.deletedCount}`} />
                <Metric label="Rollback" value={`${terminalDeltaProof.rollbackCandidateCount}`} />
              </dl>
              {terminalDeltaRows.slice(0, 5).map((row) => (
                <div key={row.id} className="computer-use-dag-row">
                  <span className="capability-status ok">{row.status}</span>
                  <strong>{row.summary}</strong>
                  <small>{row.resources} · {row.rollbackSummary} · {row.redactionSummary}</small>
                </div>
              ))}
            </div>
          ) : null}

          {artifactResources.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Artifacts</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Blob" value={`${artifactProof.blobCount}/${artifactProof.total}`} />
                <Metric label="Text" value={`${artifactProof.textCount}`} />
                <Metric label="PDF" value={`${artifactProof.pdfCount}`} />
                <Metric label="Proof" value={artifactProof.missingBlobCount ? `${artifactProof.missingBlobCount} missing` : "ready"} />
              </dl>
              {artifactResources.slice(0, 5).map((resource) => (
                <div key={resource.id} className="computer-use-artifact-row">
                  <span className={`capability-status ${statusTone(resource.retention)}`}>{resource.retention}</span>
                  <div className="computer-use-approval-copy">
                    <strong>{resource.role}</strong>
                    <small>{summarizeArtifactResource(resource)}</small>
                  </div>
                  <div className="computer-use-artifact-actions">
                    <button type="button" disabled={!resource.blobId} onClick={() => openArtifactResource(resource.id)}>Open</button>
                    <button type="button" disabled={!resource.blobId} onClick={() => saveArtifactResource(resource.id)}>Save</button>
                    <button type="button" disabled={!resource.blobId || !isTextArtifactResource(resource)} onClick={() => void copyArtifactResource(resource.id)}>Copy</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {sourceRows.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Sources</strong>
              </div>
              <dl className="computer-use-inline-metrics">
                <Metric label="Quality" value={sourceQuality.quality} />
                <Metric label="Direct" value={`${sourceQuality.directCount}`} />
                <Metric label="Fallback" value={`${sourceQuality.fallbackCount}`} />
                <Metric label="Chars" value={formatCompactNumber(sourceQuality.charCount)} />
              </dl>
              {sourceRows.slice(0, 6).map((source, index) => (
                <div key={`${source.url ?? source.title ?? "source"}-${index}`} className="computer-use-source-row">
                  <span className={`capability-status ${source.browserFallback ? "warn" : statusTone(source.status ?? "source")}`}>{source.status ?? "source"}</span>
                  <div className="computer-use-approval-copy">
                    <strong>{source.title ?? source.url ?? "Source"}</strong>
                    <small>{summarizeToolsmithSource(source)}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {promptRuns.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Prompt runs</strong>
              </div>
              {promptRuns.slice(0, 3).map((run) => (
                <div key={run.id} className="computer-use-prompt-run">
                  <div>
                    <span className={`capability-status ${statusTone(run.status)}`}>{run.status}</span>
                    <strong>{run.goal}</strong>
                    <small>{formatActivityTime(run.updatedAt)}</small>
                  </div>
                  {run.steps.slice(0, 5).map((step) => (
                    <div key={step.id} className="computer-use-step-row">
                      <span className={`capability-status ${statusTone(step.status)}`}>{step.status}</span>
                      <strong>{step.actionType}</strong>
                      <small>{step.targetSummary ?? shortId(step.id)}</small>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {dagNodes.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>DAG</strong>
              </div>
              {dagNodes.slice(0, 7).map((node) => (
                <div key={node.id} className="computer-use-dag-row">
                  <span className={`capability-status ${statusTone(node.status)}`}>{node.status}</span>
                  <strong>{node.kind}</strong>
                  <small>{summarizeDagRoute(node) ?? node.capabilityKind ?? shortId(node.id)}</small>
                </div>
              ))}
            </div>
          ) : null}

          {observations.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Evidence</strong>
              </div>
              {observations.slice(0, 5).map((observation) => (
                <div key={observation.id} className="computer-use-dag-row">
                  <span className={`capability-status ${statusTone(observation.freshness ?? "unknown")}`}>{observation.kind}</span>
                  <strong>{observation.source}</strong>
                  <small>{observation.perceptionGraphId ? `graph ${shortId(observation.perceptionGraphId)}` : observation.summary ?? formatActivityTime(observation.capturedAt)}</small>
                </div>
              ))}
            </div>
          ) : null}

          {verifierAudit ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Verifier audit</strong>
              </div>
              <dl className="computer-use-audit-metrics">
                <Metric label="False -" value={`${verifierAudit.falseNegativeRecords}`} />
                <Metric label="False +" value={`${verifierAudit.falsePositiveCandidates}`} />
                <Metric label="Inconcl." value={`${verifierAudit.inconclusiveRecords}`} />
                <Metric label="Missing" value={`${verifierAudit.missingVerifierEvidence}`} />
              </dl>
              {verifierAuditRows.slice(0, 5).map((audit) => (
                <div key={audit.id} className="computer-use-dag-row">
                  <span className={`capability-status ${verifierAuditTone(audit.auditClass)}`}>{audit.auditClass}</span>
                  <strong>{audit.verifierStatus ?? audit.stepKind}</strong>
                  <small>{summarizeVerifierAudit(audit)}</small>
                </div>
              ))}
            </div>
          ) : null}

          {failureMemory.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Memory</strong>
              </div>
              {failureMemory.slice(0, 5).map((record) => (
                <div key={record.id} className="computer-use-dag-row">
                  <span className="capability-status warn">{record.failureClass}</span>
                  <strong>{record.surface}</strong>
                  <small>{summarizeFailureMemory(record)}</small>
                </div>
              ))}
            </div>
          ) : null}

          {rollbackActions.length ? (
            <div className="computer-use-section">
              <div className="computer-use-section-title">
                <Workflow size={11} />
                <strong>Rollback</strong>
              </div>
              {rollbackActions.slice(0, 5).map((action) => (
                <div key={action.id} className="computer-use-dag-row computer-use-rollback-row">
                  <span className={`capability-status ${statusTone(action.status)}`}>{action.status}</span>
                  <strong>{action.kind}</strong>
                  <small>{action.label}</small>
                  <div className="computer-use-artifact-actions">
                    <button type="button" disabled={!canRunRollbackAction(action.status) || status === "loading"} onClick={() => void runRollbackAction(action.id, false)}>Safe</button>
                    <button type="button" disabled={action.kind !== "delete_artifact" || !canRunRollbackAction(action.status) || status === "loading"} onClick={() => void runRollbackAction(action.id, true)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p>No Computer Use session yet</p>
      )}
      {message || status === "failed" ? <p className={status === "failed" ? "capability-job-error" : undefined}>{message || "Computer Use refresh failed"}</p> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function summarizePromotionGate(gate: NonNullable<PromotionGateSummary["gates"]>[number]): string {
  const metrics = gate.metrics ?? {};
  const p95 = typeof metrics.p95LatencyMs === "number" ? `p95 ${metrics.p95LatencyMs}ms` : "";
  const fallback = metrics.browserFallbackTransportCalibrated === true ? "fallback calibrated" : metrics.fallbackOnly === true ? "fallback pending" : "";
  const reason = gate.reasons?.at(-1) ?? gate.promotionClass ?? "gate";
  const gateClass = gate.promotable
    ? "eligible"
    : gate.promotionClass === "blocked_by_design_release_guard"
      ? "release guard"
      : gate.promotionClass;
  return [gateClass, p95, fallback, reason].filter(Boolean).join(" · ");
}

function summarizeBrowserChromePublicExtensionProof(promotionGate: PromotionGateSummary | null): {
  sampleCount: string;
  p95Latency: string;
  hosts: string;
  profileApproval: string;
  coverage: string;
  permissionTypes: string;
  redaction: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "browser_chrome_public_extension_dogfood");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const publicHosts = readStringArray(metrics.publicHosts);
  const commands = readStringArray(metrics.commands);
  const permissionTypes = readStringArray(metrics.permissionTypesCovered);
  const sampleCount = typeof metrics.latestSampleCount === "number"
    ? metrics.latestSampleCount
    : typeof metrics.sampleCount === "number"
      ? metrics.sampleCount
      : 0;
  const coverageFlags = [
    ["download", metrics.downloadStartVerifyCovered === true],
    ["pdf", metrics.debuggerPrintPdfCovered === true],
    ["tabs", metrics.tabGroupCovered === true && metrics.multiTabGroupCovered === true],
    ["history", metrics.historySearchCovered === true],
    ["permissions", metrics.permissionSettingCovered === true],
    ["upload", metrics.fileUploadCovered === true]
  ];
  const covered = coverageFlags.filter(([, ok]) => ok).map(([label]) => label);
  return {
    sampleCount: sampleCount ? `${sampleCount}` : "unknown",
    p95Latency: typeof metrics.p95LatencyMs === "number" ? `${metrics.p95LatencyMs}ms` : "unknown",
    hosts: publicHosts.length ? `${publicHosts.length}` : "unknown",
    profileApproval: metrics.profileApprovalCovered === true ? "proved" : "missing",
    coverage: covered.length ? `${covered.join(" + ")} covered` : `${commands.length} commands`,
    permissionTypes: permissionTypes.length ? `permissions ${permissionTypes.join(", ")}` : "permissions unknown",
    redaction: metrics.redactionProofPresent === true ? "redaction proved" : "redaction pending",
    promotable: gate.promotable === true
  };
}

function summarizeToolsmithSelfImplementationProof(promotionGate: PromotionGateSummary | null): {
  status: string;
  scenarios: string;
  classes: string;
  samples: string;
  p95Latency: string;
  reruns: string;
  paths: string;
  coverage: string;
  nativeBoundary: string;
  promotionGuard: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "scoped_autonomy_self_implementation_breadth");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const generatedClasses = readStringArray(metrics.generatedCapabilityClasses);
  const requiredClasses = readStringArray(metrics.requiredGeneratedClasses);
  const scenarioCount = typeof metrics.scenarioCount === "number" ? metrics.scenarioCount : 0;
  const requiredScenarioCount = typeof metrics.requiredScenarioCount === "number" ? metrics.requiredScenarioCount : 0;
  const rerunMatchedCount = typeof metrics.rerunMatchedCount === "number" ? metrics.rerunMatchedCount : 0;
  const rerunArtifactMatchedCount = typeof metrics.rerunArtifactMatchedCount === "number" ? metrics.rerunArtifactMatchedCount : 0;
  const sampleCount = typeof metrics.latestSampleCount === "number" ? metrics.latestSampleCount : 0;
  const p95LatencyMs = typeof metrics.p95LatencyMs === "number" ? metrics.p95LatencyMs : undefined;
  const classesReady = metrics.requiredGeneratedClassesPresent === true && metrics.generatedToolsActive === true;
  const sourceRevision = metrics.sourceIterationPresent === true;
  const nativeBlocked = metrics.nativeBlocked === true;
  const pathRedaction = metrics.pathRedactionPresent === true && (metrics.samplePathRedactionPresent !== false);
  const repeatedReady = metrics.repeatedPromotionReady === true;
  const repeatedSamples = metrics.repeatedClassSamplesPresent === true && sampleCount >= 6;
  return {
    status: gate.promotable ? "eligible" : gate.status === "passed" ? "guarded" : gate.status,
    scenarios: scenarioCount && requiredScenarioCount ? `${scenarioCount}/${requiredScenarioCount}` : `${scenarioCount || "unknown"}`,
    classes: generatedClasses.length ? `${generatedClasses.length}` : `${requiredClasses.length || "unknown"}`,
    samples: sampleCount ? `${sampleCount}` : "pending",
    p95Latency: p95LatencyMs !== undefined ? `${p95LatencyMs}ms` : "pending",
    reruns: `${rerunMatchedCount}/${rerunArtifactMatchedCount}`,
    paths: pathRedaction ? "redacted" : "review",
    coverage: classesReady
      ? `${generatedClasses.join(" + ")} covered`
      : "generated tool breadth pending",
    nativeBoundary: nativeBlocked ? "native high-risk blocked" : "native boundary pending",
    promotionGuard: repeatedReady ? "live breadth ready" : repeatedSamples ? "fixture repeated only" : sourceRevision ? "fixture breadth only" : (gate.promotionClass ?? "guarded"),
    promotable: gate.promotable === true
  };
}

function summarizeToolsmithGeneratedToolLiveBreadthProof(promotionGate: PromotionGateSummary | null): {
  status: string;
  samples: string;
  p95Latency: string;
  classes: string;
  runs: string;
  coverage: string;
  sourceProof: string;
  redaction: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "scoped_autonomy_generated_tool_live_breadth");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const generatedClasses = readStringArray(metrics.generatedCapabilityClasses);
  const requiredClasses = readStringArray(metrics.requiredGeneratedClasses);
  const sampleCount = typeof metrics.latestSampleCount === "number" ? metrics.latestSampleCount : 0;
  const p95LatencyMs = typeof metrics.p95LatencyMs === "number" ? metrics.p95LatencyMs : undefined;
  const executeSampleCount = typeof metrics.executeSampleCount === "number" ? metrics.executeSampleCount : 0;
  const proofFlags = [
    ["web", metrics.webSourceQualityAccepted === true],
    ["local conversion", metrics.localDocumentConversionVerified === true],
    ["terminal", metrics.terminalCommandVerified === true],
    ["download", metrics.publicDownloadVerified === true]
  ];
  const covered = proofFlags.filter(([, ok]) => ok).map(([label]) => label);
  return {
    status: gate.promotable ? "eligible" : gate.status === "passed" ? "guarded" : gate.status,
    samples: sampleCount ? `${sampleCount}` : "pending",
    p95Latency: p95LatencyMs !== undefined ? `${p95LatencyMs}ms` : "pending",
    classes: generatedClasses.length ? `${generatedClasses.length}` : `${requiredClasses.length || "unknown"}`,
    runs: executeSampleCount ? `${executeSampleCount}` : "pending",
    coverage: covered.length ? `${covered.join(" + ")} live covered` : "live breadth pending",
    sourceProof: metrics.webFallbackCalibration && typeof metrics.webFallbackCalibration === "object" && (metrics.webFallbackCalibration as Record<string, unknown>).accepted === true
      ? "web fallback calibrated"
      : "web calibration pending",
    redaction: metrics.pathRedactionPresent === true ? "redaction proved" : "redaction pending",
    promotable: gate.promotable === true
  };
}

function summarizeNativeBoundaryProof(promotionGate: PromotionGateSummary | null): {
  status: string;
  foregroundInput: string;
  filePicker: string;
  permissionBubble: string;
  signing: string;
  preflight: string;
  driftAbort: string;
  executor: string;
  helperV2: string;
  coverage: string;
  redaction: string;
  releaseGuard: string;
  promotable: boolean;
} | null {
  const gate = promotionGate?.gates?.find((candidate) => candidate.id === "windows_native_watch_boundary");
  if (!gate) {
    return null;
  }
  const metrics = gate.metrics ?? {};
  const reasons = gate.reasons ?? [];
  const foregroundInputBlocked = metrics.implementationBoundaryPresent === true || reasons.includes("foreground_input_blocked_before_native_helper");
  const filePickerBlocked = metrics.nativeFilePickerBoundaryPresent === true || reasons.includes("native_file_picker_blocked_before_path_disclosure");
  const permissionBubbleBlocked = metrics.browserPermissionBubbleBoundaryPresent === true || reasons.includes("browser_permission_bubble_blocked_before_native_click");
  const signingDeferred = metrics.releaseSigningDeferred === true || reasons.includes("native_helper_release_signing_gate_present");
  const preflightContract = metrics.foregroundPreflightContractPresent === true || reasons.includes("foreground_watch_preflight_contract_present");
  const driftAbort = metrics.activeWindowDriftSmokePresent === true || reasons.includes("foreground_watch_active_window_drift_abort_smoke_present");
  const executorDisabled = metrics.foregroundWatchExecutorDisabledPresent === true || reasons.includes("foreground_watch_executor_disabled_contract_present");
  const disabledHelperV2Contracts = metrics.disabledHelperV2CommandContractsPresent === true || reasons.includes("helper_v2_disabled_command_contracts_present");
  const disabledHelperV2CommandCount = typeof metrics.disabledHelperV2CommandCount === "number" ? metrics.disabledHelperV2CommandCount : undefined;
  const actualInputSent = metrics.actualInputSent === true;
  const executorActualInputSent = metrics.foregroundWatchExecutorActualInputSent === true;
  const localPathDisclosed = metrics.localFilePathDisclosed === true;
  const nativePopupClick = metrics.nativePopupClick === true;
  const coverage = [
    foregroundInputBlocked ? "foreground input" : "",
    filePickerBlocked ? "file picker" : "",
    permissionBubbleBlocked ? "permission popup" : ""
  ].filter(Boolean).join(" + ");
  return {
    status: gate.status === "passed" ? "guarded" : gate.status,
    foregroundInput: foregroundInputBlocked && !actualInputSent ? "blocked" : "unknown",
    filePicker: filePickerBlocked && !localPathDisclosed ? "blocked" : "unknown",
    permissionBubble: permissionBubbleBlocked && !nativePopupClick ? "blocked" : "unknown",
    signing: signingDeferred ? "deferred" : "unknown",
    preflight: preflightContract ? "typed" : "unknown",
    driftAbort: driftAbort && !actualInputSent ? "proved" : "unknown",
    executor: executorDisabled && !executorActualInputSent ? "disabled" : "unknown",
    helperV2: disabledHelperV2Contracts ? `disabled${disabledHelperV2CommandCount ? ` (${disabledHelperV2CommandCount})` : ""}` : "unknown",
    coverage: coverage ? `${coverage} before input` : "native boundary evidence",
    redaction: localPathDisclosed || nativePopupClick ? "review evidence" : "paths and popup clicks hidden",
    releaseGuard: gate.promotionClass === "blocked_by_design_release_guard" ? "release guard active" : (gate.promotionClass ?? "guarded"),
    promotable: gate.promotable === true
  };
}

function promotionGateLabel(gate: NonNullable<PromotionGateSummary["gates"]>[number]): string {
  if (gate.promotable) return "eligible";
  if (gate.status === "passed") return "guarded";
  return gate.status;
}

function promotionGateTone(gate: NonNullable<PromotionGateSummary["gates"]>[number]): string {
  if (gate.promotable) return "ok";
  if (gate.status === "passed") return "warn";
  return statusTone(gate.status);
}

function ObservationPreviewPane({
  label,
  observation
}: {
  label: string;
  observation?: ComputerSessionDebugBundle["observations"][number];
}) {
  const metadata = readRecord(observation?.metadata);
  const targetEvidence = readRecord(metadata.targetEvidence);
  const targetEvidenceSummary = formatTargetEvidencePreview(targetEvidence);
  return (
    <div className="computer-use-observation-pane">
      <div>
        <span className={`capability-status ${statusTone(observation?.freshness ?? "unknown")}`}>{label}</span>
        <strong>{observation?.source ?? "not captured"}</strong>
      </div>
      <small>{observation ? summarizeObservationPreview(observation) : "No observation evidence"}</small>
      <small>{formatObservationPreviewMeta(metadata)}</small>
      {targetEvidenceSummary ? (
        <small className={`computer-use-target-evidence ${targetEvidenceTone(targetEvidence)}`}>{targetEvidenceSummary}</small>
      ) : null}
    </div>
  );
}

function summarizeDagRoute(node: CapabilityDagNodeSummary): string | null {
  const route = readDagRoute(node);
  if (!route) {
    return null;
  }
  const mode = typeof route.executionMode === "string" ? route.executionMode : "route";
  const rank = typeof route.preferenceRank === "number" ? `#${route.preferenceRank}` : "";
  const fallback = route.visualFallbackUsed === true ? "visual" : "structured";
  return `${mode}${rank ? ` ${rank}` : ""} · ${fallback}`;
}

function readDagRoute(node: CapabilityDagNodeSummary): Record<string, unknown> | null {
  const input = node.input && typeof node.input === "object" ? node.input as Record<string, unknown> : {};
  const output = node.output && typeof node.output === "object" ? node.output as Record<string, unknown> : {};
  const outputRoute = output.actionRoute && typeof output.actionRoute === "object" ? output.actionRoute as Record<string, unknown> : null;
  const inputRoute = input.actionRoute && typeof input.actionRoute === "object" ? input.actionRoute as Record<string, unknown> : null;
  return outputRoute ?? inputRoute;
}

function deriveOneTimeProfileRequirements(input: {
  session: ComputerSessionSummary | null;
  bundle: ComputerSessionDebugBundle | null;
  awaitingJobs: CapabilityJobSummary[];
  selectedSurfaceKind: ExecutionSurfaceKind;
}): AutonomyPermissionRequirement[] {
  if (!input.session) {
    return [];
  }
  const requirements: AutonomyPermissionRequirement[] = [];
  for (const node of input.bundle?.dagNodes ?? []) {
    const output = readRecord(node.output);
    collectMissingRequirements(output, requirements);
    const permission = readRecord(output.permission);
    collectMissingRequirements(permission, requirements);
  }
  for (const decision of input.bundle?.safetyDecisions ?? []) {
    const record = readRecord(decision);
    collectMissingRequirements(record, requirements);
    const requiredGrants = Array.isArray(record.requiredGrants) ? record.requiredGrants : [];
    for (const grant of requiredGrants) {
      if (typeof grant === "string") {
        requirements.push(...requirementsForSessionGrant(grant, input.session, input.selectedSurfaceKind));
      }
    }
  }
  for (const job of input.awaitingJobs) {
    requirements.push(...requirementsForCapabilityJob(job, input.session));
  }
  if (!requirements.length && (input.session.blockedReason || input.session.requiresUserAction)) {
    requirements.push(...requirementsForSurface(input.selectedSurfaceKind, input.session));
  }
  const riskRequirement = riskRequirementForSession(input.session);
  if (riskRequirement) {
    requirements.push(riskRequirement);
  }
  return dedupePermissionRequirements(requirements).filter((requirement) => requirement.type !== "credential_access");
}

function collectMissingRequirements(record: Record<string, unknown>, requirements: AutonomyPermissionRequirement[]): void {
  const missingRequirements = Array.isArray(record.missingRequirements) ? record.missingRequirements : [];
  for (const requirement of missingRequirements) {
    if (isPermissionRequirement(requirement)) {
      requirements.push(requirement);
    }
  }
}

function requirementsForSessionGrant(
  grant: string,
  session: ComputerSessionSummary,
  selectedSurfaceKind: ExecutionSurfaceKind
): AutonomyPermissionRequirement[] {
  const reason = `Computer Session selected ${selectedSurfaceKind} and requires ${grant}.`;
  if (grant === "browser.profile") {
    return [
      { type: "browser_automation", value: "regular_browser_extension", reason },
      { type: "risk_class", value: "high_risk", reason: "Existing browser profile state can expose private data." }
    ];
  }
  if (grant === "browser.chrome") {
    return [
      { type: "browser_automation", value: "browser_chrome", reason },
      { type: "risk_class", value: "side_effect", reason: "Browser chrome operations can mutate browser state." }
    ];
  }
  if (grant === "generated_code.runtime_workspace") {
    return [
      { type: "generated_tool_materialization", value: "runtime_workspace", reason },
      { type: "generated_tool_execution", value: "runtime_workspace", reason },
      { type: "generated_code", value: "runtime_workspace", reason },
      { type: "risk_class", value: riskClassToAutonomyRisk(session.riskClass), reason: `Session risk class is ${session.riskClass}.` }
    ];
  }
  if (grant === "terminal.command_allowlist") {
    return [
      { type: "risk_class", value: "side_effect", reason: "Terminal execution requires a command allowlist." }
    ];
  }
  if (grant === "file.write_output_root") {
    return [
      { type: "risk_class", value: "reversible", reason: "Local artifact writes must remain in an approved output root." }
    ];
  }
  if (grant === "desktop.foreground_watch" || grant === "desktop.abort_on_user_input") {
    return [
      { type: "risk_class", value: "high_risk", reason: "Foreground desktop actions require watch-mode guardrails." }
    ];
  }
  return [];
}

function requirementsForSurface(
  surfaceKind: ExecutionSurfaceKind,
  session: ComputerSessionSummary
): AutonomyPermissionRequirement[] {
  if (surfaceKind === "regular_browser_extension") {
    return requirementsForSessionGrant("browser.profile", session, surfaceKind)
      .concat(requirementsForSessionGrant("browser.chrome", session, surfaceKind));
  }
  if (surfaceKind === "tool_workspace") {
    return requirementsForSessionGrant("generated_code.runtime_workspace", session, surfaceKind);
  }
  if (surfaceKind === "pty_workspace") {
    return requirementsForSessionGrant("terminal.command_allowlist", session, surfaceKind);
  }
  if (surfaceKind === "foreground_desktop_watch") {
    return requirementsForSessionGrant("desktop.foreground_watch", session, surfaceKind)
      .concat(requirementsForSessionGrant("desktop.abort_on_user_input", session, surfaceKind));
  }
  return [];
}

function requirementsForCapabilityJob(job: CapabilityJobSummary, session: ComputerSessionSummary): AutonomyPermissionRequirement[] {
  const input = readRecord(job.inputJson);
  if (job.kind === "terminal") {
    const command = readString(input.command);
    return [
      ...(command ? [{ type: "command" as const, value: command, reason: "Awaiting terminal command approval." }] : []),
      { type: "risk_class", value: riskClassToAutonomyRisk(session.riskClass), reason: `Session risk class is ${session.riskClass}.` }
    ];
  }
  if (job.kind === "browser_chrome") {
    const command = readString(input.command) ?? readString(input.kind) ?? "browser_chrome";
    const riskClass: AutonomyRiskClass = browserChromeRisk(command) === "read_only"
      ? "read_only"
      : browserChromeRisk(command) === "profile_private_data" || browserChromeRisk(command) === "local_file_disclosure"
        ? "high_risk"
        : "side_effect";
    return [
      { type: "browser_automation", value: "browser_chrome", reason: browserChromeReason(command) },
      { type: "risk_class", value: riskClass, reason: `Browser chrome command ${command} is ${browserChromeRisk(command)}.` }
    ];
  }
  if (job.kind === "browser_action") {
    const action = readActionType(input);
    return [
      { type: "browser_automation", value: "browser_action", reason: "Awaiting Browser Action approval." },
      { type: "risk_class", value: action === "read" || action === "screenshot" ? "read_only" : "side_effect", reason: `Browser Action ${action} requires approval.` }
    ];
  }
  if (job.kind === "desktop_action") {
    return [
      { type: "risk_class", value: "high_risk", reason: "Desktop action requires foreground watch-mode approval." }
    ];
  }
  if (job.kind === "agent_tool") {
    return [
      { type: "generated_tool_execution", value: "runtime_workspace", reason: "Awaiting generated tool execution approval." },
      { type: "risk_class", value: "reversible", reason: "Generated tool output must remain rollback-capable." }
    ];
  }
  return [
    { type: "risk_class", value: "read_only", reason: `Awaiting ${job.kind} capability approval.` }
  ];
}

function riskRequirementForSession(session: ComputerSessionSummary): AutonomyPermissionRequirement | null {
  const risk = riskClassToAutonomyRisk(session.riskClass);
  if (risk === "read_only") {
    return null;
  }
  return {
    type: "risk_class",
    value: risk,
    reason: `Session risk class is ${session.riskClass}.`
  };
}

function riskClassToAutonomyRisk(riskClass: ComputerSessionSummary["riskClass"]): AutonomyRiskClass {
  if (riskClass === "read_only") return "read_only";
  if (riskClass === "local_artifact_create") return "reversible";
  if (riskClass === "credential_or_secret") return "credential";
  if (riskClass === "browser_state_mutation" || riskClass === "external_submission") return "side_effect";
  return "high_risk";
}

function grantsFromPermissionRequirements(requirements: AutonomyPermissionRequirement[]): Record<string, unknown> {
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
    riskClasses: [] as AutonomyRiskClass[],
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
  grants.riskClasses = [...new Set<AutonomyRiskClass>(grants.riskClasses.length ? grants.riskClasses : ["read_only"])];
  return grants;
}

type OneTimeProfileDraftSummary = {
  scope: "one_time";
  maxUses: 1;
  credentialAccess: "never";
  riskClasses: AutonomyRiskClass[];
  browserGrants: string[];
  commandGrants: string[];
  fileWriteRoots: string[];
  summary: string;
};

type ProfileGrantDetail = {
  label: string;
  value: string;
};

type BrowserChromeEvidenceRow = {
  id: string;
  command: string;
  status: CapabilityJobSummary["status"];
  riskClass: string;
  verification: string;
  redactionSummary: string;
  resourceSummary: string;
  summary: string;
};

type TerminalDeltaEvidenceRow = {
  id: string;
  status: string;
  createdCount: number;
  modifiedCount: number;
  deletedCount: number;
  rollbackCandidateCount: number;
  resources: string;
  rollbackSummary: string;
  redactionSummary: string;
  summary: string;
};

type ManagedProfileDraftValidation = {
  ok: boolean;
  payload?: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  summary: string;
};

function collectProfileGrantDetails(profile: AutonomyPermissionProfile): ProfileGrantDetail[] {
  const details: ProfileGrantDetail[] = [];
  for (const domain of profile.grants.networkDomains) {
    details.push({ label: "network", value: domain });
  }
  for (const domain of profile.grants.browserDomains) {
    details.push({ label: "browser", value: domain });
  }
  for (const command of profile.grants.commands.allowPrefixes) {
    details.push({ label: "command", value: command });
  }
  for (const root of profile.grants.filesystem.readRoots) {
    details.push({ label: "read", value: root });
  }
  for (const root of profile.grants.filesystem.writeRoots) {
    details.push({ label: "write", value: root });
  }
  if (profile.grants.packageInstall) {
    details.push({ label: "package", value: "enabled" });
  }
  for (const packagePattern of profile.grants.packageAllowlist ?? []) {
    details.push({ label: "package allow", value: packagePattern });
  }
  if (profile.grants.osMutation) {
    details.push({ label: "os", value: "mutation_enabled" });
  }
  if (profile.grants.generatedToolMaterialization) {
    details.push({ label: "tool", value: "materialization" });
  }
  if (profile.grants.generatedToolExecution) {
    details.push({ label: "tool", value: "execution" });
  }
  if (profile.grants.generatedCode) {
    details.push({ label: "code", value: "runtime_workspace" });
  }
  return details;
}

function createSafeManagedProfileDraft(): Record<string, unknown> {
  return {
    name: "Computer Use one-time profile",
    mode: "scoped_yolo",
    scope: "one_time",
    status: "active",
    maxUses: 1,
    grants: {
      network: false,
      networkDomains: [],
      browserAutomation: false,
      browserDomains: [],
      filesystem: {
        readRoots: [],
        writeRoots: []
      },
      commands: {
        allowPrefixes: [],
        denyPatterns: []
      },
      packageInstall: false,
      packageAllowlist: ["file:*"],
      osMutation: false,
      generatedToolMaterialization: false,
      generatedToolExecution: false,
      generatedCode: false,
      credentialAccess: "never",
      riskClasses: ["read_only"],
      maxRuntimeMs: 30000,
      maxOutputBytes: 2097152,
      maxIterations: 3
    },
    safetyBoundaries: [
      "approval_required_for_high_risk_actions",
      "restricted_pages_are_not_bypassed",
      "credentials_are_not_automated",
      "foreground_desktop_requires_watch_mode",
      "generated_code_must_remain_in_runtime_workspace"
    ]
  };
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

function validateManagedProfileDraft(draft: string): ManagedProfileDraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(draft || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        errors: ["Profile draft must be a JSON object."],
        warnings,
        summary: "Profile draft must be a JSON object."
      };
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Invalid JSON."],
      warnings,
      summary: "Invalid profile JSON."
    };
  }

  const grants = readRecord(payload.grants);
  const credentialAccess = typeof grants.credentialAccess === "string" ? grants.credentialAccess : "never";
  const scope = payload.scope === "persistent" ? "persistent" : "one_time";
  const riskClasses = readStringArray(grants.riskClasses);
  const browserDomains = readStringArray(grants.browserDomains);
  const commands = readRecord(grants.commands);
  const commandPrefixes = readStringArray(commands.allowPrefixes);
  const browserAutomation = grants.browserAutomation === true;
  const packageInstall = grants.packageInstall === true;
  const osMutation = grants.osMutation === true;
  const generatedCode = grants.generatedCode === true ||
    grants.generatedToolExecution === true ||
    grants.generatedToolMaterialization === true;
  const highRisk = riskClasses.includes("high_risk") ||
    riskClasses.includes("credential") ||
    packageInstall ||
    osMutation;

  if (credentialAccess !== "never") {
    errors.push("Credential access must remain never.");
  }
  if (riskClasses.includes("credential")) {
    errors.push("Credential risk class is blocked in renderer-created profiles.");
  }
  if (scope === "persistent" && highRisk) {
    errors.push("Persistent profiles cannot add high-risk, package, OS, or credential grants from this UI; use a one-time profile.");
  }
  if (scope === "persistent" && browserAutomation && browserDomains.length === 0) {
    errors.push("Persistent browser automation must list exact browser domains.");
  }
  if (scope === "persistent" && commandPrefixes.length > 5) {
    errors.push("Persistent command profiles are capped at five explicit prefixes in this UI.");
  }
  if (generatedCode && commandPrefixes.length === 0) {
    warnings.push("Generated-code profiles usually need exact command prefixes.");
  }
  if (scope === "one_time" && payload.maxUses !== 1) {
    warnings.push("One-time profiles should keep maxUses at 1.");
  }
  if (!Array.isArray(payload.safetyBoundaries) || payload.safetyBoundaries.length === 0) {
    warnings.push("Safety boundaries are empty; daemon defaults may apply.");
  }

  return {
    ok: errors.length === 0,
    payload,
    errors,
    warnings,
    summary: errors.length
      ? errors.join(" ")
      : [
        `${scope} profile`,
        credentialAccess === "never" ? "credentials never" : "credential review needed",
        riskClasses.length ? `risk ${riskClasses.join(", ")}` : "risk read_only",
        browserAutomation ? `browser ${browserDomains.length ? browserDomains.length : "broad"}` : "browser off",
        commandPrefixes.length ? `${commandPrefixes.length} commands` : "no commands",
        warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "ready"
      ].join(" · ")
  };
}

function summarizeOneTimeProfileDraft(requirements: AutonomyPermissionRequirement[]): OneTimeProfileDraftSummary | null {
  if (!requirements.length) {
    return null;
  }
  const riskClasses = valuesForRequirement(requirements, "risk_class") as AutonomyRiskClass[];
  const browserGrants = valuesForRequirement(requirements, "browser_automation");
  const commandGrants = valuesForRequirement(requirements, "command");
  const fileWriteRoots = valuesForRequirement(requirements, "filesystem_write");
  const generatedGrants = requirements.filter((requirement) =>
    requirement.type === "generated_tool_materialization" ||
    requirement.type === "generated_tool_execution" ||
    requirement.type === "generated_code"
  ).length;
  const networkGrants = valuesForRequirement(requirements, "network_domain").length + valuesForRequirement(requirements, "network").length;
  const summaryParts = [
    riskClasses.length ? `${riskClasses.join(", ")} risk` : "read-only risk",
    browserGrants.length ? `${browserGrants.length} browser grant${browserGrants.length === 1 ? "" : "s"}` : null,
    commandGrants.length ? `${commandGrants.length} exact command${commandGrants.length === 1 ? "" : "s"}` : null,
    fileWriteRoots.length ? `${fileWriteRoots.length} write root${fileWriteRoots.length === 1 ? "" : "s"}` : null,
    generatedGrants ? `${generatedGrants} generated-tool grant${generatedGrants === 1 ? "" : "s"}` : null,
    networkGrants ? `${networkGrants} network grant${networkGrants === 1 ? "" : "s"}` : null,
    "credential access stays never"
  ].filter((part): part is string => Boolean(part));
  return {
    scope: "one_time",
    maxUses: 1,
    credentialAccess: "never",
    riskClasses: riskClasses.length ? [...new Set(riskClasses)] : ["read_only"],
    browserGrants,
    commandGrants,
    fileWriteRoots,
    summary: summaryParts.join(" · ")
  };
}

function valuesForRequirement(requirements: AutonomyPermissionRequirement[], type: AutonomyPermissionRequirement["type"]): string[] {
  return [...new Set(requirements.filter((requirement) => requirement.type === type).map((requirement) => requirement.value))];
}

function formatCountOrList(values: string[]): string {
  if (!values.length) {
    return "none";
  }
  if (values.length <= 2) {
    return values.join(", ");
  }
  return `${values.length}`;
}

function formatProfileUse(profile: AutonomyPermissionProfile): string {
  const maxUses = typeof profile.maxUses === "number" ? profile.maxUses : null;
  return maxUses === null ? `${profile.usedCount}/∞` : `${profile.usedCount}/${maxUses}`;
}

function collectTerminalDeltaEvidenceRows(
  observations: ComputerSessionDebugBundle["observations"],
  rollbackActions: ComputerSessionDebugBundle["rollbackActions"]
): TerminalDeltaEvidenceRow[] {
  return observations
    .filter((observation) => observation.source === "terminal_output_root_diff")
    .map((observation) => {
      const metadata = readRecord(observation.metadata);
      const createdCount = readNumber(metadata.createdCount);
      const modifiedCount = readNumber(metadata.modifiedCount);
      const deletedCount = readNumber(metadata.deletedCount);
      const rollbackCandidateCount = readNumber(metadata.rollbackCandidateCount);
      const roles = [...new Set((observation.resourceIds ?? []).map((resource) => resource.role))];
      const hasDeltaManifest = roles.includes("terminal_output_root_delta_manifest");
      const linkedRollback = rollbackActions.find((action) =>
        action.metadata?.source === "terminal_output_root_diff" &&
        (action.capabilityJobId === observation.capabilityJobId || readString(readRecord(action.metadata).capabilityJobId) === observation.capabilityJobId)
      ) ?? rollbackActions.find((action) => action.metadata?.source === "terminal_output_root_diff");
      return {
        id: observation.id,
        status: observation.freshness ?? "evidence",
        createdCount,
        modifiedCount,
        deletedCount,
        rollbackCandidateCount,
        resources: roles.length ? roles.join(", ") : hasDeltaManifest ? "terminal_output_root_delta_manifest" : "manifest only",
        rollbackSummary: linkedRollback
          ? `${linkedRollback.status} rollback · ${readNumber(linkedRollback.metadata?.terminalArtifactTargetCount)} target${readNumber(linkedRollback.metadata?.terminalArtifactTargetCount) === 1 ? "" : "s"}`
          : "rollback not available",
        redactionSummary: summarizeTerminalDeltaRedaction(observation, linkedRollback),
        summary: `created ${createdCount}, modified ${modifiedCount}, deleted ${deletedCount}`
      };
    });
}

function summarizeTerminalDeltaProof(rows: TerminalDeltaEvidenceRow[]): {
  createdCount: number;
  modifiedCount: number;
  deletedCount: number;
  rollbackCandidateCount: number;
} {
  return rows.reduce((total, row) => ({
    createdCount: total.createdCount + row.createdCount,
    modifiedCount: total.modifiedCount + row.modifiedCount,
    deletedCount: total.deletedCount + row.deletedCount,
    rollbackCandidateCount: total.rollbackCandidateCount + row.rollbackCandidateCount
  }), {
    createdCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    rollbackCandidateCount: 0
  });
}

function summarizeTerminalDeltaRedaction(
  observation: ComputerSessionDebugBundle["observations"][number],
  rollbackAction?: ComputerSessionRollbackActionSummary
): string {
  const localPaths = readString(readRecord(observation.redaction).localPaths) ?? "minimized";
  const rollbackMetadata = readRecord(rollbackAction?.metadata);
  const rollbackTargets = Array.isArray(rollbackMetadata.terminalArtifactTargets)
    ? rollbackMetadata.terminalArtifactTargets
    : [];
  const hasRawPath = rollbackTargets.some((target) => typeof target === "object" && target !== null && "path" in target);
  return hasRawPath ? `${localPaths} · rollback path leak` : `${localPaths} · rollback paths redacted`;
}

function collectBrowserChromeEvidenceRows(
  jobs: CapabilityJobSummary[],
  observations: ComputerSessionDebugBundle["observations"]
): BrowserChromeEvidenceRow[] {
  return jobs
    .filter((job) => job.kind === "browser_chrome")
    .map((job) => {
      const input = readRecord(job.inputJson);
      const outputEnvelope = readRecord(job.outputJson);
      const output = readRecord(outputEnvelope.output);
      const metadata = readRecord(outputEnvelope.metadata);
      const command = readString(input.command) ?? "browser_chrome";
      const linkedObservations = observations.filter((observation) => observation.capabilityJobId === job.id);
      const resourceRoles = linkedObservations.flatMap((observation) =>
        (observation.resourceIds ?? []).map((resource) => resource.role)
      );
      return {
        id: job.id,
        command,
        status: job.status,
        riskClass: readString(metadata.risk) ?? browserChromeRisk(command),
        verification: readString(metadata.verification) ?? readString(readRecord(output.verification).status) ?? "unverified",
        redactionSummary: summarizeBrowserChromeRedaction(command, input, output, linkedObservations),
        resourceSummary: resourceRoles.length ? [...new Set(resourceRoles)].join(", ") : "no resources",
        summary: summarizeBrowserChromeEvidence(command, output, linkedObservations)
      };
    });
}

function summarizeBrowserChromeEvidence(
  command: string,
  output: Record<string, unknown>,
  observations: ComputerSessionDebugBundle["observations"]
): string {
  if (command === "download.verify" && output.verified === true) {
    return "Download verified with approved artifact evidence.";
  }
  if (command.startsWith("download.")) {
    const download = readRecord(output.download);
    const downloads = Array.isArray(output.downloads) ? output.downloads : [];
    const state = readString(download.state) ?? readString(readRecord(downloads[0]).state);
    return state ? `Download state ${state}.` : "Download evidence recorded.";
  }
  if (command.startsWith("history.")) {
    const items = Array.isArray(output.items) ? output.items.length : 0;
    return items ? `${items} history item(s), path-redacted.` : "History action recorded with redaction.";
  }
  if (command.startsWith("debugger.")) {
    return "Fixed debugger command evidence recorded.";
  }
  if (command.startsWith("permission.")) {
    const permission = readRecord(output.permission);
    const setting = readString(permission.verifiedSetting) ?? readString(permission.setting) ?? readString(permission.requestedSetting);
    const type = readString(permission.type) ?? "permission";
    return setting ? `${type} permission ${setting}.` : "Browser permission evidence recorded.";
  }
  if (command.startsWith("file_upload.")) {
    const files = Array.isArray(output.files) ? output.files.length : 0;
    return files ? `${files} file input item(s), local path redacted.` : "File upload state evidence recorded.";
  }
  if (observations.length) {
    return observations[0]?.summary ?? "Browser Chrome observation recorded.";
  }
  return "Browser Chrome command evidence recorded.";
}

function summarizeBrowserChromeRedaction(
  command: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  observations: ComputerSessionDebugBundle["observations"]
): string {
  const observationRedactions = observations
    .map((observation) => readRecord(observation.redaction))
    .filter((redaction) => Object.keys(redaction).length > 0);
  if (observationRedactions.some((redaction) => redaction.localPaths === "basename_only")) {
    return "basename-only redacted";
  }
  if (command.startsWith("history.") || output.redaction === "url_path_redacted" || containsBooleanField(output, "pathRedacted")) {
    return "history/path redacted";
  }
  if (command.startsWith("file_upload.") || containsBooleanField(output, "pathRedacted") || containsBooleanField(input, "pathRedacted")) {
    return "local path redacted";
  }
  if (command.startsWith("debugger.")) {
    return "debugger output minimized";
  }
  return observationRedactions.length ? "metadata redacted" : "metadata only";
}

function containsBooleanField(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsBooleanField(item, key));
  }
  const record = value as Record<string, unknown>;
  if (record[key] === true) {
    return true;
  }
  return Object.values(record).some((child) => containsBooleanField(child, key));
}

function dedupePermissionRequirements(requirements: AutonomyPermissionRequirement[]): AutonomyPermissionRequirement[] {
  const seen = new Set<string>();
  const output: AutonomyPermissionRequirement[] = [];
  for (const requirement of requirements) {
    const key = `${requirement.type}:${requirement.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(requirement);
  }
  return output;
}

function isPermissionRequirement(value: unknown): value is AutonomyPermissionRequirement {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { type?: unknown; value?: unknown; reason?: unknown };
  return typeof record.type === "string" && typeof record.value === "string" && typeof record.reason === "string";
}

function ApprovalRow({
  job,
  onApprove,
  onCancel
}: {
  job: CapabilityJobSummary;
  onApprove: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}) {
  const approval = summarizeCapabilityApproval(job);
  const preview = buildApprovalPreview(job, approval);
  return (
    <div className="computer-use-approval-item">
      <div className="computer-use-approval-row">
        <span className="capability-status active">approval</span>
        <div className="computer-use-approval-copy">
          <strong>{approval.grant}</strong>
          <small>{approval.reason}</small>
        </div>
        <span className={`capability-status ${approval.tone}`}>{approval.riskClass}</span>
        <small>{approval.command}</small>
        <button type="button" onClick={() => onApprove(job.id)}>Approve</button>
        <button type="button" onClick={() => onCancel(job.id)}>Cancel</button>
      </div>
      {preview ? (
        <details className="computer-use-approval-preview">
          <summary>Preview</summary>
          <pre>{preview}</pre>
        </details>
      ) : null}
    </div>
  );
}

function summarizeCapabilityApproval(job: CapabilityJobSummary): {
  grant: string;
  riskClass: string;
  reason: string;
  command: string;
  tone: string;
} {
  const input = readRecord(job.inputJson);
  if (job.kind === "terminal") {
    const command = readString(input.command) ?? "terminal command";
    return {
      grant: "terminal.command_allowlist",
      riskClass: classifyCommandRisk(command),
      reason: "Run an approved local command in the PTY workspace.",
      command: summarizeCommand(command),
      tone: commandRiskTone(command)
    };
  }
  if (job.kind === "browser_chrome") {
    const command = readString(input.command) ?? readString(input.kind) ?? "browser_chrome";
    return {
      grant: browserChromeGrant(command),
      riskClass: browserChromeRisk(command),
      reason: browserChromeReason(command),
      command,
      tone: browserChromeTone(command)
    };
  }
  if (job.kind === "browser_action") {
    const action = readActionType(input);
    return {
      grant: action === "read" || action === "screenshot" ? "browser.action.read" : "browser.action.side_effect",
      riskClass: action === "read" || action === "screenshot" ? "read_only" : "browser_state_mutation",
      reason: action === "read" || action === "screenshot" ? "Observe browser state." : "Execute a browser action that may change page state.",
      command: action,
      tone: action === "read" || action === "screenshot" ? "ok" : "warn"
    };
  }
  if (job.kind === "desktop_action") {
    const command = readString(input.command) ?? readActionType(input) ?? "desktop_action";
    return {
      grant: command === "observe" || command === "status" ? "desktop.observe" : "desktop.foreground_watch.one_time",
      riskClass: command === "observe" || command === "status" ? "read_only" : "security_boundary",
      reason: command === "observe" || command === "status" ? "Read bounded desktop/browser-window state." : "Foreground input requires watch-mode approval and abort guards.",
      command,
      tone: command === "observe" || command === "status" ? "ok" : "error"
    };
  }
  if (job.kind === "agent_tool") {
    return {
      grant: "generated_tool.execution",
      riskClass: "local_artifact_create",
      reason: "Run a bounded generated or reviewed tool in a runtime workspace.",
      command: readString(input.capability) ?? "agent_tool",
      tone: "warn"
    };
  }
  return {
    grant: `${job.kind}.approval`,
    riskClass: "side_effect",
    reason: "Capability execution requires explicit approval.",
    command: shortId(job.id),
    tone: "warn"
  };
}

function buildApprovalPreview(
  job: CapabilityJobSummary,
  approval: ReturnType<typeof summarizeCapabilityApproval>
): string {
  const highRisk = approval.tone === "warn" || approval.tone === "error";
  if (!highRisk) {
    return "";
  }
  const payload = {
    jobId: job.id,
    kind: job.kind,
    grant: approval.grant,
    riskClass: approval.riskClass,
    command: approval.command,
    reason: approval.reason,
    input: sanitizeApprovalPreview(job.inputJson),
    evidence: {
      requestedBy: job.requestedBy,
      priority: job.priority,
      approvalId: job.approvalId,
      timeoutMs: job.timeoutMs,
      retryCount: job.retryCount
    }
  };
  return JSON.stringify(payload, null, 2).slice(0, 1800);
}

function sanitizeApprovalPreview(value: unknown): unknown {
  if (typeof value === "string") {
    return /password|passwd|token|cookie|credential|secret|api[_-]?key/i.test(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item) => sanitizeApprovalPreview(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    output[key] = /password|passwd|token|cookie|credential|secret|api[_-]?key/i.test(key)
      ? "[redacted]"
      : sanitizeApprovalPreview(child);
  }
  return output;
}

function browserChromeGrant(command: string): string {
  if (command.startsWith("history.")) return "browser.history.one_time";
  if (command.startsWith("debugger.")) return "browser.debugger.one_time";
  if (command.startsWith("file_upload.")) return "file.upload.local_path";
  if (command.startsWith("download.")) return "browser.downloads";
  if (command.startsWith("tab_group.")) return "browser.tab_groups";
  if (command.startsWith("bookmark.")) return "browser.bookmarks";
  return "browser.chrome";
}

function browserChromeRisk(command: string): string {
  if (command.startsWith("history.") || command.startsWith("debugger.")) return "profile_private_data";
  if (command.startsWith("file_upload.")) return "local_file_disclosure";
  if (command.includes("create") || command.includes("update") || command.includes("cancel") || command.includes("clear")) return "browser_state_mutation";
  return "read_only";
}

function browserChromeReason(command: string): string {
  if (command.startsWith("history.")) return "History access is one-time and redacted by default.";
  if (command.startsWith("debugger.")) return "Debugger access can inspect private page state and needs one-time approval.";
  if (command.startsWith("file_upload.")) return "File upload requires an explicit approved local path.";
  if (command.startsWith("download.")) return "Download actions must be observed and verified.";
  if (command.startsWith("tab_group.")) return "Tab group mutation or inspection uses browser chrome permissions.";
  if (command.startsWith("bookmark.")) return "Bookmark state access or mutation uses browser chrome permissions.";
  return "Browser chrome command requires approval.";
}

function browserChromeTone(command: string): string {
  const risk = browserChromeRisk(command);
  if (risk === "read_only") return "ok";
  if (risk === "profile_private_data" || risk === "local_file_disclosure") return "error";
  return "warn";
}

function classifyCommandRisk(command: string): string {
  return /rm\s|del\s|remove|delete|format|shutdown|reg\s+add|set-item|credential|token|password/i.test(command)
    ? "destructive_local_change"
    : "local_artifact_create";
}

function commandRiskTone(command: string): string {
  return classifyCommandRisk(command) === "destructive_local_change" ? "error" : "warn";
}

function summarizeCommand(command: string): string {
  return command.length > 40 ? `${command.slice(0, 37)}...` : command;
}

function fallbackSurfaces(): Array<Pick<ExecutionSurface, "kind">> {
  return [
    { kind: "isolated_browser" },
    { kind: "regular_browser_extension" },
    { kind: "tool_workspace" },
    { kind: "pty_workspace" },
    { kind: "foreground_desktop_watch" },
    { kind: "future_vm_session" }
  ];
}

function canCancelSession(state: ComputerSessionSummary["state"]): boolean {
  return state !== "completed" && state !== "cancelled" && state !== "failed";
}

function canRunRollbackAction(status: ComputerSessionRollbackActionSummary["status"]): boolean {
  return status === "planned" || status === "blocked" || status === "failed";
}

function statusTone(status: string): string {
  if (status === "completed" || status === "passed") return "ok";
  if (status === "failed" || status === "blocked" || status === "expired") return "error";
  if (status === "cancelled" || status === "awaiting_approval" || status === "awaiting_action_confirmation") return "warn";
  return "active";
}

function summarizeFailureMemory(record: ComputerSessionDebugBundle["failureMemory"][number]): string {
  return record.calibration.recoveryHints?.[0] ??
    record.calibration.abstentionTriggers?.[0] ??
    record.provenance.source ??
    shortId(record.id);
}

function summarizeVerifierAudit(audit: NonNullable<ComputerSessionDebugBundle["verifierAudit"]>["audits"][number]): string {
  return audit.capabilityJobId
    ? `${shortId(audit.capabilityJobId)} · ${audit.reason}`
    : audit.reason;
}

function verifierAuditTone(auditClass: string): string {
  if (auditClass === "consistent_pass") return "ok";
  if (auditClass === "false_positive_candidate" || auditClass === "missing_verifier_evidence") return "error";
  if (auditClass === "false_negative_record" || auditClass === "inconclusive_verifier") return "warn";
  return "active";
}

type ToolsmithSourceRow = {
  title?: string;
  url?: string;
  status?: string;
  browserFallback?: boolean;
  fallbackReason?: string;
  chars?: number;
  excerpt?: string;
};

type ObservationPreviewPair = {
  key: string;
  source: string;
  actionType: string;
  targetSummary?: string;
  capabilityJobId?: string;
  before?: ComputerSessionDebugBundle["observations"][number];
  after?: ComputerSessionDebugBundle["observations"][number];
};

function collectObservationPreviewPairs(observations: ComputerSessionDebugBundle["observations"]): ObservationPreviewPair[] {
  const groups = new Map<string, ObservationPreviewPair>();
  for (const observation of observations) {
    const metadata = readRecord(observation.metadata);
    const phase = readString(metadata.observationPhase);
    if (phase !== "pre_action" && phase !== "post_action") {
      continue;
    }
    const key = observation.dagNodeId ?? observation.capabilityJobId ?? observation.id;
    const existing = groups.get(key) ?? {
      key,
      source: observation.source,
      actionType: readString(metadata.action) ?? "action",
      targetSummary: readObservationTargetSummary(metadata),
      capabilityJobId: observation.capabilityJobId
    };
    if (phase === "pre_action") {
      existing.before = observation;
    } else {
      existing.after = observation;
    }
    existing.source = observation.source;
    existing.actionType = readString(metadata.action) ?? existing.actionType;
    existing.targetSummary = existing.targetSummary ?? readObservationTargetSummary(metadata);
    existing.capabilityJobId = existing.capabilityJobId ?? observation.capabilityJobId;
    groups.set(key, existing);
  }
  return [...groups.values()]
    .sort((left, right) => Date.parse((right.after ?? right.before)?.capturedAt ?? "") - Date.parse((left.after ?? left.before)?.capturedAt ?? ""));
}

function readObservationTargetSummary(metadata: Record<string, unknown>): string | undefined {
  const targetEvidence = readRecord(metadata.targetEvidence);
  const target = readRecord(targetEvidence.target);
  const candidates = [
    readString(metadata.targetSummary),
    readString(target.label),
    readString(target.role),
    readString(targetEvidence.elementId),
    readString(metadata.label),
    readString(metadata.url),
    readString(metadata.title)
  ];
  return candidates.find((candidate) => candidate && candidate.length > 0);
}

function summarizeObservationPreview(observation: ComputerSessionDebugBundle["observations"][number]): string {
  const metadata = readRecord(observation.metadata);
  const title = readString(metadata.title);
  const url = readString(metadata.url);
  const elementCount = typeof metadata.elementCount === "number" ? `${metadata.elementCount} elements` : undefined;
  const graphCount = typeof metadata.perceptionGraphNodeCount === "number" ? `${metadata.perceptionGraphNodeCount} graph nodes` : undefined;
  return [title, url, elementCount, graphCount].filter((part): part is string => Boolean(part)).join(" · ") ||
    observation.summary ||
    formatActivityTime(observation.capturedAt);
}

function formatObservationPreviewMeta(metadata: Record<string, unknown>): string {
  const verification = readString(metadata.verification);
  const freshnessReason = readString(metadata.freshnessReason);
  const ageMs = typeof metadata.ageMs === "number" ? `${Math.round(metadata.ageMs)}ms old` : undefined;
  return [verification ? `verification ${verification}` : undefined, ageMs, freshnessReason].filter((part): part is string => Boolean(part)).join(" · ") ||
    "redacted structured observation";
}

function summarizeActionFeedback(feedback: ComputerSessionDebugBundle["actionFeedbacks"][number]): string {
  const parts = [
    feedback.verifierStatus ? `verifier ${feedback.verifierStatus}` : undefined,
    feedback.beforeObservationId ? `before ${shortId(feedback.beforeObservationId)}` : undefined,
    feedback.afterObservationId ? `after ${shortId(feedback.afterObservationId)}` : undefined,
    feedback.perceptionGraphId ? `graph ${shortId(feedback.perceptionGraphId)}` : undefined,
    feedback.capabilityJobId ? `job ${shortId(feedback.capabilityJobId)}` : undefined
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ") ||
    formatActivityTime(feedback.capturedAt);
}

function formatTargetEvidencePreview(targetEvidence: Record<string, unknown>): string {
  if (targetEvidence.schemaVersion !== "computer-session-target-evidence.v1") {
    return "";
  }
  const target = readRecord(targetEvidence.target);
  const risk = readString(targetEvidence.risk) ?? "risk";
  const allowed = targetEvidence.allowed === true ? "allowed" : "blocked";
  const confidence = typeof targetEvidence.confidence === "number" ? targetEvidence.confidence.toFixed(2) : undefined;
  const threshold = typeof targetEvidence.threshold === "number" ? targetEvidence.threshold.toFixed(2) : undefined;
  const node = readString(targetEvidence.nodeId) ?? readString(targetEvidence.elementId);
  const label = readString(target.label) ?? readString(target.role);
  const sources = readStringList(targetEvidence.evidenceSources).slice(0, 3).join("+");
  const classes = readStringList(targetEvidence.evidenceClasses).slice(0, 2).join("+");
  const arbitration = readRecord(targetEvidence.arbitration);
  const graphSet = readRecord(arbitration.graphSet);
  const graphCount = typeof graphSet.graphCount === "number" ? graphSet.graphCount : undefined;
  const sourceCount = typeof graphSet.sourceCount === "number" ? graphSet.sourceCount : undefined;
  const confidenceText = confidence && threshold ? `${confidence}/${threshold}` : confidence;
  return [
    `target ${allowed}`,
    risk,
    confidenceText ? `conf ${confidenceText}` : undefined,
    graphCount ? `graphs ${graphCount}/${sourceCount ?? String.fromCharCode(63)}` : undefined,
    label,
    node ? shortId(node) : undefined,
    sources ? `src ${sources}` : undefined,
    classes ? `proof ${classes}` : undefined
  ].filter((part): part is string => Boolean(part)).join(" · ");
}

function targetEvidenceTone(targetEvidence: Record<string, unknown>): string {
  if (targetEvidence.allowed !== true) {
    return "is-blocked";
  }
  const risk = readString(targetEvidence.risk);
  return risk === "read_only" || risk === "reversible" ? "is-safe" : "is-warning";
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function collectToolsmithSourceRows(observations: ComputerSessionDebugBundle["observations"]): ToolsmithSourceRow[] {
  const rows: ToolsmithSourceRow[] = [];
  for (const observation of observations) {
    const sourceSummary = observation.metadata?.sourceSummary;
    const record = readRecord(sourceSummary);
    const summaryRows = Array.isArray(record.rows) ? record.rows : [];
    for (const row of summaryRows) {
      const source = readRecord(row);
      const url = readString(source.url);
      const title = readString(source.title);
      const key = `${url ?? ""}\n${title ?? ""}`;
      if (!url && !title) {
        continue;
      }
      if (rows.some((candidate) => `${candidate.url ?? ""}\n${candidate.title ?? ""}` === key)) {
        continue;
      }
      rows.push({
        title,
        url,
        status: readString(source.status),
        browserFallback: source.browserFallback === true,
        fallbackReason: readString(source.fallbackReason),
        chars: typeof source.chars === "number" ? source.chars : undefined,
        excerpt: readString(source.excerpt)
      });
    }
  }
  return rows;
}

function summarizeToolsmithSource(source: ToolsmithSourceRow): string {
  const parts = [
    source.browserFallback ? `browser fallback${source.fallbackReason ? `:${source.fallbackReason}` : ""}` : "direct/source",
    source.url,
    typeof source.chars === "number" ? `${source.chars} chars` : undefined,
    source.excerpt
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ") || "source evidence";
}

function summarizeToolsmithSourceQuality(rows: ToolsmithSourceRow[]): {
  quality: string;
  directCount: number;
  fallbackCount: number;
  blockedCount: number;
  charCount: number;
} {
  const fallbackCount = rows.filter((row) => row.browserFallback).length;
  const blockedCount = rows.filter((row) => /blocked|failed|missing/i.test(row.status ?? "")).length;
  const directCount = rows.filter((row) => !row.browserFallback && !/blocked|failed|missing/i.test(row.status ?? "")).length;
  const charCount = rows.reduce((sum, row) => sum + Math.max(0, row.chars ?? 0), 0);
  const quality = rows.length === 0
    ? "none"
    : blockedCount > 0
      ? "mixed"
      : fallbackCount > 0 && directCount > 0
        ? "hybrid"
        : fallbackCount > 0
          ? "fallback"
          : "direct";
  return { quality, directCount, fallbackCount, blockedCount, charCount };
}

function summarizeArtifactProof(resources: ComputerSessionDebugBundle["evalResources"]): {
  total: number;
  blobCount: number;
  textCount: number;
  pdfCount: number;
  missingBlobCount: number;
} {
  const blobCount = resources.filter((resource) => Boolean(resource.blobId)).length;
  const textCount = resources.filter(isTextArtifactResource).length;
  const pdfCount = resources.filter((resource) => /pdf/i.test(resource.role)).length;
  return {
    total: resources.length,
    blobCount,
    textCount,
    pdfCount,
    missingBlobCount: resources.length - blobCount
  };
}

function summarizeArtifactResource(resource: ComputerSessionDebugBundle["evalResources"][number]): string {
  const redaction = readRecord(resource.redaction);
  const basename = readString(redaction.basename);
  const mode = readString(redaction.mode);
  const id = resource.blobId
    ? `blob ${shortId(resource.blobId)}`
    : resource.capabilityResourceId
      ? `cap ${shortId(resource.capabilityResourceId)}`
      : shortId(resource.id);
  return [basename, id, mode].filter((part): part is string => Boolean(part)).join(" · ");
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return `${value}`;
}

function isArtifactResource(resource: ComputerSessionDebugBundle["evalResources"][number]): boolean {
  return /artifact|file|toolsmith|report|pdf|citation|markdown|download/i.test(resource.role) &&
    resource.role !== "perception_graph";
}

function isTextArtifactResource(resource: ComputerSessionDebugBundle["evalResources"][number]): boolean {
  return /report|citation|markdown|json|text|stdout|source/i.test(resource.role) &&
    !/pdf|image|download/i.test(resource.role);
}

function readActionType(input: Record<string, unknown>): string {
  const action = readRecord(input.action);
  return readString(action.type) ?? readString(input.type) ?? "action";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

async function fetchJson<T>(daemonPort: string, path: string): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${daemonPort}${path}`);
  const payload = await response.json() as T;
  if (!response.ok) {
    throw new Error(readPayloadError(payload) ?? `${path} returned ${response.status}`);
  }
  return payload;
}

async function postJson<T = { ok: boolean; error?: string }>(daemonPort: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${daemonPort}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as T;
  if (!response.ok) {
    throw new Error(readPayloadError(payload) ?? `${path} returned ${response.status}`);
  }
  return payload;
}

function readPayloadError(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>).error === "string"
    ? (value as Record<string, unknown>).error as string
    : undefined;
}
