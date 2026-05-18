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
import {
  promotionGateLabel,
  promotionGateTone,
  summarizeBrowserChromePublicExtensionProof,
  summarizeNativeBoundaryProof,
  summarizePromotionGate,
  summarizeToolsmithGeneratedToolLiveBreadthProof,
  summarizeToolsmithSelfImplementationProof
} from "./computer-use/promotionGateSummary";
import {
  collectBrowserChromeEvidenceRows,
  collectProfileGrantDetails,
  collectTerminalDeltaEvidenceRows,
  createComputerUseSuperYoloProfileDraft,
  createComputerUseYoloProfileDraft,
  createSafeManagedProfileDraft,
  deriveOneTimeProfileRequirements,
  formatCountOrList,
  formatProfileUse,
  grantsFromPermissionRequirements,
  profileToEditablePayload,
  summarizeOneTimeProfileDraft,
  summarizeTerminalDeltaProof,
  validateManagedProfileDraft
} from "./computer-use/permissionEvidenceHelpers";
import { ApprovalRow } from "./computer-use/ApprovalRow";
import {
  collectObservationPreviewPairs,
  collectToolsmithSourceRows,
  formatCompactNumber,
  formatObservationPreviewMeta,
  formatTargetEvidencePreview,
  isArtifactResource,
  isTextArtifactResource,
  readRecord,
  shortId,
  summarizeActionFeedback,
  summarizeArtifactProof,
  summarizeArtifactResource,
  summarizeFailureMemory,
  summarizeObservationPreview,
  summarizeToolsmithSource,
  summarizeToolsmithSourceQuality,
  summarizeVerifierAudit,
  targetEvidenceTone,
  verifierAuditTone
} from "./computer-use/debugBundleSummary";

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

type SuperYoloToggleId =
  | "network"
  | "browser"
  | "terminal"
  | "generated"
  | "packageInstall"
  | "fileRead"
  | "fileWrite"
  | "osMutation"
  | "highRisk"
  | "credentialCookieCaptcha"
  | "paymentPurchase";

type SuperYoloToggleState = Record<SuperYoloToggleId, boolean>;

const SUPER_YOLO_TOGGLES: Array<{ id: SuperYoloToggleId; label: string; detail: string; disclaimer?: string }> = [
  { id: "network", label: "Network", detail: "Allow broad outbound network domains." },
  { id: "browser", label: "Browser", detail: "Allow broad browser automation domains." },
  { id: "terminal", label: "Terminal", detail: "Allow common local command prefixes." },
  { id: "generated", label: "Generated tools", detail: "Allow Toolsmith materialize, execute, and generated code." },
  { id: "packageInstall", label: "Packages", detail: "Allow isolated runtime package installs." },
  { id: "fileRead", label: "File read", detail: "Allow broad user-profile read root." },
  { id: "fileWrite", label: "File write", detail: "Allow Codex public output write root." },
  { id: "osMutation", label: "OS mutation", detail: "Allow explicit OS mutation requirements." },
  { id: "highRisk", label: "High risk", detail: "Allow high-risk scoped autonomy class." },
  {
    id: "credentialCookieCaptcha",
    label: "Credential / Cookie / CAPTCHA",
    detail: "Release the profile-level boundary for credential, cookie, and CAPTCHA-labeled work.",
    disclaimer: "Disclaimer: user accepts account-security, privacy, lockout, site-terms, and CAPTCHA-policy risk. Credential leases and redaction still apply."
  },
  {
    id: "paymentPurchase",
    label: "Payment / Purchase",
    detail: "Release the profile-level boundary for payment and purchase-labeled work.",
    disclaimer: "Disclaimer: user accepts financial, order, refund, tax, subscription, and legal responsibility. Commit actions may still require explicit approval."
  }
];

const SUPER_YOLO_COMMAND_PREFIXES = [
  "node *",
  "npm *",
  "npx *",
  "git *",
  "python *",
  "py *",
  "powershell *",
  "pwsh *"
];

const SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_DENY_PATTERNS = [
  "cookie",
  "password",
  "credential",
  "secret",
  "token",
  "captcha"
];

