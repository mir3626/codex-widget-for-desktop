import { randomUUID } from "node:crypto";
import type {
  AutonomyCapabilityGap,
  AutonomyGeneratedToolSpec,
  AutonomyRequestDecomposition
} from "../../shared/protocol.js";

export function requestedCapabilityForDecomposition(decomposition: AutonomyRequestDecomposition): string {
  const operations = new Set(decomposition.operations);
  if (operations.has("download_verify")) {
    return "browser_download_verify";
  }
  if (operations.has("generate_terminal_tool") || operations.has("execute_terminal_tool")) {
    return "terminal_generated_tool";
  }
  if (operations.has("browser_chrome_control")) {
    return "browser_chrome_direct_control";
  }
  if (operations.has("native_windows_action") || operations.has("native_windows_observe")) {
    return "native_windows_workflow";
  }
  if (operations.has("render_pdf") && operations.has("draft_markdown") && !operations.has("crawl_or_observe") && !operations.has("extract")) {
    return "local_document_conversion";
  }
  if (operations.has("render_pdf") && (operations.has("crawl_or_observe") || operations.has("extract"))) {
    return "web_research_to_pdf";
  }
  return "unknown";
}

export function createToolSpecForGap(gap: AutonomyCapabilityGap): AutonomyGeneratedToolSpec {
  const now = new Date().toISOString();
  if (gap.requestedCapability === "web_research_to_pdf") {
    return {
      id: gap.suggestedToolId ?? "tool-web-research-to-pdf",
      name: "Web Research To PDF",
      capability: "web_research_to_pdf",
      version: "0.2.0",
      status: "proposed",
      templateId: "web_research_to_pdf.v2",
      entrypointKind: "node_script",
      description: "Fetch allowed sources, extract evidence, draft Markdown, render PDF, and verify artifacts through staged DAG commands.",
      requiredGrants: gap.requiredGrants,
      smokeTests: [
        {
          id: "fixture-report-pdf",
          description: "Create markdown, citations, and PDF artifacts from deterministic fixture content.",
          expectedArtifacts: ["report.md", "report.pdf", "citations.json"]
        }
      ],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
  }
  if (gap.requestedCapability === "terminal_generated_tool") {
    return {
      id: gap.suggestedToolId ?? `tool-terminal-generated-${randomUUID().slice(0, 8)}`,
      name: "Terminal Generated Tool",
      capability: "terminal_generated_tool",
      version: "0.1.0",
      status: "proposed",
      templateId: "terminal_generated_tool.v1",
      entrypointKind: "node_script",
      description: "Execute a narrowly allowed local command without shell expansion and capture stdout/stderr artifacts.",
      requiredGrants: gap.requiredGrants,
      smokeTests: [
        {
          id: "terminal-wrapper-smoke",
          description: "Write deterministic stdout artifacts without running an external command.",
          expectedArtifacts: ["stdout.json", "stdout.txt"]
        }
      ],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
  }
  if (gap.requestedCapability === "browser_download_verify") {
    return {
      id: gap.suggestedToolId ?? `tool-browser-download-verify-${randomUUID().slice(0, 8)}`,
      name: "Browser Download Verify",
      capability: "browser_download_verify",
      version: "0.1.0",
      status: "proposed",
      templateId: "browser_download_verify.v1",
      entrypointKind: "node_script",
      description: "Verify a downloaded file exists, meets size constraints, and optionally matches a SHA-256 digest.",
      requiredGrants: gap.requiredGrants,
      smokeTests: [
        {
          id: "download-verify-smoke",
          description: "Verify a deterministic fixture download file in the generated workspace.",
          expectedArtifacts: ["download-verification.json"]
        }
      ],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
  }
  if (gap.requestedCapability === "local_document_conversion") {
    return {
      id: gap.suggestedToolId ?? `tool-local-document-conversion-${randomUUID().slice(0, 8)}`,
      name: "Local Document Conversion",
      capability: "local_document_conversion",
      version: "0.1.0",
      status: "proposed",
      templateId: "local_document_conversion.v1",
      entrypointKind: "node_script",
      description: "Convert supplied Markdown or text into Markdown/PDF artifacts through a bounded local converter.",
      requiredGrants: gap.requiredGrants,
      smokeTests: [
        {
          id: "local-document-conversion-smoke",
          description: "Convert deterministic Markdown fixture content into report.md and report.pdf.",
          expectedArtifacts: ["report.md", "report.pdf"]
        }
      ],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
  }
  return {
    id: gap.suggestedToolId ?? `tool-${gap.requestedCapability}`,
    name: String(gap.requestedCapability),
    capability: String(gap.requestedCapability),
    version: "0.1.0",
    status: "blocked",
    templateId: "unsupported",
    entrypointKind: "internal_template",
    description: "No reviewed built-in or ad hoc generator exists for this capability gap yet.",
    requiredGrants: gap.requiredGrants,
    smokeTests: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now
  };
}

export function isExecutableSpec(spec: AutonomyGeneratedToolSpec): boolean {
  return spec.status === "active" || spec.status === "materialized" || spec.status === "proposed";
}

export function isUnsupportedSpec(spec: AutonomyGeneratedToolSpec): boolean {
  return spec.templateId === "unsupported" || spec.status === "blocked" || spec.entrypointKind !== "node_script";
}

export function canImplementGap(gap: AutonomyCapabilityGap): boolean {
  return [
    "web_research_to_pdf",
    "local_document_conversion",
    "terminal_generated_tool",
    "browser_download_verify"
  ].includes(gap.requestedCapability);
}

export function isExternalOrUnsupportedGap(gap: AutonomyCapabilityGap): boolean {
  if (canImplementGap(gap)) {
    return false;
  }
  return gap.blockerClassification === "external_contract" ||
    gap.blockerClassification === "safety_boundary" ||
    gap.blockerClassification === "unsupported_template";
}

export function inferDefaultUrls(goal: string): string[] {
  if (/openai|codex/i.test(goal)) {
    return [
      "https://openai.com/codex/",
      "https://platform.openai.com/docs/codex"
    ];
  }
  return [];
}
