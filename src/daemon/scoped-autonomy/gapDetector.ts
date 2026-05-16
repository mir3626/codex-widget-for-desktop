import type {
  AutonomyCapabilityGap,
  AutonomyCapabilityGapCategory,
  AutonomyCapabilityClass,
  AutonomyRequestDecomposition,
  AutonomyRiskClass,
  AutonomyPermissionRequirement
} from "../../shared/protocol.js";

export function decomposeAutonomyRequest(goal: string): AutonomyRequestDecomposition {
  const normalized = goal.toLowerCase();
  const operations: string[] = [];
  const expectedArtifacts: string[] = [];
  const evidenceNeeds: string[] = [];
  if (/(research|crawl|search|homepage|website|docs|조사|검색|홈페이지|문서화|정리)/i.test(normalized)) {
    operations.push("crawl_or_observe", "extract", "verify_sources");
    evidenceNeeds.push("urls_fetched", "source_titles", "extraction_notes");
  }
  if (/(pdf|report|markdown|md|convert|conversion|문서|보고서|파일|변환)/i.test(normalized)) {
    operations.push("draft_markdown", "render_pdf", "store_artifact", "verify_artifact");
    expectedArtifacts.push("report.md", "report.pdf");
  }
  if (needsBrowserChromeDirectControl(normalized)) {
    operations.push("browser_chrome_control");
    evidenceNeeds.push("browser_surface", "action_result");
  }
  if (needsDownloadVerification(normalized)) {
    operations.push("download_verify", "verify_artifact");
    evidenceNeeds.push("download_path", "file_size", "digest_or_mtime");
  }
  if (needsNativeWindowsWorkflow(normalized)) {
    operations.push("native_windows_observe", "native_windows_action");
    evidenceNeeds.push("native_helper_scope", "approval_record");
  }
  if (needsGeneratedTerminalTool(normalized)) {
    operations.push("generate_terminal_tool", "execute_terminal_tool");
    evidenceNeeds.push("command_allowlist", "stdout_stderr");
  }
  const riskClass: AutonomyRiskClass = needsNativeWindowsWorkflow(normalized)
    ? "high_risk"
    : needsBrowserChromeDirectControl(normalized) || needsGeneratedTerminalTool(normalized)
      ? "side_effect"
      : "read_only";
  return {
    goal,
    operations: [...new Set(operations.length ? operations : ["manual_planning"])],
    expectedArtifacts,
    riskClass,
    evidenceNeeds: [...new Set(evidenceNeeds)]
  };
}