const SUPER_YOLO_PAYMENT_PURCHASE_DENY_PATTERNS = [
  "purchase",
  "payment",
  "pay",
  "checkout",
  "card"
];

const SUPER_YOLO_COMMAND_DENY_PATTERNS = [
  ...SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_DENY_PATTERNS,
  ...SUPER_YOLO_PAYMENT_PURCHASE_DENY_PATTERNS
];

const SUPER_YOLO_FILE_READ_ROOTS = ["C:\\Users"];
const SUPER_YOLO_FILE_WRITE_ROOTS = ["C:\\Users\\Public\\Documents\\Codex Outputs"];
const SUPER_YOLO_RISK_CLASSES: AutonomyRiskClass[] = ["read_only", "reversible", "side_effect", "high_risk"];
const SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_BOUNDARIES = [
  "credential_and_cookie_values_are_never_extracted",
  "captcha_bypass_is_blocked",
  "credential_cookie_captcha_override_default_off"
];
const SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_RELEASE_BOUNDARIES = [
  "credential_cookie_captcha_boundary_released_by_user",
  "DISCLAIMER: credential_cookie_captcha_override_acknowledged_user_accepts_account_security_privacy_lockout_site_terms_and_captcha_policy_risk"
];
const SUPER_YOLO_PAYMENT_PURCHASE_BOUNDARIES = [
  "purchase_payment_submit_require_explicit_user_commit",
  "payment_purchase_override_default_off"
];
const SUPER_YOLO_PAYMENT_PURCHASE_RELEASE_BOUNDARIES = [
  "payment_purchase_boundary_released_by_user",
  "DISCLAIMER: payment_purchase_override_acknowledged_user_accepts_financial_order_refund_tax_subscription_and_legal_responsibility"
];

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
  const superYoloToggleState = useMemo(
    () => readSuperYoloToggleState(profileDraft),
    [profileDraft]
  );
  const yoloDraftEnabled = useMemo(
    () => isComputerUseYoloDraft(profileDraft) || superYoloToggleState !== null,
    [profileDraft, superYoloToggleState]
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

  function startComputerUseYoloProfileCreate() {
    setManagedProfileId("");
    setProfileDraftMode("create");
    setProfileDraft(JSON.stringify(createComputerUseYoloProfileDraft(), null, 2));
    setMessage("Computer Use YOLO one-time profile draft ready.");
  }

  function startComputerUseSuperYoloProfileCreate() {
    if (!yoloDraftEnabled) {
      setMessage("Turn on YOLO first, then activate SUPER-YOLO.");
      return;
    }
    const confirmed = window.confirm([
      "SUPER-YOLO creates a one-time profile with broad local/browser/network permissions.",
      "Credential/cookie/CAPTCHA and payment/purchase overrides are off by default.",
      "If you enable either override, review its disclaimer and accept the related account, privacy, financial, and legal risk.",
      "Review each permission toggle before saving. Continue?"
    ].join("\n\n"));
    if (!confirmed) {
      setMessage("Computer Use SUPER-YOLO activation cancelled.");
      return;
    }
    setManagedProfileId("");
    setProfileDraftMode("create");
    setProfileDraft(JSON.stringify(createComputerUseSuperYoloProfileDraft(), null, 2));
    setMessage("Computer Use SUPER-YOLO one-time profile draft ready. Review each grant toggle before saving.");
  }

  function updateSuperYoloGrant(toggleId: SuperYoloToggleId, enabled: boolean) {
    const nextDraft = updateSuperYoloProfileDraftGrant(profileDraft, toggleId, enabled);
    if (!nextDraft) {
      setMessage("SUPER-YOLO draft is not valid JSON.");
      return;
    }
    setProfileDraft(nextDraft);
    setMessage(`SUPER-YOLO ${toggleLabel(toggleId)} ${enabled ? "enabled" : "disabled"}.`);
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
            <Metric label="Leases" value={`${selectedProfile.grants.credentialLeases?.filter((lease) => lease.status === "active").length ?? 0}`} />
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
            <button type="button" aria-label="New Computer Use YOLO profile" disabled={status === "loading"} onClick={startComputerUseYoloProfileCreate}>
              <ShieldCheck size={10} />
              YOLO
            </button>
            <button
              type="button"
              aria-label="Activate Computer Use SUPER-YOLO profile"
              disabled={status === "loading" || !yoloDraftEnabled}
              onClick={startComputerUseSuperYoloProfileCreate}
            >
              <ShieldCheck size={10} />
              Super
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
        {superYoloToggleState ? (
          <div className="computer-use-super-yolo-controls" aria-label="SUPER-YOLO permission toggles">
            <div className="computer-use-super-yolo-head">
              <strong>SUPER-YOLO grants</strong>
              <small>One-time only · credentials stay never · hard safety boundaries remain active</small>
            </div>
            <div className="computer-use-super-yolo-grid">
              {SUPER_YOLO_TOGGLES.map((toggle) => (
                <label key={toggle.id} className="computer-use-super-yolo-toggle">
                  <input
                    type="checkbox"
                    checked={superYoloToggleState[toggle.id]}
                    onChange={(event) => updateSuperYoloGrant(toggle.id, event.target.checked)}
                  />
                  <span>
                    <strong>{toggle.label}</strong>
                    <small>{toggle.detail}</small>
                    {toggle.disclaimer ? <small className="super-yolo-disclaimer">{toggle.disclaimer}</small> : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
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

function isComputerUseYoloDraft(draft: string): boolean {
  const payload = parseProfileDraft(draft);
  if (!payload) {
    return false;
  }
  return payload.name === "Computer Use YOLO one-time profile";
}

function readSuperYoloToggleState(draft: string): SuperYoloToggleState | null {
  const payload = parseProfileDraft(draft);
  if (!payload || !isSuperYoloProfilePayload(payload)) {
    return null;
  }
  const grants = readRecord(payload.grants);
  const filesystem = readRecord(grants.filesystem);
  const commands = readRecord(grants.commands);
  const denyPatterns = readStringArrayValue(commands.denyPatterns);
  const safetyBoundaries = readStringArrayValue(payload.safetyBoundaries);
  const riskClasses = readStringArrayValue(grants.riskClasses);
  return {
    network: grants.network === true && readStringArrayValue(grants.networkDomains).includes("*"),
    browser: grants.browserAutomation === true && readStringArrayValue(grants.browserDomains).includes("*"),
    terminal: readStringArrayValue(commands.allowPrefixes).length > 0,
    generated: grants.generatedToolMaterialization === true && grants.generatedToolExecution === true && grants.generatedCode === true,
    packageInstall: grants.packageInstall === true,
    fileRead: readStringArrayValue(filesystem.readRoots).length > 0,
    fileWrite: readStringArrayValue(filesystem.writeRoots).length > 0,
    osMutation: grants.osMutation === true,
    highRisk: riskClasses.includes("high_risk"),
    credentialCookieCaptcha: safetyBoundaries.includes("credential_cookie_captcha_boundary_released_by_user") &&
      !hasAnyValue(denyPatterns, SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_DENY_PATTERNS),
    paymentPurchase: safetyBoundaries.includes("payment_purchase_boundary_released_by_user") &&
      !hasAnyValue(denyPatterns, SUPER_YOLO_PAYMENT_PURCHASE_DENY_PATTERNS)
  };
}

function updateSuperYoloProfileDraftGrant(draft: string, toggleId: SuperYoloToggleId, enabled: boolean): string | null {
  const payload = parseProfileDraft(draft);
  if (!payload || !isSuperYoloProfilePayload(payload)) {
    return null;
  }
  const grants = ensureRecordField(payload, "grants");
  const filesystem = ensureRecordField(grants, "filesystem");
  const commands = ensureRecordField(grants, "commands");
  switch (toggleId) {
    case "network":
      grants.network = enabled;
      grants.networkDomains = enabled ? ["*"] : [];
      break;
    case "browser":
      grants.browserAutomation = enabled;
      grants.browserDomains = enabled ? ["*"] : [];
      break;
    case "terminal":
      commands.allowPrefixes = enabled ? [...SUPER_YOLO_COMMAND_PREFIXES] : [];
      commands.denyPatterns = [...SUPER_YOLO_COMMAND_DENY_PATTERNS];
      break;
    case "generated":
      grants.generatedToolMaterialization = enabled;
      grants.generatedToolExecution = enabled;
      grants.generatedCode = enabled;
      break;
    case "packageInstall":
      grants.packageInstall = enabled;
      grants.packageAllowlist = enabled ? ["*"] : ["file:*"];
      break;
    case "fileRead":
      filesystem.readRoots = enabled ? [...SUPER_YOLO_FILE_READ_ROOTS] : [];
      break;
    case "fileWrite":
      filesystem.writeRoots = enabled ? [...SUPER_YOLO_FILE_WRITE_ROOTS] : [];
      break;
    case "osMutation":
      grants.osMutation = enabled;
      break;
    case "highRisk":
      grants.riskClasses = enabled
        ? [...SUPER_YOLO_RISK_CLASSES]
        : SUPER_YOLO_RISK_CLASSES.filter((riskClass) => riskClass !== "high_risk");
      break;
    case "credentialCookieCaptcha":
      commands.denyPatterns = updateStringSet(
        readStringArrayValue(commands.denyPatterns),
        SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_DENY_PATTERNS,
        !enabled
      );
      payload.safetyBoundaries = updateBoundaryRelease(
        readStringArrayValue(payload.safetyBoundaries),
        SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_BOUNDARIES,
        SUPER_YOLO_CREDENTIAL_COOKIE_CAPTCHA_RELEASE_BOUNDARIES,
        enabled
      );
      break;
    case "paymentPurchase":
      commands.denyPatterns = updateStringSet(
        readStringArrayValue(commands.denyPatterns),
        SUPER_YOLO_PAYMENT_PURCHASE_DENY_PATTERNS,
        !enabled
      );
      payload.safetyBoundaries = updateBoundaryRelease(
        readStringArrayValue(payload.safetyBoundaries),
        SUPER_YOLO_PAYMENT_PURCHASE_BOUNDARIES,
        SUPER_YOLO_PAYMENT_PURCHASE_RELEASE_BOUNDARIES,
        enabled
      );
      break;
  }
  grants.credentialAccess = "never";
  grants.credentialLeases = [];
  const riskClasses = readStringArrayValue(grants.riskClasses).filter((riskClass) => riskClass !== "credential");
  grants.riskClasses = riskClasses.length ? riskClasses : ["read_only"];
  const boundaries = readStringArrayValue(payload.safetyBoundaries);
  if (!boundaries.includes("super_yolo_requires_user_confirmation")) {
    payload.safetyBoundaries = ["super_yolo_requires_user_confirmation", ...boundaries];
  }
  return JSON.stringify(payload, null, 2);
}

function updateBoundaryRelease(
  current: string[],
  blockedBoundaries: string[],
  releaseBoundaries: string[],
  released: boolean
): string[] {
  const removal = new Set(released ? blockedBoundaries : releaseBoundaries);
  const additions = released ? releaseBoundaries : blockedBoundaries;
  return [...new Set([...current.filter((boundary) => !removal.has(boundary)), ...additions])];
}

function updateStringSet(current: string[], values: string[], include: boolean): string[] {
  const removal = new Set(values.map((value) => value.toLowerCase()));
  const filtered = current.filter((value) => !removal.has(value.toLowerCase()));
  return include ? [...new Set([...filtered, ...values])] : filtered;
}

function hasAnyValue(current: string[], values: string[]): boolean {
  const currentSet = new Set(current.map((value) => value.toLowerCase()));
  return values.some((value) => currentSet.has(value.toLowerCase()));
}

function isSuperYoloProfilePayload(payload: Record<string, unknown>): boolean {
  const boundaries = readStringArrayValue(payload.safetyBoundaries);
  return payload.name === "Computer Use SUPER-YOLO one-time profile" ||
    boundaries.includes("super_yolo_requires_user_confirmation");
}

function parseProfileDraft(draft: string): Record<string, unknown> | null {
  try {
    const payload = JSON.parse(draft || "{}");
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function ensureRecordField(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = target[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

function readStringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toggleLabel(toggleId: SuperYoloToggleId): string {
  return SUPER_YOLO_TOGGLES.find((toggle) => toggle.id === toggleId)?.label ?? toggleId;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
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

function readPayloadError(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>).error === "string"
    ? (value as Record<string, unknown>).error as string
    : undefined;
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
