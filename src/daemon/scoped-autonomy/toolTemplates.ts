import type { AutonomyGeneratedToolSpec } from "../../shared/protocol.js";
import { BROWSER_DOWNLOAD_VERIFY_TOOL } from "./tool-templates/browserDownloadVerify.js";
import { FAILING_SMOKE_TOOL } from "./tool-templates/failingSmoke.js";
import { LOCAL_DOCUMENT_CONVERSION_TOOL } from "./tool-templates/localDocumentConversion.js";
import { TERMINAL_GENERATED_TOOL } from "./tool-templates/terminalGeneratedTool.js";
import { WEB_RESEARCH_TO_PDF_TOOL } from "./tool-templates/webResearchToPdf.js";

export function sourceForSpec(spec: AutonomyGeneratedToolSpec, forceSmokeFailure?: boolean): string {
  if (forceSmokeFailure) {
    return FAILING_SMOKE_TOOL;
  }
  if (spec.capability === "terminal_generated_tool") {
    return TERMINAL_GENERATED_TOOL;
  }
  if (spec.capability === "browser_download_verify") {
    return BROWSER_DOWNLOAD_VERIFY_TOOL;
  }
  if (spec.capability === "local_document_conversion") {
    return LOCAL_DOCUMENT_CONVERSION_TOOL;
  }
  return WEB_RESEARCH_TO_PDF_TOOL;
}

export function entrypointNameForSpec(spec: AutonomyGeneratedToolSpec): string {
  if (spec.capability === "terminal_generated_tool") {
    return "terminal-generated-tool.mjs";
  }
  if (spec.capability === "browser_download_verify") {
    return "browser-download-verify.mjs";
  }
  if (spec.capability === "local_document_conversion") {
    return "local-document-conversion.mjs";
  }
  return "web-research-to-pdf.mjs";
}