export function detectAutonomyCapabilityGaps(input: {
  goal: string;
  runId?: string;
  availableCapabilities?: string[];
  outputRoot?: string;
}): AutonomyCapabilityGap[] {
  const goal = input.goal.trim();
  const normalized = goal.toLowerCase();
  const available = new Set(input.availableCapabilities ?? []);
  const gaps: AutonomyCapabilityGap[] = [];
  const createdAt = new Date().toISOString();
  const decomposition = decomposeAutonomyRequest(goal);

  if (needsWebResearchToPdf(normalized) && !available.has("web_research_to_pdf")) {
    gaps.push(createGap({
      id: "gap-web-research-to-pdf",
      runId: input.runId,
      category: "web_research",
      requestedCapability: "web_research_to_pdf",
      reason: "The request needs source collection, report synthesis, and PDF artifact generation as one bounded workflow.",
      operations: ["crawl_or_observe", "extract", "verify_sources", "draft_markdown", "render_pdf", "store_artifact", "verify_artifact"],
      riskClass: "read_only",
      evidenceNeeds: ["urls_fetched", "source_extraction", "citation_table", "markdown_artifact", "pdf_artifact"],
      fallbackPlan: ["use_fixture_or_supplied_source_documents", "use_builtin_minimal_pdf_renderer_when_pandoc_is_not_granted"],
      blockerClassification: "none",
      requiredGrants: webResearchToPdfRequirements(goal, input.outputRoot),
      suggestedToolId: "tool-web-research-to-pdf",
      proposedTool: {
        templateId: "web_research_to_pdf.v2",
        entrypointKind: "node_script",
        expectedArtifacts: ["report.md", "report.pdf", "citations.json"]
      },
      blockers: [],
      createdAt
    }));
  }

  if (needsDownloadVerification(normalized) && !available.has("browser_download_verify")) {
    gaps.push(createGap({
      id: "gap-browser-download-verify",
      runId: input.runId,
      category: "download_verification",
      requestedCapability: "browser_download_verify",
      reason: "The request needs a bounded verifier for a downloaded browser artifact.",
      operations: ["download_verify", "verify_artifact"],
      riskClass: "read_only",
      evidenceNeeds: ["download_path", "file_size", "sha256_or_mtime", "verification_result"],
      fallbackPlan: ["ask_for_download_path_if_browser_download_surface_is_not_available"],
      blockerClassification: "none",
      requiredGrants: [
        { type: "generated_tool_materialization", value: "browser_download_verify", reason: "Toolsmith must materialize the download verifier." },
        { type: "generated_tool_execution", value: "browser_download_verify", reason: "The generated verifier must execute after smoke tests." },
        { type: "risk_class", value: "read_only", reason: "Download verification reads local metadata without mutating the file." },
        { type: "filesystem_read", value: input.outputRoot ?? "downloads", reason: "The verifier must read the downloaded file path." }
      ],
      suggestedToolId: "tool-browser-download-verify",
      proposedTool: {
        templateId: "browser_download_verify.v1",
        entrypointKind: "node_script",
        expectedArtifacts: ["download-verification.json"]
      },
      blockers: [],
      createdAt
    }));
  }

  if (needsLocalDocumentConversion(normalized) && !available.has("local_document_conversion")) {
    const requiredGrants: AutonomyPermissionRequirement[] = [
      { type: "generated_tool_materialization", value: "local_document_conversion", reason: "Toolsmith must materialize the document converter." },
      { type: "generated_tool_execution", value: "local_document_conversion", reason: "The generated converter must execute after smoke tests." },
      { type: "risk_class", value: "read_only", reason: "Local document conversion reads supplied content and writes local artifacts." }
    ];
    if (input.outputRoot) {
      requiredGrants.push({ type: "filesystem_write", value: input.outputRoot, reason: "The generated converter must write Markdown/PDF artifacts." });
    }
    gaps.push(createGap({
      id: "gap-local-document-conversion",
      runId: input.runId,
      category: "document_conversion",
      requestedCapability: "local_document_conversion",
      reason: "The request needs a bounded local Markdown/text-to-PDF conversion workflow without web research.",
      operations: ["draft_markdown", "render_pdf", "store_artifact", "verify_artifact"],
      riskClass: "read_only",
      evidenceNeeds: ["source_content_hash", "markdown_artifact", "pdf_artifact", "artifact_verifier"],
      fallbackPlan: ["use_builtin_minimal_pdf_renderer_when_pandoc_is_not_granted", "block_if_source_path_is_outside_read_roots"],
      blockerClassification: "none",
      requiredGrants,
      suggestedToolId: "tool-local-document-conversion",
      proposedTool: {
        templateId: "local_document_conversion.v1",
        entrypointKind: "node_script",
        expectedArtifacts: ["report.md", "report.pdf"]
      },
      blockers: [],
      createdAt
    }));
  }

  if (needsBrowserChromeDirectControl(normalized) && !available.has("browser_chrome_direct_control")) {
    gaps.push(createGap({
      id: "gap-browser-chrome-direct-control",
      runId: input.runId,
      category: "browser_chrome",
      requestedCapability: "browser_chrome_direct_control",
      reason: "The request targets browser chrome UI such as bookmarks, settings, downloads, or extension reload state.",
      operations: ["browser_chrome_control", "verify_action"],
      riskClass: "side_effect",
      evidenceNeeds: ["browser_surface", "action_result", "post_action_observation"],
      fallbackPlan: ["use_browser_bridge_command_when_available", "block_and_explain_if_native_helper_scope_is_missing"],
      blockerClassification: "external_contract",
      requiredGrants: [
        { type: "browser_automation", value: "browser_chrome", reason: "Browser chrome workflow needs an explicitly bounded active browser surface." },
        { type: "browser_domain", value: "*", reason: "Browser chrome workflow needs an explicitly bounded active browser surface." },
        { type: "risk_class", value: "side_effect", reason: "Browser chrome actions can change browser state." }
      ],
      suggestedToolId: "tool-browser-chrome-direct-control",
      blockers: ["native_helper_or_extension_command_surface_required"],
      createdAt
    }));
  }

  if (needsNativeWindowsWorkflow(normalized) && !available.has("native_windows_workflow")) {
    gaps.push(createGap({
      id: "gap-native-windows-workflow",
      runId: input.runId,
      category: "native_windows",
      requestedCapability: "native_windows_workflow",
      reason: "The request needs bounded Windows UI Automation/native helper behavior beyond screenshot/OCR observation.",
      operations: ["native_windows_observe", "native_windows_action", "verify_action"],
      riskClass: "high_risk",
      evidenceNeeds: ["signed_helper", "approval_record", "pre_post_state"],
      fallbackPlan: ["block_high_risk_mutation_without_signed_helper_and_explicit_os_grant"],
      blockerClassification: "safety_boundary",
      requiredGrants: [
        { type: "risk_class", value: "high_risk", reason: "Windows Settings changes are high risk." },
        { type: "os_mutation", value: "windows_settings_or_app_surface", reason: "Windows Settings or app workflow may mutate OS/app state." },
        { type: "generated_tool_execution", value: "native_helper", reason: "A bounded native helper must be executed." }
      ],
      suggestedToolId: "tool-native-windows-workflow",
      blockers: ["signed_native_helper_scope_required"],
      createdAt
    }));
  }

  if (needsAsrRuntime(normalized) && !available.has("local_asr_runtime")) {
    gaps.push(createGap({
      id: "gap-local-asr-runtime",
      runId: input.runId,
      category: "asr_runtime",
      requestedCapability: "local_asr_runtime",
      reason: "The request needs real microphone ASR or runtime/model selection beyond deterministic transcript decoding.",
      operations: ["load_asr_runtime", "transcribe_audio", "decode_command_slots"],
      riskClass: "read_only",
      evidenceNeeds: ["audio_retention_policy", "transcript_candidates", "latency_metrics"],
      fallbackPlan: ["use_mock_or_existing_transcript_path_until_human_corpus_is_resumed"],
      blockerClassification: "external_contract",
      requiredGrants: [
        { type: "filesystem_read", value: ".runtime/asr", reason: "Local ASR runtime/model files must be readable." }
      ],
      suggestedToolId: "tool-local-asr-runtime",
      blockers: ["human_microphone_corpus_benchmark_deferred", "gpu_validation_deferred"],
      createdAt
    }));
  }

  if (needsGeneratedTerminalTool(normalized) && !available.has("terminal_generated_tool")) {
    gaps.push(createGap({
      id: "gap-terminal-generated-tool",
      runId: input.runId,
      category: "terminal_tool",
      requestedCapability: "terminal_generated_tool",
      reason: "The request appears to need a bounded generated command wrapper rather than a one-off terminal command.",
      operations: ["generate_terminal_tool", "run_smoke", "execute_terminal_tool"],
      riskClass: "side_effect",
      evidenceNeeds: ["generated_source_hash", "command_allowlist", "smoke_result", "stdout_stderr"],
      fallbackPlan: ["block_if_command_prefix_is_not_granted"],
      blockerClassification: "none",
      requiredGrants: [
        { type: "generated_tool_materialization", value: "terminal_tool", reason: "Toolsmith must materialize a generated command wrapper." },
        { type: "generated_tool_execution", value: "terminal_tool", reason: "The generated wrapper must execute after smoke tests." },
        { type: "generated_code", value: "terminal_tool", reason: "Ad hoc terminal helper source must be generated." },
        { type: "risk_class", value: "side_effect", reason: "Terminal tools can affect local state." }
      ],
      suggestedToolId: "tool-terminal-generated",
      proposedTool: {
        templateId: "terminal_generated_tool.v1",
        entrypointKind: "node_script",
        expectedArtifacts: ["stdout.json"]
      },
      blockers: [],
      createdAt
    }));
  }

  if (gaps.length === 0 && goal && decomposition.operations.includes("manual_planning")) {
    gaps.push(createGap({
      id: "gap-unknown",
      runId: input.runId,
      category: "unknown",
      requestedCapability: "unknown",
      reason: "The goal did not match a known missing-capability template.",
      operations: decomposition.operations,
      riskClass: decomposition.riskClass,
      evidenceNeeds: decomposition.evidenceNeeds,
      fallbackPlan: ["manual_planning_required"],
      blockerClassification: "unsupported_template",
      requiredGrants: [],
      blockers: ["manual_planning_required"],
      createdAt
    }));
  }

  return gaps;
}

function createGap(input: AutonomyCapabilityGap): AutonomyCapabilityGap {
  return input;
}

function webResearchToPdfRequirements(goal: string, outputRoot?: string): AutonomyPermissionRequirement[] {
  const domains = inferDomains(goal);
  const requirements: AutonomyPermissionRequirement[] = [
    { type: "network", value: "http_fetch", reason: "The generated research tool may fetch allowed source pages." },
    { type: "risk_class", value: "read_only", reason: "Web research reads public sources and writes local artifacts." },
    { type: "generated_tool_materialization", value: "web_research_to_pdf", reason: "Toolsmith must materialize the report/PDF tool." },
    { type: "generated_tool_execution", value: "web_research_to_pdf", reason: "Generated tool must execute after smoke tests." }
  ];
  for (const domain of domains) {
    requirements.push({ type: "network_domain", value: domain, reason: "The generated research tool may fetch this source domain." });
  }
  if (outputRoot) {
    requirements.push({ type: "filesystem_write", value: outputRoot, reason: "The generated tool must write report artifacts." });
  }
  return requirements;
}

function inferDomains(goal: string): string[] {
  const domains = new Set<string>();
  const urlMatches = goal.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const match of urlMatches) {
    try {
      domains.add(new URL(match).hostname.toLowerCase());
    } catch {
      // Ignore malformed URL fragments; explicit permission evaluation will still block live fetches.
    }
  }
  if (/openai/i.test(goal) || /codex/i.test(goal)) {
    domains.add("openai.com");
    domains.add("help.openai.com");
    domains.add("platform.openai.com");
  }
  return [...domains];
}

function needsWebResearchToPdf(goal: string): boolean {
  return /(pdf|report|문서|보고서|파일)/i.test(goal)
    && /(research|crawl|search|homepage|website|docs|조사|검색|홈페이지|문서화|정리)/i.test(goal);
}

function needsLocalDocumentConversion(goal: string): boolean {
  return !needsWebResearchToPdf(goal)
    && /(pdf|markdown|md|document|convert|conversion|문서|보고서|파일|변환)/i.test(goal)
    && /(pdf|convert|conversion|render|export|markdown|md|문서|파일|변환|저장)/i.test(goal);
}

function needsBrowserChromeDirectControl(goal: string): boolean {
  return /(bookmark|favorite|즐겨찾기|브라우저 설정|extension reload|reload bridge|다운로드|download)/i.test(goal);
}

function needsDownloadVerification(goal: string): boolean {
  return /(download|다운로드)/i.test(goal) && /(verify|확인|검증|hash|sha|size|저장됐는지)/i.test(goal);
}

function needsNativeWindowsWorkflow(goal: string): boolean {
  return /(windows settings|윈도우 설정|제어판|권한 팝업|file picker|파일 선택|앱별|설정 변경)/i.test(goal);
}

function needsAsrRuntime(goal: string): boolean {
  return /(microphone|마이크|asr|음성|녹음|transcription|받아쓰기)/i.test(goal);
}

function needsGeneratedTerminalTool(goal: string): boolean {
  return /(generate tool|script|cli|batch|powershell wrapper|도구 생성|스크립트 생성)/i.test(goal);
}
